/**
 * Manual test for normalizeRoleUrl.
 * Run with: npx ts-node scripts/testNormalizeUrl.ts
 */

import { normalizeRoleUrl } from "../src/lib/normalizeUrl";

let passed = 0;
let failed = 0;

function assertEqual(label: string, actual: string, expected: string): void {
  if (actual === expected) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.log(`  ❌  ${label}`);
    console.log(`       expected: ${expected}`);
    console.log(`       actual:   ${actual}`);
    failed++;
  }
}

console.log("\n── normalizeRoleUrl ──\n");

// All three should collapse to the same canonical form.
const CANONICAL = "https://boards.greenhouse.io/stripe/jobs/12345";

assertEqual(
  "baseline: tracking params stripped",
  normalizeRoleUrl("https://boards.greenhouse.io/stripe/jobs/12345?gh_jid=12345&utm_source=apply"),
  CANONICAL,
);

// Path is NOT case-normalized (paths are case-sensitive per URL spec).
// Only the trailing slash is removed; the host is lowercased separately.
assertEqual(
  "trailing slash stripped (path case preserved)",
  normalizeRoleUrl("https://boards.greenhouse.io/stripe/jobs/12345/"),
  CANONICAL,
);

assertEqual(
  "http → https, fragment stripped, param order independent",
  normalizeRoleUrl("http://boards.greenhouse.io/stripe/jobs/12345?utm_source=apply&gh_jid=12345#apply"),
  CANONICAL,
);

// Additional coverage.

assertEqual(
  "www stripped",
  normalizeRoleUrl("https://www.lever.co/company/12345"),
  "https://lever.co/company/12345",
);

assertEqual(
  "trailing slash on path stripped",
  normalizeRoleUrl("https://jobs.ashbyhq.com/company/role/"),
  "https://jobs.ashbyhq.com/company/role",
);

assertEqual(
  "root path slash kept",
  normalizeRoleUrl("https://example.com/"),
  "https://example.com/",
);

assertEqual(
  "non-tracking params kept",
  normalizeRoleUrl("https://boards.greenhouse.io/company/jobs/42?token=abc"),
  "https://boards.greenhouse.io/company/jobs/42?token=abc",
);

assertEqual(
  "multiple tracking params all stripped",
  normalizeRoleUrl("https://jobs.lever.co/acme/123?utm_source=x&utm_medium=y&lever-source=z&fbclid=w"),
  "https://jobs.lever.co/acme/123",
);

assertEqual(
  "mixed tracking + non-tracking params — only tracking stripped, remainder sorted",
  normalizeRoleUrl("https://example.com/job?b=2&utm_source=x&a=1"),
  "https://example.com/job?a=1&b=2",
);

assertEqual(
  "hostname case normalized",
  normalizeRoleUrl("https://BOARDS.Greenhouse.IO/co/jobs/1"),
  "https://boards.greenhouse.io/co/jobs/1",
);

// Summary.
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
