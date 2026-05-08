/**
 * Phase 3 — Filter pipeline
 *
 * Orchestrates all 6 filter steps for a single RawJob.
 *
 * Filter order (per spec):
 *   3.1 title → 3.2 location → 3.4 freshness
 *   → 3.3 experience → 3.5 sponsorship → 3.6 salary
 *
 * Freshness runs before experience/sponsorship/salary because it doesn't need
 * the description, letting us bail out cheaply before description fetches.
 *
 * ── Two-phase API ────────────────────────────────────────────────────────────
 *
 * The orchestrator (Phase 5) fetches descriptions only for jobs that survive
 * the title/location/freshness checks.  Two helpers support this pattern:
 *
 *   runPreDescriptionFilters(job, config, runStart)
 *     → pass/fail on title + location + freshness only
 *
 *   runFilterPipeline(job, company, config, runStart)
 *     → full pipeline including description-dependent filters
 *       (safe to call even when job.description is undefined — those filters
 *        keep with confidence = 'unknown')
 */

import type { RawJob, Company } from "../scrapers/types";
import type {
  FilterConfig,
  JobEnrichment,
  PipelineResult,
} from "./types";
import { filterTitle } from "./title";
import { filterLocation } from "./location";
import { filterFreshness } from "./freshness";
import { filterExperience } from "./experience";
import { filterSponsorship } from "./sponsorship";
import { filterSalary } from "./salary";
import { isUSRawJob } from "../utils/geo";

// ── Ashby-specific pre-filters (cheap, run first) ───────────────────────────

/**
 * Title must contain both "product" AND "manager" (case-insensitive).
 * Excludes intern/coordinator/assistant/recruiter roles.
 * Excludes Product Marketing Manager (PMM) — not a PM role.
 */
export function isPMTitle(title: string): boolean {
  const t = (title || "").toLowerCase();
  if (!t.includes("product") || !t.includes("manager")) return false;
  if (/\b(intern|coordinator|assistant|recruiter|recruiting)\b/.test(t))
    return false;
  if (/\bproduct\s+marketing\s+manager\b|\bpmm\b/.test(t))
    return false;
  return true;
}

/**
 * Returns true if the title signals an Associate/entry-level PM role.
 * Used for APM priority in digest emails.
 */
export function isAssociatePM(title: string): boolean {
  const t = (title || "").toLowerCase();
  return /\b(associate|apm|new grad|entry level|early career)\b/.test(t);
}

/**
 * Check if a RawJob's location resolves to United States.
 * Uses the structured raw_payload from Ashby when available.
 */
export function isUSLocation(rawJob: RawJob): boolean {
  return isUSRawJob(rawJob.source_meta);
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_ENRICHMENT: JobEnrichment = {
  location_city: null,
  is_remote: false,
  is_hybrid: false,
  yoe_min: null,
  yoe_max: null,
  yoe_raw: null,
  experience_confidence: "inferred-junior",
  is_new_grad_language: false,
  freshness_confidence: "unknown",
  posted_within_7_days: false,
  posted_within_30_days: false,
  sponsorship_offered: null,
  requires_sponsorship_unclear: false,
  salary_min: null,
  salary_max: null,
  salary_currency: null,
};

// ── Full pipeline ─────────────────────────────────────────────────────────────

/**
 * Run the complete Phase 3 filter pipeline on a single RawJob.
 *
 * Stops at the first rejection and returns the accumulated enrichment so far.
 * Safe to call before the description has been fetched — description-dependent
 * filters (experience, sponsorship, salary) will keep with confidence = 'unknown'.
 *
 * @param job           RawJob from a Phase 2 scraper.
 * @param company       Company record.
 * @param config        FilterConfig loaded from targets.json.
 * @param runStartedAt  Wall-clock start of this scan run (for freshness math).
 */
export function runFilterPipeline(
  job: RawJob,
  company: Company,
  config: FilterConfig,
  runStartedAt: Date,
): PipelineResult {
  let enrichment: JobEnrichment = { ...DEFAULT_ENRICHMENT };

  // ── 3.1 Title ─────────────────────────────────────────────────────────────
  const titleResult = filterTitle(job.title, config);
  if (!titleResult.kept) {
    return {
      kept: false,
      enrichment,
      rejectedBy: "title",
      rejectionReason: titleResult.reason,
    };
  }
  Object.assign(enrichment, titleResult.enrichment);

  // ── 3.2 Location ──────────────────────────────────────────────────────────
  const locationResult = filterLocation(job.location_raw, config);
  if (!locationResult.kept) {
    return {
      kept: false,
      enrichment,
      rejectedBy: "location",
      rejectionReason: locationResult.reason,
    };
  }
  Object.assign(enrichment, locationResult.enrichment);

  // ── 3.4 Freshness (no description needed) ────────────────────────────────
  const freshnessResult = filterFreshness(job.posted_date, config, runStartedAt);
  if (!freshnessResult.kept) {
    return {
      kept: false,
      enrichment,
      rejectedBy: "freshness",
      rejectionReason: freshnessResult.reason,
    };
  }
  Object.assign(enrichment, freshnessResult.enrichment);

  // ── 3.3 Experience (needs description) ───────────────────────────────────
  const experienceResult = filterExperience(job.description, job.title);
  if (!experienceResult.kept) {
    return {
      kept: false,
      enrichment,
      rejectedBy: "experience",
      rejectionReason: experienceResult.reason,
    };
  }
  Object.assign(enrichment, experienceResult.enrichment);

  // ── 3.5 Sponsorship (needs description) ──────────────────────────────────
  const sponsorshipResult = filterSponsorship(job.description, config);
  if (!sponsorshipResult.kept) {
    return {
      kept: false,
      enrichment,
      rejectedBy: "sponsorship",
      rejectionReason: sponsorshipResult.reason,
    };
  }
  Object.assign(enrichment, sponsorshipResult.enrichment);

  // ── 3.6 Salary (needs description) ───────────────────────────────────────
  const salaryResult = filterSalary(job.description, config);
  if (!salaryResult.kept) {
    return {
      kept: false,
      enrichment,
      rejectedBy: "salary",
      rejectionReason: salaryResult.reason,
    };
  }
  Object.assign(enrichment, salaryResult.enrichment);

  return { kept: true, enrichment };
}

// ── Pre-description phase (title + location + freshness only) ─────────────────

export interface PreDescriptionResult {
  kept: boolean;
  enrichment: Partial<JobEnrichment>;
  rejectedBy?: string;
  rejectionReason?: string;
}

/**
 * Run only the filters that don't require the job description.
 *
 * Use this before fetching full descriptions to avoid unnecessary HTTP calls.
 * If this returns `kept: true`, fetch the description, then call `runFilterPipeline`
 * with the fully-populated job.
 */
export function runPreDescriptionFilters(
  job: RawJob,
  config: FilterConfig,
  runStartedAt: Date,
): PreDescriptionResult {
  let enrichment: Partial<JobEnrichment> = {};

  const titleResult = filterTitle(job.title, config);
  if (!titleResult.kept) {
    return {
      kept: false,
      enrichment,
      rejectedBy: "title",
      rejectionReason: titleResult.reason,
    };
  }
  Object.assign(enrichment, titleResult.enrichment);

  const locationResult = filterLocation(job.location_raw, config);
  if (!locationResult.kept) {
    return {
      kept: false,
      enrichment,
      rejectedBy: "location",
      rejectionReason: locationResult.reason,
    };
  }
  Object.assign(enrichment, locationResult.enrichment);

  const freshnessResult = filterFreshness(job.posted_date, config, runStartedAt);
  if (!freshnessResult.kept) {
    return {
      kept: false,
      enrichment,
      rejectedBy: "freshness",
      rejectionReason: freshnessResult.reason,
    };
  }
  Object.assign(enrichment, freshnessResult.enrichment);

  return { kept: true, enrichment };
}
