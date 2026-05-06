/**
 * Insight extractor: calls Claude Sonnet 4.6 to extract structured
 * insights from fetched project content.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const InsightZ = z.object({
  type: z.enum(["hard_decision", "lesson", "surprise", "philosophical_take", "would_do_differently"]),
  text: z.string().min(12),
});

const ExtractionResultZ = z.object({
  insights: z.array(InsightZ),
});

export type ExtractedInsight = z.infer<typeof InsightZ>;

export interface ExtractionResult {
  insights: ExtractedInsight[];
  inputTokens: number;
  outputTokens: number;
}

const SYSTEM_PROMPT = `You are analyzing a project source (README, blog post, or portfolio page) to extract non-obvious insights about the builder's thinking, decisions, and lessons learned.

Extract insights in these five categories:
1. hard_decision — A choice where two reasonable options existed and the builder picked one for a specific reason.
2. lesson — Something learned through building that wasn't obvious beforehand.
3. surprise — An unexpected result, behavior, or discovery.
4. philosophical_take — An opinionated stance on how to build software, grounded in this project.
5. would_do_differently — A retrospective insight about what the builder would change.

Rules:
- Each insight MUST be 12+ words and self-contained (readable without the source).
- Each insight MUST reference a SPECIFIC technical detail, decision, or outcome from the project. No generic statements like "learned the importance of testing."
- Extract 2-5 insights per category. If a category has no genuine insights in the source, return an empty array for it — do NOT fabricate.
- Prefer insights that reveal the builder's JUDGMENT, not just what they built.
- An insight that a recruiter at the target company could connect to their own product challenges is more valuable than a purely internal lesson.

Output as JSON only — no markdown fences, no preamble:
{
  "insights": [
    { "type": "hard_decision", "text": "..." },
    ...
  ]
}`;

export async function extractInsights(
  projectId: string,
  oneLine: string,
  sourceUrl: string,
  content: string,
): Promise<ExtractionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const client = new Anthropic({ apiKey });

  const userMessage = `Project: ${oneLine}
Project ID: ${projectId}
Source URL: ${sourceUrl}

--- SOURCE CONTENT ---
${content.slice(0, 12_000)}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    temperature: 0.3,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  console.log(`[insights] Claude usage: ${inputTokens} in / ${outputTokens} out`);

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON object found in Claude response");

  const parsed = JSON.parse(jsonMatch[0]);
  const validated = ExtractionResultZ.parse(parsed);

  // Filter out short/generic insights
  const filtered = validated.insights.filter((i) => {
    const words = i.text.split(/\s+/).length;
    if (words < 12) return false;
    // Reject generic patterns
    const generic = /^(learned the importance of|realized that testing|understood that)/i;
    if (generic.test(i.text)) return false;
    return true;
  });

  return { insights: filtered, inputTokens, outputTokens };
}
