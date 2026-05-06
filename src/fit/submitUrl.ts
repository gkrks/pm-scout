/**
 * Core logic for submitting an arbitrary job URL to the Check Fit system.
 *
 * Scrapes the page, extracts qualifications via the deterministic JD extractor,
 * resolves or creates a company row, inserts into job_listings, and returns
 * a jobId + token for the standard /fit/:jobId flow.
 */

import crypto from "crypto";
import fetch from "node-fetch";

import { extractJD } from "../jdExtractor";
import { normalizeRoleUrl } from "../lib/normalizeUrl";
import { getSupabaseClient } from "../storage/supabase";
import { generateToken } from "./server";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export interface SubmitUrlResult {
  jobId: string;
  token: string;
  existing: boolean;
}

export class SubmitUrlError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public detail?: string,
  ) {
    super(message);
    this.name = "SubmitUrlError";
  }
}

// ---------------------------------------------------------------------------
//  Company resolution helpers
// ---------------------------------------------------------------------------

/** Derive a human-readable company name from a URL hostname. */
function companyNameFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();

    // Handle ATS-hosted URLs: jobs.lever.co/stripe → "stripe"
    const atsHostPatterns: { host: string; extract: (url: URL) => string | null }[] = [
      { host: "lever.co", extract: (u) => u.pathname.split("/")[1] || null },
      { host: "greenhouse.io", extract: (u) => u.pathname.split("/")[1] || null },
      { host: "ashbyhq.com", extract: (u) => u.pathname.split("/")[1] || null },
      { host: "myworkdayjobs.com", extract: (u) => u.hostname.split(".")[0] || null },
      { host: "smartrecruiters.com", extract: (u) => u.pathname.split("/")[1] || null },
    ];

    for (const p of atsHostPatterns) {
      if (hostname.endsWith(p.host)) {
        const parsed = new URL(url);
        const name = p.extract(parsed);
        if (name && name.length > 1) {
          return name.charAt(0).toUpperCase() + name.slice(1);
        }
      }
    }

    // Generic: strip subdomains like "careers.", "jobs.", "www."
    const parts = hostname.replace(/^(careers|jobs|www)\./i, "").split(".");
    const domain = parts[0];
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  } catch {
    return "Unknown";
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Find existing company by slug, or create a new "manual" company row. */
async function resolveCompany(
  companyName: string,
  url: string,
): Promise<{ id: string; name: string; slug: string }> {
  const supabase = getSupabaseClient();
  const slug = slugify(companyName);

  // Try to find existing company by slug
  const { data: existing } = await supabase
    .from("companies")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();

  if (existing) return existing;

  // Create a new company row
  const id = crypto.randomUUID();
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = url;
  }

  const { data: created, error } = await supabase
    .from("companies")
    .insert({
      id,
      slug,
      name: companyName,
      category: "manual",
      careers_url: origin,
      has_apm_program: false,
      domain_tags: [],
      target_roles: [],
      content_hash: "manual",
    })
    .select("id, name, slug")
    .single();

  if (error) {
    // Race condition: another request created the same slug concurrently
    if (error.code === "23505") {
      const { data: retry } = await supabase
        .from("companies")
        .select("id, name, slug")
        .eq("slug", slug)
        .single();
      if (retry) return retry;
    }
    throw new SubmitUrlError(
      `Failed to create company: ${error.message}`,
      500,
    );
  }

  return created!;
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

export async function submitJobUrl(url: string): Promise<SubmitUrlResult> {
  // 1. Validate URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SubmitUrlError("Invalid URL format", 400);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SubmitUrlError("URL must be http or https", 400);
  }

  const normalizedUrl = normalizeRoleUrl(url);

  // 2. Check if this URL already exists in job_listings
  const supabase = getSupabaseClient();
  const { data: existingJob } = await supabase
    .from("job_listings")
    .select("id, jd_required_qualifications")
    .eq("role_url", normalizedUrl)
    .maybeSingle();

  if (existingJob && existingJob.jd_required_qualifications?.length > 0) {
    return {
      jobId: existingJob.id,
      token: generateToken(existingJob.id),
      existing: true,
    };
  }

  // 3. Fetch HTML
  let rawHtml: string;
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: 20_000,
    });
    if (!resp.ok) {
      throw new SubmitUrlError(
        `Failed to fetch URL: HTTP ${resp.status}`,
        502,
        resp.statusText,
      );
    }
    rawHtml = await resp.text();
  } catch (err: any) {
    if (err instanceof SubmitUrlError) throw err;
    throw new SubmitUrlError(
      `Failed to fetch URL: ${err.message}`,
      502,
    );
  }

  if (!rawHtml || rawHtml.length < 200) {
    throw new SubmitUrlError("Page returned too little content", 502);
  }

  // 4. Extract JD
  let extractedJD;
  try {
    extractedJD = await extractJD({
      rawHtml,
      rawText: undefined,
      jobTitle: "",
      companyName: "",
      sourceAts: null,
      sourceUrl: url,
    });
  } catch (err: any) {
    throw new SubmitUrlError(
      `Failed to extract job data: ${err.message}`,
      422,
    );
  }

  // 5. Validate qualifications
  const reqQuals = extractedJD.required_qualifications ?? [];
  const prefQuals = extractedJD.preferred_qualifications ?? [];
  if (reqQuals.length === 0 && prefQuals.length === 0) {
    throw new SubmitUrlError(
      "Could not extract any qualifications from this page. The page may require JavaScript rendering or use an unsupported format.",
      422,
    );
  }

  // 6. Resolve company
  const companyName =
    extractedJD.company_name && extractedJD.company_name !== "Unknown"
      ? extractedJD.company_name
      : companyNameFromUrl(url);
  const company = await resolveCompany(companyName, url);

  // 7. Build and insert job_listing row
  const title =
    extractedJD.job_title && extractedJD.job_title !== "Unknown"
      ? extractedJD.job_title
      : "Product Manager";

  const isRemote = extractedJD.location?.is_remote ?? false;
  const isHybrid = extractedJD.location?.is_hybrid ?? false;
  const locationRaw = extractedJD.location?.raw ?? null;

  const row: Record<string, unknown> = {
    company_id: company.id,
    role_url: normalizedUrl,
    title,
    location_raw: locationRaw,
    is_remote: isRemote,
    is_hybrid: isHybrid,
    ats_platform: "manual",
    is_active: true,
    last_seen_at: new Date().toISOString(),
    raw_jd_excerpt: rawHtml.slice(0, 5000),
    // All jd_* columns from extraction
    jd_job_title: extractedJD.job_title,
    jd_company_name: extractedJD.company_name,
    jd_location: extractedJD.location,
    jd_employment: extractedJD.employment,
    jd_experience: extractedJD.experience,
    jd_education: extractedJD.education,
    jd_required_qualifications: extractedJD.required_qualifications,
    jd_preferred_qualifications: extractedJD.preferred_qualifications,
    jd_responsibilities: extractedJD.responsibilities,
    jd_skills: extractedJD.skills,
    jd_certifications: extractedJD.certifications,
    jd_compensation: extractedJD.compensation,
    jd_authorization: extractedJD.authorization,
    jd_role_context: extractedJD.role_context,
    jd_company_context: extractedJD.company_context,
    jd_logistics: extractedJD.logistics,
    jd_benefits: extractedJD.benefits,
    jd_application: extractedJD.application,
    jd_legal: extractedJD.legal,
    jd_ats_keywords: extractedJD.ats_keywords,
    jd_extraction_meta: extractedJD.extraction_meta,
    extracted_at: extractedJD.extraction_meta?.extracted_at ?? new Date().toISOString(),
  };

  // If the URL already existed (but without quals), update it instead
  if (existingJob) {
    const { error: updateErr } = await supabase
      .from("job_listings")
      .update(row)
      .eq("id", existingJob.id);

    if (updateErr) {
      throw new SubmitUrlError(
        `Failed to update job listing: ${updateErr.message}`,
        500,
      );
    }
    return {
      jobId: existingJob.id,
      token: generateToken(existingJob.id),
      existing: true,
    };
  }

  // Fresh insert
  const { data: inserted, error: insertErr } = await supabase
    .from("job_listings")
    .insert(row)
    .select("id")
    .single();

  if (insertErr) {
    // Duplicate URL (race condition)
    if (insertErr.code === "23505") {
      const { data: dup } = await supabase
        .from("job_listings")
        .select("id")
        .eq("role_url", normalizedUrl)
        .single();
      if (dup) {
        return {
          jobId: dup.id,
          token: generateToken(dup.id),
          existing: true,
        };
      }
    }
    throw new SubmitUrlError(
      `Failed to insert job listing: ${insertErr.message}`,
      500,
    );
  }

  const jobId = inserted!.id;
  return {
    jobId,
    token: generateToken(jobId),
    existing: false,
  };
}
