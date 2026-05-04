/**
 * Phase 4 — Upsert kept job listings into Supabase + record listing_runs entries.
 *
 * Key invariant: unique key is (company_id, role_url).
 * On conflict: refresh all mutable fields + set last_seen_at=now(), is_active=true.
 *
 * seen_state determination (no raw SQL needed):
 *   - Pre-fetch existing (role_url → { id, is_active }) for each company.
 *   - After upsert, cross-reference: absent → 'new'; was inactive → 'reactivated'; else 'existing'.
 *
 * Batching: 50 rows per Supabase call; max 4 concurrent DB calls.
 */

import { getSupabaseClient } from "./supabase";
import type { RawJob, Company } from "../scrapers/types";
import type { JobEnrichment } from "../filters/types";
import type { ExtractedJD } from "../types/extractedJD";
import { normalizeRoleUrl } from "../lib/normalizeUrl";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ListingToUpsert {
  job: Pick<RawJob, "title" | "role_url" | "location_raw" | "posted_date" | "description">;
  /** company.id must be present — it's the FK into public.companies */
  company: Required<Pick<Company, "id">> & Company;
  enrichment: JobEnrichment;
  tier: 1 | 2 | 3;
  /** APM priority signal — written to the apm_signal column (Bug Fix 15) */
  apm_signal?: "priority_apm" | "apm_company" | "none";
  /** Structured JD extraction result (populated for new/reactivated listings) */
  extracted_jd?: ExtractedJD;
  /** ATS platform that sourced this listing */
  ats_platform?: string;
}

export type SeenState = "new" | "existing" | "reactivated";

export interface UpsertResult {
  listingId: string;
  roleUrl: string;
  companyId: string;
  seenState: SeenState;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BATCH_SIZE = 50;
const MAX_CONCURRENT_DB = 4;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Upsert all kept listings for a single company, then record listing_runs entries.
 *
 * Must be called once per successfully-scraped company (even when listings is empty —
 * the caller still needs the return value to know counts, and the empty case is valid).
 *
 * @returns UpsertResult[] for each successfully upserted row.
 */
export async function upsertCompanyListings(
  companyId: string,
  listings: ListingToUpsert[],
  runId: string,
): Promise<UpsertResult[]> {
  if (listings.length === 0) return [];

  const supabase = getSupabaseClient();

  // 1. Pre-fetch existing rows for this company so we can determine seen_state.
  const { data: existing, error: fetchErr } = await supabase
    .from("job_listings")
    .select("id, role_url, is_active")
    .eq("company_id", companyId);

  if (fetchErr) {
    throw new Error(
      `[upsertListing] Pre-fetch failed for company ${companyId}: ${fetchErr.message}`,
    );
  }

  // Normalize stored URLs so pre-fetch lookup is stable across tracking-param variants.
  const existingMap = new Map<string, { id: string; is_active: boolean }>(
    (existing ?? []).map((r) => [
      normalizeRoleUrl(r.role_url as string),
      { id: r.id as string, is_active: r.is_active as boolean },
    ]),
  );

  // 2. Validate and build rows — skip listings with unusable apply URLs.
  const validListings = listings.filter((item) => {
    if (!isValidApplyUrl(item.job.role_url)) {
      console.warn(
        `[upsertListing] Invalid apply URL skipped — company=${item.company.slug} ` +
        `title="${item.job.title}" url=${item.job.role_url}`,
      );
      return false;
    }
    return true;
  });

  if (validListings.length === 0) return [];

  const rows = validListings.map((item) => buildRow(item));

  // 3. Upsert in batches of BATCH_SIZE, with limited concurrency.
  const allUpserted: Array<{ id: string; role_url: string }> = [];

  const batches: typeof rows[] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    batches.push(rows.slice(i, i + BATCH_SIZE));
  }

  await runWithConcurrency(batches, MAX_CONCURRENT_DB, async (batch) => {
    const { data, error } = await supabase
      .from("job_listings")
      .upsert(batch, { onConflict: "company_id,role_url" })
      .select("id, role_url");

    if (error) {
      throw new Error(`[upsertListing] Upsert batch failed: ${error.message}`);
    }
    allUpserted.push(...((data ?? []) as Array<{ id: string; role_url: string }>));
  });

  // 4. Determine seen_state for each upserted row.
  const results: UpsertResult[] = allUpserted.map((row) => {
    const prior = existingMap.get(normalizeRoleUrl(row.role_url));
    const seenState: SeenState = !prior
      ? "new"
      : prior.is_active === false
      ? "reactivated"
      : "existing";

    return {
      listingId: row.id,
      roleUrl: row.role_url,
      companyId,
      seenState,
    };
  });

  // 5. Insert listing_runs entries in batches.
  const listingRunRows = results.map((r) => ({
    run_id: runId,
    listing_id: r.listingId,
    seen_state: r.seenState,
  }));

  const lrBatches: typeof listingRunRows[] = [];
  for (let i = 0; i < listingRunRows.length; i += BATCH_SIZE) {
    lrBatches.push(listingRunRows.slice(i, i + BATCH_SIZE));
  }

  await runWithConcurrency(lrBatches, MAX_CONCURRENT_DB, async (batch) => {
    const { error } = await supabase.from("listing_runs").insert(batch);
    if (error) {
      // Non-fatal: listing_runs is a ledger, not critical to correctness.
      console.warn(`[upsertListing] listing_runs insert failed: ${error.message}`);
    }
  });

  return results;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Reject URLs that would produce a broken apply link in the email digest.
 * Called before normalizeRoleUrl so we catch problems before they reach Supabase.
 */
function isValidApplyUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      (u.protocol === "https:" || u.protocol === "http:") &&
      u.hostname.length > 0 &&
      u.pathname.length > 1 &&            // not just '/'
      !u.pathname.includes("undefined") &&
      !u.pathname.includes("null") &&
      !u.hash.startsWith("#section")      // anchor-only section links, not apply URLs
    );
  } catch {
    return false;
  }
}

function buildRow(item: ListingToUpsert): Record<string, unknown> {
  const { job, company, enrichment, tier } = item;

  // Clamp posted_date to today if it's in the future.
  let postedDate = job.posted_date ?? null;
  if (postedDate) {
    const today = new Date().toISOString().slice(0, 10);
    if (postedDate > today) {
      console.warn(
        `[upsertListing] Future posted_date clamped: ${postedDate} → ${today} (${job.role_url})`,
      );
      postedDate = today;
    }
  }

  return {
    company_id: company.id,
    role_url: normalizeRoleUrl(job.role_url),
    title: job.title,
    location_raw: job.location_raw ?? null,
    location_city: enrichment.location_city ?? null,
    is_remote: enrichment.is_remote,
    is_hybrid: enrichment.is_hybrid,
    posted_date: postedDate,
    // Only set yoe fields if enrichment has actual values — don't overwrite
    // OpenAI-extracted yoe with null on re-scan
    ...(enrichment.yoe_min != null ? { yoe_min: enrichment.yoe_min } : {}),
    ...(enrichment.yoe_max != null ? { yoe_max: enrichment.yoe_max } : {}),
    ...(enrichment.yoe_raw != null ? { yoe_raw: enrichment.yoe_raw } : {}),
    tier,
    salary_min: enrichment.salary_min ?? null,
    salary_max: enrichment.salary_max ?? null,
    salary_currency: enrichment.salary_currency ?? "USD",
    requires_sponsorship_unclear: enrichment.requires_sponsorship_unclear,
    sponsorship_offered: enrichment.sponsorship_offered ?? null,
    domain_tags:    company.domain_tags ?? [],
    raw_jd_excerpt: job.description?.slice(0, 5000) ?? null,
    apm_signal:     item.apm_signal ?? "none",
    ats_platform:   item.ats_platform ?? null,
    last_seen_at:   new Date().toISOString(),
    is_active:      true,
    ...(item.extracted_jd ? {
      jd_job_title:                item.extracted_jd.job_title,
      jd_company_name:             item.extracted_jd.company_name,
      jd_location:                 item.extracted_jd.location,
      jd_employment:               item.extracted_jd.employment,
      jd_experience:               item.extracted_jd.experience,
      jd_education:                item.extracted_jd.education,
      jd_required_qualifications:  item.extracted_jd.required_qualifications,
      jd_preferred_qualifications: item.extracted_jd.preferred_qualifications,
      jd_responsibilities:         item.extracted_jd.responsibilities,
      jd_skills:                   item.extracted_jd.skills,
      jd_certifications:           item.extracted_jd.certifications,
      jd_compensation:             item.extracted_jd.compensation,
      jd_authorization:            item.extracted_jd.authorization,
      jd_role_context:             item.extracted_jd.role_context,
      jd_company_context:          item.extracted_jd.company_context,
      jd_logistics:                item.extracted_jd.logistics,
      jd_benefits:                 item.extracted_jd.benefits,
      jd_application:              item.extracted_jd.application,
      jd_legal:                    item.extracted_jd.legal,
      jd_ats_keywords:             item.extracted_jd.ats_keywords,
      jd_extraction_meta:          item.extracted_jd.extraction_meta,
      extracted_at:                item.extracted_jd.extraction_meta.extracted_at,
    } : {}),
  };
}

/**
 * Run async tasks over an array with a max concurrency cap.
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
