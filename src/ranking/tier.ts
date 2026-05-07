/**
 * Phase 3.7 — Tier ranking
 *
 * Assigns a priority tier (1, 2, or 3) to every job that passed the filter
 * pipeline. Tier is a LABEL for sorting and display — it never causes rejection.
 * Rejection is handled exclusively by the filter pipeline (title, location,
 * experience, freshness, sponsorship, salary).
 *
 * ── Tier 1 — apply today (highest priority) ───────────────────────────────────
 * Any of these → tier 1:
 *   • Title contains "Associate" / "APM" / "New Grad" / "Entry Level"
 *   • APM program signal (priority_apm or apm_company + junior)
 *   • posted_within_7_days AND yoe_max ≤ 2 AND in a target city
 *
 * ── Tier 2 — apply this week ──────────────────────────────────────────────────
 *   • posted_within_30_days
 *   • Title contains "product manager"
 *   • In a target city OR remote-US OR hybrid
 *   • AND not Tier 1
 *
 * ── Tier 3 — review when convenient ──────────────────────────────────────────
 *   • Everything else that passed the filters.
 *
 * ── Domain boost ──────────────────────────────────────────────────────────────
 * Does NOT change the tier number — used by the digest to sort domain-boosted
 * companies above otherwise-equivalent ones within the same tier.
 */

import type { Company } from "../scrapers/types";
import type { JobEnrichment, FilterConfig } from "../filters/types";
import { detectApmSignal, type ApmSignal } from "./apmSignal";

export interface TierResult {
  tier: 1 | 2 | 3;
  domainBoosted: boolean;
  apmSignal: ApmSignal;
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

  // Compute APM signal once — used for both tier assignment and the return value.
  const apmSignal = detectApmSignal({
    title,
    description: null,   // description not available at tier-compute time in the pipeline
    company,
  });

  // ── Associate/APM/New Grad: always tier 1 ─────────────────────────────────
  const ASSOCIATE_RE = /\b(associate|apm|new grad|entry level|early career)\b/i;
  if (ASSOCIATE_RE.test(title)) {
    return { tier: 1, domainBoosted, apmSignal };
  }

  // ── Priority APM signal: tier 1 ─────────────────────────────────────────
  if (apmSignal === "priority_apm") {
    return { tier: 1, domainBoosted, apmSignal };
  }

  // ── APM company + junior signals: tier 1 ─────────────────────────────────
  if (apmSignal === "apm_company" && (e.is_new_grad_language || (e.yoe_max !== null && e.yoe_max <= 2))) {
    return { tier: 1, domainBoosted, apmSignal };
  }

  // ── Tier 1 base: fresh + junior + in a city ─────────────────────────────
  const tier1Base =
    e.posted_within_7_days && yoeOkForTier1(e) && locationInCity;

  if (tier1Base) {
    return { tier: 1, domainBoosted, apmSignal };
  }

  // ── Tier 2 ───────────────────────────────────────────────────────────────
  const tier2 =
    e.posted_within_30_days &&
    yoeOkForTier2(e) &&
    PM_TITLE_RE.test(title) &&
    (locationInCity || isRemoteUs || e.is_hybrid);

  if (tier2) {
    return { tier: 2, domainBoosted, apmSignal };
  }

  // ── Tier 3 — review when convenient ──────────────────────────────────────
  return { tier: 3, domainBoosted, apmSignal };
}
