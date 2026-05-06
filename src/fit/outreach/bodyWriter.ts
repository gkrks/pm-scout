/**
 * Body writer: generates the outreach body using Claude Sonnet 4.
 * One core function, parameterized by mode.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { OutreachMode, HookData } from "./types";

// Carry over banned phrases from the existing cover letter generator
const BANNED_PHRASES = [
  "I am writing to express",
  "thrilled/excited to apply",
  "passionate",
  "results-driven",
  "team player",
  "synergy",
  "leverage",
  "perfect fit",
  "dynamic team",
  "I believe I would be a great fit",
  "in today's fast-paced world",
  "achieved X% growth",
  "drove significant improvements",
  "I came across your profile",
  "I noticed your background",
  "Hope this finds you well",
];

const SYSTEM_PROMPT = `You are writing a cover letter body for a technical builder applying to a PM role. A recruiter with 150 applications will read the resume first. If it lands, the cover letter confirms it. Your job: be the one that makes them think "this person actually thought about this."

STRUCTURE (exactly two short paragraphs):

Paragraph 1: The hook. Why this company, why this role, why now. Open with the hook sentence provided. Add one line of context that makes it land harder. This paragraph answers: what does the company care about and why am I relevant to that?

Paragraph 2: The proof. One specific thing you did that proves you can deliver what paragraph 1 promises. Not a resume summary. One concrete detail from one project. End with what you are looking for.

VOICE: Written like a person. Read it out loud. If it sounds like a template, rewrite it. Short sentences. No filler.

BANNED (never use these or anything that sounds like them):
${BANNED_PHRASES.map(p => `- "${p}"`).join("\n")}
- "resonates deeply"
- "I'd welcome the chance"
- "translates directly to"
- "aligns perfectly with"
- "this approach served me well"
- "I've found that"
- "which accelerates"
- "contributes to [company]'s"
- "mirrors how"
- "the same [noun] that"
- Any sentence starting with "My experience" or "This approach" or "Your role's emphasis"

HARD RULES:
1. 80-120 words total across both paragraphs. Count them.
2. Exactly two paragraphs separated by a blank line.
3. No em dashes. No unicode characters. Plain ASCII only. Use commas or periods instead.
4. One project referenced. Not three. Not a tour.
5. No resume summary. The resume is already read. This says what the resume cannot.
6. Same body works for cover letter and LinkedIn DM. Framing differs, body does not.

OUTPUT: Two paragraphs of plain text. No salutation, no sign-off, no metadata.`;

export interface WriteBodyParams {
  hook: HookData;
  jdSummary: string;
  mode: OutreachMode;
  companyName: string;
  roleTitle: string;
}

export interface WriteBodyResult {
  body: string;
  wordCount: number;
  inputTokens: number;
  outputTokens: number;
}

export async function writeBody(params: WriteBodyParams): Promise<WriteBodyResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const client = new Anthropic({ apiKey });

  const userMessage = `MODE: ${params.mode}
COMPANY: ${params.companyName}
ROLE: ${params.roleTitle}

HOOK (this is the spine — build the body around it):
"${params.hook.bridge_text}"

JD SUMMARY:
${params.jdSummary}

Write the body now.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    temperature: 0.5,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const body = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const wordCount = body.split(/\s+/).filter(Boolean).length;

  console.log(`[outreach] Body writer: ${wordCount} words, ${inputTokens} in / ${outputTokens} out`);

  return { body, wordCount, inputTokens, outputTokens };
}
