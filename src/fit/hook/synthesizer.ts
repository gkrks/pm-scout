/**
 * Hook synthesizer: calls Claude Opus to find the strongest specific
 * bridge between candidate insights and company intel.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Insight, IntelChunk } from "./retriever";

const HookCandidateZ = z.object({
  bridge_text: z.string().min(10),
  insight_id: z.string(),
  intel_id: z.string(),
  specificity_score: z.number().min(1).max(10),
  score_rationale: z.string(),
});

const SynthesisResultZ = z.object({
  hooks: z.array(HookCandidateZ),
});

export type HookCandidate = z.infer<typeof HookCandidateZ>;

export interface SynthesisResult {
  hooks: HookCandidate[];
  inputTokens: number;
  outputTokens: number;
}

const SYSTEM_PROMPT = `You are finding the single most compelling reason this specific candidate should work at this specific company, for this specific role.

A good hook answers three questions in one thought:
1. What does this company care about RIGHT NOW? (from their recent activity/intel)
2. What does this role actually need? (from the JD)
3. What has this candidate already done that proves they can deliver on #1 and #2?

The hook must feel like a human insight, not a pattern match. "I reduced X metric which mirrors your Y platform" is robotic. Instead think: what problem is the company solving, what did the candidate learn solving a similar problem, and why does that make them the right person for this role?

BAD hooks (robotic, pattern-matching):
- "My experience reducing X from Y to Z mirrors how Company built their platform"
- "I learned that owning pipelines is important, which aligns with how Company does X"
- Any hook that starts with "My experience" or "I learned that"

GOOD hooks (human, specific, triangulated):
- A hook that names the company's actual challenge, explains why the candidate already thinks about that problem, and connects it to what the role needs
- A hook that references something the company did recently and explains WHY the candidate would have made the same decision (or a different one)

You receive:
- INSIGHTS: Non-obvious lessons/decisions from the candidate's projects
- INTEL: Recent company activity, funding, blog posts, launches
- JD_SUMMARY: What the role requires

Find THREE hook candidates. Each must triangulate: company ethos/activity + job requirement + candidate's proven value.

For each hook, provide:
- bridge_text: 1-2 sentences. Written like a person, not a template. No em dashes. No unicode. Plain ASCII only.
- insight_id: Which insight was used
- intel_id: Which intel chunk was used
- specificity_score: 1-10 using this rubric:
  10 = triangulates all three (company + role + candidate) with specific details
  7-9 = strong on two of three, decent on the third
  4-6 = only connects two, or uses generic language
  1-3 = could apply to any company or any candidate
- score_rationale: One sentence explaining the score

Output as JSON only, no markdown fences, no preamble:
{
  "hooks": [
    {
      "bridge_text": "...",
      "insight_id": "...",
      "intel_id": "...",
      "specificity_score": N,
      "score_rationale": "..."
    }
  ]
}`;

export async function synthesizeHooks(params: {
  insights: Insight[];
  intel: IntelChunk[];
  jdSummary: string;
}): Promise<SynthesisResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const client = new Anthropic({ apiKey });

  // Format insights for the prompt
  const insightsText = params.insights
    .slice(0, 15)
    .map((i) => `[${i.id}] (${i.insight_type}, project: ${i.project_id}) ${i.text}`)
    .join("\n");

  // Format intel for the prompt
  const intelText = params.intel
    .slice(0, 15)
    .map((c) => `[${c.id}] (${c.intel_type}, ${c.published_at?.split("T")[0] || "undated"}) ${c.chunk_text.slice(0, 500)}`)
    .join("\n\n");

  const userMessage = `JD_SUMMARY:
${params.jdSummary}

INSIGHTS:
${insightsText}

INTEL:
${intelText}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    temperature: 0.4,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  console.log(`[hook] Sonnet usage: ${inputTokens} in / ${outputTokens} out`);

  // Parse JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON object found in Opus response");

  const parsed = JSON.parse(jsonMatch[0]);
  const validated = SynthesisResultZ.parse(parsed);

  return {
    hooks: validated.hooks,
    inputTokens,
    outputTokens,
  };
}
