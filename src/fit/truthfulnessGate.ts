/**
 * Truthfulness Gate — Phase 5
 *
 * DETERMINISTIC verification that a rewritten bullet preserves all original
 * claims and adds no new factual content. This gate is NOT LLM-judged.
 *
 * The LLM cannot self-certify truthfulness. Every check is verifiable by
 * string matching or tokenized comparison.
 *
 * If the gate fails after retries, the ORIGINAL bullet is returned unchanged.
 */

import type { AtomicClaim, BulletClaims } from "./claimExtractor";

// --------------------------------------------------------------------------- //
//  Types
// --------------------------------------------------------------------------- //

export interface RewriteResult {
  rewritten: string;
  char_count: number;
  claims_preserved: Array<{ claim_id: string; evidence_span: string }>;
  claims_added: Array<{ type: string; value: string }>;
  keywords_embedded: string[];
  omitted_keywords: string[];
  format_used: "xyz" | "car";
  acronyms_expanded: string[];
  acronyms_kept: string[];
  banned_phrase_check: boolean;
}

export interface GateResult {
  passed: boolean;
  failures: string[];
}

// --------------------------------------------------------------------------- //
//  Safe content tokens (articles, prepositions, common verbs, connectors)
//  These are allowed to appear as "new" tokens without triggering fact-add.
// --------------------------------------------------------------------------- //

const SAFE_TOKENS = new Set([
  "a", "an", "the", "of", "for", "to", "in", "on", "at", "by", "with",
  "and", "or", "but", "from", "through", "via", "into", "across", "over",
  "under", "between", "among", "within", "during", "after", "before",
  "that", "which", "this", "these", "those", "its", "their", "our",
  "is", "was", "were", "are", "be", "been", "being", "has", "had", "have",
  "do", "does", "did", "will", "would", "could", "should", "may", "might",
  "can", "shall", "must",
  "not", "no", "nor", "neither",
  "also", "then", "thus", "hence", "therefore", "consequently",
  "while", "when", "where", "how", "what", "who", "whom",
  "more", "most", "less", "least", "very", "much", "many", "few",
  "all", "each", "every", "both", "several", "some", "any",
  "new", "key", "core", "main", "primary", "critical", "strategic",
  "resulting", "leading", "enabling", "driving", "achieving", "delivering",
  "improving", "optimizing", "enhancing", "establishing", "implementing",
]);

// --------------------------------------------------------------------------- //
//  Gate implementation
// --------------------------------------------------------------------------- //

export function truthfulnessGate(
  original: BulletClaims,
  rewrite: RewriteResult,
  bannedPhrases: string[],
  acronymsToSpellOut: Record<string, string>,
  acronymsToKeep: string[],
  keywordsToEmbed: string[],
  preferredVerbs: string[]
): GateResult {
  const failures: string[] = [];

  // 1. Every claim in original.claims must have a corresponding entry in rewrite.claims_preserved
  for (const claim of original.claims) {
    const preserved = rewrite.claims_preserved.find((p) => p.claim_id === claim.id);
    if (!preserved) {
      failures.push(`CLAIM_DROPPED: claim "${claim.id}" (${claim.type}: "${claim.value}") not in claims_preserved`);
      continue;
    }

    // 2. Each evidence_span must be a substring of rewrite.rewritten (case-insensitive for flexibility)
    if (preserved.evidence_span) {
      const spanLower = preserved.evidence_span.toLowerCase();
      const rewrittenLower = rewrite.rewritten.toLowerCase();
      if (!rewrittenLower.includes(spanLower)) {
        failures.push(
          `CLAIM_NOT_FOUND: claim "${claim.id}" evidence_span "${preserved.evidence_span}" ` +
          `not found in rewritten text`
        );
      }
    }
  }

  // 3. claims_added must be empty
  if (rewrite.claims_added && rewrite.claims_added.length > 0) {
    for (const added of rewrite.claims_added) {
      failures.push(`CLAIM_ADDED: new ${added.type} claim "${added.value}" — fabrication detected`);
    }
  }

  // 4. char_count must match rewritten.length and be <= 225
  if (rewrite.rewritten.length > 225) {
    failures.push(`CHAR_LIMIT: rewritten is ${rewrite.rewritten.length} chars, exceeds 225 limit`);
  }
  if (rewrite.char_count !== rewrite.rewritten.length) {
    failures.push(`CHAR_MISMATCH: reported ${rewrite.char_count} but actual is ${rewrite.rewritten.length}`);
  }

  // 5. No banned phrase appears in rewritten text
  const rewrittenLower = rewrite.rewritten.toLowerCase();
  for (const phrase of bannedPhrases) {
    if (rewrittenLower.includes(phrase.toLowerCase())) {
      failures.push(`BANNED_PHRASE: "${phrase}" found in rewritten text`);
    }
  }

  // 6. Acronyms in always_spell_out must not appear as standalone tokens
  const keepSet = new Set(acronymsToKeep.map((a) => a.toLowerCase()));
  for (const acronym of Object.keys(acronymsToSpellOut)) {
    if (keepSet.has(acronym.toLowerCase())) continue; // skip conflicts
    const escaped = acronym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}\\b`, "i");
    if (pattern.test(rewrite.rewritten)) {
      failures.push(`ACRONYM_NOT_EXPANDED: "${acronym}" should be spelled out as "${acronymsToSpellOut[acronym]}"`);
    }
  }

  // 7. Verify embedded keywords appear in rewritten text
  for (const keyword of rewrite.keywords_embedded) {
    const kwLower = keyword.toLowerCase();
    if (!rewrittenLower.includes(kwLower)) {
      // Check if any word-boundary variant exists
      const escaped = kwLower.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
      const pattern = new RegExp(`\\b${escaped}(?:s|ly|ing|ed)?\\b`, "i");
      if (!pattern.test(rewrite.rewritten)) {
        failures.push(`KEYWORD_NOT_FOUND: claimed to embed "${keyword}" but not found in rewritten text`);
      }
    }
  }

  // 8. NEW FACT DETECTION: tokenize rewritten, check for content tokens not in original
  const newFactFailures = _detectNewFacts(
    original,
    rewrite.rewritten,
    keywordsToEmbed,
    preferredVerbs
  );
  failures.push(...newFactFailures);

  return {
    passed: failures.length === 0,
    failures,
  };
}

// --------------------------------------------------------------------------- //
//  New fact detection (fail closed: uncertain = fail)
// --------------------------------------------------------------------------- //

function _detectNewFacts(
  original: BulletClaims,
  rewrittenText: string,
  keywordsToEmbed: string[],
  preferredVerbs: string[]
): string[] {
  const failures: string[] = [];

  // Tokenize both texts
  const originalTokens = _tokenize(original.original_text);
  const rewrittenTokens = _tokenize(rewrittenText);

  // Build allowlist: original tokens + keywords + verbs + safe tokens + tools
  const allowlist = new Set<string>();
  for (const t of originalTokens) allowlist.add(t.toLowerCase());
  for (const kw of keywordsToEmbed) {
    for (const t of _tokenize(kw)) allowlist.add(t.toLowerCase());
  }
  for (const v of preferredVerbs) allowlist.add(v.toLowerCase());
  SAFE_TOKENS.forEach((t) => allowlist.add(t));
  for (const tool of original.tools_implied) {
    for (const t of _tokenize(tool)) allowlist.add(t.toLowerCase());
  }

  // Check each rewritten token against allowlist
  for (const token of rewrittenTokens) {
    const tLower = token.toLowerCase();
    if (allowlist.has(tLower)) continue;
    if (SAFE_TOKENS.has(tLower)) continue;
    if (tLower.length <= 2) continue; // skip short tokens (articles, etc.)
    if (/^\d+$/.test(tLower)) continue; // skip pure numbers

    // Check if it looks like a technology, metric, or proper noun (potential fabrication)
    if (_isContentToken(token)) {
      failures.push(
        `NEW_FACT_SUSPECTED: token "${token}" appears in rewrite but not in original bullet, ` +
        `keywords, or action verbs — possible fabrication`
      );
    }
  }

  return failures;
}

function _tokenize(text: string): string[] {
  return text
    .replace(/[^\w\s/\-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function _isContentToken(token: string): boolean {
  // Heuristic: likely a fabricated fact if it's:
  // - A capitalized word (proper noun / technology)
  // - A word that looks like a technology (contains uppercase mid-word, or is all-caps)
  // - A numeric token with units
  if (/^[A-Z][a-z]+/.test(token)) return true;  // Capitalized word
  if (/[A-Z].*[A-Z]/.test(token)) return true;  // Multiple caps (acronym-like)
  if (/^\d+[%xX+]/.test(token)) return true;    // Metric with unit
  if (/^\d+[kKmMbB]$/.test(token)) return true;  // Scale suffix (10K, 5M)
  return false;
}
