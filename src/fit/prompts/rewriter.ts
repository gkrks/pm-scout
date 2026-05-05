/**
 * Prompt constants for the bullet rewriter (Phase 5).
 *
 * These prompts are safety-critical. Changes must be reviewed against
 * the truthfulness gate to ensure the gate can still verify compliance.
 */

export const REWRITER_SYSTEM_PROMPT = `You rewrite resume bullets to optimize for ATS keyword matching while preserving every factual claim.

ABSOLUTE RULES:
1. Every claim in <claims> MUST appear in your rewrite. Do not drop any.
2. You MUST NOT add any new factual claim. No new technologies, metrics, outcomes, scope, durations, or domains.
3. You may rephrase, reorder, and substitute synonyms for non-factual content (action verbs, connectors).
4. Maximum 225 characters in the rewritten text. Hard limit.
5. Format: XYZ if the bullet has a quantified outcome, otherwise CAR.
   - XYZ: "[Outcome verb-phrase] by [Y metric] through [Z action with technology/method]"
   - CAR: "[Context]; [Action verb] [object]; [Result]"
6. Spell out acronyms in <acronyms_to_spell_out>. Keep acronyms in <acronyms_to_keep> as-is.
7. Use a verb from <preferred_verbs>. Avoid every phrase in <banned_phrases>.
8. Embed the keywords in <keywords_to_embed> verbatim where they fit naturally. If you cannot embed a keyword without fabrication, OMIT IT and report omitted_keywords in your output.

OUTPUT FORMAT:
Return ONLY a JSON object matching the provided schema. No prose, no markdown.`;

export const REWRITER_USER_TEMPLATE = `<original_bullet>
{original_bullet}
</original_bullet>

<claims>
{claims_json}
</claims>

<target_qualification>
{target_qualification}
</target_qualification>

<keywords_to_embed>
{keywords_to_embed}
</keywords_to_embed>

<acronyms_to_spell_out>
{acronyms_to_spell_out}
</acronyms_to_spell_out>

<acronyms_to_keep>
{acronyms_to_keep}
</acronyms_to_keep>

<preferred_verbs>
{preferred_verbs}
</preferred_verbs>

<banned_phrases>
{banned_phrases}
</banned_phrases>

Rewrite the bullet.`;

export const REWRITER_RETRY_ADDENDUM = `

Your previous rewrite FAILED the truthfulness gate. Here are the failures:
{failures}

Fix these issues in your next attempt. Remember: you MUST preserve every claim from <claims> and you MUST NOT add new facts.`;

export const CLAIM_EXTRACTOR_SYSTEM_PROMPT = `You extract atomic factual claims from resume bullets.

For each bullet, identify every distinct factual claim. A claim is any statement that:
- Names a specific technology, tool, or methodology
- States a quantified metric or outcome (number, percentage, duration)
- Describes a specific action taken
- Defines scope (team size, number of users, number of systems)
- Names a domain or industry context
- States a duration or timeframe

Return a JSON object matching the provided schema. Each claim must have:
- id: sequential "c1", "c2", etc.
- type: one of "action", "metric_scale", "metric_outcome", "purpose", "tool", "scope", "duration", "domain"
- value: the exact phrase from the bullet (normalized whitespace only)
- evidence_span: [start_char_index, end_char_index] in the original bullet

Also extract:
- tools_implied: technologies named or strongly implied
- scope_signal: one of "individual_contributor_owned", "team_lead", "cross_functional_lead", "executive"

Be exhaustive. Missing a claim means the truthfulness gate may allow fabrication.`;

export const CLAIM_EXTRACTOR_USER_TEMPLATE = `Extract all atomic factual claims from this resume bullet:

"{bullet_text}"

Return JSON matching the schema.`;

/**
 * JSON schema for the rewriter's structured output.
 */
export const REWRITER_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    rewritten: { type: "string", description: "The rewritten bullet text" },
    char_count: { type: "number", description: "Character count of rewritten text" },
    claims_preserved: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim_id: { type: "string" },
          evidence_span: { type: "string", description: "Substring from rewritten text proving this claim" },
        },
        required: ["claim_id", "evidence_span"],
      },
    },
    claims_added: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          value: { type: "string" },
        },
        required: ["type", "value"],
      },
      description: "MUST be empty array. Gate fails if non-empty.",
    },
    keywords_embedded: { type: "array", items: { type: "string" } },
    omitted_keywords: { type: "array", items: { type: "string" } },
    format_used: { type: "string", enum: ["xyz", "car"] },
    acronyms_expanded: { type: "array", items: { type: "string" } },
    acronyms_kept: { type: "array", items: { type: "string" } },
    banned_phrase_check: { type: "boolean", description: "true if no banned phrases present" },
  },
  required: [
    "rewritten", "char_count", "claims_preserved", "claims_added",
    "keywords_embedded", "omitted_keywords", "format_used",
    "acronyms_expanded", "acronyms_kept", "banned_phrase_check",
  ],
};

/**
 * JSON schema for the claim extractor's structured output.
 */
export const CLAIM_EXTRACTOR_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    bullet_id: { type: "string" },
    original_text: { type: "string" },
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["action", "metric_scale", "metric_outcome", "purpose", "tool", "scope", "duration", "domain"] },
          value: { type: "string" },
          evidence_span: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
        },
        required: ["id", "type", "value", "evidence_span"],
      },
    },
    tools_implied: { type: "array", items: { type: "string" } },
    scope_signal: {
      type: "string",
      enum: ["individual_contributor_owned", "team_lead", "cross_functional_lead", "executive"],
    },
  },
  required: ["bullet_id", "original_text", "claims", "tools_implied", "scope_signal"],
};
