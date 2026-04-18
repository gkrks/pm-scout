import Groq from "groq-sdk";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "llama-3.1-8b-instant";

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

async function callExtractor(rawText: string): Promise<string[]> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 1000,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: rawText },
    ],
  });

  const text = (completion.choices[0].message.content ?? "").trim();
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(clean);
  if (!Array.isArray(parsed)) throw new Error("Extractor response is not a JSON array");
  return parsed as string[];
}

/**
 * Extract atomic requirement phrases from raw job posting text.
 * Retries once on JSON parse failure.
 */
export async function extractRequirements(rawText: string): Promise<string[]> {
  try {
    return await callExtractor(rawText);
  } catch (err) {
    try {
      return await callExtractor(rawText);
    } catch {
      throw new Error(`Extractor failed after retry: ${err}`);
    }
  }
}
