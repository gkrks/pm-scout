/**
 * Claim Extractor — Phase 5
 *
 * Extracts atomic factual claims from resume bullets using GPT-4.1.
 * Results are cached per bullet_id (claims don't change unless bullet text changes).
 *
 * This is run ONCE per bullet at master resume parse time, not per-request.
 */

import {
  CLAIM_EXTRACTOR_OUTPUT_SCHEMA,
  CLAIM_EXTRACTOR_SYSTEM_PROMPT,
  CLAIM_EXTRACTOR_USER_TEMPLATE,
} from "./prompts/rewriter";

// --------------------------------------------------------------------------- //
//  Types
// --------------------------------------------------------------------------- //

export interface AtomicClaim {
  id: string;          // "c1", "c2", ...
  type: "action" | "metric_scale" | "metric_outcome" | "purpose" | "tool" | "scope" | "duration" | "domain";
  value: string;       // exact phrase from bullet, normalized whitespace
  evidence_span: [number, number];  // [start, end] character indices in original bullet
}

export interface BulletClaims {
  bullet_id: string;
  original_text: string;
  claims: AtomicClaim[];
  tools_implied: string[];   // technologies named or strongly implied
  scope_signal: "individual_contributor_owned" | "team_lead" | "cross_functional_lead" | "executive";
}

// --------------------------------------------------------------------------- //
//  In-memory cache (persisted per server lifetime)
// --------------------------------------------------------------------------- //

const _claimCache: Map<string, BulletClaims> = new Map();

export function getCachedClaims(bulletId: string): BulletClaims | null {
  return _claimCache.get(bulletId) || null;
}

// --------------------------------------------------------------------------- //
//  Extraction
// --------------------------------------------------------------------------- //

export async function extractClaims(
  bulletId: string,
  bulletText: string
): Promise<BulletClaims> {
  // Check cache
  const cached = _claimCache.get(bulletId);
  if (cached && cached.original_text === bulletText) {
    return cached;
  }

  const openaiKey = process.env.OPENAI_KEY;
  if (!openaiKey) {
    // Fallback: return minimal claims derived from text analysis
    return _fallbackExtraction(bulletId, bulletText);
  }

  const fetch = (await import("node-fetch")).default;
  const userMessage = CLAIM_EXTRACTOR_USER_TEMPLATE.replace("{bullet_text}", bulletText);

  let result: BulletClaims | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4.1",
          temperature: 0,
          max_tokens: 2048,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: CLAIM_EXTRACTOR_SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
        }),
        timeout: 30000,
      });

      if (!resp.ok) {
        if (attempt === 0) continue;
        break;
      }

      const data = (await resp.json()) as any;
      const content = data.choices?.[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);

      result = {
        bullet_id: bulletId,
        original_text: bulletText,
        claims: (parsed.claims || []).map((c: any) => ({
          id: c.id || `c${Math.random().toString(36).slice(2, 6)}`,
          type: c.type || "action",
          value: c.value || "",
          evidence_span: c.evidence_span || [0, 0],
        })),
        tools_implied: parsed.tools_implied || [],
        scope_signal: parsed.scope_signal || "individual_contributor_owned",
      };
      break;
    } catch {
      if (attempt === 1) break;
    }
  }

  if (!result) {
    result = _fallbackExtraction(bulletId, bulletText);
  }

  _claimCache.set(bulletId, result);
  return result;
}

/**
 * Batch extract claims for multiple bullets (for pre-warming the cache).
 */
export async function extractClaimsBatch(
  bullets: Array<{ bullet_id: string; text: string }>
): Promise<Map<string, BulletClaims>> {
  const results = new Map<string, BulletClaims>();

  // Process sequentially to avoid rate limits (GPT-4.1)
  for (const bullet of bullets) {
    const claims = await extractClaims(bullet.bullet_id, bullet.text);
    results.set(bullet.bullet_id, claims);
  }

  return results;
}

// --------------------------------------------------------------------------- //
//  Fallback: simple heuristic extraction (no LLM)
// --------------------------------------------------------------------------- //

function _fallbackExtraction(bulletId: string, text: string): BulletClaims {
  const claims: AtomicClaim[] = [];
  let claimIdx = 1;

  // Extract metrics (numbers with context)
  const metricPattern = /(\d+[\d,.]*[%xX+]?)\s*([\w\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = metricPattern.exec(text)) !== null) {
    claims.push({
      id: `c${claimIdx++}`,
      type: "metric_outcome",
      value: match[0].trim(),
      evidence_span: [match.index, match.index + match[0].length],
    });
  }

  // Extract tool/technology references (common patterns)
  const techPattern = /\b(SQL|Python|JavaScript|TypeScript|React|Node\.js|AWS|GCP|Kubernetes|Docker|ML|API|REST)\b/gi;
  while ((match = techPattern.exec(text)) !== null) {
    claims.push({
      id: `c${claimIdx++}`,
      type: "tool",
      value: match[0],
      evidence_span: [match.index, match.index + match[0].length],
    });
  }

  // If no claims found, treat the whole bullet as a single action claim
  if (claims.length === 0) {
    claims.push({
      id: "c1",
      type: "action",
      value: text,
      evidence_span: [0, text.length],
    });
  }

  // Detect scope
  let scope: BulletClaims["scope_signal"] = "individual_contributor_owned";
  if (/\b(team of|led|managed)\s+\d+/i.test(text)) {
    scope = "team_lead";
  } else if (/\bcross-functional/i.test(text)) {
    scope = "cross_functional_lead";
  }

  // Extract implied tools
  const tools: string[] = [];
  const toolMatches = text.match(/\b(SQL|Python|JavaScript|TypeScript|React|Node|AWS|GCP|Docker|Kubernetes|ML|Elasticsearch|Looker|Rust)\b/gi);
  if (toolMatches) {
    tools.push(...Array.from(new Set(toolMatches.map((t) => t))));
  }

  return {
    bullet_id: bulletId,
    original_text: text,
    claims,
    tools_implied: tools,
    scope_signal: scope,
  };
}
