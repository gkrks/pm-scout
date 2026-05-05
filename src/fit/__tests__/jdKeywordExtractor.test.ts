/**
 * Unit tests for jdKeywordExtractor.ts — deterministic extraction.
 *
 * Run: npx ts-node src/fit/__tests__/jdKeywordExtractor.test.ts
 *
 * Tests Stage 1 (deterministic regex) only — does not call LLM.
 * Sets JD_KEYWORD_EXTRACTOR_ENABLED=true for testing.
 */

process.env.JD_KEYWORD_EXTRACTOR_ENABLED = "true";
// Ensure LLM is not called (no OPENAI_KEY)
delete process.env.OPENAI_KEY;

import { extractJDKeywords, detectRoleFamily } from "../jdKeywordExtractor";

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

function assertIncludes(arr: string[], item: string, message: string) {
  assert(arr.includes(item), `${message} — expected "${item}" in [${arr.slice(0, 5).join(", ")}...]`);
}

// --------------------------------------------------------------------------- //
//  Test data: realistic PM JD
// --------------------------------------------------------------------------- //

const SAMPLE_JD_TITLE = "Senior Product Manager, Growth";
const SAMPLE_BASIC_QUALS = [
  "5+ years of product management experience",
  "Strong SQL skills and experience with A/B testing and experimentation",
  "Experience writing PRDs and defining product roadmaps",
  "Track record of shipping products from 0 to 1",
];
const SAMPLE_PREFERRED_QUALS = [
  "Experience with ML-powered features",
  "Familiarity with funnel analysis and cohort analysis",
  "MBA or equivalent experience",
];
const SAMPLE_RESPONSIBILITIES = [
  "Define and own the product roadmap for the Growth team",
  "Partner cross-functionally with engineering, design, and data science",
  "Drive experimentation strategy and analyze A/B test results",
  "Communicate product strategy to executive stakeholders",
];

// --------------------------------------------------------------------------- //
//  Tests
// --------------------------------------------------------------------------- //

async function runTests() {
  console.log("\n=== Role Detection Tests ===\n");

  // Role detection
  const pmResult = detectRoleFamily("Senior Product Manager, Growth");
  assert(pmResult.family === "pm", `PM detected for "${SAMPLE_JD_TITLE}"`);
  assert(pmResult.confidence > 0.5, `Confidence > 0.5 (got ${pmResult.confidence})`);

  const sweResult = detectRoleFamily("Staff Software Engineer");
  assert(sweResult.family === "swe", "SWE detected for 'Staff Software Engineer'");

  const tpmResult = detectRoleFamily("Technical Program Manager");
  assert(tpmResult.family === "tpm", "TPM detected for 'Technical Program Manager'");

  const techPmResult = detectRoleFamily("Technical Product Manager");
  assert(techPmResult.family === "pm", "PM detected for 'Technical Product Manager' (not TPM)");

  console.log("\n=== Keyword Extraction Tests ===\n");

  const result = await extractJDKeywords({
    jdTitle: SAMPLE_JD_TITLE,
    jdText: [SAMPLE_JD_TITLE, ...SAMPLE_BASIC_QUALS, ...SAMPLE_PREFERRED_QUALS, ...SAMPLE_RESPONSIBILITIES].join("\n"),
    basicQualifications: SAMPLE_BASIC_QUALS,
    preferredQualifications: SAMPLE_PREFERRED_QUALS,
    responsibilities: SAMPLE_RESPONSIBILITIES,
  });

  // Basic structure
  assert(result.role_family === "pm", `role_family is pm (got ${result.role_family})`);
  assert(result.jd_hash.length === 16, `jd_hash is 16 chars (got ${result.jd_hash.length})`);
  assert(result.must_have.length > 0, `must_have is non-empty (got ${result.must_have.length})`);

  // Key terms should be detected
  const allCanonicals = [...result.must_have, ...result.nice_to_have].map((t) => t.canonical);

  assertIncludes(allCanonicals, "a/b testing", "A/B testing detected");
  assertIncludes(allCanonicals, "sql", "SQL detected");
  assertIncludes(allCanonicals, "product requirements document", "PRD canonicalized to full form");
  assertIncludes(allCanonicals, "roadmap", "roadmap detected");
  assertIncludes(allCanonicals, "cross-functional", "cross-functional detected");
  assertIncludes(allCanonicals, "funnel analysis", "funnel analysis detected");
  assertIncludes(allCanonicals, "cohort analysis", "cohort analysis detected");
  assertIncludes(allCanonicals, "experimentation", "experimentation detected");

  // Position scoring: terms in basic quals should be required
  const sqlTerm = result.must_have.find((t) => t.canonical === "sql");
  if (sqlTerm) {
    assert(sqlTerm.required === true, "SQL marked as required (in basic quals)");
    assert(sqlTerm.position_score >= 2.0, `SQL position_score >= 2.0 (got ${sqlTerm.position_score})`);
  } else {
    const sqlNice = result.nice_to_have.find((t) => t.canonical === "sql");
    assert(false, `SQL should be in must_have, found in nice_to_have: ${!!sqlNice}`);
  }

  // PRD should be canonicalized
  const prdTerm = [...result.must_have, ...result.nice_to_have].find(
    (t) => t.canonical === "product requirements document"
  );
  assert(!!prdTerm, "PRD found as 'product requirements document'");
  if (prdTerm) {
    assert(
      prdTerm.aliases.includes("prd"),
      "PRD aliases include 'prd'"
    );
  }

  // Weight calculation: terms appearing in multiple sections should have higher weight
  const roadmapTerm = [...result.must_have, ...result.nice_to_have].find(
    (t) => t.canonical === "roadmap"
  );
  assert(!!roadmapTerm, "roadmap found");
  if (roadmapTerm) {
    assert(roadmapTerm.jd_count >= 2, `roadmap appears in multiple sections (count=${roadmapTerm.jd_count})`);
  }

  // Category assignment
  const abTerm = [...result.must_have, ...result.nice_to_have].find(
    (t) => t.canonical === "a/b testing"
  );
  if (abTerm) {
    assert(
      abTerm.category === "data_and_experimentation",
      `A/B testing category is data_and_experimentation (got ${abTerm.category})`
    );
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
