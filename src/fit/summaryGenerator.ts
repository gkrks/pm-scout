/**
 * Summary generator: produces 3 ranked summary candidates
 * using OpenAI gpt-4o.
 *
 * Rule 4 constraints:
 * - Max 2 sentences, 35 words
 * - Must name a specific recent project or domain
 * - Must NOT contain any JD phrases
 * - Must NOT contain banned vocabulary
 * - Must NOT lead with "years of experience" unless followed by specific competency
 */

import fs from "fs";
import path from "path";
import OpenAI from "openai";

const PROMPT_PATH = path.resolve(__dirname, "../../.claude/commands/resume_summary.md");
const SUMMARY_MAX_WORDS = 25;

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
  recommended: number;
  jdAnalysis: string;
}

export async function generateSummaryCandidates(
  jdText: string,
  bulletTexts: string[],
): Promise<SummaryResult> {
  const openaiKey = process.env.OPENAI_KEY;
  if (!openaiKey) return fallbackResult();

  // Load custom prompt if available, otherwise use inline
  let systemPrompt: string;
  try {
    const raw = fs.readFileSync(PROMPT_PATH, "utf-8");
    systemPrompt = raw.replace(/## INPUTS[\s\S]*$/, "").trim();
  } catch {
    systemPrompt = getInlinePrompt();
  }

  // Override with Rule 4 constraints
  systemPrompt += RULE_4_OVERRIDE;

  // Extract JD years requirement
  const yearsMatch = jdText.match(/(?:less than|under|<)\s*(\d+)\s*years?/i)
    || jdText.match(/(\d+)\+?\s*years?\s*(?:of\s+)?(?:professional|total|relevant)?\s*experience/i);
  if (yearsMatch) {
    systemPrompt += `\nThe JD specifies "${yearsMatch[1]}" years. Use "${yearsMatch[1]}+ years" if mentioning years.`;
  }

  const bulletsStr = bulletTexts.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const userMessage = `JD:\n\`\`\`\n${jdText}\n\`\`\`\n\nBULLETS:\n\`\`\`\n${bulletsStr}\n\`\`\``;

  const client = new OpenAI({ apiKey: openaiKey, timeout: 30_000 });

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.3,
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

const RULE_4_OVERRIDE = `

## CRITICAL: SUMMARY RULES (override all previous summary instructions)

The summary is ONE LINE that connects the dots between the candidate's past experience and this target role. It is a bridge, not a list of attributes.

HARD CONSTRAINTS:
1. ONE sentence only. Maximum 25 words.
2. The sentence must have two halves: what you've actually done → why that maps to this role.
3. Name a SPECIFIC thing (company, system, domain, technology) from real experience — not a generic claim.
4. ZERO phrases from the JD. The bridge must be in the candidate's own words.
5. BANNED — never insert: leveraging, spearheaded, orchestrated, championed, facilitated, streamlined, enhanced, transformed, cross-functional, fast-paced, dynamic, results-driven, data-driven, scalable, robust, innovative, strategic, "translating X into Y", "driving initiatives", "enabling stakeholders", "passionate about", "proven track record", "foster collaboration", "adept at"
6. No first-person pronouns (I, me, my, myself).
7. No em dashes. No creative compound titles (Builder-PM, Engineer-PM). Use the real role title.
8. ASCII punctuation only.

Template that WORKS:
"Product manager who built sensor validation systems at Matic Robots, now applying that hardware-software rigor to sizing infrastructure."
"Product manager with 4 years shipping serverless analytics and ML pipelines, looking to own performance tooling end to end."

Template that FAILS:
"Builder-PM with 4+ years in enterprise software, adept at leveraging AI for product enhancement and analyzing market trends."
"Results-driven product leader passionate about translating complex architecture into actionable roadmaps."

The test: does this sentence make a recruiter think "oh, that background is relevant to this role"? If it reads like a generic PM description, it fails.`;

function parseResponse(raw: string): SummaryResult {
  const candidates: SummaryCandidate[] = [];

  const jdMatch = raw.match(/JD ANALYSIS\s*\n([\s\S]*?)(?=\nCANDIDATE 1)/i);
  const jdAnalysis = jdMatch ? jdMatch[1].trim() : "";

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

  const recMatch = raw.match(/RECOMMENDED:\s*CANDIDATE\s*(\d)/i);
  const recommended = recMatch ? parseInt(recMatch[1], 10) : 1;

  if (candidates.length === 0) {
    const quotes = raw.match(/"([^"]{30,250})"/g);
    if (quotes) {
      quotes.slice(0, 3).forEach((q, i) => {
        const text = q.replace(/^"|"$/g, "").trim();
        candidates.push({
          index: i + 1,
          angle: i === 0 ? "specific" : i === 1 ? "technical" : "domain",
          text,
          chars: text.length,
          selfCheck: "Parsed from loose match",
          reasoning: "",
        });
      });
    }
  }

  if (candidates.length === 0) return fallbackResult();
  return { candidates, recommended, jdAnalysis };
}

function fallbackResult(): SummaryResult {
  const text = "Product manager who built sensor validation at Matic Robots, now applying that hardware-software rigor to platform sizing.";
  return {
    candidates: [{
      index: 1,
      angle: "fallback",
      text,
      chars: text.length,
      selfCheck: "Fallback",
      reasoning: "Static fallback.",
    }],
    recommended: 1,
    jdAnalysis: "",
  };
}

function getInlinePrompt(): string {
  return `You generate professional summaries for Krithik Gopinath's resume, tailored to a specific job description.

Produce 3 ranked candidates. Each MUST follow the CRITICAL SUMMARY RULES below.

Output format:
CANDIDATE 1 - <angle>
Text: "<summary>"
Chars: <N>
Self-check: [1] PASS/FAIL ... [10] PASS/FAIL
Reasoning: <why this works>

(repeat for 2 and 3)

RECOMMENDED: CANDIDATE <N>`;
}
