/**
 * Phase 3.1 — Title filter
 *
 * Include rule  : title must contain at least one include keyword (case-insensitive substring).
 * Exclude rule  : title must NOT match any exclude keyword.
 *                 Most keywords use word-boundary matching so "Product Manager" in an include
 *                 doesn't accidentally match "Senior Product Manager" via the exclude list.
 *                 Exception: keywords that end with a literal space (e.g. "VP ") are matched
 *                 as plain substrings to avoid false-matching adjacent text like "VPN".
 *
 * Normalisation applied to the title before matching:
 *   lowercase · collapse whitespace · strip punctuation except '-'
 * Keywords are lowercased but NOT normalised further — the trailing-space trick depends on it.
 */

import type { FilterConfig, FilterResult } from "./types";

/** Lower-case, collapse whitespace, strip all punctuation except hyphens. */
function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ") // strip punctuation except '-'
    .replace(/\s+/g, " ")
    .trim();
}

/** Escape a string for safe use inside a RegExp literal. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns true when `keyword` is found in `normalisedTitle` using word-boundary matching.
 *
 * Keywords ending with a space bypass word-boundary logic and use plain substring search
 * (e.g. "vp " matches "vp of product" but not "vpn solutions").
 *
 * For all other keywords the keyword is normalised (same transformation as the title —
 * lowercase, strip punctuation except hyphens, collapse whitespace) before the regex is
 * built, so "Sr. Product Manager" correctly matches the normalised title "sr product
 * manager" even after the dot is stripped.
 */
function excludeMatches(normalisedTitle: string, keyword: string): boolean {
  const kwLower = keyword.toLowerCase();

  if (kwLower.endsWith(" ")) {
    // Literal substring — preserves the intentional trailing space
    return normalisedTitle.includes(kwLower);
  }

  // Normalise the keyword the same way as the title so punctuation differences
  // (e.g. "Sr." → "sr") don't prevent a match.
  const kwNorm = normaliseTitle(kwLower);
  const re = new RegExp(`\\b${escapeRe(kwNorm)}\\b`);
  return re.test(normalisedTitle);
}

/**
 * 3.1 Title filter
 *
 * Pure function — no side effects.
 */
export function filterTitle(
  rawTitle: string,
  config: Pick<FilterConfig, "title_include_keywords" | "title_exclude_keywords">,
): FilterResult {
  const normalised = normaliseTitle(rawTitle);

  // ── Include check ─────────────────────────────────────────────────────────
  const included = config.title_include_keywords.some((kw) =>
    normalised.includes(kw.toLowerCase()),
  );

  if (!included) {
    return {
      kept: false,
      reason: `"${rawTitle}" does not match any include keyword`,
      enrichment: {},
    };
  }

  // ── Exclude check ─────────────────────────────────────────────────────────
  for (const kw of config.title_exclude_keywords) {
    if (excludeMatches(normalised, kw)) {
      return {
        kept: false,
        reason: `"${rawTitle}" matches exclude keyword "${kw}"`,
        enrichment: {},
      };
    }
  }

  return { kept: true, enrichment: {} };
}
