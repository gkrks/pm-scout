/**
 * Personalization line: generates a 1-2 sentence opener for LinkedIn modes
 * using person intel + job reference.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { PersonIntel } from "./types";

const SYSTEM_PROMPT = `Write a 1-2 sentence opening line for a LinkedIn DM. You have context about the person and the job being referenced.

RULES:
- NEVER start with "I came across your profile", "I noticed your background", "Hope this finds you well", or any variant.
- Reference something SPECIFIC about the person (their work, a post, a project, their role).
- Mention the role naturally — don't make it sound like a cold pitch.
- Conversational. Not sycophantic.
- Maximum 2 sentences, under 40 words total.

OUTPUT: Just the opening line. Nothing else.`;

export interface PersonalizationParams {
  personIntel: PersonIntel;
  roleTitle: string;
  companyName: string;
  jobId: string;
}

export interface PersonalizationResult {
  line: string;
  inputTokens: number;
  outputTokens: number;
}

export async function composePersonalizationLine(
  params: PersonalizationParams,
): Promise<PersonalizationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const client = new Anthropic({ apiKey });

  const userMessage = `PERSON INTEL:
${params.personIntel?.text || "No specific person intel provided."}
${params.personIntel?.name ? `Name: ${params.personIntel.name}` : ""}
${params.personIntel?.title ? `Title: ${params.personIntel.title}` : ""}

JOB REFERENCE:
Role: ${params.roleTitle} at ${params.companyName}

Write the opening line.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 128,
    temperature: 0.6,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const line = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  console.log(`[outreach] Personalization: ${inputTokens} in / ${outputTokens} out`);

  return { line, inputTokens, outputTokens };
}
