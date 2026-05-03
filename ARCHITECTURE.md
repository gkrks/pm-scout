# PM/APM Job Scanner — Architecture

## System Overview

Fully automated job discovery pipeline that scans 754 companies every hour for Product Manager and Associate Product Manager roles. Scrapes job boards, filters/ranks results, persists to multiple stores, and emails a digest of new matches.

```
GitHub Actions (hourly cron)
  -> Config (754 companies + filter rules + ATS routing)
    -> Orchestrator (two-pool concurrent scraper)
      -> 11 ATS Scrapers (API + Playwright)
        -> Filter Pipeline (6 filters + tier ranking)
          -> Local Diff (fingerprint-based dedup)
            -> Persistence (Supabase + Airtable + JSON buffers)
              -> Notifications (email + Telegram + health alerts)
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
8. [Local Diff & State](#8-local-diff--state)
9. [Storage Layer](#9-storage-layer)
10. [Notification System](#10-notification-system)
11. [People Finder](#11-people-finder)
12. [Blackout & Safety](#12-blackout--safety)
13. [Data Flow Diagram](#13-data-flow-diagram)
14. [Key Design Decisions](#14-key-design-decisions)

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

A standalone 5-stage pipeline: Scrape -> Extract -> Parse -> Match -> Report. Uses Claude API for requirement extraction and matching. Completely independent from the scanner.

### C. Utility Scripts — `scripts/`

| Script | Purpose |
|--------|---------|
| `syncCompanies.ts` | Seed/update Supabase `companies` table from `config/targets.json` |
| `discoverATS.js` | Probe unknown companies to detect their ATS platform |
| `replayPendingBuffer.ts` | Manually replay buffered Supabase writes |
| `clearDatabase.ts` | Reset Supabase state |

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
| **Workday** | `POST /wday/cxs/{tenant}/{site}/jobs` | Paginated; descriptions fetched separately; parses relative dates |
| **Amazon** | `GET /en/search.json?base_query=...` | Dual pass: main + university/early-career; dedup by ICIMS id |
| **SmartRecruiters** | Platform-specific REST | -- |
| **Workable** | Platform-specific REST | -- |
| **BambooHR** | Platform-specific REST | -- |

### Playwright-based scrapers (slow, 60s timeout)

| Scraper | Method | Notes |
|---------|--------|-------|
| **Google** | Headless Chromium | Scrolls 3x, extracts DOM cards, fetches descriptions in-session; no posting dates |
| **Meta** | GraphQL intercept | Captures `/graphql` response for `job_search_with_featured_jobs`; no posting dates |
| **Custom** | Configurable CSS selectors | Per-company selectors from `ats_routing.json`; supports scrollToLoad, waitForSelector |

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

Six filters run in order; first rejection stops the chain. Enrichment accumulates through all passing filters.

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

## 8. Local Diff & State

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

## 9. Storage Layer

**Source:** `src/storage/`

### Supabase (primary) — 5 tables

```
companies (754 rows)           <- seeded by syncCompanies.ts
    | FK: company_id
job_listings                   <- upserted by writeToSupabase()
    | FK: listing_id
listing_runs                   <- junction: which listings seen on which run
    | FK: run_id
parser_runs                    <- one row per scan execution

applications                   <- optional user tracker (listing_id FK)
```

**Schema:** `config/supabase_schema.sql`
**Migrations:** `migrations/` (incremental: upsert returning state, apm_signal column, backfill)

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

## 10. Notification System

**Source:** `src/notify/`

### Email Digest (`email.ts`)

- **Subject:** `[New PM/APM Roles] N new jobs found - May 2, 2026 . 2:00 PM PT`
- **Sort:** newest-first primary, tier as tiebreak
- **Sections:** APM Programs (purple) -> APM Companies (cyan) -> Tier 1 (green) -> Tier 2 (blue) -> Tier 3 (gray)
- **APM cards:** gradient background, pill badge ("APM PROGRAM" / "APM COMPANY"), thicker border, bolder title, box shadow
- **Standard cards:** tier-colored left border on gray background
- **Per-job card:** company, location, work type, posted-ago, experience, APM badge, tier label, apply button
- Sends via SMTP (Gmail app password)

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

## 11. People Finder

**Source:** `src/peopleFinder.ts` + `src/apolloClient.ts`

3-pass hiring intelligence pipeline (invoked separately, not part of hourly scan):

1. **Pass 1 - Groq LLaMA 3.1:** Extract JD signals (team, product area, seniority, keywords, org hypothesis). Generate search strategies for 3 personas.
2. **Pass 2 - Apollo API:** Parallel people searches. Return contacts with titles, LinkedIn URLs.
3. **Pass 3 - Groq LLaMA 3.1:** Categorize and score candidates (relevance 1-5, confidence 0-100, outreach suggestions for top HMs).

---

## 12. Blackout & Safety

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

## 13. Data Flow Diagram

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
   +------------+    +------+------+    +----------------+
                            |
              +-------------+------------------------+
              |  NOTIFICATIONS                       |
              |  +-- Email digest (rich HTML)        |
              |  |   APM: purple/cyan cards          |
              |  |   Standard: tier-colored cards    |
              |  |   Sorted: newest-first            |
              |  +-- Telegram digest (Markdown)      |
              |  +-- Health alerts                   |
              +--------------------------------------+
```

---

## 14. Key Design Decisions

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
| **Companies seeded separately** | `syncCompanies.ts` runs before each scan. job_listings FK to companies -- without seeding, all upserts fail. |

---

## Project Structure

```
src/
  index.ts                  CLI entrypoint (resume matcher)
  scheduler.ts              Top-level scan orchestration
  jobScraper.ts             Scraper dispatcher (1488 lines)
  jobStore.ts               Local fingerprint diff + persistence
  state.ts                  Job interface, AppState singleton
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

  notify/
    email.ts                Rich HTML email digest
    telegram.ts             Telegram bot digest
    digest.ts               Shared formatting helpers
    labels.ts               Company metadata + display helpers
    healthAlert.ts          Error/suspicious alerting
    healthState.ts          Per-company error history

  airtable/
    upsert.ts               Legacy Airtable upsert

  lib/
    blackout.ts             Blackout window check
    normalizeUrl.ts         URL normalization for dedup
    timeout.ts              Promise timeout wrapper

config/
  targets.json              754 company configs + filter rules
  ats_routing.json          ATS platform routing overrides
  supabase_schema.sql       Database schema (5 tables)

scripts/
  runScan.ts                Scan entry point (blackout + scheduler)
  syncCompanies.ts          Seed Supabase companies table
  discoverATS.js            ATS auto-detection probe
  replayPendingBuffer.ts    Manual Supabase buffer replay
  clearDatabase.ts          Reset Supabase state

migrations/
  2_upsert_returning_state.sql
  3_apm_signal_column.sql
  4_apm_signal_backfill.sql

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
| HTTP | `node-fetch` (CommonJS v2) |
| HTML parsing | `cheerio` |
| PDF parsing | `pdf-parse` |
| Browser automation | `playwright` (Chromium) |
| Database | Supabase (`@supabase/supabase-js`) |
| Legacy DB | Airtable (`airtable`) |
| Email | `nodemailer` (SMTP/Gmail) |
| CLI | `commander` |
| Terminal output | `chalk` v4 (CommonJS) |
| Validation | `zod` |
| Env | `dotenv` |
| CI/CD | GitHub Actions |

---

## Environment Variables

```
# AI
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...

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
SMTP_PASS=...          # Gmail App Password
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
SCAN_POOL=all          # all | api | playwright
```
