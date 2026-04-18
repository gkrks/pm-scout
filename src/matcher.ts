import Groq from "groq-sdk";
import { ResumeData } from "./parser";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "llama-3.1-8b-instant";

export interface MatchResult {
  requirement: string;
  status: "met" | "partial" | "missing";
  proof: string;      // Verbatim excerpt from resume, or calculation; empty if missing
  location: string;   // e.g. "Experience > Stripe > bullet 3"
  confidence: number; // 0.0 – 1.0
}

const SYSTEM_PROMPT = `You are a resume analyst. You will be given ONE job requirement phrase and the full text of a resume.

Your task: determine whether the resume satisfies this requirement.

Return ONLY a JSON object with these fields:
- status: "met", "partial", or "missing"
  - "met" = clear, direct evidence exists
  - "partial" = related evidence exists but doesn't fully satisfy the requirement
  - "missing" = no relevant evidence found
- proof: A SHORT verbatim excerpt from the resume that supports your answer (under 30 words). If missing, return an empty string.
- location: Where in the resume this evidence appears. Format as "Section > Subsection > detail". Example: "Experience > Stripe > bullet 2" or "Education > line 1" or "Skills > row 3"
- confidence: A number from 0.0 to 1.0 indicating your certainty

SPECIAL RULE for "X+ years of Y" requirements:
- Do NOT guess. Calculate from the work entries provided.
- Sum up ALL months of experience that match domain Y across all jobs.
- If the total meets or exceeds the requirement, status = "met". If within 6 months short, status = "partial". Otherwise, status = "missing".
- In the proof field, show your calculation: "PM @ Company A (Jan 2021–present = Ny Nm) + PM @ Company B (dates = Nm). Total: Ny Nm"

SPECIAL RULE for degree requirements:
- Look in the Education section first
- If the degree level matches, status = "met", proof = exact degree line from resume

Return ONLY the JSON object. No preamble, no explanation, no markdown fences.`;

function buildUserMessage(requirement: string, resume: ResumeData): string {
  return [
    `REQUIREMENT: ${requirement}`,
    `RESUME:`,
    resume.raw,
    `EXPERIENCE ENTRIES (parsed):`,
    JSON.stringify(resume.experience, null, 2),
  ].join("\n");
}

const FALLBACK_RESULT: Omit<MatchResult, "requirement"> = {
  status: "missing",
  proof: "",
  location: "",
  confidence: 0,
};

async function callMatcher(requirement: string, resume: ResumeData): Promise<MatchResult> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 500,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: buildUserMessage(requirement, resume) },
    ],
  });

  const text = (completion.choices[0].message.content ?? "").trim();
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(clean) as Omit<MatchResult, "requirement">;

  // Enforce: if status is "missing", proof must be empty
  if (parsed.status === "missing") parsed.proof = "";

  return { requirement, ...parsed };
}

const CONCURRENCY = 10;

/**
 * Match each requirement against the resume with up to CONCURRENCY requests in
 * flight at once. Results are returned in the original requirement order.
 * Retries once on failure; falls back to { status: "missing" } on second failure.
 */
export async function matchRequirements(
  requirements: string[],
  resume: ResumeData,
  onProgress?: (current: number, total: number) => void,
): Promise<MatchResult[]> {
  const total = requirements.length;
  let completed = 0;

  let slots = CONCURRENCY;
  const queue: Array<() => void> = [];
  function acquire(): Promise<void> {
    if (slots > 0) { slots--; return Promise.resolve(); }
    return new Promise((resolve) => queue.push(resolve));
  }
  function release(): void {
    if (queue.length > 0) { queue.shift()!(); }
    else { slots++; }
  }

  const promises = requirements.map(async (req, i) => {
    await acquire();
    try {
      let result: MatchResult;
      try {
        result = await callMatcher(req, resume);
      } catch {
        try {
          result = await callMatcher(req, resume);
        } catch (retryErr) {
          console.error(`  [matcher] Failed for requirement "${req}": ${retryErr}`);
          result = { requirement: req, ...FALLBACK_RESULT, proof: "Parse error" };
        }
      }
      completed++;
      if (onProgress) onProgress(completed, total);
      return { i, result };
    } finally {
      release();
    }
  });

  const settled = await Promise.all(promises);
  settled.sort((a, b) => a.i - b.i);
  return settled.map((s) => s.result);
}
