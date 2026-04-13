"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchRequirements = matchRequirements;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const client = new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY });
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
function buildUserMessage(requirement, resume) {
    return [
        `REQUIREMENT: ${requirement}`,
        `RESUME:`,
        resume.raw,
        `EXPERIENCE ENTRIES (parsed):`,
        JSON.stringify(resume.experience, null, 2),
    ].join("\n");
}
const FALLBACK_RESULT = {
    status: "missing",
    proof: "",
    location: "",
    confidence: 0,
};
async function callMatcher(requirement, resume) {
    const message = await client.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 500,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(requirement, resume) }],
    });
    const content = message.content[0];
    if (content.type !== "text") {
        throw new Error("Unexpected response type from matcher");
    }
    const text = content.text.trim();
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(clean);
    // Enforce: if status is "missing", proof must be empty
    if (parsed.status === "missing") {
        parsed.proof = "";
    }
    return { requirement, ...parsed };
}
const CONCURRENCY = 10;
/**
 * Match each requirement against the resume with up to CONCURRENCY requests in
 * flight at once. Results are returned in the original requirement order.
 * Retries once on failure; falls back to { status: "missing" } on second failure.
 */
async function matchRequirements(requirements, resume, onProgress) {
    const total = requirements.length;
    let completed = 0;
    // Semaphore: cap concurrent Claude calls
    let slots = CONCURRENCY;
    const queue = [];
    function acquire() {
        if (slots > 0) {
            slots--;
            return Promise.resolve();
        }
        return new Promise((resolve) => queue.push(resolve));
    }
    function release() {
        if (queue.length > 0) {
            queue.shift()();
        }
        else {
            slots++;
        }
    }
    const promises = requirements.map(async (req, i) => {
        await acquire();
        try {
            let result;
            try {
                result = await callMatcher(req, resume);
            }
            catch {
                // Retry once
                try {
                    result = await callMatcher(req, resume);
                }
                catch (retryErr) {
                    console.error(`  [matcher] Failed for requirement "${req}": ${retryErr}`);
                    result = { requirement: req, ...FALLBACK_RESULT, proof: "Parse error" };
                }
            }
            completed++;
            if (onProgress)
                onProgress(completed, total);
            return { i, result };
        }
        finally {
            release();
        }
    });
    const settled = await Promise.all(promises);
    // Restore original order (Promise.all preserves insertion order, but be explicit)
    settled.sort((a, b) => a.i - b.i);
    return settled.map((s) => s.result);
}
//# sourceMappingURL=matcher.js.map