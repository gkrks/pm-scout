/**
 * Phase 3 — Filter pipeline
 *
 * Orchestrates all 7 filter steps + tier ranking for a single RawJob.
 *
 * Filter order (per spec):
 *   3.1 title → 3.2 location → 3.4 freshness
 *   → 3.3 experience → 3.5 sponsorship → 3.6 salary
 *   → 3.7 tier
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
 *     → full pipeline including description-dependent filters + tier
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
import { computeTier } from "../ranking/tier";

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
 * @param company       Company record (needed for tier ranking).
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
      tier: null,
      enrichment,
      rejectedBy: "title",
      rejectionReason: titleResult.reason,
      domainBoosted: false,
    };
  }
  Object.assign(enrichment, titleResult.enrichment);

  // ── 3.2 Location ──────────────────────────────────────────────────────────
  const locationResult = filterLocation(job.location_raw, config);
  if (!locationResult.kept) {
    return {
      kept: false,
      tier: null,
      enrichment,
      rejectedBy: "location",
      rejectionReason: locationResult.reason,
      domainBoosted: false,
    };
  }
  Object.assign(enrichment, locationResult.enrichment);

  // ── 3.4 Freshness (no description needed) ────────────────────────────────
  const freshnessResult = filterFreshness(job.posted_date, config, runStartedAt);
  if (!freshnessResult.kept) {
    return {
      kept: false,
      tier: null,
      enrichment,
      rejectedBy: "freshness",
      rejectionReason: freshnessResult.reason,
      domainBoosted: false,
    };
  }
  Object.assign(enrichment, freshnessResult.enrichment);

  // ── 3.3 Experience (needs description) ───────────────────────────────────
  const experienceResult = filterExperience(job.description, job.title);
  if (!experienceResult.kept) {
    return {
      kept: false,
      tier: null,
      enrichment,
      rejectedBy: "experience",
      rejectionReason: experienceResult.reason,
      domainBoosted: false,
    };
  }
  Object.assign(enrichment, experienceResult.enrichment);

  // ── 3.5 Sponsorship (needs description) ──────────────────────────────────
  const sponsorshipResult = filterSponsorship(job.description, config);
  if (!sponsorshipResult.kept) {
    return {
      kept: false,
      tier: null,
      enrichment,
      rejectedBy: "sponsorship",
      rejectionReason: sponsorshipResult.reason,
      domainBoosted: false,
    };
  }
  Object.assign(enrichment, sponsorshipResult.enrichment);

  // ── 3.6 Salary (needs description) ───────────────────────────────────────
  const salaryResult = filterSalary(job.description, config);
  if (!salaryResult.kept) {
    return {
      kept: false,
      tier: null,
      enrichment,
      rejectedBy: "salary",
      rejectionReason: salaryResult.reason,
      domainBoosted: false,
    };
  }
  Object.assign(enrichment, salaryResult.enrichment);

  // ── 3.7 Tier ranking ─────────────────────────────────────────────────────
  // Tier is a label only — it never rejects. Every job that passes the 6 filters
  // is kept; tier determines sort order and display priority in the digest.
  const { tier, domainBoosted } = computeTier(
    job.title,
    enrichment,
    company,
    config,
  );

  return { kept: true, tier, enrichment, domainBoosted };
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
