# PM Scout — Architecture

## System Overview

Fully automated job discovery pipeline that scans 754 companies every hour for Product Manager and Associate Product Manager roles. Scrapes job boards, filters/ranks results, extracts structured job data via a deterministic pipeline, persists to multiple stores, and sends a digest of new matches via email and Telegram. Also includes a web-based analytics dashboard, applications tracker, standalone tools for ATS-optimized resume generation, and a CLI resume-vs-JD matcher.

```
GitHub Actions (hourly cron)
  -> Config (754 companies + filter rules + ATS routing)
    -> Orchestrator (two-pool concurrent scraper)
      -> 11 ATS Scrapers (API + Playwright)
        -> Filter Pipeline (7 filters + tier ranking)
          -> JD Extraction (deterministic, no LLM)
            -> Local Diff (fingerprint-based dedup)
              -> Persistence (Supabase + Airtable + JSON buffers)
                -> Notifications (email + Telegram + health alerts)

Web UI (Express server, port 3847):
  -> /dashboard        — Analytics dashboard (35+ charts, Chart.js)
  -> /tracker          — Applications tracker (status, referrals, notes)
  -> /fit/:jobId       — Check Fit UI (score bullets -> select -> generate tailored resume)

Resume Tools:
  -> build_template.js (ATS-validated .docx/.pdf template)
  -> fill_resume.js (populate template from master_resume.json)
  -> CLI matcher (scrape JD -> extract requirements -> match against resume -> report)
  -> Qualification Map (Claude: cluster qualifications -> map resume bullets)
```

---

## Table of Contents

1. [Entry Points](#1-entry-points)
2. [Config System](#2-config-system)
3. [Scheduler](#3-scheduler)
4. [Orchestrator](#4-orchestrator)
5. [Scrapers](#5-scrapers)
6. [Filter Pipeline](#6-filter-pipeline)
7. [Ranking System](#7-ranking-system)
8. [JD Extraction](#8-jd-extraction)
9. [Local Diff & State](#9-local-diff--state)
10. [Storage Layer](#10-storage-layer)
11. [Notification System](#11-notification-system)
12. [Resume Tools](#12-resume-tools)
13. [Analytics Dashboard](#13-analytics-dashboard)
14. [Applications Tracker](#14-applications-tracker)
15. [People Finder](#15-people-finder)
16. [Blackout & Safety](#16-blackout--safety)
17. [Data Flow Diagram](#17-data-flow-diagram)
18. [Key Design Decisions](#18-key-design-decisions)

---

## 1. Entry Points

### A. Hourly Scan — `.github/workflows/scan.yml` -> `scripts/runScan.ts`

```
GitHub Actions cron (0 * * * *)
  -> npm ci + install Playwright
  -> Write .env from PM_JOBS secret
  -> npx ts-node scripts/syncCompanies.ts    <- seed companies table
  -> npx ts-node scripts/runScan.ts          <- main scan
```

`scripts/runScan.ts` does:
1. Check blackout window (5 PM-5 AM Pacific) — skip if active (unless `IGNORE_BLACKOUT=true`)
2. Build `runId` from `RUN_ID_GH` env or `Date.now()`
3. Call `runScanOnce(runId)` from `scheduler.ts`
4. Exit 0 on success/partial, 1 on fatal crash

### B. Resume Matcher CLI — `src/index.ts`

```bash
resume-matcher match --job <url> --resume <file> [--verbose]
```

A standalone 5-stage pipeline: Scrape -> Extract -> Parse -> Match -> Report. Uses Claude API for requirement extraction and matching. Completely independent from the scanner. See [Section 12](#12-resume-tools) for details.

### C. Web Server — `src/fit/server.ts`

```bash
npm run fit:serve
# Express on http://localhost:3847
```

Unified Express server hosting three web products:
- **Check Fit UI** — Token-gated resume tailoring per job listing
- **Analytics Dashboard** — 35+ Chart.js visualizations of pipeline data
- **Applications Tracker** — CRUD interface for tracking application status

Deployed on Railway (auto-detects `RAILWAY_ENVIRONMENT`). See sections [12C](#c-check-fit--resume-tailoring-web-ui), [13](#13-analytics-dashboard), [14](#14-applications-tracker) for details.

### D. Resume Generator Scripts (root)

| Script | Purpose |
|--------|---------|
| `build_template.js` | Generate ATS-validated `.docx` + `.pdf` template with `{{PLACEHOLDERS}}` |
| `fill_resume.js` | Populate template from `config/master_resume.json` -> `out/` |

### E. Utility Scripts — `scripts/`

| Script | Purpose |
|--------|---------|
| `syncCompanies.ts` | Seed/update Supabase `companies` table from `config/targets.json` |
| `discoverATS.js` | Probe unknown companies to detect their ATS platform |
| `extractOne.ts` | Extract structured JD from a single job URL |
| `extractSkills.ts` | Extract skills from a job description |
| `extractYoe.ts` | Extract YOE from a job description |
| `cleanQualifications.ts` | Normalize qualification strings |
| `backfillLocationCity.ts` | Backfill `location_city` from `location_raw` (deterministic) |
| `seedQualMapToSupabase.ts` | Persist qualification map JSON to Supabase |
| `replayPendingBuffer.ts` | Manually replay buffered Supabase writes |
| `clearDatabase.ts` | Reset Supabase state |
| `testAllCompanies.ts` | Integration test for all company scrapers |
| `testCustomPlaywright.ts` | Test custom Playwright scraper |
| `inferSelectors.js` | Infer CSS selectors for custom-playwright companies |
| `probeATS.js` | Probe unknown ATS platforms |

---

## 2. Config System

**Source:** `src/config/`

Three config files drive the entire system:

### `config/targets.json` (754 companies)

Each company entry has:

```
uuid, slug, name, category, careers_url, program_url,
has_apm_program, apm_program_name, apm_program_status,
domain_tags[], target_roles[], notes, content_hash
```

Plus a `filters` block:

```
title_include_keywords, title_exclude_keywords,
location (allowed_cities, city_aliases, accept_remote/hybrid/onsite),
experience (reject_above_years: 3),
freshness (max_posting_age_days: 30, tier_1_max_age_days: 7),
sponsorship, compensation, preferred_domains
```

### `config/ats_routing.json`

Maps company slugs to ATS platforms with host/tenant/site details. Used primarily for Workday (which needs tenant + site) and custom-playwright (which needs CSS selectors).

### ATS Resolution — 3-step priority (`src/config/targets.ts`)

1. **Explicit `ats` field** in company entry
2. **`SLUG_TO_ATS` hardcoded map** — 200+ companies (Greenhouse, Lever, Ashby, etc.)
3. **URL-based detection** via `detectAtsFromUrl()` — pattern matching on careers URL
4. **Routing config fallback** — `ats_routing.json` with `unmapped_default` (typically "manual")

`loadTargetsConfig()` validates via Zod schemas and returns:

```typescript
interface TargetsConfig {
  version: 1;
  defaults: { maxExperienceYears, locationFilter, dateCutoffDays };
  companies: CompanyConfig[];
}
```

---

## 3. Scheduler

**Source:** `src/scheduler.ts`

`runScanOnce(runId)` is the top-level orchestration function. It coordinates every phase:

```
runScanOnce(runId)
|
+-- PRE-SCAN HOUSEKEEPING
|   +-- sweepStaleRuns()          -> mark orphaned parser_runs as "failed"
|   +-- replayPendingBuffer()     -> retry buffered Supabase writes
|   +-- acquireLock(runId)        -> file lock prevents concurrent runs
|
+-- START PARSER RUN
|   +-- startParserRun()          -> insert row into parser_runs (status="running")
|
+-- ORCHESTRATE SCRAPE
|   +-- orchestrateRun(config)    -> two-pool concurrent scraper -> Job[]
|
+-- LOCAL DEDUP
|   +-- applyJobDiff(allJobs)     -> fingerprint-based diff against previous scans
|   +-- saveJobs(diffed)          -> persist to data/jobs.json
|
+-- AIRTABLE (legacy)
|   +-- upsertJobs(diffed, id)   -> SHA-1 fingerprint upsert
|   +-- markStaleJobs(7)         -> flag jobs older than 7 days
|
+-- SUPABASE WRITE               <- the one point where job_listings is populated
|   +-- buildCompanyMap(config)   -> name -> {id, slug, ...}
|   +-- writeToSupabase()         -> upsertCompanyListings() per company
|   |   +-- Pre-fetch existing (role_url -> {id, is_active})
|   |   +-- UPSERT batches of 50 on (company_id, role_url)
|   |   +-- Determine seen_state: new / existing / reactivated
|   |   +-- INSERT listing_runs entries
|   |   +-- deactivateUnseen() for successfully-scraped companies
|   +-- finalizeParserRun()       -> update parser_runs with counts
|   +-- ON FAILURE: bufferRun()   -> data/pending-supabase.json
|
+-- DETERMINE NOTIFICATION SET
|   +-- If Supabase succeeded: use seen_state='new' URLs (authoritative)
|   +-- If Supabase skipped/failed: use local diff (fallback)
|
+-- SEND NOTIFICATIONS
|   +-- sendEmailDigest()         -> rich HTML via SMTP
|   +-- sendTelegramDigest()      -> brief Markdown summary
|   +-- sendHealthAlert()         -> error/suspicious company report
|
+-- RELEASE LOCK
```

---

## 4. Orchestrator

**Source:** `src/orchestrator/`

### `runScan.ts` — Entry point

```typescript
orchestrateRun(config, opts?) -> Promise<OrchestratorResult>
```

1. Load 30-day baselines from Supabase (for suspicious detection)
2. Partition enabled companies into 3 buckets:
   - `manual` -> immediately marked "skipped" (no scraper)
   - `api` -> REST-based scrapers
   - `playwright` -> browser-based scrapers
3. Run API pool + Playwright pool **concurrently** via `Promise.all()`
4. Aggregate results: `{ jobs: Job[], companyResults: CompanyResult[], stats }`

### `pools.ts` — Worker pool executor

```typescript
runPool(companies, concurrency, budget, baselines, onResult) -> Promise<void>
```

**Concurrency limits:**

| Pool | Concurrent Workers | Per-Company Timeout |
|------|--------------------|---------------------|
| API | 12 | 15s (Greenhouse/Lever/Ashby), 25s (Workday) |
| Playwright | 3 | 60s |

**Worker pattern:** shared mutable queue (safe in single-threaded JS). N workers pull companies as they finish — not pre-assigned.

**Per-company flow:**

1. Check `budget.hasRoomFor(timeoutMs)` — if no room, mark "skipped-budget"
2. Call `scrapeCompanyByConfig(company)` via `scrapeWithRetry()`
3. On success: check if 0 results + baseline >= 3 -> mark "suspicious" (not "ok")
4. On failure: classify error -> retry once if retryable -> report result
5. Cap at 200 jobs per company (guard against misconfigured queries)

### `classify.ts` — Error classification + retry policy

```typescript
classifyError(err) -> ErrorInfo { type, message, httpStatus? }
```

| Error Type | Retry? | Backoff |
|------------|--------|---------|
| `timeout` | Yes (1x) | 5s |
| `http-429` | Yes (1x) | 10s |
| `network` (ECONNRESET, etc.) | Yes (1x) | 2s |
| `http-4xx` (401/403/404) | No | -- |
| `error` (other) | Yes (1x) | 2s |

**Company status values:**

```typescript
type CompanyStatus = "ok" | "suspicious" | "timeout" | "error" | "skipped" | "skipped-budget"
```

### `budget.ts` — Run budget enforcement

```typescript
class RunBudget(budgetMs = 9 * 60_000)  // 9 minutes
  .hasRoomFor(perCompanyTimeoutMs) -> boolean
```

Before each company dequeue: check if `elapsed + timeout < budget`. Prevents exceeding the 12-minute GitHub Actions hard kill.

### `lock.ts` — Concurrency guard

File-based lock in `/tmp` prevents overlapping scan runs.

---

## 5. Scrapers

**Source:** `src/scrapers/` + `src/jobScraper.ts`

### Scraper Registry (`src/scrapers/index.ts`)

```typescript
SCRAPER_REGISTRY: {
  "greenhouse":          greenhouseScraper,
  "lever":               leverScraper,
  "ashby":               ashbyScraper,
  "workday":             workdayScraper,
  "amazon":              amazonScraper,
  "smartrecruiters":     smartRecruitersScraper,
  "workable":            workableScraper,
  "bamboohr":            bambooHRScraper,
  "google-playwright":   googlePlaywrightScraper,
  "meta-playwright":     metaPlaywrightScraper,
  "custom-playwright":   customPlaywrightScraper,
}
```

### API-based scrapers (fast, 12-25s timeout)

| Scraper | Endpoint | Notes |
|---------|----------|-------|
| **Greenhouse** | `GET /v1/boards/{slug}/jobs?content=true` | Descriptions inline; uses `first_published` for date |
| **Lever** | `GET /v0/postings/{slug}?mode=json` | `createdAt` is epoch ms |
| **Ashby** | `GET /posting-api/job-board/{slug}` | Handles both `jobs` and `jobPostings` response fields |
| **Workday** | `POST /wday/cxs/{tenant}/{site}/jobs` | Paginated; descriptions fetched inline (5 concurrent per company); parses relative dates ("Posted 3 Days Ago" -> ISO); fallback: retries without `searchText` if rejected |
| **Amazon** | `GET /en/search.json?base_query=...` | Dual pass: main + university/early-career; dedup by ICIMS id |
| **SmartRecruiters** | Platform-specific REST | -- |
| **Workable** | Platform-specific REST | -- |
| **BambooHR** | Platform-specific REST | -- |

### Playwright-based scrapers (slow, 60s timeout)

| Scraper | Method | Notes |
|---------|--------|-------|
| **Google** | Headless Chromium | Scrolls 3x, extracts DOM cards, fetches descriptions in-session; no posting dates |
| **Meta** | GraphQL intercept | Captures `/graphql` response for `job_search_with_featured_jobs`; no posting dates |
| **Custom** | Configurable CSS selectors | Per-company selectors from `ats_routing.json`; supports scrollToLoad, waitForSelector; generic fallback for companies without selectors |

### `jobScraper.ts` — Scraper dispatcher

`scrapeCompanyByConfig(company)` is the main dispatcher:

1. Resolve ATS type from company config
2. Dispatch to the correct scraper
3. Apply inline filters: `isPmRole()`, `isUsLocation()`, `passesExperienceFilter()`
4. Build `Job` objects with enrichment (workType, earlyCareer, etc.)

**Shared helpers:**

- `isPmRoleForConfig(title, roles)` — per-company role allow-list + global include/exclude
- `isEarlyCareer(title, description)` — regex for APM/entry-level/new grad
- `workTypeFrom(location)` — infers Remote/Hybrid/Onsite
- `fetchWithTimeout(url)` — 15s fetch with User-Agent header
- `withPlaywright(fn)` — serializer ensuring one browser instance at a time

---

## 6. Filter Pipeline

**Source:** `src/filters/`

Seven filters run in order; first rejection stops the chain (tier ranking never rejects). Enrichment accumulates through all passing filters.

```typescript
runFilterPipeline(rawJob, company, filterConfig, runStartedAt) -> PipelineResult
```

### Two-phase design (optimization)

- **Pre-description** (`runPreDescriptionFilters`): title + location + freshness — cheap, no HTTP needed
- **Post-description** (full pipeline): experience + sponsorship + salary — requires job description text

This avoids fetching descriptions for jobs that would be rejected by title/location alone.

### Filter chain

| # | Filter | Rejects when | Enriches |
|---|--------|--------------|----------|
| 1 | **Title** | Title doesn't match include keywords or matches exclude keywords | -- |
| 2 | **Location** | Not in allowed cities, not remote-US, not hybrid | `location_city`, `is_remote`, `is_hybrid` |
| 3 | **Freshness** | Posted > 30 days ago | `freshness_confidence`, `posted_within_7_days`, `posted_within_30_days` |
| 4 | **Experience** | Description requires > 3 years | `yoe_min`, `yoe_max`, `yoe_raw`, `experience_confidence`, `is_new_grad_language` |
| 5 | **Sponsorship** | Config requires sponsorship but JD says "no sponsorship" | `sponsorship_offered`, `requires_sponsorship_unclear` |
| 6 | **Salary** | Below `min_base_salary_usd` threshold | `salary_min`, `salary_max`, `salary_currency` |
| 7 | **Tier** (never rejects) | -- | `tier: 1|2|3`, `domainBoosted` |

### Result type

```typescript
interface PipelineResult {
  kept: boolean;
  tier: 1 | 2 | 3 | null;
  enrichment: JobEnrichment;    // 15+ fields accumulated from all filters
  rejectedBy?: string;          // which filter killed it
  rejectionReason?: string;
  domainBoosted: boolean;
}
```

---

## 7. Ranking System

**Source:** `src/ranking/`

### Tier Assignment (`tier.ts`)

Never rejects — labels only for sorting/display.

| Tier | Label | Criteria |
|------|-------|----------|
| **1** | "Apply today" | Priority APM role, OR: posted <=7d + YOE <=2 + physical city match |
| **2** | "Apply this week" | Posted <=30d + YOE <=3 + location match (including remote) |
| **3** | "Review convenient" | Everything else that passed filters |

### APM Signal Detection (`apmSignal.ts`)

```typescript
detectApmSignal(input) -> "priority_apm" | "apm_company" | "none"
```

| Signal | Meaning | Criteria |
|--------|---------|----------|
| `priority_apm` | This IS the APM program posting | Title matches APM patterns + company has active program |
| `apm_company` | Company has APM program but this isn't it | Company flagged but title doesn't match |
| `none` | No APM relevance | -- |

**APM title patterns:** `/\bAPM\b/i`, `/\bassociate\s+product\s+manager\b/i`, `/\brotational/i`, `/\bnew\s+grad\s+program\b/i`

---

## 8. JD Extraction

**Source:** `src/jdExtractor.ts` + `src/lib/headingAliases.ts` + `src/types/extractedJD.ts`

Fully deterministic pipeline that extracts structured job data from raw HTML or text — no LLM calls on the primary path. Groq LLM is used only as a fallback to classify truly unrecognized headings.

### Two-phase architecture

**Phase 1 — Section Splitting** (`parseSections()` / `parseSectionsFromText()`):
1. Parse HTML into heading-based sections using `<h1>`-`<h6>` tags + `<strong>` tag heuristics
2. Classify each heading into a canonical bucket via `classifyHeading()` -> `HeadingBucket`
3. Fallback for plain text: detect ALL-CAPS lines, colon-suffixed headers, bullet patterns, dash-underlined lines

**Phase 2 — Field Extraction**:
1. Regex-based extraction for: location (cities/states/remote), employment type, education, compensation, work authorization, benefits, logistics
2. Skill matching via curated keyword lists: `TECHNICAL_SKILLS`, `TOOLS`, `METHODOLOGIES`, `SOFT_SKILLS`, `DOMAIN_EXPERTISE`, `CERTIFICATIONS`
3. Confidence scoring: `meaningful sections found + unknown heading count -> "high" | "medium" | "low"`

### Heading Classification (`headingAliases.ts`)

Maps 196 heading aliases -> 11 canonical buckets:

| Bucket | Examples |
|--------|----------|
| `required_qualifications` | "minimum qualifications", "what you need", "must have" |
| `preferred_qualifications` | "nice to have", "bonus points", "preferred experience" |
| `responsibilities` | "what you'll do", "key responsibilities", "the role" |
| `role_summary` | "about the role", "overview", "position summary" |
| `team_info` | "about the team", "who we are" |
| `company_info` | "about us", "our mission" |
| `benefits` | "perks", "what we offer" |
| `compensation` | "salary", "pay range", "total rewards" |
| `application` | "how to apply", "next steps" |
| `legal` | "equal opportunity", "eeo statement" |
| `unknown` | Unrecognized headings (LLM fallback) |

### ExtractedJD Output Schema (`extractedJD.ts`)

Zod-validated structure written to the `job_listings.extracted_jd` JSONB column:

```typescript
{
  job_title, company_name,
  location: { raw, cities[], states[], countries[], is_remote, is_hybrid, ... },
  employment: { type, seniority_level, is_people_manager, is_early_career, team_size, duration_months },
  experience: { years_min, years_max, is_new_grad_friendly, domains_required[] },
  education: { minimum_degree, preferred_degree, fields_of_study[], accepts_equivalent_experience },
  required_qualifications[], preferred_qualifications[], responsibilities[],
  skills: { technical[], tools[], methodologies[], soft[], languages[], domain_expertise[] },
  certifications: { required[], preferred[] },
  compensation: { base_salary_min, base_salary_max, currency, equity_offered, bonus, sign_on_bonus },
  work_authorization: { sponsorship_available, security_clearance, citizenship_required },
  benefits: { health, dental, vision, retirement_401k, pto_days, unlimited_pto, parental_leave_weeks, ... },
  logistics: { travel_percentage, on_call },
  application: { deadline, process_steps[], recruiter_name, cover_letter_required, portfolio_required },
  ats_keywords: { high_priority[], medium_priority[], low_priority[], acronyms[], buzzwords[] },
  extraction_meta: { schema_version, confidence, source_ats, source_url, missing_sections[], extraction_notes[] }
}
```

---

## 9. Local Diff & State

**Source:** `src/jobStore.ts` + `src/state.ts`

### Fingerprinting

```
fingerprint = SHA-1( normalize(company) | normalize(title) | normalize(location) )[0:16]
```

URL is excluded because Google/Meta URLs are session-specific and change between scans.

### `applyJobDiff(jobs)` flow

1. Load persistent store from `data/jobStore.json` (fingerprint -> `{firstSeenAt, lastSeenAt}`)
2. For each incoming job: compute fingerprint
   - **New**: set `firstSeenAt = now`, `isNew = true` (if posted within 3 days)
   - **Seen before**: reuse `firstSeenAt`, update `lastSeenAt`, `isNew = false`
3. Save updated store
4. Return jobs with `firstSeenAt`/`isNew` populated

### Job interface (`state.ts`)

```typescript
interface Job {
  // Core fields (always present)
  id: string;                    // {company}-{externalId}
  company: string;
  title: string;
  location: string;
  workType: string;              // "Remote" | "Hybrid" | "Onsite" | "-"
  datePosted: string;            // "YYYY-MM-DD" or "-"
  applyUrl: string;
  careersUrl: string;
  earlyCareer: boolean;
  description: string;           // raw HTML

  // Enrichment from filter pipeline
  tier?: "T0" | "T1" | "T2" | "T3" | "T3R";
  pmTier?: 1 | 2 | 3;
  apmSignal?: "priority_apm" | "apm_company" | "none";
  category?: string;
  domainTags?: string[];
  sponsorshipOffered?: boolean | null;

  // Scan diffing (set by jobStore.applyJobDiff)
  firstSeenAt?: string;
  isNew?: boolean;

  // Scoring (set by matcher)
  matchScore?: number;
  requirements?: MatchResult[];
  summary?: RequirementsSummary;
  resumeAction?: string;         // "apply_as_is" | "tailor_then_apply" | "skip"
  scoredWith?: string;           // "generic" | "uploaded"

  sourceLabel?: string;
}
```

### AppState singleton

- `jobs: Job[]` — current scan results
- `status: ScanStatus` — live progress (`state: "idle"|"scanning"|"scoring"|"done"`, progress counters)
- `resume: ResumeState` — for matcher CLI
- `applications: Record<string, ApplicationRecord>` — user's application tracker

---

## 10. Storage Layer

**Source:** `src/storage/`

### Supabase (primary) — 6 tables

```
companies (754 rows)           <- seeded by syncCompanies.ts
    | FK: company_id
job_listings                   <- upserted by writeToSupabase()
    | FK: listing_id
listing_runs                   <- junction: which listings seen on which run
    | FK: run_id
parser_runs                    <- one row per scan execution

applications                   <- user application tracker (listing_id FK)
    | status: not_started/researching/applied/phone_screen/interviewing/offer/rejected/withdrawn
    | email_used, is_referral, referrer_name

qualification_map_quals        <- qualification -> bullet mappings (embedding-based)
```

**Schema:** `config/supabase_schema.sql`

**Migrations (10 total):** `migrations/`
| # | Migration | Purpose |
|---|-----------|---------|
| 2 | `upsert_returning_state.sql` | Upsert returning seen state |
| 3 | `apm_signal_column.sql` | Add APM signal column |
| 4 | `apm_signal_backfill.sql` | Backfill APM signal data |
| 5 | `extracted_jd_column.sql` | Add extracted JD JSONB column |
| 6 | `ats_platform_column.sql` | Add ATS platform tracking |
| 7 | `jd_extracted_skills.sql` | Add extracted skills columns |
| 8 | `applications_applied_by.sql` | Add applied_by to applications |
| 9 | `fit_score_cache.sql` | Cache fit scores |
| 10 | `qualification_map.sql` | Qualification map table |
| 11 | `tracker_columns.sql` | Phone screen status + tracker columns |

**Upsert key:** `(company_id, role_url)` — normalized via `normalizeRoleUrl()`

**Seen state determination:** pre-fetch existing -> after upsert cross-reference:
- absent -> `new`
- was `is_active=false` -> `reactivated`
- else -> `existing`

**Deactivation:** after each company, set `is_active=false` for listings not seen in this run

**Batching:** 50 rows per DB call, max 4 concurrent calls

### Airtable (legacy)

**Source:** `src/airtable/upsert.ts`

SHA-1 fingerprint dedup, rate-limited (5 req/s), with retry and pending buffer fallback.

### JSON buffers (crash recovery)

| File | Purpose |
|------|---------|
| `data/pending-supabase.json` | Buffered when Supabase write fails; replayed next run |
| `data/pending-airtable.json` | Same for Airtable |
| `data/jobs.json` | Full Job[] list |
| `data/jobStore.json` | Fingerprint -> {firstSeenAt, lastSeenAt} |
| `data/health-state.json` | Per-company error history across runs |

---

## 11. Notification System

**Source:** `src/notify/`

### Email Digest (`email.ts`)

- **Subject:** `[New PM/APM Roles] N new jobs found — May 2, 2026 · 2:00 PM PT` (includes APM count if any)
- **Sort:** strict newest-first by posted date (fallback to firstSeenAt). No tier grouping.
- **Three sections:**
  1. New roles — newest first (all standard jobs, sorted by recency)
  2. APM Program roles (jobs with `apmSignal === "priority_apm"` — purple gradient cards, pill badge)
  3. APM Company roles (jobs with `apmSignal === "apm_company"` — cyan gradient cards)
- **APM cards:** gradient background, thick colored border, pill badges ("APM PROGRAM" / "APM COMPANY"), box shadow
- **Standard cards:** muted grey border, grey tier label
- **"NEW" badge:** for jobs posted today
- **Per-job card:** company, location, work type, posted-ago, experience, APM badge, apply button
- **Footer links:** Dashboard + Tracker URLs included in every digest
- Sends via SMTP (Gmail app password)
- HTML + plaintext versions with consistent structure

### Telegram Digest (`telegram.ts`)

MarkdownV2 messages split at 4000 chars. Grouped by company within each tier section.

### Health Alerts (`healthAlert.ts` + `healthState.ts`)

- Flags repeated failures per company (>2 consecutive errors)
- Alerts on suspicious 0-result returns (baseline >= 3)
- Tracks error history across runs in `data/health-state.json`

### Labels (`labels.ts`)

- Company category -> short label (e.g., "AI Labs & Foundation Model Companies" -> "AI Labs")
- `formatPostedAgo()`: "Today" / "2d ago (Apr 29)" / "2w ago"
- `formatLocation()`: "Remote US" / "SF (Hybrid)" / "NYC"
- `activeApmProgram()`: returns program name if active, null otherwise

---

## 12. Resume Tools

### A. ATS-Validated Resume Generator (standalone scripts)

Two standalone Node.js scripts produce ATS-optimized resumes without any external binary dependencies:

**`build_template.js`** — Generates a placeholder-driven template:
- Output: `config/Resume_Template.docx` + `.pdf`
- Uses `docx-js` for OOXML generation, `pdfkit` for PDF
- ATS-optimized layout: Calibri 10pt, 0.65" margins, paragraph borders (no tables)
- Proper bullet numbering config (not literal characters)
- Tab-stopped right-aligned dates
- Placeholders: `{{FULL_NAME}}`, `{{SUMMARY}}`, `{{EXP_1_TITLE}}`, etc.

**`fill_resume.js`** — Populates template with real data:
- Input: `config/master_resume.json` (structured resume: contact, summary, experience, projects, skills)
- Output: `out/Resume_<Name>.docx` + `.pdf`
- Selects longest bullets from each role to maximize content density
- Sorts skills alphabetically within categories

**Character budgets enforced:**

| Element | Max chars |
|---------|-----------|
| Contact line | 90 |
| Summary | 340 |
| Experience header (left) | 75 |
| Date column (right) | 22 |
| Bullet point | 155 |
| Skills line | 110 |

**Layout:** 4 experiences x 2 bullets, 2 projects x 2 bullets, 3 skill categories — fits one page.

### B. CLI Resume Matcher (`src/index.ts`)

Standalone 5-stage pipeline (independent from the scanner):

```
scraper.ts -> extractor.ts -> parser.ts -> matcher.ts -> reporter.ts
```

1. **Scrape** (`scraper.ts`): Fetch job page, extract requirement sections using heading patterns
2. **Extract** (`extractor.ts`): Claude API parses raw text -> atomic requirement phrases (5-15 words)
3. **Parse** (`parser.ts`): Parse resume PDF/text -> structured `ResumeData` (sections, work entries with dates)
4. **Match** (`matcher.ts`): Claude API matches each requirement against resume (parallel, <=10 concurrent, semaphore-capped)
5. **Report** (`reporter.ts`): Chalk terminal report + `match-report.json`

```bash
npm run match -- --job <url> --resume <file> [--verbose]
```

### C. Check Fit — Resume Tailoring Web UI (`src/fit/`)

Express-based web application that lets users tailor their resume to a specific job listing. Token-gated access, server-rendered pages, and integration with a Python scoring service.

**Entry:** `src/fit/server.ts` — Express on port `FIT_PORT` (default 3847)

**Routes:**

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/fit/:jobId` | Token-gated, server-rendered Fit page |
| `POST` | `/fit/:jobId/score` | Proxy to Python `/score` — retrieve bullet scores |
| `POST` | `/fit/:jobId/select` | Proxy to Python `/select` — apply user selections |
| `POST` | `/fit/:jobId/generate` | Compose payload -> regen summary -> call `fill_resume.js` |
| `GET` | `/fit/:jobId/download/pdf` | Stream generated PDF |
| `GET` | `/fit/:jobId/download/docx` | Stream generated DOCX |

**Generation flow** (`generateResume.ts`):

1. Accept bullet selections from UI
2. Load `config/master_resume.json`
3. Apply dynamic 4+2 source selection (based on scores)
4. Map selected bullets to template slots
5. Regenerate professional summary via Claude (`summaryGenerator.ts`)
6. Optimize skills section via Claude (`skillsOptimizer.ts`)
7. Shell out to `fill_resume.js --input <path> --out-basename <name>`
8. Return PDF + DOCX file paths in `out/`

**AI-powered helpers:**

| Module | Purpose |
|--------|---------|
| `summaryGenerator.ts` | Claude: generate 3 summary candidates, pick best match for JD |
| `skillsOptimizer.ts` | Claude: reorder/optimize skills section for ATS keyword density |
| `coverLetterGenerator.ts` | Claude: generate tailored cover letter from resume bullets + JD |

**Python scoring service** (`ats_bullet_selector/`):

Separate Python process (default `http://127.0.0.1:8001`) that scores resume bullets against job qualifications using `text-embedding-3-large`. Handles type-routed scoring for education, years-of-experience, and skills qualifications.

### D. Qualification Map (`src/qualificationMap.ts` + `src/storage/updateQualMap.ts`)

Two-tier system for mapping qualifications to resume bullets:

**Batch generation** (`qualificationMap.ts`):
1. Fetch all qualifications from `job_listings` (required + preferred)
2. Deduplicate exact strings
3. Load master resume bullets
4. Call Claude to group qualifications into 15-30 semantic clusters, extract ATS keywords per cluster, and map relevant resume bullets by ID
5. Write output to `ats_bullet_selector/outputs/qualification_map.json`

**Incremental updates** (`storage/updateQualMap.ts`):
1. After each scan, identify qualification texts not yet in the map
2. Embed them via OpenAI `text-embedding-3-large`
3. Rank top-5 resume bullets by cosine similarity
4. Assign each to the best-matching semantic group
5. Upsert rows into `qualification_map_quals` in Supabase
6. Cost: ~$0.001 per scan for ~20 new quals

### E. Inline LLM Extractors (`src/storage/`)

Three LLM-powered extractors that enrich job listings during the Supabase write phase:

| Module | Purpose |
|--------|---------|
| `extractSkillsInline.ts` | Extract technical/soft skills from job descriptions |
| `extractYoeInline.ts` | Extract years-of-experience requirements from descriptions |
| `cleanQualsInline.ts` | Normalize and deduplicate qualification strings |

---

## 13. Analytics Dashboard

**Source:** `src/fit/dashboard.ts` + `src/fit/dashboardClient.js` + `src/fit/dashboardRender.ts`

Full-featured analytics dashboard accessible at `GET /dashboard?token=xxx&from=YYYY-MM-DD&to=YYYY-MM-DD`.

### Data Pipeline

1. Fetches 5 parallel Supabase queries: job_listings, applications, parser_runs, listing_runs, companies
2. Aggregates server-side into 35+ chart datasets
3. Renders Chart.js-powered page with server-rendered HTML shell

### Dashboard Sections (11 categories)

| Section | Charts/Metrics |
|---------|---------------|
| **KPIs** | Total discovered, active, applied count, interview rate, avg fit score, application rate, avg YOE |
| **Pipeline funnel** | Status counts (not_started -> applied -> phone_screen -> interviewing -> offer/rejected) |
| **Discovery trends** | Discovered per week, applied vs discovered per week, applications per week |
| **Skills demand** | Top skills across listings, skills gap treemap, most reused resume bullets |
| **Geography** | Location distribution, work type breakdown (remote/hybrid/onsite) |
| **Companies** | Top hiring companies, ATS platform distribution |
| **Timing** | Application response time, days-to-first-action |
| **Fit scores** | Fit score vs outcome correlation, score distribution |
| **Stale opportunities** | Active listings with no action, aging analysis |
| **Pipeline mechanics** | Filter rejection reasons, scraper success rates |
| **Improvement trends** | Week-over-week application quality, response rates |

### Frontend

- **Chart.js** with treemap plugin for visualizations
- **Dark/light theme** with localStorage persistence
- **Color palette:** Vibrant neon (cyan, green, amber, pink, purple)
- **Responsive layout:** CSS grid with card-based sections
- Token-gated (uses `DASHBOARD_TOKEN` env var)

---

## 14. Applications Tracker

**Source:** `src/fit/tracker.ts` + `src/fit/trackerClient.js` + `src/fit/trackerRender.ts`

CRUD interface for tracking job application status.

### Routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/tracker` | Render tracker page |
| `GET` | `/tracker/api/applications` | JSON list of all applications |
| `PATCH` | `/tracker/api/applications/:id` | Update application fields |

### Data Model (applications table)

```
id, listing_id (FK -> job_listings),
status: not_started | researching | applied | phone_screen | interviewing | offer | rejected | withdrawn,
applied_date, applied_by (email_used),
is_referral, referrer_name, referral_contact,
notes, created_at, updated_at
```

### Features

- Inline-editable status dropdown (no page reload)
- Referral tracking (boolean flag + contact name)
- Notes field per application
- Sorted by applied_date descending
- Joins with job_listings + companies for display (title, company, location)
- Token-gated (same `DASHBOARD_TOKEN` as dashboard)

---

## 15. People Finder

**Source:** `src/peopleFinder.ts` + `src/apolloClient.ts`

3-pass hiring intelligence pipeline (invoked separately, not part of hourly scan):

1. **Pass 1 - Groq LLaMA 3.1:** Extract JD signals (team, product area, seniority, keywords, org hypothesis). Generate search strategies for 3 personas.
2. **Pass 2 - Apollo API:** Parallel people searches. Return contacts with titles, LinkedIn URLs.
3. **Pass 3 - Groq LLaMA 3.1:** Categorize and score candidates (relevance 1-5, confidence 0-100, outreach suggestions for top HMs).

---

## 16. Blackout & Safety

**Source:** `src/lib/`

### Blackout window (`blackout.ts`)

- Default: 5 PM -> 5 AM Pacific (configurable via env)
- `scripts/runScan.ts` checks `isInBlackout()` before proceeding
- `IGNORE_BLACKOUT=true` bypasses (used for manual workflow_dispatch)

### URL normalization (`normalizeUrl.ts`)

Strips tracking params (UTM, gh_src, lever-source), forces HTTPS, lowercase hostname, sort remaining params, drop fragment. Ensures `(company_id, role_url)` uniqueness is stable.

### Timeout wrapper (`lib/timeout.ts`)

`withTimeout(promise, ms)` — rejects with descriptive error if promise doesn't resolve in time.

---

## 17. Data Flow Diagram

```
+------------------------------------------------------------------+
|  GitHub Actions (hourly) / manual trigger                        |
|  scripts/runScan.ts                                              |
|    +-- Blackout check (5PM-5AM PT)                               |
|    +-- scheduler.ts::runScanOnce(runId)                          |
+-------------------------------+----------------------------------+
                                |
              +-----------------+------------------+
              |  PRE-SCAN HOUSEKEEPING             |
              |  +-- sweepStaleRuns()              |
              |  +-- replayPendingBuffer()         |
              |  +-- acquireLock()                 |
              +-----------------+------------------+
                                |
              +-----------------+------------------+
              |  CONFIG LOADING                    |
              |  +-- targets.json (754 companies)  |
              |  +-- ats_routing.json              |
              |  +-- filterConfig (filter rules)   |
              +-----------------+------------------+
                                |
              +-----------------+------------------+
              |  ORCHESTRATOR                      |
              |  +-- Load 30-day baselines         |
              |  +-- Partition: manual/API/PW      |
              |  +-- RunBudget(9 min)              |
              +--------+----------------+----------+
                       |                |
            +----------+---+    +-------+----------+
            |  API Pool    |    |  Playwright Pool  |
            |  12 workers  |    |  3 workers        |
            |  15-25s/co   |    |  60s/co           |
            +------+-------+    +-------+----------+
                   |                    |
                   |  Per company:      |
                   |  1. Budget check   |
                   |  2. Scrape (ATS)   |
                   |  3. Retry (1x)     |
                   |  4. Suspicious?    |
                   +---------+----------+
                             |
              +--------------+-----------------------+
              |  INLINE FILTERS (in jobScraper.ts)   |
              |  +-- isPmRole(title)                 |
              |  +-- isUsLocation(location)          |
              |  +-- passesExperienceFilter(desc)    |
              +--------------+-----------------------+
                             |  Job[]
              +--------------+-----------------------+
              |  JD EXTRACTION (jdExtractor.ts)      |
              |  +-- parseSections() (heading-based) |
              |  +-- classifyHeading() (196 aliases) |
              |  +-- regex field extraction          |
              |  +-- skill keyword matching          |
              |  -> ExtractedJD (Zod-validated)      |
              +--------------+-----------------------+
                             |
              +--------------+-----------------------+
              |  LOCAL DIFF (jobStore.ts)             |
              |  +-- SHA-1 fingerprint               |
              |  +-- Mark isNew / firstSeenAt        |
              |  +-- Save data/jobs.json             |
              +--------------+-----------------------+
                             |
          +------------------+---------------------+
          |                  |                     |
   +------+-----+    +------+------+    +---------+------+
   | Airtable   |    | Supabase    |    | JSON buffers   |
   | (legacy)   |    | (primary)   |    | (fallback)     |
   |            |    |             |    |                |
   | upsert     |    | companies   |    | pending-       |
   | Jobs       |    | job_listings|    | supabase.json  |
   | mark       |    | listing_runs|    | pending-       |
   | Stale      |    | parser_runs |    | airtable.json  |
   +------------+    | applications|    +----------------+
                     | qual_map    |
                     +------+------+
                            |
              +-------------+------------------------+
              |  NOTIFICATIONS                       |
              |  +-- Email digest (rich HTML)        |
              |  |   Sorted: strict newest-first     |
              |  |   APM: purple/cyan gradient cards |
              |  |   Standard: muted grey cards      |
              |  |   Footer: Dashboard + Tracker     |
              |  +-- Telegram digest (Markdown)      |
              |  +-- Health alerts                   |
              +--------------------------------------+

+------------------------------------------------------------------+
|  WEB SERVER (Express, port 3847, deployed on Railway)            |
|                                                                  |
|  /dashboard?token=xxx                                            |
|    -> 5 parallel Supabase queries                                |
|    -> Server-side aggregation (35+ chart datasets)               |
|    -> Chart.js + treemap (dark/light theme)                      |
|                                                                  |
|  /tracker?token=xxx                                              |
|    -> applications + job_listings + companies join               |
|    -> Inline-editable status, referral tracking, notes           |
|                                                                  |
|  /fit/:jobId?token=xxx (Check Fit — Resume Tailoring)            |
|    -> POST /score -> Python scorer (text-embedding-3-large)      |
|      -> User selects bullets in UI                               |
|        -> POST /generate                                         |
|          -> Claude: regen summary + optimize skills              |
|          -> fill_resume.js -> out/ (PDF + DOCX)                 |
|            -> GET /download/pdf or /download/docx                |
+------------------------------------------------------------------+
```

---

## 18. Key Design Decisions

| Decision | Why |
|----------|-----|
| **Two-pool architecture** | API scrapers (fast, cheap) shouldn't be blocked by Playwright (slow, 1 browser). 12 vs 3 concurrency. |
| **9-minute budget** | GitHub Actions has 12-min hard kill. Budget leaves 3 min for post-scrape work (dedup, persist, notify). |
| **Pre-description filters** | Title/location/freshness don't need JD text. Avoids hundreds of unnecessary HTTP calls per scan. |
| **Fingerprint without URL** | Google/Meta URLs are session-specific. SHA-1(company\|title\|location) is stable across scans. |
| **Suspicious detection** | 0 results from a company that normally has 3+ listings means ATS breakage, not "no jobs". Flagged, not silently accepted. |
| **Triple persistence** | Supabase (authoritative) + Airtable (legacy) + JSON buffers (crash recovery). No data loss even during outages. |
| **Pending buffer replay** | If Supabase fails, results are serialized to JSON and automatically replayed at the start of the next run. |
| **Normalized URLs** | Strip tracking params, force HTTPS, sort query params. Prevents duplicate listings from URL variants. |
| **APM signal system** | Differentiates the actual APM program posting (`priority_apm`) from other PM roles at APM companies (`apm_company`). Drives tier-1 ranking + distinct email styling. |
| **Companies seeded separately** | `syncCompanies.ts` runs before each scan. job_listings FK to companies — without seeding, all upserts fail. |
| **Deterministic JD extraction** | Regex + keyword matching instead of LLM calls. Faster, cheaper, reproducible. LLM only used as fallback for unrecognized headings. |
| **Inline Workday JD fetch** | Descriptions fetched during scrape (5 concurrent) instead of deferred. Eliminates a separate pass and simplifies the pipeline. |
| **Flat email digest (no tiers)** | Strict newest-first sort replaced tier grouping. APM roles get their own sections with distinct visual treatment. Simpler for the reader. |
| **ATS-validated resume generation** | Pure Node.js (docx-js + pdfkit) — no LibreOffice or external binary. Character budgets enforce one-page fit. |
| **Token-gated web UI** | Check Fit + Dashboard + Tracker all require tokens — prevents unauthorized access. Python scorer runs as a separate process for isolation. |
| **Qualification clustering** | Claude groups raw qualifications into semantic clusters with ATS keywords, enabling the Python scorer to match bullets by meaning rather than exact text. |
| **Incremental qual map updates** | New qualifications are embedded and mapped incrementally per scan (~$0.001/run) rather than regenerating the full map. |
| **Unified Express server** | Dashboard, tracker, and Check Fit share one server process — simplifies deployment on Railway with a single port. |
| **Server-side chart aggregation** | Dashboard queries are aggregated server-side to avoid shipping raw data to the client. Only chart-ready datasets are sent. |
| **Railway deployment** | Auto-detects Railway environment. Uses `PORT` env var from Railway, falls back to `FIT_PORT` for local dev. |

---

## Project Structure

```
src/
  index.ts                  CLI entrypoint (resume matcher)
  scheduler.ts              Top-level scan orchestration
  jobScraper.ts             Scraper dispatcher
  jobStore.ts               Local fingerprint diff + persistence
  state.ts                  Job interface, AppState singleton
  jdExtractor.ts            Deterministic JD extraction (no LLM primary path)
  qualificationMap.ts       Claude: group qualifications -> semantic clusters
  scraper.ts                Job page scraper (for resume matcher)
  extractor.ts              Claude-based requirement extraction
  parser.ts                 Resume PDF/text parser
  matcher.ts                Claude-based requirement matching
  reporter.ts               Chalk terminal report + JSON output
  peopleFinder.ts           3-pass hiring intelligence pipeline
  apolloClient.ts           Apollo API client
  companyDetector.ts        ATS auto-detection for unknown companies
  companies.ts              Company slug mappings
  customCompanies.ts        User-added custom companies
  pdfUtil.ts                PDF parsing utilities

  config/
    targets.ts              Config loader + Zod validation
    filterConfig.ts         Filter config loader
    loadRouting.ts          ATS routing resolver

  scrapers/
    index.ts                Scraper registry
    types.ts                RawJob, ScrapeResult, Scraper interfaces
    greenhouse.ts           Greenhouse API scraper
    lever.ts                Lever API scraper
    ashby.ts                Ashby API scraper
    workday.ts              Workday API scraper
    amazon.ts               Amazon Jobs API scraper
    smartrecruiters.ts      SmartRecruiters API scraper
    workable.ts             Workable API scraper
    bamboohr.ts             BambooHR API scraper
    googlePlaywright.ts     Google Careers Playwright scraper
    metaPlaywright.ts       Meta Careers Playwright scraper
    customPlaywright.ts     Generic CSS-selector Playwright scraper
    playwright.ts           Shared Playwright utilities

  orchestrator/
    runScan.ts              Two-pool orchestration entry point
    pools.ts                Concurrent worker pool executor
    classify.ts             Error classification + retry policy
    budget.ts               Run budget enforcement (9 min)
    lock.ts                 File-based concurrency lock

  filters/
    pipeline.ts             Filter pipeline runner
    types.ts                FilterConfig, JobEnrichment, PipelineResult
    title.ts                Title keyword include/exclude
    location.ts             City matching, remote/hybrid classification
    freshness.ts            Posting age check
    experience.ts           YOE extraction from description
    sponsorship.ts          Visa sponsorship detection
    salary.ts               Salary extraction

  ranking/
    tier.ts                 Tier 1/2/3 assignment
    apmSignal.ts            APM program signal detection

  storage/
    supabase.ts             Singleton Supabase client
    upsertListing.ts        Job listings upsert + listing_runs
    parserRuns.ts           Parser run tracking
    deactivateUnseen.ts     Mark stale listings inactive
    pendingBuffer.ts        JSON buffer for Supabase outages
    updateQualMap.ts        Incremental qualification map updater (embeddings)
    extractSkillsInline.ts  LLM: extract skills from descriptions
    extractYoeInline.ts     LLM: extract YOE from descriptions
    cleanQualsInline.ts     LLM: normalize qualifications

  notify/
    email.ts                Rich HTML email digest
    telegram.ts             Telegram bot digest
    digest.ts               Shared formatting helpers
    labels.ts               Company metadata + display helpers
    healthAlert.ts          Error/suspicious alerting
    healthState.ts          Per-company error history

  fit/
    server.ts               Express server (port 3847) + all routes
    generateResume.ts       Bullet selection -> fill_resume.js
    render.ts               Server-render Fit page (token-gated)
    skillsOptimizer.ts      Claude: optimize skills section
    summaryGenerator.ts     Claude: generate professional summary
    coverLetterGenerator.ts Claude: tailored cover letters
    types.ts                Zod schemas for scoring/selection
    slug.ts                 Filename slug generator
    client.js               Check Fit frontend JS
    dashboard.ts            Analytics dashboard route handler + aggregation
    dashboardClient.js      Dashboard frontend JS (Chart.js)
    dashboardRender.ts      Dashboard server-side HTML rendering
    tracker.ts              Applications tracker route handlers
    trackerClient.js        Tracker frontend JS
    trackerRender.ts        Tracker server-side HTML rendering

  airtable/
    upsert.ts               Legacy Airtable upsert

  types/
    extractedJD.ts          Zod schema for ExtractedJD

  lib/
    blackout.ts             Blackout window check
    normalizeUrl.ts         URL normalization for dedup
    headingAliases.ts       196 heading aliases -> 11 canonical buckets
    skillsList.ts           Curated skill/tool/methodology keyword lists
    htmlToText.ts           HTML -> plain text converter
    timeout.ts              Promise timeout wrapper

  __tests__/
    jdExtractor.test.ts     JD extraction tests

  fit/__tests__/
    fill-resume-flags.test.ts
    slug.test.ts
    token.test.ts

config/
  targets.json              754 company configs + filter rules
  ats_routing.json          ATS platform routing overrides
  supabase_schema.sql       Database schema (6 tables)
  master_resume.json        Structured resume data (for fill_resume.js)
  Resume_Template.docx      Generated ATS-validated template
  Resume_Template.pdf       PDF version of template

ats_bullet_selector/        Python scoring service for resume tailoring
  server.py                 Flask-based HTTP service (port 8001)
  src/ats_bullet_selector/
    assign.py               Bullet assignment logic
    classify.py             Qualification type classification
    cli.py                  CLI interface
    config.py               Configuration
    db.py                   Database access
    judge.py                Scoring judgment
    map_lookup.py           Qualification map lookup
    models.py               Scoring models (text-embedding-3-large)
    normalize.py            Text normalization
    report.py               Score reporting
    resolve.py              Resolution logic
    retrieve.py             Bullet retrieval
    score.py                Embedding-based scoring
  outputs/
    qualification_map.json  Qualification clusters -> bullet mappings
  tests/                    Python test suite
  pyproject.toml            Python project config
  requirements.txt          Python dependencies

build_template.js           ATS-validated resume template generator (docx + pdf)
fill_resume.js              Populate template from master_resume.json (docx + pdf)

scripts/
  runScan.ts                Scan entry point (blackout + scheduler)
  syncCompanies.ts          Seed Supabase companies table
  discoverATS.js            ATS auto-detection probe
  probeATS.js               Probe unknown ATS platforms
  inferSelectors.js         Infer CSS selectors for custom-playwright
  extractOne.ts             Extract JD from a single job URL
  extractSkills.ts          Extract skills from JD
  extractYoe.ts             Extract YOE from JD
  cleanQualifications.ts    Normalize qualifications
  backfillLocationCity.ts   Backfill location_city from location_raw
  seedQualMapToSupabase.ts  Persist qualification map to Supabase
  replayPendingBuffer.ts    Manual Supabase buffer replay
  clearDatabase.ts          Reset Supabase state
  testAllCompanies.ts       Integration test for all scrapers
  testCustomPlaywright.ts   Test custom Playwright scraper

migrations/                 Incremental SQL schema migrations (11 total)

docs/                       Design documents and test reports

out/                        Generated resume output (PDF + DOCX)

data/                       Runtime data (gitignored)
  jobs.json                 Current job list
  jobStore.json             Fingerprint store
  health-state.json         Error history
  pending-supabase.json     Supabase write buffer
  pending-airtable.json     Airtable write buffer

.github/workflows/
  scan.yml                  Hourly GitHub Actions cron
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (Node.js 20+) |
| Build | `tsc` -> `dist/`, dev via `ts-node` |
| AI | Claude API (`@anthropic-ai/sdk`), Groq LLaMA 3.1 (`groq-sdk`) |
| Embeddings | OpenAI `text-embedding-3-large` (Python scorer + qual map) |
| HTTP | `node-fetch` (CommonJS v2) |
| HTML parsing | `cheerio` |
| PDF parsing | `pdf-parse` |
| Browser automation | `playwright` (Chromium) |
| Database | Supabase (`@supabase/supabase-js`) |
| Legacy DB | Airtable (`airtable`) |
| Web server | Express (port 3847) |
| Charts | Chart.js + chartjs-chart-treemap |
| Resume generation | `docx` (docx-js), `pdfkit` |
| Email | `nodemailer` (SMTP/Gmail) |
| CLI | `commander` |
| Terminal output | `chalk` v4 (CommonJS) |
| Validation | `zod` |
| Env | `dotenv` |
| Testing | Jest |
| CI/CD | GitHub Actions (hourly cron) |
| Deployment | Railway |
| Python service | Flask, OpenAI SDK, numpy |

---

## Environment Variables

```
# AI
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...
OPENAI_KEY=...              # For text-embedding-3-large in Python scorer

# People finder
APOLLO_API_KEY=...

# Database
SUPABASE_URL=https://....supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Email notifications
NOTIFY_EMAIL_DIGEST=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=...
SMTP_PASS=...               # Gmail App Password
EMAIL_FROM=...
EMAIL_TO=...

# Telegram notifications
NOTIFY_TELEGRAM_DIGEST=true
NOTIFY_TELEGRAM_HEALTH=true
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# Display
DISPLAY_TIMEZONE=America/Los_Angeles

# Blackout
BLACKOUT_TIMEZONE=America/Los_Angeles
BLACKOUT_START_HOUR=17
BLACKOUT_END_HOUR=5

# Scan control
IGNORE_BLACKOUT=false
SCAN_POOL=all               # all | api | playwright

# Web server (unified)
PORT=3847                   # Railway sets this automatically
FIT_PORT=3847               # Fallback for local dev
FIT_TOKEN_SECRET=...        # HMAC secret for Check Fit token generation
FIT_BASE_URL=https://pm-scout.example.com
DASHBOARD_TOKEN=...         # Token for dashboard + tracker access
BULLET_SELECTOR_URL=http://127.0.0.1:8001
```
