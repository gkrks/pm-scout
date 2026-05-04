/**
 * Summary generator: produces 3 ranked summary candidates
 * using the resume_summary.md prompt via OpenAI gpt-4o.
 *
 * Called during /score to provide candidates in the UI before generate.
 */

import fs from "fs";
import path from "path";
import OpenAI from "openai";

const PROMPT_PATH = path.resolve(__dirname, "../../.claude/commands/resume_summary.md");
const SUMMARY_MAX_CHARS = 300;

export interface SummaryCandidate {
  index: number;
  angle: string;
  text: string;
  chars: number;
  reasoning: string;
  selfCheck: string;
}

export interface SummaryResult {
  candidates: SummaryCandidate[];
  recommended: number; // 1-indexed
  jdAnalysis: string;
}

/**
 * Generate 3 summary candidates for a job.
 */
export async function generateSummaryCandidates(
  jdText: string,
  bulletTexts: string[],
): Promise<SummaryResult> {
  const openaiKey = process.env.OPENAI_KEY;
  if (!openaiKey) {
    return fallbackResult();
  }

  // Load the prompt template
  let promptTemplate: string;
  try {
    promptTemplate = fs.readFileSync(PROMPT_PATH, "utf-8");
  } catch {
    // Inline a simplified version if the file doesn't exist
    promptTemplate = getInlinePrompt();
  }

  // Build the inputs section
  const bulletsStr = bulletTexts
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");

  const userMessage = `JD:\n\`\`\`\n${jdText}\n\`\`\`\n\nBULLETS:\n\`\`\`\n${bulletsStr}\n\`\`\``;

  // Strip the INPUTS section from the prompt (we provide it as user message)
  let systemPrompt = promptTemplate
    .replace(/## INPUTS[\s\S]*$/, "")
    .trim();

  // Extract the JD's years requirement and inject as a clear override
  const yearsMatch = jdText.match(/(?:less than|under|<)\s*(\d+)\s*years?/i)
    || jdText.match(/(\d+)\+?\s*years?\s*(?:of\s+)?(?:professional|total|relevant)?\s*experience/i);
  if (yearsMatch) {
    const jdYears = yearsMatch[1];
    systemPrompt += `\n\n## CRITICAL OVERRIDE\nThe JD specifies "${jdYears}" years. You MUST use "${jdYears}+ yrs" or "${jdYears}+ years" in the summary. Do NOT use "4+ yrs" or any other number. This overrides rule 8.`;
  }

  const client = new OpenAI({ apiKey: openaiKey });

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.3, // slight creativity for different angles
      max_tokens: 2000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

    const raw = response.choices[0]?.message?.content || "";
    return parseResponse(raw);
  } catch (err: any) {
    console.error("[summary] OpenAI call failed:", err.message);
    return fallbackResult();
  }
}

/**
 * Parse the structured response from the LLM.
 */
function parseResponse(raw: string): SummaryResult {
  const candidates: SummaryCandidate[] = [];

  // Extract JD analysis
  const jdMatch = raw.match(/JD ANALYSIS\s*\n([\s\S]*?)(?=\nCANDIDATE 1)/i);
  const jdAnalysis = jdMatch ? jdMatch[1].trim() : "";

  // Extract each candidate
  for (let i = 1; i <= 3; i++) {
    const pattern = new RegExp(
      `CANDIDATE ${i}\\s*[—-]\\s*([^\\n]+)\\nText:\\s*"([^"]+)"\\s*\\nChars:\\s*(\\d+)\\s*\\nSelf-check:\\s*([^\\n]+)\\nReasoning:\\s*([^\\n]+(?:\\n[^\\n]+)?)`,
      "i",
    );
    const match = raw.match(pattern);
    if (match) {
      candidates.push({
        index: i,
        angle: match[1].trim(),
        text: match[2].trim(),
        chars: parseInt(match[3], 10),
        selfCheck: match[4].trim(),
        reasoning: match[5].trim(),
      });
    }
  }

  // Extract recommended
  const recMatch = raw.match(/RECOMMENDED:\s*CANDIDATE\s*(\d)/i);
  const recommended = recMatch ? parseInt(recMatch[1], 10) : 1;

  // If parsing failed, try a looser extraction
  if (candidates.length === 0) {
    // Try to find any quoted text as summaries
    const quotes = raw.match(/"([^"]{50,300})"/g);
    if (quotes) {
      quotes.slice(0, 3).forEach((q, i) => {
        const text = q.replace(/^"|"$/g, "").trim();
        candidates.push({
          index: i + 1,
          angle: i === 0 ? "engineering" : i === 1 ? "product" : "bridge",
          text,
          chars: text.length,
          selfCheck: "Parsed from loose match",
          reasoning: "",
        });
      });
    }
  }

  if (candidates.length === 0) {
    return fallbackResult();
  }

  return { candidates, recommended, jdAnalysis };
}

function fallbackResult(): SummaryResult {
  const text = "Engineer-PM with 4+ yrs across consumer robotics, fitness tech, and enterprise SaaS; ships end-to-end systems in Rust and Python, bridging product management with hands-on engineering.";
  return {
    candidates: [{
      index: 1,
      angle: "fallback",
      text,
      chars: text.length,
      selfCheck: "Fallback (no API key or call failed)",
      reasoning: "Static fallback summary.",
    }],
    recommended: 1,
    jdAnalysis: "",
  };
}

function getInlinePrompt(): string {
  return `You are generating the professional summary for Krithik Gopinath's resume, tailored to a specific job description.

Produce 3 ranked summary candidates. Each must:
1. Be <= 300 characters
2. No em dashes. Use ; or , instead.
3. No buzzwords (passionate, results-driven, dynamic, motivated, etc.)
4. No first-person pronouns (I, me, my)
5. No content duplicating the BULLETS
6. Mirror 2-3 JD keywords naturally
7. Start with identity noun (Engineer-PM, Builder-PM, etc.)
8. Include "4+ yrs" or "4+ years"
9. Plain ASCII only

Output in this format:
CANDIDATE 1 - <angle>
Text: "<summary>"
Chars: <N>
Self-check: [1] PASS [2] PASS ... [9] PASS
Reasoning: <why>

(repeat for 2 and 3)

RECOMMENDED: CANDIDATE <N>`;
}
