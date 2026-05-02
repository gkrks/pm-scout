/**
 * Phase 3.4 — Freshness filter
 *
 * Uses `filters.freshness.max_posting_age_days` (default 30) and
 * `tier_1_max_age_days` (default 7).
 *
 * Rules:
 *  - posted_date is null   → keep with freshness_confidence = 'unknown'
 *  - posted_date unparseable → keep with freshness_confidence = 'unknown'
 *  - age > max_posting_age_days → reject
 *  - otherwise → keep; set posted_within_7_days and posted_within_30_days
 *
 * Note: posted_date should already be clamped to now() by the scraper
 * for future dates (e.g. Workday scheduling artefacts).
 */

import type { FilterConfig, FilterResult, JobEnrichment } from "./types";

/** Milliseconds per day — avoids repeated arithmetic. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const UNKNOWN_ENRICHMENT: Partial<JobEnrichment> = {
  freshness_confidence: "unknown",
  posted_within_7_days: false,
  posted_within_30_days: false,
};

/**
 * 3.4 Freshness filter
 *
 * @param postedDate    ISO-8601 date string from the scraper, or null.
 * @param config        Freshness config (max_posting_age_days, tier_1_max_age_days).
 * @param runStartedAt  Wall-clock start of this scan run — the reference point
 *                      for all age calculations so the pipeline is deterministic
 *                      even when processing many companies in parallel.
 */
export function filterFreshness(
  postedDate: string | null,
  config: Pick<FilterConfig, "freshness">,
  runStartedAt: Date,
): FilterResult {
  const { max_posting_age_days, tier_1_max_age_days } = config.freshness;

  if (!postedDate) {
    return {
      kept: true,
      reason: "posted_date absent — freshness confidence unknown, keeping",
      enrichment: UNKNOWN_ENRICHMENT,
    };
  }

  const postedMs = Date.parse(postedDate);
  if (isNaN(postedMs)) {
    return {
      kept: true,
      reason: `posted_date "${postedDate}" could not be parsed — treating as unknown`,
      enrichment: UNKNOWN_ENRICHMENT,
    };
  }

  const ageDays = (runStartedAt.getTime() - postedMs) / MS_PER_DAY;

  if (ageDays > max_posting_age_days) {
    return {
      kept: false,
      reason: `Posted ${Math.round(ageDays)} days ago (max ${max_posting_age_days})`,
      enrichment: {
        freshness_confidence: "known",
        posted_within_7_days: false,
        posted_within_30_days: false,
      },
    };
  }

  return {
    kept: true,
    enrichment: {
      freshness_confidence: "known",
      posted_within_7_days: ageDays <= tier_1_max_age_days,
      posted_within_30_days: true, // already know ageDays <= max_posting_age_days
    },
  };
}
