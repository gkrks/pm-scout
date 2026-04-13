"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractRequirements = extractRequirements;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const client = new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY });
const SYSTEM_PROMPT = `You are a job requirement parser. You receive raw text scraped from a job posting's requirements section.

Your job: extract ONLY the core skill/qualification phrases. Strip all filler language.

Rules:
- Return each requirement as a SHORT, ATOMIC phrase (5–15 words max)
- Remove phrases like "you will", "you have", "we expect", "ideally", "we are looking for"
- Keep domain-specific terms verbatim (e.g. "ACH", "GraphQL", "LTV", "A/B testing")
- For experience requirements like "3+ years of X", keep the exact number and domain
- For degree requirements, keep the degree level (Bachelor's, Master's, PhD)
- Split compound requirements: "strong analytical and communication skills" → two items
- Omit soft generic filler like "team player", "passionate", "self-starter" UNLESS the job is explicitly asking for leadership or culture fit roles
- Return ONLY a JSON array of strings. No preamble, no explanation, no markdown.

Example input:
"Bachelor's, Master's, or equivalent experience. 3+ years in a PM role. Familiarity with payment systems (ACH, wires, card networks) or vendor integrations such as data aggregators."

Example output:
["Bachelor's or Master's degree or equivalent", "3+ years product management experience", "payment systems (ACH, wires, card networks)", "vendor integrations — data aggregators"]`;
async function callExtractor(rawText) {
    const message = await client.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 1000,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: rawText }],
    });
    const content = message.content[0];
    if (content.type !== "text") {
        throw new Error("Unexpected response type from extractor");
    }
    const text = content.text.trim();
    // Strip markdown fences if the model wraps the JSON
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) {
        throw new Error("Extractor response is not a JSON array");
    }
    return parsed;
}
/**
 * Extract atomic requirement phrases from raw job posting text.
 * Retries once on JSON parse failure.
 */
async function extractRequirements(rawText) {
    try {
        return await callExtractor(rawText);
    }
    catch (err) {
        // Retry once
        try {
            return await callExtractor(rawText);
        }
        catch {
            throw new Error(`Extractor failed after retry: ${err}`);
        }
    }
}
//# sourceMappingURL=extractor.js.map