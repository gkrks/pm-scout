/**
 * Phase 3.7 — Tier ranking
 *
 * Assigns a priority tier (1, 2, or 3) to every job that passed the filter
 * pipeline. Tier is a LABEL for sorting and display — it never causes rejection.
 * Rejection is handled exclusively by the filter pipeline (title, location,
 * experience, freshness, sponsorship, salary).
 *
 * ── Tier 1 — apply today ──────────────────────────────────────────────────────
 * Base signals (ALL required):
 *   • posted_within_7_days
 *   • yoe_max ≤ 2 OR junior language detected
 *   • location_city is non-null (physical city match — pure remote doesn't qualify)
 *
 * Tier-1 boost (EITHER base OR boost → tier 1):
 *   • Title contains "Associate Product Manager" or "APM"
 *     AND company has has_apm_program = true AND apm_program_status = 'active'
 *
 * ── Tier 2 — apply this week ──────────────────────────────────────────────────
 *   • posted_within_30_days
 *   • YOE clearly ≤ 3 (see yoeOkForTier2)
 *   • location_city is non-null OR is_remote (US) OR is_hybrid
 *   • AND not Tier 1
 *
 * ── Tier 3 — review when convenient ──────────────────────────────────────────
 *   • Everything else that passed the filters. Examples: posted_date unknown,
 *     location is remote-US-only (no city anchor), experience is junior-flagged
 *     but unclear (e.g. "2-5 years" — low floor but high ceiling), etc.
 *
 * ── Domain boost ──────────────────────────────────────────────────────────────
 * Does NOT change the tier number — used by the digest to sort domain-boosted
 * companies above otherwise-equivalent ones within the same tier.
 */

import type { Company } from "../scrapers/types";
import type { JobEnrichment, FilterConfig } from "../filters/types";

export interface TierResult {
  tier: 1 | 2 | 3;
  domainBoosted: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const APM_TITLE_RE = /associate\s+product\s+manager|(?:^|\s)apm(?:\s|$)/i;
const PM_TITLE_RE  = /product manager|forward deployed/i;

function yoeOkForTier1(e: JobEnrichment): boolean {
  // Explicit upper bound ≤ 2
  if (e.yoe_max !== null && e.yoe_max <= 2) return true;
  // Junior language (new grad, entry-level, etc.) — no numbers needed
  if (e.is_new_grad_language) return true;
  return false;
}

function yoeOkForTier2(e: JobEnrichment): boolean {
  // Explicit upper bound ≤ 3
  if (e.yoe_max !== null && e.yoe_max <= 3) return true;
  // Low floor with no ceiling (e.g. "at least 2 years", "minimum 3 years")
  if (e.yoe_min !== null && e.yoe_min <= 3 && e.yoe_max === null) return true;
  // Pure junior language with no numbers (e.g. "new grad" postings)
  if (e.yoe_min === null && e.yoe_max === null && e.is_new_grad_language) return true;
  return false;
}

function isDomainBoosted(
  company: Company,
  preferred_domains: string[],
): boolean {
  return (company.domain_tags ?? []).some((tag) =>
    preferred_domains.includes(tag),
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Compute the display/sort tier for a job that has passed all filters.
 * Always returns 1, 2, or 3 — never rejects.
 *
 * @param title         Raw job title from ATS (not normalised).
 * @param enrichment    Accumulated enrichment from the filter pipeline.
 * @param company       Company metadata (has_apm_program, domain_tags, …).
 * @param filterConfig  Full FilterConfig — only preferred_domains is read.
 */
export function computeTier(
  title: string,
  enrichment: JobEnrichment,
  company: Company,
  filterConfig: Pick<FilterConfig, "preferred_domains">,
): TierResult {
  const e            = enrichment;
  const locationInCity = e.location_city !== null;
  const isRemoteUs   = e.is_remote && e.location_city === null;
  const domainBoosted = isDomainBoosted(company, filterConfig.preferred_domains);

  // ── Tier 1 base ──────────────────────────────────────────────────────────
  const tier1Base =
    e.posted_within_7_days && yoeOkForTier1(e) && locationInCity;

  // ── Tier 1 boost: APM title + active APM program ─────────────────────────
  const apmTitle     = APM_TITLE_RE.test(title.trim());
  const activeProgram =
    (company.has_apm_program ?? false) &&
    company.apm_program_status === "active";
  const tier1Boost = apmTitle && activeProgram;

  if (tier1Base || tier1Boost) {
    return { tier: 1, domainBoosted };
  }

  // ── Tier 2 ───────────────────────────────────────────────────────────────
  const tier2 =
    e.posted_within_30_days &&
    yoeOkForTier2(e) &&
    PM_TITLE_RE.test(title) &&
    (locationInCity || isRemoteUs || e.is_hybrid);

  if (tier2) {
    return { tier: 2, domainBoosted };
  }

  // ── Tier 3 — review when convenient ──────────────────────────────────────
  // All jobs that passed the filters but don't meet Tier 1 or Tier 2 criteria.
  return { tier: 3, domainBoosted };
}
