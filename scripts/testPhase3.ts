/**
 * Phase 3 verification script
 *
 * Run with:  npx ts-node scripts/testPhase3.ts
 *
 * Prints PASS / FAIL for each assertion. Exits 1 on any failure.
 */

import { filterTitle } from "../src/filters/title";
import { filterLocation } from "../src/filters/location";
import { filterFreshness } from "../src/filters/freshness";
import { filterExperience } from "../src/filters/experience";
import { filterSponsorship } from "../src/filters/sponsorship";
import { filterSalary } from "../src/filters/salary";
import { computeTier } from "../src/ranking/tier";
import { runFilterPipeline, runPreDescriptionFilters } from "../src/filters/pipeline";
import { loadFilterConfig } from "../src/config/filterConfig";
import type { FilterConfig, JobEnrichment } from "../src/filters/types";
import type { RawJob, Company } from "../src/scrapers/types";

// ── Tiny assertion harness ────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, actual: unknown, expected: unknown): void {
  const ok =
    JSON.stringify(actual) === JSON.stringify(expected) ||
    actual === expected;
  if (ok) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    console.error(`       expected: ${JSON.stringify(expected)}`);
    console.error(`       actual  : ${JSON.stringify(actual)}`);
    failed++;
  }
}

function section(name: string): void {
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 60 - name.length))}`);
}

// ── Shared test fixtures ──────────────────────────────────────────────────────

const FILTER_CONFIG: FilterConfig = {
  title_include_keywords: [
    "Product Manager",
    "Associate Product Manager",
    "APM",
    "Forward Deployed PM",
  ],
  title_exclude_keywords: [
    "Senior Product Manager",
    "Sr. Product Manager",
    "VP ",        // trailing space intentional
    "Director",
    "Marketing",
    "Program Manager",
    "Technical Product Manager",
  ],
  location: {
    allowed_cities: ["San Francisco", "New York City", "Austin", "Seattle", "Boston"],
    city_aliases: {
      "New York City": ["New York", "NYC", "Manhattan", "New York, NY"],
      "San Francisco": ["SF", "San Francisco, CA", "Bay Area"],
      "Austin": ["Austin, TX"],
      "Seattle": ["Seattle, WA", "Bellevue", "Bellevue, WA"],
      "Boston": ["Boston, MA", "Cambridge, MA"],
    },
    accept_onsite: true,
    accept_hybrid: true,
    accept_remote_us: true,
    accept_remote_in_allowed_cities: true,
  },
  experience: { reject_above_years: 3 },
  freshness: { max_posting_age_days: 30, tier_1_max_age_days: 7 },
  sponsorship: { requires_sponsorship: false, reject_if_no_sponsorship_offered: false },
  compensation: { min_base_salary_usd: null },
  preferred_domains: ["AI/ML", "Platform", "Fintech"],
};

const NOW = new Date("2026-05-01T12:00:00Z");

function daysAgo(n: number): string {
  const d = new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

const BASE_COMPANY: Company = {
  slug: "anthropic",
  name: "Anthropic",
  careers_url: "https://anthropic.com/careers",
  has_apm_program: true,
  apm_program_status: "active",
  domain_tags: ["AI/ML"],
  target_roles: ["Associate Product Manager"],
};

const BASE_JOB: RawJob = {
  title: "Associate Product Manager",
  role_url: "https://anthropic.com/careers/apm",
  location_raw: "San Francisco, CA",
  posted_date: daysAgo(3),
  description: "We are looking for a new grad to join as an Associate PM. No prior experience required.",
  source_meta: {},
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3.1 Title filter
// ═══════════════════════════════════════════════════════════════════════════════
section("3.1  Title filter");

assert(
  "keeps 'Product Manager'",
  filterTitle("Product Manager", FILTER_CONFIG).kept,
  true,
);
assert(
  "keeps 'Associate Product Manager'",
  filterTitle("Associate Product Manager", FILTER_CONFIG).kept,
  true,
);
assert(
  "keeps 'APM, Platform'",
  filterTitle("APM, Platform", FILTER_CONFIG).kept,
  true,
);
assert(
  "rejects 'Senior Product Manager'",
  filterTitle("Senior Product Manager", FILTER_CONFIG).kept,
  false,
);
assert(
  "rejects 'Sr. Product Manager, Growth'",
  filterTitle("Sr. Product Manager, Growth", FILTER_CONFIG).kept,
  false,
);
assert(
  "rejects 'Director of Product'",
  filterTitle("Director of Product", FILTER_CONFIG).kept,
  false,
);
assert(
  "rejects 'Marketing Product Manager' (Marketing exclude)",
  filterTitle("Marketing Product Manager", FILTER_CONFIG).kept,
  false,
);
assert(
  "rejects 'VP of Product' via trailing-space 'VP '",
  filterTitle("VP of Product", FILTER_CONFIG).kept,
  false,
);
assert(
  "keeps 'Product Manager, VPN Infrastructure' — VP space trick works",
  filterTitle("Product Manager, VPN Infrastructure", FILTER_CONFIG).kept,
  true,
);
assert(
  "rejects 'Software Engineer' (not in include list)",
  filterTitle("Software Engineer", FILTER_CONFIG).kept,
  false,
);
assert(
  "rejects 'Technical Product Manager'",
  filterTitle("Technical Product Manager", FILTER_CONFIG).kept,
  false,
);
assert(
  "keeps 'Forward Deployed PM'",
  filterTitle("Forward Deployed PM", FILTER_CONFIG).kept,
  true,
);

// ═══════════════════════════════════════════════════════════════════════════════
// 3.2 Location filter
// ═══════════════════════════════════════════════════════════════════════════════
section("3.2  Location filter");

{
  const r = filterLocation("San Francisco, CA", FILTER_CONFIG);
  assert("SF onsite — kept", r.kept, true);
  assert("SF onsite — location_city", r.enrichment.location_city, "San Francisco");
  assert("SF onsite — is_remote", r.enrichment.is_remote, false);
}
{
  const r = filterLocation("NYC", FILTER_CONFIG);
  assert("NYC alias — kept", r.kept, true);
  assert("NYC alias — location_city", r.enrichment.location_city, "New York City");
}
{
  const r = filterLocation("Remote (US)", FILTER_CONFIG);
  assert("Remote (US) — kept", r.kept, true);
  assert("Remote (US) — is_remote", r.enrichment.is_remote, true);
  assert("Remote (US) — location_city is null", r.enrichment.location_city, null);
}
{
  const r = filterLocation("Remote", FILTER_CONFIG);
  assert("Bare 'Remote' — kept", r.kept, true);
  assert("Bare 'Remote' — is_remote", r.enrichment.is_remote, true);
}
{
  const r = filterLocation("Hybrid - Austin, TX", FILTER_CONFIG);
  assert("Hybrid Austin — kept", r.kept, true);
  assert("Hybrid Austin — is_hybrid", r.enrichment.is_hybrid, true);
  assert("Hybrid Austin — location_city", r.enrichment.location_city, "Austin");
}
{
  const r = filterLocation("Remote — San Francisco", FILTER_CONFIG);
  assert("Remote-in-SF — kept", r.kept, true);
  assert("Remote-in-SF — is_remote", r.enrichment.is_remote, true);
  assert("Remote-in-SF — location_city", r.enrichment.location_city, "San Francisco");
}
{
  const r = filterLocation("Dallas, TX", FILTER_CONFIG);
  assert("Dallas (not in allowed_cities) — rejected", r.kept, false);
}
{
  const r = filterLocation("Onsite - Denver, CO", FILTER_CONFIG);
  assert("Denver (not in allowed_cities) — rejected", r.kept, false);
}
{
  const r = filterLocation("Bellevue, WA", FILTER_CONFIG);
  assert("Bellevue alias → Seattle — kept", r.kept, true);
  assert("Bellevue alias → location_city", r.enrichment.location_city, "Seattle");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3.4 Freshness filter
// ═══════════════════════════════════════════════════════════════════════════════
section("3.4  Freshness filter");

assert(
  "3-day-old post — kept, within_7d=true",
  filterFreshness(daysAgo(3), FILTER_CONFIG, NOW).enrichment.posted_within_7_days,
  true,
);
assert(
  "3-day-old post — posted_within_30d=true",
  filterFreshness(daysAgo(3), FILTER_CONFIG, NOW).enrichment.posted_within_30_days,
  true,
);
assert(
  "10-day-old post — kept, within_7d=false",
  filterFreshness(daysAgo(10), FILTER_CONFIG, NOW).enrichment.posted_within_7_days,
  false,
);
assert(
  "10-day-old post — kept, within_30d=true",
  filterFreshness(daysAgo(10), FILTER_CONFIG, NOW).enrichment.posted_within_30_days,
  true,
);
assert(
  "31-day-old post — rejected",
  filterFreshness(daysAgo(31), FILTER_CONFIG, NOW).kept,
  false,
);
assert(
  "null date — kept",
  filterFreshness(null, FILTER_CONFIG, NOW).kept,
  true,
);
assert(
  "null date — confidence unknown",
  filterFreshness(null, FILTER_CONFIG, NOW).enrichment.freshness_confidence,
  "unknown",
);
assert(
  "garbage date — kept with unknown confidence",
  filterFreshness("not-a-date", FILTER_CONFIG, NOW).kept,
  true,
);

// ═══════════════════════════════════════════════════════════════════════════════
// 3.3 Experience filter
// ═══════════════════════════════════════════════════════════════════════════════
section("3.3  Experience filter");

{
  const r = filterExperience(
    "We require 5+ years of product experience.",
  );
  assert("5+ yoe — rejected", r.kept, false);
  assert("5+ yoe — reason too-senior", r.reason, "experience-too-senior");
  assert("5+ yoe — yoe_min", r.enrichment.yoe_min, 5);
}
{
  const r = filterExperience(
    "2-3 years of experience preferred.",
  );
  assert("2-3 yoe — kept", r.kept, true);
  // "2-3 years" matches JUNIOR_PHRASES_RE → confidence is inferred-junior (junior check fires first)
  assert("2-3 yoe — confidence inferred-junior", r.enrichment.experience_confidence, "inferred-junior");
  assert("2-3 yoe — yoe_min", r.enrichment.yoe_min, 2);
  assert("2-3 yoe — yoe_max", r.enrichment.yoe_max, 3);
}
{
  const r = filterExperience(
    "Minimum of 4 years of professional experience required.",
  );
  assert("min 4 yoe — rejected", r.kept, false);
  assert("min 4 yoe — reason too-senior", r.reason, "experience-too-senior");
  assert("min 4 yoe — yoe_min", r.enrichment.yoe_min, 4);
}
{
  // yoe_max=5 exceeds 3 → REJECTED despite junior phrase (max check comes first)
  const r = filterExperience(
    "Up to 5 years of experience. Entry level welcome.",
  );
  assert("'up to 5 yrs' + entry level — rejected (max>3)", r.kept, false);
  assert("'up to 5 yrs' — yoe_max 5", r.enrichment.yoe_max, 5);
}
{
  // yoe_max ≤ 3 → KEPT
  const r = filterExperience(
    "Up to 2 years of experience preferred.",
  );
  assert("'up to 2 years' — kept", r.kept, true);
  assert("'up to 2 years' — yoe_min null", r.enrichment.yoe_min, null);
  assert("'up to 2 years' — yoe_max 2", r.enrichment.yoe_max, 2);
}
{
  const r = filterExperience(
    "Great opportunity for new grad candidates.",
  );
  assert("new grad language — kept", r.kept, true);
  assert("new grad language — confidence inferred-junior", r.enrichment.experience_confidence, "inferred-junior");
  assert("new grad language — is_new_grad_language", r.enrichment.is_new_grad_language, true);
  assert("new grad language — yoe_min null", r.enrichment.yoe_min, null);
}
{
  // No YOE + no junior language + no APM title → REJECT (new tightened behavior)
  const r = filterExperience(
    "Looking for an experienced PM to join our team.",
  );
  assert("no YOE mention — rejected (unclear)", r.kept, false);
  assert("no YOE mention — reason unclear", r.reason, "experience-unclear-and-not-junior");
}
{
  // No description + no APM title → REJECT
  const r = filterExperience(undefined);
  assert("no description — rejected (no APM title)", r.kept, false);
  assert("no description — reason unclear", r.reason, "experience-unclear-and-not-junior");
}
{
  // No description but title is APM → KEEP
  const r = filterExperience(undefined, "Associate Product Manager");
  assert("no description + APM title — kept", r.kept, true);
  assert("no description + APM title — confidence inferred-junior", r.enrichment.experience_confidence, "inferred-junior");
}
{
  // "3+ years" has plus suffix → REJECT (plus means and-up, violates max-3 constraint)
  const r = filterExperience(
    "3+ years of experience in product.",
  );
  assert("3+ yoe — rejected (plus suffix)", r.kept, false);
  assert("3+ yoe — reason too-senior", r.reason, "experience-too-senior");
  assert("3+ yoe — yoe_min 3", r.enrichment.yoe_min, 3);
}
{
  // "at least 2 years" — has_min_clause=true but X<4 → KEPT (REJECT only when X>=4)
  const r = filterExperience(
    "At least 2 years of product experience.",
  );
  assert("at least 2 years — kept", r.kept, true);
  assert("at least 2 years — confidence extracted", r.enrichment.experience_confidence, "extracted");
  assert("at least 2 years — yoe_min 2", r.enrichment.yoe_min, 2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3.5 Sponsorship filter
// ═══════════════════════════════════════════════════════════════════════════════
section("3.5  Sponsorship filter");

{
  const r = filterSponsorship(
    "We are unable to sponsor visas at this time.",
    FILTER_CONFIG,
  );
  assert("no sponsorship — kept (config flag off)", r.kept, true);
  assert("no sponsorship — sponsorship_offered false", r.enrichment.sponsorship_offered, false);
}
{
  const r = filterSponsorship(
    "Visa sponsorship is available for qualified candidates.",
    FILTER_CONFIG,
  );
  assert("offers sponsorship — kept", r.kept, true);
  assert("offers sponsorship — sponsorship_offered true", r.enrichment.sponsorship_offered, true);
}
{
  const r = filterSponsorship(
    "We are building the future of AI.",
    FILTER_CONFIG,
  );
  assert("no mention — kept, unclear=true", r.kept, true);
  assert("no mention — requires_sponsorship_unclear", r.enrichment.requires_sponsorship_unclear, true);
  assert("no mention — sponsorship_offered null", r.enrichment.sponsorship_offered, null);
}
{
  // Config WITH reject_if_no_sponsorship_offered = true
  const strictConfig: FilterConfig = {
    ...FILTER_CONFIG,
    sponsorship: { requires_sponsorship: false, reject_if_no_sponsorship_offered: true },
  };
  const r = filterSponsorship(
    "We cannot sponsor work visas.",
    strictConfig,
  );
  assert("strict config + no sponsorship → rejected", r.kept, false);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3.6 Salary filter
// ═══════════════════════════════════════════════════════════════════════════════
section("3.6  Salary filter");

assert(
  "filter disabled (min null) — kept",
  filterSalary("$80,000 – $100,000 base salary.", FILTER_CONFIG).kept,
  true,
);

{
  const cfg: FilterConfig = { ...FILTER_CONFIG, compensation: { min_base_salary_usd: 120_000 } };
  const r = filterSalary("Salary range: $150,000 – $200,000.", cfg);
  assert("range above min — kept", r.kept, true);
  assert("range — salary_min", r.enrichment.salary_min, 150_000);
  assert("range — salary_max", r.enrichment.salary_max, 200_000);
}
{
  const cfg: FilterConfig = { ...FILTER_CONFIG, compensation: { min_base_salary_usd: 120_000 } };
  const r = filterSalary("Compensation: $80,000 – $110,000.", cfg);
  assert("range below min — rejected", r.kept, false);
}
{
  const cfg: FilterConfig = { ...FILTER_CONFIG, compensation: { min_base_salary_usd: 120_000 } };
  const r = filterSalary("Pay: $130,000 annually.", cfg);
  assert("single amount above min — kept", r.kept, true);
  assert("single amount — salary_min=max", r.enrichment.salary_min, 130_000);
}
{
  const cfg: FilterConfig = { ...FILTER_CONFIG, compensation: { min_base_salary_usd: 120_000 } };
  const r = filterSalary("Compensation: €90.000.", cfg);
  assert("non-USD salary — kept (currency skip)", r.kept, true);
  assert("non-USD — salary_currency", r.enrichment.salary_currency, "non-USD");
}
{
  const cfg: FilterConfig = { ...FILTER_CONFIG, compensation: { min_base_salary_usd: 120_000 } };
  const r = filterSalary("Competitive compensation package.", cfg);
  assert("no salary disclosed — kept", r.kept, true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3.7 Tier ranking
// ═══════════════════════════════════════════════════════════════════════════════
section("3.7  Tier ranking");

const FULL_ENRICHMENT: JobEnrichment = {
  location_city: "San Francisco",
  is_remote: false,
  is_hybrid: false,
  yoe_min: null,
  yoe_max: null,
  yoe_raw: null,
  experience_confidence: "inferred-junior",
  is_new_grad_language: true,
  freshness_confidence: "known",
  posted_within_7_days: true,
  posted_within_30_days: true,
  sponsorship_offered: null,
  requires_sponsorship_unclear: true,
  salary_min: null,
  salary_max: null,
  salary_currency: null,
};

{
  const r = computeTier("Associate Product Manager", FULL_ENRICHMENT, BASE_COMPANY, FILTER_CONFIG);
  assert("tier 1 base signals — tier 1", r.tier, 1);
  assert("AI/ML domain boost — domainBoosted", r.domainBoosted, true);
}
{
  // APM boost: active APM program + exact APM title, but stale post
  const e: JobEnrichment = {
    ...FULL_ENRICHMENT,
    posted_within_7_days: false,   // fails base tier 1
    location_city: null,           // pure remote — fails base tier 1
    is_remote: true,
  };
  const r = computeTier("Associate Product Manager", e, BASE_COMPANY, FILTER_CONFIG);
  assert("APM boost (exact title + active program) → tier 1", r.tier, 1);
}
{
  // Tier 2: posted ≤30d, explicit yoe_max ≤ 3, PM title, remote US
  const e: JobEnrichment = {
    ...FULL_ENRICHMENT,
    posted_within_7_days: false,
    location_city: null,
    is_remote: true,
    is_new_grad_language: false,
    yoe_min: 1,
    yoe_max: 2,
  };
  const r = computeTier("Product Manager, Growth", e, BASE_COMPANY, FILTER_CONFIG);
  assert("tier 2 — remote US PM — tier 2", r.tier, 2);
}
{
  // Tier 3: stale, not remote, not city — passes filters but no T1/T2 signals
  const e: JobEnrichment = {
    ...FULL_ENRICHMENT,
    posted_within_7_days: false,
    posted_within_30_days: false,
    location_city: null,
    is_remote: false,
  };
  const r = computeTier("Product Manager", e, BASE_COMPANY, FILTER_CONFIG);
  assert("tier 3 (no tier 1/2 signals) — review when convenient", r.tier, 3);
}
{
  // Tier 1 with explicit YOE ≤ 2
  const e: JobEnrichment = {
    ...FULL_ENRICHMENT,
    yoe_min: 1,
    yoe_max: 2,
    is_new_grad_language: false,
  };
  const r = computeTier("Product Manager", e, BASE_COMPANY, FILTER_CONFIG);
  assert("tier 1 with yoe_max=2 — tier 1", r.tier, 1);
}
{
  // Tier 2: YOE = 3 — should NOT be tier 1, but fine for tier 2
  const e: JobEnrichment = {
    ...FULL_ENRICHMENT,
    yoe_min: 3,
    yoe_max: 3,
    is_new_grad_language: false,
  };
  const r = computeTier("Product Manager", e, BASE_COMPANY, FILTER_CONFIG);
  assert("yoe=3 + within_7d + city — tier 1 (yoe_max ≤ 2 fails, but tier 2 accepts yoe ≤ 3)", r.tier, 2);
}
{
  // No domain overlap → not boosted
  const companyNoDomain: Company = { ...BASE_COMPANY, domain_tags: ["Healthcare"] };
  const r = computeTier("Associate Product Manager", FULL_ENRICHMENT, companyNoDomain, FILTER_CONFIG);
  assert("no domain overlap — not boosted", r.domainBoosted, false);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Full pipeline — runPreDescriptionFilters
// ═══════════════════════════════════════════════════════════════════════════════
section("runPreDescriptionFilters");

{
  const r = runPreDescriptionFilters(BASE_JOB, FILTER_CONFIG, NOW);
  assert("good job — pre-desc passes", r.kept, true);
  assert("good job — location_city set", r.enrichment.location_city, "San Francisco");
  assert("good job — posted_within_7d", r.enrichment.posted_within_7_days, true);
}
{
  const staleJob: RawJob = { ...BASE_JOB, posted_date: daysAgo(45) };
  const r = runPreDescriptionFilters(staleJob, FILTER_CONFIG, NOW);
  assert("stale job — pre-desc rejected by freshness", r.kept, false);
  assert("stale job — rejectedBy freshness", r.rejectedBy, "freshness");
}
{
  const dallaJob: RawJob = { ...BASE_JOB, location_raw: "Dallas, TX" };
  const r = runPreDescriptionFilters(dallaJob, FILTER_CONFIG, NOW);
  assert("Dallas job — rejected by location", r.kept, false);
  assert("Dallas job — rejectedBy location", r.rejectedBy, "location");
}
{
  const srJob: RawJob = { ...BASE_JOB, title: "Senior Product Manager" };
  const r = runPreDescriptionFilters(srJob, FILTER_CONFIG, NOW);
  assert("Senior PM — rejected by title", r.kept, false);
  assert("Senior PM — rejectedBy title", r.rejectedBy, "title");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Full pipeline — runFilterPipeline
// ═══════════════════════════════════════════════════════════════════════════════
section("runFilterPipeline (end-to-end)");

{
  const r = runFilterPipeline(BASE_JOB, BASE_COMPANY, FILTER_CONFIG, NOW);
  assert("ideal APM job — kept", r.kept, true);
  assert("ideal APM job — tier 1", r.tier, 1);
  assert("ideal APM job — domainBoosted (AI/ML)", r.domainBoosted, true);
  assert("ideal APM job — location_city", r.enrichment.location_city, "San Francisco");
  assert("ideal APM job — is_new_grad_language", r.enrichment.is_new_grad_language, true);
}
{
  // Typical tier-2: PM title, remote, 3 yoe, 15 days old
  const job2: RawJob = {
    ...BASE_JOB,
    title: "Product Manager, Platform",
    location_raw: "Remote (US)",
    posted_date: daysAgo(15),
    description: "2-3 years of product experience. We cannot sponsor visas.",
  };
  const r = runFilterPipeline(job2, BASE_COMPANY, FILTER_CONFIG, NOW);
  assert("tier-2 remote PM — kept", r.kept, true);
  assert("tier-2 remote PM — tier 2", r.tier, 2);
  assert("tier-2 remote PM — is_remote", r.enrichment.is_remote, true);
  assert("tier-2 remote PM — sponsorship_offered false (noted, not rejected)", r.enrichment.sponsorship_offered, false);
  assert("tier-2 remote PM — yoe_min 2", r.enrichment.yoe_min, 2);
}
{
  // Rejected: too much experience (use non-APM title so APM override doesn't fire)
  const job3: RawJob = {
    ...BASE_JOB,
    title: "Product Manager, Platform",
    description: "Minimum 5 years of product experience required.",
  };
  const r = runFilterPipeline(job3, BASE_COMPANY, FILTER_CONFIG, NOW);
  assert("5-yoe job — rejected by experience", r.kept, false);
  assert("5-yoe job — rejectedBy experience", r.rejectedBy, "experience");
}
{
  // Rejected: stale posting
  const job4: RawJob = { ...BASE_JOB, posted_date: daysAgo(40) };
  const r = runFilterPipeline(job4, BASE_COMPANY, FILTER_CONFIG, NOW);
  assert("stale job — rejected by freshness", r.kept, false);
  assert("stale job — rejectedBy freshness", r.rejectedBy, "freshness");
}
{
  // Rejected: wrong location
  const job5: RawJob = { ...BASE_JOB, location_raw: "Miami, FL" };
  const r = runFilterPipeline(job5, BASE_COMPANY, FILTER_CONFIG, NOW);
  assert("Miami (not in test allowed_cities) — rejected by location", r.kept, false);
}
{
  // Tier 2: all filters pass, not tier 1 (not fresh enough, no city anchor)
  const job6: RawJob = {
    ...BASE_JOB,
    posted_date: daysAgo(15), // passes freshness but not tier-1 freshness
    location_raw: "Remote (US)", // passes location (is_remote, city=null)
    description: "0-2 years of experience preferred. Entry-level role.", // clear junior signal
    title: "Product Manager",
  };
  const companyNoProgram: Company = { ...BASE_COMPANY, has_apm_program: false };
  const r = runFilterPipeline(job6, companyNoProgram, FILTER_CONFIG, NOW);
  // posted_within_7_days=false, location_city=null → can't be tier 1
  // But posted_within_30d=true, yoe ok, PM title, is_remote=true → tier 2
  assert("remote PM 15d — tier 2 (not tier 1, not rejected)", r.tier, 2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// loadFilterConfig — reads real targets.json
// ═══════════════════════════════════════════════════════════════════════════════
section("loadFilterConfig (reads config/targets.json)");

{
  const cfg = loadFilterConfig();
  assert(
    "title_include_keywords is non-empty array",
    Array.isArray(cfg.title_include_keywords) && cfg.title_include_keywords.length > 0,
    true,
  );
  assert(
    "title_exclude_keywords is non-empty array",
    Array.isArray(cfg.title_exclude_keywords) && cfg.title_exclude_keywords.length > 0,
    true,
  );
  assert(
    "allowed_cities is non-empty",
    Array.isArray(cfg.location.allowed_cities) && cfg.location.allowed_cities.length > 0,
    true,
  );
  assert(
    "experience.reject_above_years = 3",
    cfg.experience.reject_above_years,
    3,
  );
  assert(
    "freshness.max_posting_age_days = 30",
    cfg.freshness.max_posting_age_days,
    30,
  );
  assert(
    "freshness.tier_1_max_age_days = 7",
    cfg.freshness.tier_1_max_age_days,
    7,
  );
  assert(
    "sponsorship.requires_sponsorship = false",
    cfg.sponsorship.requires_sponsorship,
    false,
  );
  assert(
    "compensation.min_base_salary_usd = null",
    cfg.compensation.min_base_salary_usd,
    null,
  );
  assert(
    "preferred_domains includes 'AI/ML'",
    cfg.preferred_domains.includes("AI/ML"),
    true,
  );
  // Quick smoke-test: pipeline works with the real config
  const realResult = runFilterPipeline(BASE_JOB, BASE_COMPANY, cfg, NOW);
  assert("pipeline with real config — kept", realResult.kept, true);
  assert("pipeline with real config — tier 1", realResult.tier, 1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(64)}`);
console.log(`  ${passed} passed   ${failed > 0 ? failed + " FAILED" : "0 failed"}`);
console.log(`${"═".repeat(64)}\n`);

if (failed > 0) process.exit(1);
