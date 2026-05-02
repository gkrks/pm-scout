/**
 * APM signal detection — Bug Fix 15
 *
 * Classifies a job into one of three APM priority levels:
 *   'priority_apm'  — the job is in a named APM / rotational program
 *   'apm_company'   — the company runs an APM program but this role isn't in it
 *   'none'          — not at an APM-program company
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

// Strong title signals that this job is the program itself (not just at the company).
const PRIORITY_APM_TITLE_PATTERNS = [
  /\bAPM\b/i,
  /\bassociate\s+product\s+manager\b/i,
  /\brotational\s+product\s+manager\b/i,
  /\bproduct\s+manager,?\s*new\s*grad\b/i,
  /\bproduct\s+manager\s+(rotational|new\s*grad|university|early\s*career)\b/i,
];

// Description signals that this is a structured rotational / new-grad program.
const PRIORITY_APM_DESCRIPTION_PATTERNS = [
  /\brotational\s+program\b/i,
  /\b\d+[-\s]year\s+rotation\b/i,
  /\bnew\s+grad(uate)?\s+program\b/i,
  /\bearly[\s-]career\s+program\b/i,
  /\buniversity\s+(grad|hire|recruiting)\b/i,
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Detect the APM signal level for a job.
 *
 * @param input.title        Raw job title.
 * @param input.description  Job description text (may be absent — detection falls back
 *                           to title-only when null/undefined).
 * @param input.company      Company APM program fields.
 */
export function detectApmSignal(input: ApmDetectionInput): ApmSignal {
  const { title, description, company } = input;
  const hasActiveProgram =
    (company.has_apm_program ?? false) &&
    company.apm_program_status === "active";

  if (!hasActiveProgram) return "none";

  // ── Priority APM: title or description matches a strong APM pattern ─────────
  const titleMatchesAPM = PRIORITY_APM_TITLE_PATTERNS.some((p) => p.test(title));

  const descMatchesAPM = description
    ? PRIORITY_APM_DESCRIPTION_PATTERNS.some((p) => p.test(description))
    : false;

  // Also match the program's own name in the description (e.g. "Google APM Program").
  const programNameMatch =
    company.apm_program_name && description
      ? new RegExp(`\\b${escapeRegex(company.apm_program_name)}\\b`, "i").test(description)
      : false;

  if (titleMatchesAPM || descMatchesAPM || programNameMatch) {
    return "priority_apm";
  }

  // ── APM company: company runs an active program but this job isn't in it ────
  return "apm_company";
}
