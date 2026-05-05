/**
 * Bullet Rewriter — Phase 5
 *
 * Rewrites selected resume bullets to embed JD keywords while preserving
 * every original factual claim. Uses Claude Opus as primary model (safety-critical),
 * GPT-4.1 as fallback.
 *
 * Feature flag: BULLET_REWRITER_ENABLED (env var, default false)
 * UI toggle: "Optimize bullets for this JD" (per-request)
 * Cost control: Limited to top 3 selected bullets per request (per user decision #16)
 *
 * CRITICAL: If the truthfulness gate fails after 2 retries, the ORIGINAL bullet
 * is returned unchanged. Never return a rewrite that failed the gate.
 */

import type { BulletClaims } from "./claimExtractor";
import { extractClaims } from "./claimExtractor";
import {
  REWRITER_OUTPUT_SCHEMA,
  REWRITER_RETRY_ADDENDUM,
  REWRITER_SYSTEM_PROMPT,
  REWRITER_USER_TEMPLATE,
} from "./prompts/rewriter";
import type { GateResult, RewriteResult } from "./truthfulnessGate";
import { truthfulnessGate } from "./truthfulnessGate";

// --------------------------------------------------------------------------- //
//  Config
// --------------------------------------------------------------------------- //

const BULLET_REWRITER_ENABLED = process.env.BULLET_REWRITER_ENABLED === "true";
const MAX_BULLETS_TO_REWRITE = 3; // cost control per user decision #16
const REWRITER_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 2;

// --------------------------------------------------------------------------- //
//  Types
// --------------------------------------------------------------------------- //

export interface RewriteRequest {
  bulletId: string;
  bulletText: string;
  bulletClaims?: BulletClaims;     // pre-extracted; if missing, will be extracted
  targetQualification: string;
  keywordsToEmbed: string[];       // 1-3 keywords from JDKeywords.must_have
  bannedPhrases: string[];
  preferredVerbs: string[];
  acronymsToSpellOut: Record<string, string>;
  acronymsToKeep: string[];
}

export interface RewriteOutput {
  bulletId: string;
  text: string;             // rewritten text, or original if gate failed
  wasRewritten: boolean;
  keywordsEmbedded: string[];
  gateFailures?: string[];  // populated if gate failed (for logging)
}

export interface BatchRewriteInput {
  bullets: Array<{
    bulletId: string;
    bulletText: string;
    targetQualification: string;
  }>;
  keywordsToEmbed: string[];
  bannedPhrases: string[];
  preferredVerbs: string[];
  acronymsToSpellOut: Record<string, string>;
  acronymsToKeep: string[];
}

// --------------------------------------------------------------------------- //
//  Main entry point
// --------------------------------------------------------------------------- //

/**
 * Rewrite multiple bullets for keyword optimization.
 * Limited to top MAX_BULLETS_TO_REWRITE (3) for cost control.
 * Returns original text unchanged for any bullet whose gate fails.
 */
export async function rewriteBullets(input: BatchRewriteInput): Promise<RewriteOutput[]> {
  if (!BULLET_REWRITER_ENABLED) {
    return input.bullets.map((b) => ({
      bulletId: b.bulletId,
      text: b.bulletText,
      wasRewritten: false,
      keywordsEmbedded: [],
    }));
  }

  // Limit to top N bullets
  const toRewrite = input.bullets.slice(0, MAX_BULLETS_TO_REWRITE);
  const results: RewriteOutput[] = [];

  for (const bullet of toRewrite) {
    const result = await rewriteBulletSafe({
      bulletId: bullet.bulletId,
      bulletText: bullet.bulletText,
      targetQualification: bullet.targetQualification,
      keywordsToEmbed: input.keywordsToEmbed,
      bannedPhrases: input.bannedPhrases,
      preferredVerbs: input.preferredVerbs,
      acronymsToSpellOut: input.acronymsToSpellOut,
      acronymsToKeep: input.acronymsToKeep,
    });
    results.push(result);
  }

  // Append unchanged bullets beyond the limit
  for (let i = MAX_BULLETS_TO_REWRITE; i < input.bullets.length; i++) {
    results.push({
      bulletId: input.bullets[i].bulletId,
      text: input.bullets[i].bulletText,
      wasRewritten: false,
      keywordsEmbedded: [],
    });
  }

  return results;
}

// --------------------------------------------------------------------------- //
//  Single bullet rewrite with retry and gate
// --------------------------------------------------------------------------- //

async function rewriteBulletSafe(req: RewriteRequest): Promise<RewriteOutput> {
  // Extract claims if not provided
  const claims = req.bulletClaims || await extractClaims(req.bulletId, req.bulletText);

  let lastGateResult: GateResult | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const previousFailures = attempt > 0 && lastGateResult ? lastGateResult.failures : undefined;

    const rewriteResult = await callRewriterLLM(req, claims, previousFailures);
    if (!rewriteResult) {
      // LLM call failed entirely
      continue;
    }

    // Run truthfulness gate
    const gateResult = truthfulnessGate(
      claims,
      rewriteResult,
      req.bannedPhrases,
      req.acronymsToSpellOut,
      req.acronymsToKeep,
      req.keywordsToEmbed,
      req.preferredVerbs
    );

    if (gateResult.passed) {
      return {
        bulletId: req.bulletId,
        text: rewriteResult.rewritten,
        wasRewritten: true,
        keywordsEmbedded: rewriteResult.keywords_embedded,
      };
    }

    lastGateResult = gateResult;
    console.warn(
      `[rewriter] Gate failed for ${req.bulletId} attempt ${attempt + 1}:`,
      gateResult.failures.slice(0, 3)
    );
  }

  // Both attempts failed: return ORIGINAL bullet unchanged
  console.warn(
    `[rewriter] rewriter_gate_failed bullet_id=${req.bulletId}`,
    lastGateResult?.failures?.slice(0, 5)
  );

  return {
    bulletId: req.bulletId,
    text: req.bulletText,
    wasRewritten: false,
    keywordsEmbedded: [],
    gateFailures: lastGateResult?.failures,
  };
}

// --------------------------------------------------------------------------- //
//  LLM call (Claude Opus primary, GPT-4.1 fallback)
// --------------------------------------------------------------------------- //

async function callRewriterLLM(
  req: RewriteRequest,
  claims: BulletClaims,
  previousFailures?: string[]
): Promise<RewriteResult | null> {
  // Build user message from template
  let userMessage = REWRITER_USER_TEMPLATE
    .replace("{original_bullet}", req.bulletText)
    .replace("{claims_json}", JSON.stringify(claims.claims, null, 2))
    .replace("{target_qualification}", req.targetQualification)
    .replace("{keywords_to_embed}", req.keywordsToEmbed.join(", "))
    .replace(
      "{acronyms_to_spell_out}",
      Object.entries(req.acronymsToSpellOut)
        .map(([k, v]) => `${k} -> ${v}`)
        .join("\n")
    )
    .replace("{acronyms_to_keep}", req.acronymsToKeep.join(", "))
    .replace("{preferred_verbs}", req.preferredVerbs.join(", "))
    .replace("{banned_phrases}", req.bannedPhrases.join("\n"));

  // Add retry context if this is a second attempt
  if (previousFailures && previousFailures.length > 0) {
    userMessage += REWRITER_RETRY_ADDENDUM.replace(
      "{failures}",
      previousFailures.join("\n")
    );
  }

  // Try Claude Opus first (safety-critical)
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const result = await _callClaude(anthropicKey, userMessage);
    if (result) return result;
  }

  // Fallback to GPT-4.1
  const openaiKey = process.env.OPENAI_KEY;
  if (openaiKey) {
    return await _callOpenAI(openaiKey, userMessage);
  }

  return null;
}

async function _callClaude(apiKey: string, userMessage: string): Promise<RewriteResult | null> {
  try {
    const fetch = (await import("node-fetch")).default;
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-6",
        max_tokens: 1024,
        temperature: 0,
        messages: [
          { role: "user", content: REWRITER_SYSTEM_PROMPT + "\n\n" + userMessage },
        ],
      }),
      timeout: REWRITER_TIMEOUT_MS,
    });

    if (!resp.ok) return null;

    const data = (await resp.json()) as any;
    const content = data.content?.[0]?.text || "";
    return _parseRewriteResponse(content);
  } catch {
    return null;
  }
}

async function _callOpenAI(apiKey: string, userMessage: string): Promise<RewriteResult | null> {
  try {
    const fetch = (await import("node-fetch")).default;
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        temperature: 0,
        max_tokens: 1024,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: REWRITER_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
      }),
      timeout: REWRITER_TIMEOUT_MS,
    });

    if (!resp.ok) return null;

    const data = (await resp.json()) as any;
    const content = data.choices?.[0]?.message?.content || "{}";
    return _parseRewriteResponse(content);
  } catch {
    return null;
  }
}

function _parseRewriteResponse(raw: string): RewriteResult | null {
  try {
    // Strip markdown fences if present
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      rewritten: parsed.rewritten || "",
      char_count: parsed.char_count || (parsed.rewritten || "").length,
      claims_preserved: parsed.claims_preserved || [],
      claims_added: parsed.claims_added || [],
      keywords_embedded: parsed.keywords_embedded || [],
      omitted_keywords: parsed.omitted_keywords || [],
      format_used: parsed.format_used || "car",
      acronyms_expanded: parsed.acronyms_expanded || [],
      acronyms_kept: parsed.acronyms_kept || [],
      banned_phrase_check: parsed.banned_phrase_check !== false,
    };
  } catch {
    return null;
  }
}
