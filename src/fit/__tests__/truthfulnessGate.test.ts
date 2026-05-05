/**
 * Tests for truthfulnessGate.ts — deterministic verification.
 *
 * Run: npx ts-node src/fit/__tests__/truthfulnessGate.test.ts
 *
 * Tests that the gate catches:
 *   1. Dropped claims (claim in original not in rewrite)
 *   2. Added claims (claims_added non-empty)
 *   3. Char limit exceeded (>225)
 *   4. Banned phrases present
 *   5. Unexpanded acronyms
 *   6. Keywords claimed but not found
 *   7. New fact detection (suspicious tokens)
 *   8. Gate PASSES for a valid rewrite
 */

import type { BulletClaims } from "../claimExtractor";
import type { RewriteResult } from "../truthfulnessGate";
import { truthfulnessGate } from "../truthfulnessGate";

// --------------------------------------------------------------------------- //
//  Helpers
// --------------------------------------------------------------------------- //

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

const BANNED_PHRASES = ["responsible for", "helped with", "worked on"];
const ACRONYMS_SPELL_OUT: Record<string, string> = {
  PRD: "product requirements document",
  OKR: "objectives and key results",
  KPI: "key performance indicator",
};
const ACRONYMS_KEEP = ["SQL", "API", "AWS", "ML"];
const PREFERRED_VERBS = ["shipped", "launched", "drove", "owned", "built", "led"];
const KEYWORDS = ["roadmap", "sql"];

// Sample original bullet claims
const ORIGINAL_CLAIMS: BulletClaims = {
  bullet_id: "test_b1",
  original_text: "Led cross-functional team of 8 to ship ML-powered search, increasing engagement 34%",
  claims: [
    { id: "c1", type: "action", value: "Led cross-functional team", evidence_span: [0, 26] },
    { id: "c2", type: "scope", value: "team of 8", evidence_span: [22, 31] },
    { id: "c3", type: "tool", value: "ML-powered search", evidence_span: [40, 58] },
    { id: "c4", type: "metric_outcome", value: "increasing engagement 34%", evidence_span: [60, 85] },
  ],
  tools_implied: ["ML"],
  scope_signal: "cross_functional_lead",
};

// --------------------------------------------------------------------------- //
//  Tests
// --------------------------------------------------------------------------- //

function runTests() {
  console.log("\n=== Truthfulness Gate Tests ===\n");

  // Test 1: Valid rewrite passes
  {
    const rewrite: RewriteResult = {
      rewritten: "Led cross-functional team of 8 to ship ML-powered search feature, increasing engagement 34% through roadmap execution",
      char_count: 117,
      claims_preserved: [
        { claim_id: "c1", evidence_span: "Led cross-functional team" },
        { claim_id: "c2", evidence_span: "team of 8" },
        { claim_id: "c3", evidence_span: "ML-powered search" },
        { claim_id: "c4", evidence_span: "increasing engagement 34%" },
      ],
      claims_added: [],
      keywords_embedded: ["roadmap"],
      omitted_keywords: ["sql"],
      format_used: "xyz",
      acronyms_expanded: [],
      acronyms_kept: ["ML"],
      banned_phrase_check: true,
    };
    // Fix char_count
    rewrite.char_count = rewrite.rewritten.length;

    const result = truthfulnessGate(
      ORIGINAL_CLAIMS, rewrite, BANNED_PHRASES, ACRONYMS_SPELL_OUT, ACRONYMS_KEEP, KEYWORDS, PREFERRED_VERBS
    );
    assert(result.passed === true, "Valid rewrite passes gate");
    assert(result.failures.length === 0, `No failures (got ${result.failures.length}: ${result.failures.join("; ")})`);
  }

  // Test 2: Dropped claim fails
  {
    const rewrite: RewriteResult = {
      rewritten: "Led team to ship search feature, increasing engagement 34%",
      char_count: 60,
      claims_preserved: [
        { claim_id: "c1", evidence_span: "Led team" },
        // c2 (scope) MISSING
        // c3 (tool) MISSING
        { claim_id: "c4", evidence_span: "increasing engagement 34%" },
      ],
      claims_added: [],
      keywords_embedded: [],
      omitted_keywords: [],
      format_used: "car",
      acronyms_expanded: [],
      acronyms_kept: [],
      banned_phrase_check: true,
    };
    rewrite.char_count = rewrite.rewritten.length;

    const result = truthfulnessGate(
      ORIGINAL_CLAIMS, rewrite, BANNED_PHRASES, ACRONYMS_SPELL_OUT, ACRONYMS_KEEP, KEYWORDS, PREFERRED_VERBS
    );
    assert(result.passed === false, "Dropped claims detected");
    assert(
      result.failures.some((f) => f.includes("CLAIM_DROPPED") && f.includes("c2")),
      "Reports c2 (scope) as dropped"
    );
    assert(
      result.failures.some((f) => f.includes("CLAIM_DROPPED") && f.includes("c3")),
      "Reports c3 (tool) as dropped"
    );
  }

  // Test 3: Added claims fails
  {
    const rewrite: RewriteResult = {
      rewritten: "Led cross-functional team of 8 to ship ML-powered search using Kubernetes, increasing engagement 34%",
      char_count: 100,
      claims_preserved: [
        { claim_id: "c1", evidence_span: "Led cross-functional team" },
        { claim_id: "c2", evidence_span: "team of 8" },
        { claim_id: "c3", evidence_span: "ML-powered search" },
        { claim_id: "c4", evidence_span: "increasing engagement 34%" },
      ],
      claims_added: [{ type: "tool", value: "Kubernetes" }],  // FABRICATION
      keywords_embedded: [],
      omitted_keywords: [],
      format_used: "xyz",
      acronyms_expanded: [],
      acronyms_kept: ["ML"],
      banned_phrase_check: true,
    };
    rewrite.char_count = rewrite.rewritten.length;

    const result = truthfulnessGate(
      ORIGINAL_CLAIMS, rewrite, BANNED_PHRASES, ACRONYMS_SPELL_OUT, ACRONYMS_KEEP, KEYWORDS, PREFERRED_VERBS
    );
    assert(result.passed === false, "Added claims detected");
    assert(
      result.failures.some((f) => f.includes("CLAIM_ADDED") && f.includes("Kubernetes")),
      "Reports Kubernetes fabrication"
    );
  }

  // Test 4: Char limit exceeded
  {
    const longText = "Led cross-functional team of 8 to ship ML-powered search, increasing engagement 34% " +
      "through strategic roadmap execution and comprehensive product planning across multiple business units and stakeholders globally over fifteen quarters of sustained delivery";
    const rewrite: RewriteResult = {
      rewritten: longText,
      char_count: longText.length,
      claims_preserved: [
        { claim_id: "c1", evidence_span: "Led cross-functional team" },
        { claim_id: "c2", evidence_span: "team of 8" },
        { claim_id: "c3", evidence_span: "ML-powered search" },
        { claim_id: "c4", evidence_span: "increasing engagement 34%" },
      ],
      claims_added: [],
      keywords_embedded: ["roadmap"],
      omitted_keywords: [],
      format_used: "xyz",
      acronyms_expanded: [],
      acronyms_kept: ["ML"],
      banned_phrase_check: true,
    };

    const result = truthfulnessGate(
      ORIGINAL_CLAIMS, rewrite, BANNED_PHRASES, ACRONYMS_SPELL_OUT, ACRONYMS_KEEP, KEYWORDS, PREFERRED_VERBS
    );
    assert(result.passed === false, "Char limit violation detected");
    assert(
      result.failures.some((f) => f.includes("CHAR_LIMIT")),
      "Reports CHAR_LIMIT failure"
    );
  }

  // Test 5: Banned phrase present
  {
    const rewrite: RewriteResult = {
      rewritten: "Was responsible for leading team of 8 to ship ML-powered search, increasing engagement 34%",
      char_count: 91,
      claims_preserved: [
        { claim_id: "c1", evidence_span: "leading team" },
        { claim_id: "c2", evidence_span: "team of 8" },
        { claim_id: "c3", evidence_span: "ML-powered search" },
        { claim_id: "c4", evidence_span: "increasing engagement 34%" },
      ],
      claims_added: [],
      keywords_embedded: [],
      omitted_keywords: [],
      format_used: "car",
      acronyms_expanded: [],
      acronyms_kept: ["ML"],
      banned_phrase_check: false,
    };
    rewrite.char_count = rewrite.rewritten.length;

    const result = truthfulnessGate(
      ORIGINAL_CLAIMS, rewrite, BANNED_PHRASES, ACRONYMS_SPELL_OUT, ACRONYMS_KEEP, KEYWORDS, PREFERRED_VERBS
    );
    assert(result.passed === false, "Banned phrase detected");
    assert(
      result.failures.some((f) => f.includes("BANNED_PHRASE") && f.includes("responsible for")),
      "Reports 'responsible for' as banned"
    );
  }

  // Test 6: Unexpanded acronym
  {
    const rewrite: RewriteResult = {
      rewritten: "Led cross-functional team of 8 to ship ML-powered search per the PRD, increasing engagement 34%",
      char_count: 96,
      claims_preserved: [
        { claim_id: "c1", evidence_span: "Led cross-functional team" },
        { claim_id: "c2", evidence_span: "team of 8" },
        { claim_id: "c3", evidence_span: "ML-powered search" },
        { claim_id: "c4", evidence_span: "increasing engagement 34%" },
      ],
      claims_added: [],
      keywords_embedded: [],
      omitted_keywords: [],
      format_used: "xyz",
      acronyms_expanded: [],
      acronyms_kept: ["ML"],
      banned_phrase_check: true,
    };
    rewrite.char_count = rewrite.rewritten.length;

    const result = truthfulnessGate(
      ORIGINAL_CLAIMS, rewrite, BANNED_PHRASES, ACRONYMS_SPELL_OUT, ACRONYMS_KEEP, KEYWORDS, PREFERRED_VERBS
    );
    assert(result.passed === false, "Unexpanded acronym detected");
    assert(
      result.failures.some((f) => f.includes("ACRONYM_NOT_EXPANDED") && f.includes("PRD")),
      "Reports PRD should be spelled out"
    );
  }

  // Test 7: Keyword claimed but not found
  {
    const rewrite: RewriteResult = {
      rewritten: "Led cross-functional team of 8 to ship ML-powered search, increasing engagement 34%",
      char_count: 85,
      claims_preserved: [
        { claim_id: "c1", evidence_span: "Led cross-functional team" },
        { claim_id: "c2", evidence_span: "team of 8" },
        { claim_id: "c3", evidence_span: "ML-powered search" },
        { claim_id: "c4", evidence_span: "increasing engagement 34%" },
      ],
      claims_added: [],
      keywords_embedded: ["roadmap"],  // claims to embed roadmap but it's NOT in the text
      omitted_keywords: [],
      format_used: "xyz",
      acronyms_expanded: [],
      acronyms_kept: ["ML"],
      banned_phrase_check: true,
    };
    rewrite.char_count = rewrite.rewritten.length;

    const result = truthfulnessGate(
      ORIGINAL_CLAIMS, rewrite, BANNED_PHRASES, ACRONYMS_SPELL_OUT, ACRONYMS_KEEP, KEYWORDS, PREFERRED_VERBS
    );
    assert(result.passed === false, "Missing keyword detected");
    assert(
      result.failures.some((f) => f.includes("KEYWORD_NOT_FOUND") && f.includes("roadmap")),
      "Reports roadmap not found"
    );
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
