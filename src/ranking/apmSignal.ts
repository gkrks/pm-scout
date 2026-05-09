/**
 * APM / Early-career program signal detection
 *
 * Classifies a job into one of three priority levels:
 *   'priority_apm'  — the job is in a named early-career / rotational program
 *   'apm_company'   — the company runs an early-career program but this role isn't in it
 *   'none'          — not at an early-career-program company
 *
 * Works across all role categories (PM, TPM, SWE).
 *
 * Used in both tier assignment (tier.ts) and digest rendering (email.ts, digest.ts).
 */

export type ApmSignal = "priority_apm" | "apm_company" | "none";

export interface ApmDetectionInput {
  title:       string;
  description: string | null | undefined;
  company: {
    has_apm_program?:    boolean;
    apm_program_name?:   string | null;
    apm_program_status?: string | null;
  };
}

// ── PM early-career title patterns ───────────────────────────────────────────
const PM_PROGRAM_TITLE_PATTERNS = [
  /\bAPM\b/i,
  /\bassociate\s+product\s+manager\b/i,
  /\brotational\s+product\s+manager\b/i,
  /\bproduct\s+manager,?\s*new\s*grad\b/i,
  /\bproduct\s+manager\s+(rotational|new\s*grad|university|early\s*career)\b/i,
];

// ── SWE early-career title patterns ──────────────────────────────────────────
const SWE_PROGRAM_TITLE_PATTERNS = [
  /\bnew\s+grad\b.*\bsoftware\s+engineer\b/i,
  /\bsoftware\s+engineer\b.*\bnew\s+grad\b/i,
  /\bsoftware\s+engineer\b.*\bentry[\s-]level\b/i,
  /\bentry[\s-]level\b.*\bsoftware\s+engineer\b/i,
  /\bsoftware\s+engineer\b.*\bearly[\s-]career\b/i,
  /\bearly[\s-]career\b.*\bsoftware\s+engineer\b/i,
  /\bsoftware\s+engineer\b.*\buniversity\b/i,
  /\buniversity\b.*\bsoftware\s+engineer\b/i,
  /\bjunior\s+software\s+engineer\b/i,
  /\bsoftware\s+engineer\s+[i1]\b/i,
  /\bsoftware\s+engineer,?\s+(rotational|new\s*grad|university|early\s*career)\b/i,
  /\bSTEP\b/,  // Google STEP program
];

// ── TPM early-career title patterns ──────────────────────────────────────────
const TPM_PROGRAM_TITLE_PATTERNS = [
  /\bnew\s+grad\b.*\btechnical\s+program\s+manager\b/i,
  /\btechnical\s+program\s+manager\b.*\bnew\s+grad\b/i,
  /\btechnical\s+program\s+manager\b.*\bentry[\s-]level\b/i,
  /\bentry[\s-]level\b.*\btechnical\s+program\s+manager\b/i,
  /\btechnical\s+program\s+manager\b.*\bearly[\s-]career\b/i,
  /\bearly[\s-]career\b.*\btechnical\s+program\s+manager\b/i,
  /\btechnical\s+program\s+manager\s+[i1]\b/i,
  /\btechnical\s+program\s+manager,?\s+(rotational|new\s*grad|university|early\s*career)\b/i,
];

// ── Description patterns (role-agnostic) ─────────────────────────────────────
const EARLY_CAREER_DESCRIPTION_PATTERNS = [
  /\brotational\s+program\b/i,
  /\b\d+[-\s]year\s+rotation\b/i,
  /\bnew\s+grad(uate)?\s+program\b/i,
  /\bearly[\s-]career\s+program\b/i,
  /\buniversity\s+(grad|hire|recruiting)\b/i,
  /\bnew\s+grad(uate)?\s+role\b/i,
  /\bentry[\s-]level\s+program\b/i,
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Detect the early-career program signal level for a job.
 *
 * Checks title patterns for PM, SWE, and TPM roles, plus role-agnostic
 * description patterns and program name matching.
 *
 * @param input.title        Raw job title.
 * @param input.description  Job description text (may be absent — detection falls back
 *                           to title-only when null/undefined).
 * @param input.company      Company early-career program fields.
 */
export function detectApmSignal(input: ApmDetectionInput): ApmSignal {
  const { title, description, company } = input;
  const hasActiveProgram =
    (company.has_apm_program ?? false) &&
    company.apm_program_status === "active";

  if (!hasActiveProgram) return "none";

  // ── Priority: title matches a strong early-career pattern (any category) ────
  const allTitlePatterns = [
    ...PM_PROGRAM_TITLE_PATTERNS,
    ...SWE_PROGRAM_TITLE_PATTERNS,
    ...TPM_PROGRAM_TITLE_PATTERNS,
  ];
  const titleMatch = allTitlePatterns.some((p) => p.test(title));

  const descMatch = description
    ? EARLY_CAREER_DESCRIPTION_PATTERNS.some((p) => p.test(description))
    : false;

  // Also match the program's own name in the description (e.g. "Google APM Program").
  const programNameMatch =
    company.apm_program_name && description
      ? new RegExp(`\\b${escapeRegex(company.apm_program_name)}\\b`, "i").test(description)
      : false;

  if (titleMatch || descMatch || programNameMatch) {
    return "priority_apm";
  }

  // ── Company runs an active program but this job isn't in it ─────────────────
  return "apm_company";
}
