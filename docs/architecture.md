# PM Scout — Architecture

## System Overview

PM Scout is a job search automation pipeline that discovers PM/APM roles across 754 companies, scores resume fit, and generates tailored application materials. The system is composed of three products sharing a single codebase:

| Product | Runtime | Trigger |
|---------|---------|---------|
| Hourly Job Scanner | GitHub Actions | Cron (hourly, 5 AM–9 PM PDT) or `workflow_dispatch` |
| CLI Resume Matcher | Local terminal | Manual (`npm run match`) |
| Check Fit Web UI | Railway (Express) | User clicks "Check Fit" link in email digest |

---

## High-Level Architecture

```
                         ┌────────────────────────────┐
                         │    GitHub Actions (cron)    │
                         └────────────┬───────────────┘
                                      │
                                      ▼
                      ┌──────────────────────────────┐
                      │     scheduler.ts              │
                      │     runScanOnce()             │
                      └──────┬───────────┬────────────┘
                             │           │
                    ┌────────▼───┐  ┌────▼─────────┐
                    │  API Pool  │  │   PW Pool    │
                    │ 12 workers │  │  6 workers   │
                    │ 8 scrapers │  │  3 scrapers  │
                    └────────┬───┘  └────┬─────────┘
                             │           │
                             ▼           ▼
                      ┌──────────────────────────────┐
                      │  7-filter pipeline + ranking  │
                      │  JD extraction (deterministic) │
                      └──────────────┬────────────────┘
                                     │
                    ┌────────────────┼─────────────────┐
                    │                │                  │
                    ▼                ▼                  ▼
              ┌──────────┐   ┌────────────┐    ┌─────────────┐
              │ Supabase │   │  Airtable  │    │   Notify    │
              │ (primary)│   │  (legacy)  │    │ Email + TG  │
              └──────────┘   └────────────┘    └──────┬──────┘
                                                      │
                                          "Check Fit" HMAC link
                                                      │
                                                      ▼
                                            ┌──────────────────┐
                                            │  Express :3847   │
                                            │  fit/server.ts   │
                                            └────────┬─────────┘
                                                     │
                                        ┌────────────┼────────────┐
                                        │            │            │
                                        ▼            ▼            ▼
                                  ┌──────────┐ ┌──────────┐ ┌──────────┐
                                  │  Python  │ │  GPT-4o  │ │fill_     │
                                  │  :8001   │ │ summary  │ │resume.js │
                                  │ ILP/rank │ │ + skills │ │ PDF/DOCX │
                                  └──────────┘ └──────────┘ └──────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (Node.js 20+), Python 3.11+ |
| Build | `tsc` → `dist/`, dev via `ts-node` |
| AI — Scoring | OpenAI GPT-4.1 (re-rank), GPT-4o-mini (extraction), `text-embedding-3-large` (embeddings) |
| AI — Generation | Claude Opus 4.6 (qual map, hooks), Claude Sonnet (insights), GPT-4o (summaries) |
| AI — Legacy | Groq LLaMA 3.1 (CLI matcher) |
| HTTP | `node-fetch` (CommonJS v2) |
| HTML parsing | `cheerio` |
| PDF parsing | `pdf-parse` |
| Browser | Playwright (Chromium) |
| Database | Supabase (PostgreSQL) |
| Legacy DB | Airtable |
| Web server | Express |
| Resume output | `docx` (docx-js), `pdfkit` |
| Email | `nodemailer` (Gmail SMTP) |
| Python service | FastAPI, PuLP (ILP), sentence-transformers, Pydantic v2, structlog |
| CLI | `commander`, `chalk` v4 |
| Validation | `zod` (TS), Pydantic v2 (Python) |
| CI/CD | GitHub Actions |
| Deployment | Railway |

---

## Project Structure

```
src/
├── index.ts                    CLI entrypoint (Commander)
├── scheduler.ts                Top-level scan orchestration
├── jobScraper.ts               Scraper dispatcher + inline filters
├── jobStore.ts                 Local fingerprint diff + persistence
├── state.ts                    Job interface + AppState singleton
├── jdExtractor.ts              Deterministic JD extraction (no LLM)
├── qualificationMap.ts         Claude: full qual map regeneration
│
├── config/
│   ├── targets.ts              Load + validate targets.json (Zod)
│   ├── loadRouting.ts          Resolve ats_routing.json
│   └── filterConfig.ts         Build filter config from targets
│
├── scrapers/                   11 ATS platform scrapers
│   ├── index.ts                SCRAPER_REGISTRY
│   ├── types.ts                RawJob, ScrapeResult, Scraper interfaces
│   ├── greenhouse.ts           Greenhouse API
│   ├── lever.ts                Lever API
│   ├── ashby.ts                Ashby API
│   ├── workday.ts              Workday API (paginated)
│   ├── amazon.ts               Amazon Jobs API (dual pass)
│   ├── smartrecruiters.ts      SmartRecruiters API
│   ├── workable.ts             Workable API
│   ├── bamboohr.ts             BambooHR API
│   ├── googlePlaywright.ts     Google Careers (Chromium)
│   ├── metaPlaywright.ts       Meta Careers (GraphQL intercept)
│   ├── customPlaywright.ts     Generic CSS-selector scraper
│   └── playwright.ts           Shared Playwright utilities
│
├── orchestrator/               Two-pool concurrent execution
│   ├── runScan.ts              Partition → pools → aggregate
│   ├── pools.ts                Worker pool (API 12x, PW 6x)
│   ├── budget.ts               9-minute run budget enforcement
│   ├── classify.ts             Error classification + retry policy
│   └── lock.ts                 File-based concurrency guard
│
├── filters/                    7-filter pipeline
│   ├── pipeline.ts             Filter orchestration
│   ├── types.ts                FilterConfig, JobEnrichment
│   ├── title.ts                Title keyword include/exclude
│   ├── location.ts             City matching, remote/hybrid
│   ├── freshness.ts            Posting age check
│   ├── experience.ts           YOE extraction
│   ├── sponsorship.ts          Visa sponsorship detection
│   └── salary.ts               Salary extraction
│
├── ranking/
│   ├── tier.ts                 Tier 1/2/3 assignment
│   └── apmSignal.ts            APM program signal detection
│
├── storage/                    Supabase persistence
│   ├── supabase.ts             Singleton client
│   ├── upsertListing.ts        Batch upsert (50 rows/call)
│   ├── updateQualMap.ts        Incremental qual map embeddings
│   ├── deactivateUnseen.ts     Mark stale listings inactive
│   ├── pendingBuffer.ts        JSON buffer for outages
│   ├── parserRuns.ts           Per-run metadata tracking
│   ├── extractSkillsInline.ts  GPT-4o-mini: extract skills
│   ├── extractYoeInline.ts     GPT-4o-mini: extract YOE
│   ├── extractQualsInline.ts   GPT-4o-mini: extract qualifications
│   └── cleanQualsInline.ts     GPT-4o-mini: normalize quals
│
├── notify/
│   ├── email.ts                Rich HTML email digest (SMTP)
│   ├── telegram.ts             Telegram bot digest (MarkdownV2)
│   ├── digest.ts               Shared message builders
│   ├── labels.ts               Company metadata + display helpers
│   ├── healthAlert.ts          Error/suspicious alerting
│   └── healthState.ts          Per-company error history
│
├── fit/                        Phase 3: Resume tailoring web UI
│   ├── server.ts               Express routes (15+ endpoints)
│   ├── render.ts               Server-render Fit page (HMAC-gated)
│   ├── generateResume.ts       Bullet selection → fill_resume.js
│   ├── summaryGenerator.ts     GPT-4o: 3 summary candidates
│   ├── skillsOptimizer.ts      JD-aware skills section
│   ├── coverLetterGenerator.ts Claude: tailored cover letters
│   ├── bulletRewriter.ts       Rewrite bullets to match JD
│   ├── claimExtractor.ts       Extract factual claims from bullets
│   ├── truthfulnessGate.ts     Validate rewritten bullet accuracy
│   ├── jdKeywordExtractor.ts   Must-have/nice-to-have JD keywords
│   ├── types.ts                Zod schemas for scoring/selection
│   ├── slug.ts                 Filename slug generator
│   ├── client.js               Frontend JavaScript
│   ├── submitUrl.ts            Process ad-hoc job URL → fit link
│   ├── submitUrlRender.ts      Submit URL page render
│   ├── tracker.ts              Application tracker CRUD
│   ├── trackerRender.ts        Tracker HTML render
│   ├── dashboard.ts            Analytics dashboard logic
│   ├── dashboardRender.ts      Dashboard HTML render
│   │
│   ├── hook/                   Outreach hook discovery
│   │   ├── finder.ts           findHook() — skip if specificity < 7/10
│   │   ├── retriever.ts        Match (insight, intel) candidate pairs
│   │   └── synthesizer.ts      Claude Opus: score hook specificity
│   │
│   ├── insights/               Personal project insights
│   │   ├── fetcher.ts          Fetch content from project URLs
│   │   ├── extractor.ts        Claude Sonnet: structured 5-category insights
│   │   └── reviewCli.ts        CLI for reviewing extracted insights
│   │
│   ├── intel/                  Company intelligence
│   │   ├── feedDiscovery.ts    Discover RSS/Atom feeds for domains
│   │   ├── rssFetcher.ts       Fetch + process RSS → intel_chunks
│   │   └── orchestrator.ts     refreshCompanyIntel() — 7-day cache, circuit breaker
│   │
│   └── outreach/               Unified outreach composer
│       ├── types.ts            OutreachMode enum (4 modes)
│       ├── bodyWriter.ts       LLM-generated outreach body
│       ├── personalizationLine.ts  Person-specific opener
│       └── composer.ts         composeOutreach() — mode routing
│
├── airtable/
│   └── upsert.ts              Legacy Airtable sync (SHA-1 fingerprint)
│
├── lib/
│   ├── blackout.ts            Blackout window check (5 PM–5 AM PT)
│   ├── normalizeUrl.ts        URL normalization for dedup
│   ├── headingAliases.ts      196 heading aliases → 11 canonical buckets
│   ├── skillsList.ts          Curated skill/tool keyword lists
│   ├── htmlToText.ts          HTML → plain text converter
│   └── timeout.ts             Promise timeout wrapper
│
├── types/
│   └── extractedJD.ts         Zod schema for ExtractedJD (150+ fields)
│
├── # Legacy CLI matcher (standalone)
├── scraper.ts                 Fetch job page, extract sections
├── extractor.ts               Groq: raw text → atomic requirements
├── parser.ts                  Parse resume PDF/text
├── matcher.ts                 Groq: match requirements vs resume
└── reporter.ts                Chalk report + match-report.json

ats_bullet_selector/           Python FastAPI microservice (:8001)
├── server.py                  FastAPI app + routes
└── src/ats_bullet_selector/
    ├── models.py              Pydantic v2 data models
    ├── config.py              Constants, LLM config, ILP params
    ├── db.py                  Supabase REST queries
    ├── map_lookup.py          Qualification map + embed/rerank engine
    ├── assign.py              ILP solver (PuLP/CBC)
    ├── classify.py            Qualification type routing
    ├── resolve.py             Deterministic education/YOE/skill resolution
    ├── retrieve.py            Local sentence-transformer retrieval (fallback)
    ├── embed_voyage.py        Voyage AI contextual embeddings
    ├── score.py               Sub-score computation
    ├── normalize.py           Keyword overlap scoring
    ├── keyword_carry.py       Bullet → JD keyword mapping
    ├── role_profile.py        Role profile loading
    ├── report.py              JSON scoring report output
    ├── judge.py               LLM judge (legacy, bypassed)
    ├── cli.py                 ats-select CLI entry point
    └── scripts/
        ├── regen_qualification_map.py
        └── validate.py

config/
├── targets.json               754 company configs (source of truth)
├── ats_routing.json           Slug → ATS platform routing
├── master_resume.json         Structured resume data
├── supabase_schema.sql        Database schema
├── insight_sources.json       Personal project URLs
└── Resume_Template.docx/.pdf  ATS resume templates

scripts/                       27 utility scripts
├── runScan.ts                 Scan entry point
├── syncCompanies.ts           Seed companies → Supabase
├── extractOne.ts              Single-URL JD extraction
├── replayPendingBuffer.ts     Replay buffered Supabase writes
├── refreshIntel.ts            Refresh company RSS intel
├── runInsightsExtraction.ts   Extract personal project insights
├── cleanQualifications.ts     Clean qual strings in DB
├── seedQualMapToSupabase.ts   Seed qual map to Supabase
├── discoverATS.js             ATS auto-detection probe
├── probeATS.js                ATS connectivity test
└── ...                        (backfill, test, migration scripts)

migrations/                    15 sequential Supabase SQL migrations

build_template.js              ATS-validated .docx/.pdf template generator
fill_resume.js                 Populate template from resume JSON → PDF + DOCX
```

---

## Data Flow 1: Hourly Job Scanner

```
GitHub Actions cron (hourly 5 AM–9 PM PDT)
  └─ scripts/runScan.ts
       └─ scheduler.ts:runScanOnce()
            │
            ├── 1. Startup
            │   ├── sweepStaleRuns()        — mark orphaned parser_runs as failed
            │   ├── replayPendingBuffer()   — retry failed Supabase writes
            │   └── syncCompaniesToSupabase() — upsert targets.json → companies table
            │
            ├── 2. Orchestrated Scraping (orchestrator/runScan.ts)
            │   ├── Load baselines (30-day active counts per company)
            │   ├── Partition companies: manual → skip, API → pool 1, PW → pool 2
            │   └── Promise.all([
            │         runPool(API,  concurrency=12, timeout=15–25s),
            │         runPool(PW,   concurrency=6,  timeout=45–60s)
            │       ])
            │       Each worker: scrapeCompanyByConfig() → SCRAPER_REGISTRY[ats].scrape()
            │       Retry: network→2s, 429→10s, PW crash→5s; max 1 retry
            │       Suspicious flag: baseline≥3 but 0 results returned
            │
            ├── 3. JD Extraction (concurrency 3, deterministic)
            │   └── extractJD() for each new listing
            │       ├── HTML → sections by heading tags
            │       ├── classifyHeading() → 11 canonical buckets
            │       └── Regex extractors: location, salary, YOE, education, skills, etc.
            │       (No LLM invoked on the primary path)
            │
            ├── 4. Persistence
            │   ├── Airtable upsert (legacy, buffered on failure)
            │   └── writeToSupabase()
            │       ├── upsertCompanyListings() — batch 50, onConflict: company_id+role_url
            │       │   seen_state: new | reactivated | existing
            │       ├── For new listings only:
            │       │   ├── cleanQualsForNewListings()    (GPT-4o-mini)
            │       │   ├── extractQualsForNewListings()  (GPT-4o-mini, fills empty quals)
            │       │   ├── extractSkillsForNewListings() (GPT-4o-mini)
            │       │   └── extractYoeForNewListings()    (GPT-4o-mini)
            │       ├── deactivateUnseen() — set is_active=false for stale listings
            │       └── updateQualMapIncremental()
            │           ├── Embed new quals (text-embedding-3-large)
            │           ├── Cosine rank against bullet embeddings
            │           ├── Upsert → qualification_map_quals
            │           └── POST /map/refresh → Python service cache invalidation
            │
            ├── 5. Notifications (filtered: yoe_min ≤ 3 or NULL)
            │   ├── Telegram: tier-grouped MarkdownV2, 4k char chunks
            │   ├── Email: HTML cards with APM badges, "Check Fit" HMAC links
            │   └── Health alert: suspicious/error companies → separate TG channel
            │
            └── 6. Cleanup
                ├── finalizeParserRun()
                └── releaseLock()
```

### Key Constraints
- **9-minute budget** — leaves 3 min buffer before GitHub Actions 12-min hard kill
- **Fingerprint dedup** — SHA-1(company|title|location); URL excluded (session-specific for Google/Meta)
- **Pre-description filtering** — title/location/freshness checked before fetching JD text
- **Pending buffer** — failed Supabase writes buffered to `data/pending-supabase.json` for next-run replay
- **Blackout window** — 5 PM–5 AM Pacific, skippable via `IGNORE_BLACKOUT=true` or `workflow_dispatch`

---

## Data Flow 2: Check Fit Resume Tailoring

```
User clicks "Check Fit" in email digest
  │
  ▼
GET /fit/:jobId?token=HMAC
  ├── Verify HMAC-SHA256(FIT_TOKEN_SECRET, jobId).slice(0,32)
  ├── Load listing from Supabase (quals, context, skills)
  ├── splitCompoundQualifications()
  └── renderFitPage() — server-side HTML

POST /fit/:jobId/score
  │
  ├── Python service POST :8001/score
  │   ├── load_job_listing() from Supabase REST
  │   ├── extract_qualifications() → Qualification[]
  │   ├── load_master_resume() from Supabase (JSON fallback)
  │   ├── classify_qualifications() → routing categories:
  │   │   education_check | experience_years | skill_check |
  │   │   values_statement | bullet_match
  │   ├── Pre-resolve (deterministic, no LLM):
  │   │   ├── education → degree level check
  │   │   ├── experience_years → total months check
  │   │   └── skill_check → resume skills lookup
  │   ├── rank_all_from_map() for bullet_match quals:
  │   │   ├── Map hits: SHA256(qual)[:12] → instant top-3 (0 API calls)
  │   │   └── Map misses: batch embed (1 call) + GPT-4.1 rerank (ceil(N/4) calls)
  │   └── solve_assignment() ILP (PuLP/CBC):
  │       ├── Maximize total match score
  │       ├── Constraints: basic quals covered, per-source cap (3), global cap (12)
  │       └── Fallback: all-soft if infeasible
  │
  ├── generateSummaryCandidates() — GPT-4o, 3 candidates, 9 constraint rules
  ├── optimizeSkills() — best 3 categories, JD gap fill
  └── Cache → fit_score_cache (Supabase, keyed on listing_id)

POST /fit/:jobId/select (optional)
  └── Python /select — validate user bullet overrides against source caps

POST /fit/:jobId/generate
  ├── loadMasterResume() from Supabase
  ├── Resolve selections → bullet text + source ID
  ├── Dynamic 4+2 source selection:
  │   ├── Top 4 experiences (by selected bullet count)
  │   └── Top 2 projects (by selected bullet count)
  ├── Summary: user override or regenerateSummary() (GPT-4o)
  ├── Skills: optimizeSkills() with user edits applied
  ├── Write working_resume.json
  └── execSync fill_resume.js → .docx + .pdf

GET /fit/:jobId/download/:format
  └── Stream generated file (PDF or DOCX)
```

### Additional Fit Routes

| Route | Purpose |
|-------|---------|
| `GET /fit/new` | Submit arbitrary job URL form |
| `POST /fit/submit-url` | Scrape URL → extract JD → upsert → redirect to fit page |
| `POST /fit/:jobId/apply` | Mark job as applied in `applications` table |
| `POST /fit/:jobId/cover-letter` | Generate cover letter (GPT-4o) + DOCX |
| `POST /fit/:jobId/outreach` | Unified outreach: cover letter, LinkedIn referral, hiring manager |
| `POST /fit/:jobId/intel/refresh` | Refresh company RSS/blog intel (7-day cache) |
| `GET /dashboard` | Analytics dashboard |
| `GET /tracker` | Application tracker |

---

## Data Flow 3: Outreach Generation

```
POST /fit/:jobId/outreach
  │
  ├── findHook() — discover a company-specific conversation hook
  │   ├── retrieveCandidatePairs()
  │   │   ├── master_insights (personal project insights, Claude Sonnet-extracted)
  │   │   └── intel_chunks (company RSS/blog, 7-day cached)
  │   ├── synthesizeHooks() — Claude Opus scores specificity (1-10)
  │   └── Skip if best hook < 7/10 specificity
  │
  ├── composeOutreach() — route by mode:
  │   ├── cover_letter          → formal, 2 paragraphs
  │   ├── linkedin_referral_peer → casual, short
  │   ├── linkedin_referral_open → warm intro request
  │   └── linkedin_hiring_manager → direct pitch
  │
  ├── writeBody() — LLM-generated outreach body
  ├── composePersonalizationLine() — person-specific opener (if person intel provided)
  └── Assemble: hook + body + signature
```

---

## Data Flow 4: Qualification Map Lifecycle

The qualification map bridges the scan pipeline and the fit pipeline, pre-computing bullet rankings for fast scoring.

```
Full Regeneration (manual, periodic):
  src/qualificationMap.ts
    ├── Fetch all active quals from Supabase
    ├── Deduplicate
    ├── Load master resume bullets
    ├── Claude Opus 4.6: group into 15–30 semantic clusters
    └── Write qualification_map.json
  scripts/seedQualMapToSupabase.ts
    └── Upsert → qualification_map_meta + qualification_map_quals

Incremental Update (automatic, post-scan):
  storage/updateQualMap.ts
    ├── Find new quals not in existing hash set
    ├── Embed via text-embedding-3-large
    ├── Cosine rank against bullet embeddings
    ├── Assign to semantic group by keyword heuristic
    ├── Upsert → qualification_map_quals
    └── POST /map/refresh → Python service cache invalidation

Python Service Loading (on-demand):
  map_lookup.py
    ├── First request: load from Supabase REST (paginated)
    ├── Fallback: local qualification_map.json
    ├── Cache in-memory
    └── POST /map/refresh → clear cache, re-fetch next request
```

---

## Database Schema (Supabase)

Key tables (15 migrations):

| Table | Purpose |
|-------|---------|
| `companies` | Company metadata from targets.json |
| `job_listings` | Active/inactive job listings with extracted JD fields |
| `parser_runs` | Per-scan run metadata (status, counts, duration) |
| `listing_runs` | Junction: which listings appeared in which run |
| `applications` | Application status tracking |
| `fit_score_cache` | Cached scoring results per listing |
| `qualification_map_meta` | Semantic cluster metadata |
| `qualification_map_quals` | Per-qual → bullet rankings with embeddings |
| `master_resume` | Structured resume data (bullets, experiences, projects) |
| `master_insights` | Personal project insights (5-category, Claude-extracted) |
| `company_intel` | Company intelligence metadata |
| `intel_sources` | RSS/Atom feed URLs per company |
| `intel_chunks` | Processed RSS content chunks |
| `jd_extracted_skills` | Extracted skills per listing |
| `scrape_failures` | Scraper error tracking |

---

## External Service Dependencies

| Service | Used For | Cost Driver |
|---------|----------|-------------|
| **Supabase** | Primary DB (PostgreSQL) | Storage + API calls |
| **OpenAI GPT-4o** | Summary generation, regeneration | Per-resume generation |
| **OpenAI GPT-4o-mini** | Skills/YOE/quals extraction (post-scan) | ~$0.0002/listing |
| **OpenAI GPT-4.1** | Re-ranking map misses in Python service | Per-miss batch |
| **OpenAI text-embedding-3-large** | Qual + bullet embeddings | Incremental post-scan |
| **Claude Opus 4.6** | Qual map generation, hook synthesis | Manual + per-outreach |
| **Claude Sonnet** | Personal project insights extraction | One-time per project |
| **Groq LLaMA 3.1** | CLI matcher (legacy) | Per-match run |
| **Voyage AI** | Optional contextual bullet embeddings | Fallback path |
| **Airtable** | Legacy job sync | Per-upsert |
| **Telegram Bot API** | Digest + health alerts | Per-notification |
| **Gmail SMTP** | Email digests | Per-email |
| **Playwright/Chromium** | Google, Meta, custom site scrapers | Per-scan (3 pool slots) |
| **Railway** | Fit server deployment | Always-on |

---

## Concurrency Model

### Scan Pipeline
- **API pool**: 12 concurrent workers, 15–25s timeout per company
- **Playwright pool**: 6 concurrent workers, 45–60s timeout per company
- Both pools run in parallel via `Promise.all`
- JD extraction: concurrency 3
- Supabase upsert: 4 concurrent DB calls max, batches of 50 rows
- **Run budget**: 9 minutes hard ceiling (3 min buffer before GitHub Actions 12-min kill)

### Fit Server
- Express single-process, async I/O
- Python service: FastAPI single-process (or gunicorn), CPU-bound ILP solving
- Generated files: in-memory map with 24h TTL, swept hourly

### Retry Policy
| Error Type | Retries | Backoff |
|-----------|---------|---------|
| Network / 5xx | 1 | 2s |
| 429 Rate Limit | 1 | 10s |
| Playwright crash | 1 | 5s |
| 4xx / Parse error | 0 | — |

---

## Security

- **Fit page access**: HMAC-SHA256 token verification (`FIT_TOKEN_SECRET`)
- **Supabase**: Service role key (server-side only)
- **Gmail**: App Password (not OAuth)
- **API keys**: All in `.env`, never committed
- **No user auth**: Single-user system, token-gated links

---

## Deployment

| Component | Platform | Config |
|-----------|----------|--------|
| Scanner | GitHub Actions | `.github/workflows/scan.yml`, hourly cron |
| Fit server | Railway | `render.yaml`, `nixpacks.toml`, port from `$PORT` |
| Python service | Co-located with Fit server | FastAPI on `:8001` |
| Database | Supabase | Managed PostgreSQL |

---

## Phase Roadmap

| Phase | Name | Status |
|-------|------|--------|
| 1 | Job Discovery Engine | Complete |
| 2 | Custom Deterministic ATS Tool | Complete |
| 3 | Resume Tailoring (Check Fit UI) | In Progress |
| 4 | People Finder | Partial (Apollo integration exists) |
| 5 | Personalized Email Generation | Pending |
| 6 | Send & Follow-up Scheduler | Pending |
