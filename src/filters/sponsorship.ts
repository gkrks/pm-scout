/**
 * Phase 3.5 — Sponsorship filter
 *
 * Scans the description for phrases that signal whether the role offers
 * visa sponsorship. Classification:
 *
 *   sponsorship_offered = false  → explicit "no sponsorship" language
 *   sponsorship_offered = true   → explicit "we sponsor" language
 *   sponsorship_offered = null   → not mentioned (requires_sponsorship_unclear = true)
 *
 * Rejection rule (from config):
 *   Reject ONLY when (requires_sponsorship || reject_if_no_sponsorship_offered)
 *   AND sponsorship_offered === false.
 *
 * Default config has both flags false, so the filter passes everything through
 *   and just annotates the enrichment for display.
 */

import type { FilterConfig, FilterResult, JobEnrichment } from "./types";

const NO_SPONSORSHIP_RE =
  /unable to sponsor|no\s+(?:visa\s+)?sponsorship|not eligible for sponsorship|must be authorized to work in the united states without sponsorship|cannot\s+sponsor|does not\s+sponsor|not\s+able to\s+sponsor|will not\s+sponsor/i;

const OFFERS_SPONSORSHIP_RE =
  /visa sponsorship (?:is\s+)?(?:offered|available)|we\s+(?:do\s+)?sponsor|h[\s-]?1b sponsorship|sponsorship is available|able to\s+sponsor|will\s+sponsor|open to\s+sponsoring/i;

/**
 * 3.5 Sponsorship filter
 *
 * @param description  Job description text. May be undefined.
 */
export function filterSponsorship(
  description: string | undefined,
  config: Pick<FilterConfig, "sponsorship">,
): FilterResult {
  let sponsorship_offered: boolean | null = null;
  let requires_sponsorship_unclear = false;

  if (description) {
    if (NO_SPONSORSHIP_RE.test(description)) {
      sponsorship_offered = false;
    } else if (OFFERS_SPONSORSHIP_RE.test(description)) {
      sponsorship_offered = true;
    } else {
      requires_sponsorship_unclear = true;
    }
  } else {
    requires_sponsorship_unclear = true;
  }

  const enrichment: Partial<JobEnrichment> = {
    sponsorship_offered,
    requires_sponsorship_unclear,
  };

  const { requires_sponsorship, reject_if_no_sponsorship_offered } =
    config.sponsorship;

  if (
    (requires_sponsorship || reject_if_no_sponsorship_offered) &&
    sponsorship_offered === false
  ) {
    return {
      kept: false,
      reason: "Role explicitly does not offer visa sponsorship",
      enrichment,
    };
  }

  return { kept: true, enrichment };
}
