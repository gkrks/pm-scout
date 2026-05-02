/**
 * Phase 3.3 — Experience filter (strict 0–3 year enforcement)
 *
 * A job is KEPT only when there is positive evidence it is junior-level:
 *   1. Title is exactly "Associate Product Manager" or "APM" (overrides all)
 *   2. Description contains explicit junior-language phrases
 *   3. Both yoe_min AND yoe_max were extracted and both are ≤ 3
 *   4. yoe_min was extracted (≤ 3), yoe_max is null, AND no "+" suffix
 *
 * Everything else is rejected. When in doubt, reject.
 *
 * Rejection reasons:
 *   'experience-too-senior'              — explicit senior signal found
 *   'experience-unclear-and-not-junior'  — no YOE numbers, no junior language, not APM title
 */

import type { FilterResult, JobEnrichment } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Exact-match override: title is unambiguously entry-level */
const APM_TITLE_RE = /\b(associate\s+product\s+manager|apm)\b/i;

/**
 * Junior language phrases (per spec).
 * Any of these in the description is sufficient to keep on language signal alone.
 */
const JUNIOR_PHRASES_RE =
  /new\s+grad(?:uate)?|new\s+graduate|university\s+grad(?:uate)?|entry[\s-]level|early[\s-]career|0[\s-–]1\s+years?|0[\s-–]2\s+years?|0[\s-–]3\s+years?|1[\s-–]2\s+years?|1[\s-–]3\s+years?|2[\s-–]3\s+years?|no\s+prior\s+experience\s+required|internship/i;

/**
 * Context patterns that indicate a seniority keyword is describing who the
 * candidate will WORK WITH, not the seniority of the role itself.
 * Used to suppress false-positive senior-language detection.
 */
const COLLABORATION_CONTEXT_RE =
  /work(?:ing)?\s+with|alongside|collaborate\s+with|partner\s+with|report(?:ing)?\s+to|stakeholder|cross[\s-]functional/i;

// ── YOE signal extraction ─────────────────────────────────────────────────────

export interface YoeSignals {
  yoe_min: number | null;
  yoe_max: number | null;
  yoe_raw: string | null;
  /** True when the matched pattern had a "+" suffix (open-ended "and up") */
  has_plus_suffix: boolean;
  /** True when matched via "minimum"/"at least" — a hard floor, not a preference */
  has_min_clause: boolean;
  /** True when any junior phrase from JUNIOR_PHRASES_RE appears in the description */
  has_junior_language: boolean;
  /**
   * True when "senior|staff|lead|principal|director" appears in a sentence that
   * is clearly about the seniority of the ROLE being filled (not a collaborator).
   */
  has_senior_language: boolean;
}

/**
 * Extract all experience-related signals from a job description.
 * Exported so it can be unit-tested independently.
 */
export function extractYoeSignals(description: string): YoeSignals {
  let yoe_min: number | null = null;
  let yoe_max: number | null = null;
  let yoe_raw: string | null = null;
  let has_plus_suffix = false;
  let has_min_clause = false;

  // Pattern 1: "up to N years [of experience]"
  // Must run BEFORE the generic patterns so "up to 5 years of experience" doesn't
  // set yoe_min = 5.
  {
    const re = /up\s+to\s+(\d+)\s+years?/i;
    const m = re.exec(description);
    if (m) {
      yoe_max = parseInt(m[1], 10);
      yoe_raw = m[0];
    }
  }

  // Pattern 2: explicit range "5-8 years" / "5–8 years"
  // Must run BEFORE the single-value patterns so "2-3 years" doesn't match on
  // the trailing "3 years" substring.
  if (!yoe_raw) {
    const re = /(\d+)\s*[-–]\s*(\d+)\s+years?/i;
    const m = re.exec(description);
    if (m) {
      yoe_min = parseInt(m[1], 10);
      yoe_max = parseInt(m[2], 10);
      yoe_raw = m[0];
    }
  }

  // Pattern 3: "5 to 8 years of [type] experience" or "5+ years of experience"
  if (!yoe_raw) {
    const re =
      /(\d+)(\+)?\s*(?:to\s+(\d+)\s+)?years?\s+of\s+(?:relevant\s+)?(?:product|professional|industry|work|software|technical\s+)?\s*experience/i;
    const m = re.exec(description);
    if (m) {
      yoe_min = parseInt(m[1], 10);
      has_plus_suffix = !!m[2];
      if (m[3]) {
        yoe_max = parseInt(m[3], 10);
      } else if (!m[2]) {
        // No "+" and no upper bound in the text → treat as exact: min === max
        yoe_max = parseInt(m[1], 10);
      }
      // If there IS a "+", yoe_max stays null (open-ended)
      yoe_raw = m[0];
    }
  }

  // Pattern 4: "minimum [of] N years"
  if (!yoe_raw) {
    const re = /minimum\s+(?:of\s+)?(\d+)\s+years?/i;
    const m = re.exec(description);
    if (m) {
      yoe_min = parseInt(m[1], 10);
      has_min_clause = true;
      yoe_raw = m[0];
    }
  }

  // Pattern 5: "at least N years"
  if (!yoe_raw) {
    const re = /at\s+least\s+(\d+)\s+years?/i;
    const m = re.exec(description);
    if (m) {
      yoe_min = parseInt(m[1], 10);
      has_min_clause = true;
      yoe_raw = m[0];
    }
  }

  // Pattern 6: bare "N+ years" (least specific — run last)
  if (!yoe_raw) {
    const re = /(\d+)\+\s*years?/i;
    const m = re.exec(description);
    if (m) {
      yoe_min = parseInt(m[1], 10);
      has_plus_suffix = true;
      yoe_raw = m[0];
    }
  }

  // ── Junior language ──────────────────────────────────────────────────────────
  const has_junior_language = JUNIOR_PHRASES_RE.test(description);

  // ── Senior language: seniority word describing the ROLE itself ───────────────
  // Look for "Senior|Staff|Lead|Principal|Director" followed by "Product Manager"
  // or "PM" (the phrase indicates the ROLE is senior). Suppress if the surrounding
  // context is clearly about a collaborator, not the applicant.
  let has_senior_language = false;
  const seniorPhraseRe =
    /\b(senior|staff|lead|principal|director)\s+(?:product\s+manager|pm)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = seniorPhraseRe.exec(description)) !== null) {
    // Grab up to 80 chars before the match to check for collaboration context
    const before = description.slice(Math.max(0, match.index - 80), match.index);
    if (!COLLABORATION_CONTEXT_RE.test(before)) {
      has_senior_language = true;
      break;
    }
  }

  return {
    yoe_min,
    yoe_max,
    yoe_raw,
    has_plus_suffix,
    has_min_clause,
    has_junior_language,
    has_senior_language,
  };
}

// ── Filter ────────────────────────────────────────────────────────────────────

/**
 * Phase 3.3 — Experience filter
 *
 * @param description  Full job description text. May be undefined when the
 *                     description hasn't been fetched yet.
 * @param title        Job title — used only for the APM title override.
 */
export function filterExperience(
  description: string | undefined,
  title?: string,
): FilterResult {
  const isApmTitle = title ? APM_TITLE_RE.test(title) : false;

  // ── No description available ─────────────────────────────────────────────────
  if (!description) {
    if (isApmTitle) {
      return {
        kept: true,
        reason: "APM title override — no description needed",
        enrichment: {
          yoe_min: null,
          yoe_max: null,
          yoe_raw: null,
          experience_confidence: "inferred-junior",
          is_new_grad_language: false,
        },
      };
    }
    // No description + not APM title → reject (when in doubt, reject)
    console.warn(
      `[experience] REJECT experience-unclear-and-not-junior — no description, title="${title ?? "(none)"}"`,
    );
    return {
      kept: false,
      reason: "experience-unclear-and-not-junior",
      enrichment: {
        yoe_min: null,
        yoe_max: null,
        yoe_raw: null,
        experience_confidence: "inferred-junior",
        is_new_grad_language: false,
      },
    };
  }

  const {
    yoe_min,
    yoe_max,
    yoe_raw,
    has_plus_suffix,
    has_min_clause,
    has_junior_language,
    has_senior_language,
  } = extractYoeSignals(description);

  const enrichment: Partial<JobEnrichment> = {
    yoe_min,
    yoe_max,
    yoe_raw,
    is_new_grad_language: has_junior_language,
  };

  // ── APM title override: keep regardless of other signals ─────────────────────
  if (isApmTitle) {
    enrichment.experience_confidence = "inferred-junior";
    return {
      kept: true,
      reason: "APM title override",
      enrichment,
    };
  }

  // ── Explicit REJECT conditions ───────────────────────────────────────────────

  if (yoe_min !== null && yoe_min > 3) {
    console.warn(
      `[experience] REJECT experience-too-senior — yoe_min=${yoe_min}, raw="${yoe_raw}"`,
    );
    return { kept: false, reason: "experience-too-senior", enrichment };
  }

  // Only reject on yoe_max when there is no yoe_min set (e.g. "up to 5 years").
  // For explicit ranges like "2–5 years", yoe_min=2 ≤ 3 means the role accepts
  // junior candidates — the upper end is a preference, not a floor.
  if (yoe_min === null && yoe_max !== null && yoe_max > 3) {
    console.warn(
      `[experience] REJECT experience-too-senior — yoe_max=${yoe_max} (no lower bound), raw="${yoe_raw}"`,
    );
    return { kept: false, reason: "experience-too-senior", enrichment };
  }

  if (has_senior_language && !has_junior_language) {
    console.warn(
      `[experience] REJECT experience-too-senior — senior role language in description`,
    );
    return { kept: false, reason: "experience-too-senior", enrichment };
  }

  // ── Explicit KEEP conditions ─────────────────────────────────────────────────

  // Keep on junior language alone (title-independent)
  if (has_junior_language) {
    enrichment.experience_confidence = "inferred-junior";
    return { kept: true, reason: "Junior language detected", enrichment };
  }

  // "up to N years" pattern: yoe_min is null, yoe_max extracted and ≤ 3
  if (yoe_min === null && yoe_max !== null && yoe_max <= 3) {
    enrichment.experience_confidence = "extracted";
    return {
      kept: true,
      reason: `YOE up-to ${yoe_max} within 0–3`,
      enrichment,
    };
  }

  // yoe_min extracted and ≤ 3 — the role accepts someone at the lower bound.
  // yoe_max may be anything (including > 3): "2–5 years" keeps because yoe_min=2
  // means the company will hire a 2-year candidate.
  // Excludes plus-suffix cases (caught as "too senior" below when min > 3, or
  // no-min cases handled above).
  if (yoe_min !== null && yoe_min <= 3 && !has_plus_suffix) {
    enrichment.experience_confidence = "extracted";
    return {
      kept: true,
      reason: `YOE lower bound ${yoe_min} ≤ 3`,
      enrichment,
    };
  }

  // ── Reject everything else ───────────────────────────────────────────────────

  if (yoe_raw === null) {
    // No YOE numbers at all, no junior language, not APM → unclear
    console.warn(
      `[experience] REJECT experience-unclear-and-not-junior — no YOE numbers and no junior language`,
    );
    return { kept: false, reason: "experience-unclear-and-not-junior", enrichment };
  }

  // YOE numbers were extracted but didn't meet any KEEP condition —
  // covers: "3+ years" (plus suffix), "minimum 2 years" (min clause ≤ 3 but open-ended), etc.
  console.warn(
    `[experience] REJECT experience-too-senior — ambiguous YOE "${yoe_raw}" (plus=${has_plus_suffix}, minClause=${has_min_clause})`,
  );
  return { kept: false, reason: "experience-too-senior", enrichment };
}
