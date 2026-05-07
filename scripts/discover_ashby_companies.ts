#!/usr/bin/env npx ts-node
/**
 * Ashby Company Discovery — Phase 1
 *
 * Populates the Supabase `companies` table from multiple sources:
 *   1. config/ats_routing.json (trust_tier=1, existing curated list)
 *   2. data/akshatbhat_verified_ashby_slugs.csv (trust_tier=2, external discovery)
 *   3. data/bloomberry_ashby.csv (trust_tier=2, optional)
 *
 * For each slug:
 *   - Validates via Ashby's GraphQL endpoint (gets canonical name + website)
 *   - Pre-computes US-ness by fetching the job board and checking location fields
 *   - Upserts to Supabase in batches
 *
 * Usage:
 *   npx ts-node scripts/discover_ashby_companies.ts [--skip-validation] [--dry-run]
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { isUSJob } from "../src/utils/geo";

dotenv.config();

// UUIDv5 namespace for Ashby-discovered companies (deterministic from slug)
const ASHBY_UUID_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // DNS namespace

function slugToUUID(slug: string): string {
  // Use crypto to generate a deterministic UUID from the slug
  const hash = crypto.createHash("sha1").update(`ashby:${slug}`).digest("hex");
  // Format as UUID v5
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    "5" + hash.slice(13, 16), // version 5
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join("-");
}

// ── CLI flags ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const SKIP_VALIDATION = args.includes("--skip-validation");
const DRY_RUN = args.includes("--dry-run");

// ── Types ───────────────────────────────────────────────────────────────────

interface CompanyEntry {
  ats_slug: string;
  internal_slug: string | null;
  name: string | null;
  website: string | null;
  trust_tier: 1 | 2 | 3;
  source: string;
  is_valid: boolean;
  is_us_company: boolean | null;
  us_job_ratio: number | null;
  total_jobs_seen: number;
}

// ── Source 1: ats_routing.json ──────────────────────────────────────────────

function loadAtsRouting(): CompanyEntry[] {
  const routingPath = path.join(process.cwd(), "config", "ats_routing.json");
  const raw = JSON.parse(fs.readFileSync(routingPath, "utf8"));
  const routing = raw.routing || raw;
  const entries: CompanyEntry[] = [];

  for (const [key, val] of Object.entries(routing) as [string, any][]) {
    if (val.ats !== "ashby") continue;
    entries.push({
      ats_slug: val.slug ?? key,
      internal_slug: val.slug && val.slug !== key ? key : null,
      name: null,
      website: null,
      trust_tier: 1,
      source: "ats_routing.json",
      is_valid: true,
      is_us_company: null,
      us_job_ratio: null,
      total_jobs_seen: 0,
    });
  }
  return entries;
}

// ── Source 2: AkshatBhat verified slugs CSV ─────────────────────────────────

function loadAkshatBhatCSV(): CompanyEntry[] {
  const csvPath = path.join(
    process.cwd(),
    "data",
    "akshatbhat_verified_ashby_slugs.csv",
  );
  if (!fs.existsSync(csvPath)) {
    console.log("[discover] No akshatbhat CSV found, skipping");
    return [];
  }

  const lines = fs.readFileSync(csvPath, "utf8").split("\n");
  const header = lines[0]?.toLowerCase() ?? "";
  const slugIdx = header.split(",").findIndex((h) => h.trim() === "slug");
  const nameIdx = header
    .split(",")
    .findIndex((h) => h.trim() === "inferred_company_name");
  const statusIdx = header
    .split(",")
    .findIndex((h) => h.trim() === "verification_status");

  if (slugIdx === -1) {
    console.warn("[discover] akshatbhat CSV: cannot find 'slug' column");
    return [];
  }

  const entries: CompanyEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    if (!cols[slugIdx]) continue;

    // Only ingest verified rows
    if (statusIdx !== -1 && cols[statusIdx]?.toUpperCase() !== "VERIFIED")
      continue;

    entries.push({
      ats_slug: cols[slugIdx],
      internal_slug: null,
      name: nameIdx !== -1 ? cols[nameIdx] || null : null,
      website: null,
      trust_tier: 2,
      source: "akshatbhat",
      is_valid: true,
      is_us_company: null,
      us_job_ratio: null,
      total_jobs_seen: 0,
    });
  }
  return entries;
}

// ── Source 3: Bloomberry CSV (optional) ─────────────────────────────────────

function loadBloomberryCSV(): CompanyEntry[] {
  const csvPath = path.join(
    process.cwd(),
    "data",
    "bloomberry_ashby.csv",
  );
  if (!fs.existsSync(csvPath)) {
    console.log("[discover] No bloomberry CSV found, skipping");
    return [];
  }

  const lines = fs.readFileSync(csvPath, "utf8").split("\n");
  const header = lines[0]?.toLowerCase() ?? "";
  const slugIdx = header.split(",").findIndex((h) => h.trim() === "slug");

  if (slugIdx === -1) {
    console.warn("[discover] bloomberry CSV: cannot find 'slug' column");
    return [];
  }

  const entries: CompanyEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    if (!cols[slugIdx]) continue;

    entries.push({
      ats_slug: cols[slugIdx],
      internal_slug: null,
      name: null,
      website: null,
      trust_tier: 2,
      source: "bloomberry",
      is_valid: true,
      is_us_company: null,
      us_job_ratio: null,
      total_jobs_seen: 0,
    });
  }
  return entries;
}

// ── Deduplication ───────────────────────────────────────────────────────────

function deduplicateEntries(entries: CompanyEntry[]): CompanyEntry[] {
  const bySlug = new Map<string, CompanyEntry>();
  for (const e of entries) {
    const existing = bySlug.get(e.ats_slug);
    if (!existing) {
      bySlug.set(e.ats_slug, e);
    } else {
      // Keep highest trust tier (lowest number), concatenate sources
      if (e.trust_tier < existing.trust_tier) {
        const sources = `${existing.source},${e.source}`;
        bySlug.set(e.ats_slug, { ...e, source: sources });
      } else {
        existing.source = `${existing.source},${e.source}`;
      }
      // Preserve internal_slug from ats_routing
      if (e.internal_slug && !existing.internal_slug) {
        existing.internal_slug = e.internal_slug;
      }
    }
  }
  return [...bySlug.values()];
}

// ── GraphQL validation ──────────────────────────────────────────────────────

async function validateAshbySlug(
  slug: string,
): Promise<{ name: string; website: string } | null> {
  const resp = await fetch(
    "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiOrganizationFromHostedJobsPageName",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationName: "ApiOrganizationFromHostedJobsPageName",
        variables: {
          organizationHostedJobsPageName: slug,
          searchContext: "JobBoard",
        },
        query: `query ApiOrganizationFromHostedJobsPageName($organizationHostedJobsPageName: String!, $searchContext: String) {
          organization(organizationHostedJobsPageName: $organizationHostedJobsPageName, searchContext: $searchContext) {
            name publicWebsite hostedJobsPageSlug allowJobPostIndexing
          }
        }`,
      }),
      timeout: 10_000,
    } as any,
  );

  const data = (await resp.json()) as any;
  const org = data?.data?.organization;
  if (!org) return null;
  return { name: org.name, website: org.publicWebsite };
}

// ── US-ness pre-computation ─────────────────────────────────────────────────

async function computeUSness(
  slug: string,
): Promise<{ is_us: boolean; ratio: number; total: number }> {
  try {
    const resp = await fetch(
      `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; JobSearchBot/1.0)" },
        timeout: 15_000,
      } as any,
    );

    if (!resp.ok) return { is_us: false, ratio: 0, total: 0 };
    const data = (await resp.json()) as any;
    const jobs: any[] = data.jobs ?? data.jobPostings ?? [];

    if (jobs.length === 0) return { is_us: false, ratio: 0, total: 0 };

    const usCount = jobs.filter(isUSJob).length;
    const ratio = usCount / jobs.length;

    return {
      is_us: ratio >= 0.3,
      ratio: Math.round(ratio * 1000) / 1000,
      total: jobs.length,
    };
  } catch {
    return { is_us: false, ratio: 0, total: 0 };
  }
}

// ── Concurrent executor ─────────────────────────────────────────────────────

async function runConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const queue = items.map((item, idx) => ({ item, idx }));
  let processed = 0;

  const worker = async () => {
    while (true) {
      const entry = queue.shift();
      if (!entry) break;
      try {
        results[entry.idx] = await fn(entry.item);
      } catch (e) {
        results[entry.idx] = null as any;
      }
      processed++;
      if (processed % 50 === 0) {
        console.log(`[discover] Progress: ${processed}/${items.length}`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

// ── Supabase upsert ─────────────────────────────────────────────────────────

async function upsertToSupabase(entries: CompanyEntry[]): Promise<void> {
  if (DRY_RUN) {
    console.log("[discover] DRY RUN — skipping Supabase upsert");
    return;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // First, check which ats_slugs already exist (from ats_routing.json sync)
  const { data: existingRows } = await supabase
    .from("companies")
    .select("id, slug, ats_slug")
    .not("ats_slug", "is", null);

  const existingByAtsSlug = new Map<string, string>(
    (existingRows ?? []).map((r: any) => [r.ats_slug, r.id]),
  );
  // Also map by company slug (for tier-1 entries from ats_routing.json)
  const existingBySlug = new Map<string, string>(
    (existingRows ?? []).map((r: any) => [r.slug, r.id]),
  );

  // Split into updates (existing rows) and inserts (new rows)
  const updates: any[] = [];
  const inserts: any[] = [];

  for (const e of entries) {
    const existingId = existingByAtsSlug.get(e.ats_slug) || existingBySlug.get(e.ats_slug);

    const ashbyFields = {
      ats_provider: "ashby",
      ats_slug: e.ats_slug,
      internal_slug: e.internal_slug,
      website: e.website,
      is_valid: e.is_valid,
      is_us_company: e.is_us_company,
      us_job_ratio: e.us_job_ratio,
      total_jobs_seen: e.total_jobs_seen,
      trust_tier: e.trust_tier,
      source: e.source,
      last_validated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (existingId) {
      updates.push({ id: existingId, ...ashbyFields, ...(e.name ? { name: e.name } : {}) });
    } else {
      inserts.push({
        id: slugToUUID(e.ats_slug),
        slug: `ashby-${e.ats_slug}`,
        name: e.name || e.ats_slug,
        category: "discovered",
        careers_url: `https://jobs.ashbyhq.com/${e.ats_slug}`,
        has_apm_program: false,
        domain_tags: [],
        target_roles: [],
        content_hash: crypto.createHash("sha1").update(e.ats_slug).digest("hex").slice(0, 16),
        ...ashbyFields,
      });
    }
  }

  console.log(`[discover] ${updates.length} existing companies to update, ${inserts.length} new companies to insert`);

  // Batch updates
  const BATCH = 500;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    for (const row of batch) {
      const { id, ...fields } = row;
      const { error } = await supabase
        .from("companies")
        .update(fields)
        .eq("id", id);
      if (error) {
        console.error(`[discover] Update failed for ${id}: ${error.message}`);
      }
    }
    console.log(`[discover] Updated batch ${Math.floor(i / BATCH) + 1} (${batch.length} rows)`);
  }

  // Batch inserts
  for (let i = 0; i < inserts.length; i += BATCH) {
    const batch = inserts.slice(i, i + BATCH);
    const { error } = await supabase
      .from("companies")
      .insert(batch);

    if (error) {
      console.error(`[discover] Insert batch ${Math.floor(i / BATCH) + 1} failed: ${error.message}`);
    } else {
      console.log(`[discover] Inserted batch ${Math.floor(i / BATCH) + 1} (${batch.length} rows)`);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Ashby Company Discovery ===\n");

  // Step 1: Load all sources
  const atsRouting = loadAtsRouting();
  console.log(`[source] ats_routing.json: ${atsRouting.length} Ashby entries`);

  const akshatbhat = loadAkshatBhatCSV();
  console.log(`[source] akshatbhat CSV: ${akshatbhat.length} verified entries`);

  const bloomberry = loadBloomberryCSV();
  console.log(`[source] bloomberry CSV: ${bloomberry.length} entries`);

  // Step 2: Deduplicate
  const allEntries = [...atsRouting, ...akshatbhat, ...bloomberry];
  const deduped = deduplicateEntries(allEntries);
  console.log(
    `\n[dedup] ${allEntries.length} total → ${deduped.length} unique slugs\n`,
  );

  // Step 3: Validate each slug via GraphQL (concurrency 8)
  if (!SKIP_VALIDATION) {
    console.log("[validate] Validating slugs via Ashby GraphQL (concurrency 8)...");
    const validationResults = await runConcurrent(
      deduped,
      8,
      async (entry) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await validateAshbySlug(entry.ats_slug);
          } catch {
            if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
          }
        }
        return null;
      },
    );

    let validCount = 0;
    let invalidCount = 0;
    for (let i = 0; i < deduped.length; i++) {
      const result = validationResults[i];
      if (result) {
        deduped[i].name = deduped[i].name ?? result.name;
        deduped[i].website = result.website;
        deduped[i].is_valid = true;
        validCount++;
      } else {
        deduped[i].is_valid = false;
        invalidCount++;
      }
    }
    console.log(`[validate] ${validCount} valid, ${invalidCount} invalid\n`);
  }

  // Step 4: Pre-compute US-ness (concurrency 8, only valid slugs)
  const validEntries = deduped.filter((e) => e.is_valid);
  console.log(
    `[us-check] Computing US presence for ${validEntries.length} valid companies...`,
  );
  const usResults = await runConcurrent(validEntries, 8, async (entry) => {
    return computeUSness(entry.ats_slug);
  });

  let usCompanyCount = 0;
  for (let i = 0; i < validEntries.length; i++) {
    const result = usResults[i];
    if (result) {
      validEntries[i].is_us_company = result.is_us;
      validEntries[i].us_job_ratio = result.ratio;
      validEntries[i].total_jobs_seen = result.total;
      if (result.is_us) usCompanyCount++;
    }
  }

  // Step 5: Upsert to Supabase
  console.log(`\n[upsert] Upserting ${deduped.length} companies to Supabase...`);
  await upsertToSupabase(deduped);

  // Step 6: Summary
  const byTier = new Map<number, { total: number; valid: number; us: number }>();
  for (const e of deduped) {
    const tier = byTier.get(e.trust_tier) ?? { total: 0, valid: 0, us: 0 };
    tier.total++;
    if (e.is_valid) tier.valid++;
    if (e.is_us_company) tier.us++;
    byTier.set(e.trust_tier, tier);
  }

  console.log("\n=== Discovery Summary ===");
  console.log(`Total slugs ingested: ${deduped.length}`);
  for (const [tier, counts] of [...byTier.entries()].sort()) {
    console.log(
      `  Tier ${tier}: ${counts.total} total, ${counts.valid} valid, ${counts.us} US`,
    );
  }
  console.log(`US companies total: ${usCompanyCount}`);
  console.log(`Valid companies: ${validEntries.length}`);
  console.log(`Invalid companies: ${deduped.length - validEntries.length}`);
}

main().catch((e) => {
  console.error("Discovery failed:", e);
  process.exit(1);
});
