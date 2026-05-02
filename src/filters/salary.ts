/**
 * Phase 3.6 — Salary filter
 *
 * Optional — only runs when config.compensation.min_base_salary_usd is non-null.
 *
 * Extraction order:
 *  1. "$XXX,XXX – $YYY,YYY" range pattern
 *  2. Single "$XXX,XXX" amount (treated as both min and max)
 *
 * Rules:
 *  - Non-USD currency detected → skip filter (keep), store salary_currency = 'non-USD'
 *  - No salary disclosed       → keep (don't reject on missing data)
 *  - salary_max < min_base_salary_usd → reject
 *
 * Note: "accept if range_top >= min" — the spec uses salary_max as the comparison value.
 */

import type { FilterConfig, FilterResult, JobEnrichment } from "./types";

/** Matches non-USD currency symbols/codes appearing near a number. */
const NON_USD_RE = /(?:€|£|¥|₹|CAD|AUD|EUR|GBP|JPY|SGD|MXN)\s*\d/;

const EMPTY_SALARY: Partial<JobEnrichment> = {
  salary_min: null,
  salary_max: null,
  salary_currency: null,
};

/**
 * Parse a compact salary integer from two regex capture groups.
 * "$120,000" → groups ["120", "000"] → 120000
 */
function parseSalary(hundreds: string, thousands: string): number {
  return parseInt(hundreds + thousands, 10);
}

/**
 * 3.6 Salary filter
 *
 * @param description  Job description text. May be undefined.
 */
export function filterSalary(
  description: string | undefined,
  config: Pick<FilterConfig, "compensation">,
): FilterResult {
  const { min_base_salary_usd } = config.compensation;

  // Filter disabled or no description to scan
  if (min_base_salary_usd === null || !description) {
    return { kept: true, enrichment: EMPTY_SALARY };
  }

  // Non-USD currency → skip the salary filter entirely
  if (NON_USD_RE.test(description)) {
    return {
      kept: true,
      enrichment: { salary_min: null, salary_max: null, salary_currency: "non-USD" },
    };
  }

  // ── Range pattern: "$120,000 – $160,000" (with -, –, —, "to") ────────────
  const rangeRe =
    /\$(\d{2,3}),(\d{3})\s*(?:-|–|—|to)\s*\$?(\d{2,3}),(\d{3})/i;
  const rangeMatch = rangeRe.exec(description);
  if (rangeMatch) {
    const salary_min = parseSalary(rangeMatch[1], rangeMatch[2]);
    const salary_max = parseSalary(rangeMatch[3], rangeMatch[4]);
    const enrichment: Partial<JobEnrichment> = {
      salary_min,
      salary_max,
      salary_currency: "USD",
    };

    if (salary_max < min_base_salary_usd) {
      return {
        kept: false,
        reason:
          `Salary cap $${salary_max.toLocaleString()} is below minimum ` +
          `$${min_base_salary_usd.toLocaleString()}`,
        enrichment,
      };
    }
    return { kept: true, enrichment };
  }

  // ── Single amount: "$120,000" ─────────────────────────────────────────────
  const singleRe = /\$(\d{2,3}),(\d{3})/;
  const singleMatch = singleRe.exec(description);
  if (singleMatch) {
    const amount = parseSalary(singleMatch[1], singleMatch[2]);
    const enrichment: Partial<JobEnrichment> = {
      salary_min: amount,
      salary_max: amount,
      salary_currency: "USD",
    };

    if (amount < min_base_salary_usd) {
      return {
        kept: false,
        reason:
          `Salary $${amount.toLocaleString()} is below minimum ` +
          `$${min_base_salary_usd.toLocaleString()}`,
        enrichment,
      };
    }
    return { kept: true, enrichment };
  }

  // No salary disclosed — keep
  return { kept: true, enrichment: EMPTY_SALARY };
}
