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

import type { FilterConfig, FilterResult, RoleCategory } from "./types";

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
 * Check if a title matches a role category by required_words (all must appear).
 */
function matchesRequiredWords(normalised: string, words: string[]): boolean {
  return words.every((w) => normalised.includes(w.toLowerCase()));
}

/**
 * 3.1 Title filter
 *
 * Tries each role category in order: TPM/SWE first (more specific), then PM.
 * Returns the first matching category. Pure function — no side effects.
 */
export function filterTitle(
  rawTitle: string,
  config: Pick<FilterConfig, "title_include_keywords" | "title_exclude_keywords" | "role_categories">,
): FilterResult {
  const normalised = normaliseTitle(rawTitle);

  // ── Try TPM / SWE categories first (more specific required_words matching) ─
  const categories = config.role_categories ?? [];
  for (const cat of categories) {
    if (!cat.required_words || cat.required_words.length === 0) continue;

    if (matchesRequiredWords(normalised, cat.required_words)) {
      // Check category-specific excludes
      const catExcludes = cat.title_exclude_keywords ?? [];
      let excluded = false;
      for (const kw of catExcludes) {
        if (excludeMatches(normalised, kw)) {
          excluded = true;
          break;
        }
      }
      if (!excluded) {
        return { kept: true, enrichment: { role_category: cat.id } };
      }
    }
  }

  // ── PM: original include/exclude logic ────────────────────────────────────
  const included = config.title_include_keywords.some((kw) =>
    normalised.includes(kw.toLowerCase()),
  );

  if (!included) {
    return {
      kept: false,
      reason: `"${rawTitle}" does not match any include keyword or role category`,
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

  return { kept: true, enrichment: { role_category: "PM" as RoleCategory } };
}
