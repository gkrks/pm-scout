# PM Scout — Job Search Automation Pipeline

## Current Phase
**Phase 3 — Resume Tailoring** (Active)

## Phase Roadmap
| Phase | Name | Status |
|-------|------|--------|
| 1 | Job Discovery Engine | Complete |
| 2 | Custom Deterministic ATS Tool | Complete |
| 3 | Resume Tailoring (Check Fit UI) | In Progress |
| 4 | People Finder | Partial (Apollo integration exists) |
| 5 | Personalized Email Generation | Pending |
| 6 | Send & Follow-up Scheduler | Pending |

---

## Tech Stack
| Component | Technology |
|-----------|-----------|
| Language | TypeScript (Node.js 20+) |
| Build | `tsc` → `dist/`, dev via `ts-node` |
| AI | Claude API (`@anthropic-ai/sdk`), Groq LLaMA 3.1 (`groq-sdk`) |
| HTTP | `node-fetch` (CommonJS v2) |
| HTML parsing | `cheerio` |
| PDF parsing | `pdf-parse` |
| Browser automation | `playwright` (Chromium) |
| Database | Supabase (`@supabase/supabase-js`) |
| Legacy DB | Airtable (`airtable`) |
| Web server | Express (port 3847) |
| Resume generation | `docx` (docx-js), `pdfkit` |
| Email | `nodemailer` (SMTP/Gmail) |
| CLI | `commander` |
| Terminal output | `chalk` v4 (CommonJS) |
| Validation | `zod` |
| Env | `dotenv` |
| CI/CD | GitHub Actions (hourly cron) |
| Deployment | Railway / Render |

---

## Project Structure

```
src/
  index.ts                  CLI entrypoint (Commander: match command)
  scheduler.ts              Top-level scan orchestration (runScanOnce)
  jobScraper.ts             Scraper dispatcher + inline filters
  jobStore.ts               Local fingerprint diff + persistence
  state.ts                  Job interface, AppState singleton
  jdExtractor.ts            Deterministic JD extraction (no LLM primary path)
  qualificationMap.ts       Claude: group qualifications → semantic clusters

  config/
    targets.ts              Load + validate targets.json (Zod)
    loadRouting.ts          Load + resolve ats_routing.json
    filterConfig.ts         Build filter config from targets

  scrapers/                 11 ATS platform scrapers
    index.ts                SCRAPER_REGISTRY
    types.ts                RawJob, ScrapeResult, Scraper interfaces
    greenhouse.ts           Greenhouse API
    lever.ts                Lever API
    ashby.ts                Ashby API
    workday.ts              Workday API (paginated + inline descriptions)
    amazon.ts               Amazon Jobs API (dual pass)
    smartrecruiters.ts      SmartRecruiters API
    workable.ts             Workable API
    bamboohr.ts             BambooHR API
    googlePlaywright.ts     Google Careers (Chromium)
    metaPlaywright.ts       Meta Careers (GraphQL intercept)
    customPlaywright.ts     Generic CSS-selector scraper
    playwright.ts           Shared Playwright utilities

  orchestrator/             Two-pool concurrent execution
    runScan.ts              Entry point (partition → pools → aggregate)
    pools.ts                Worker pool executor (API 12x, PW 3x)
    budget.ts               9-minute run budget enforcement
    classify.ts             Error classification + retry policy
    lock.ts                 File-based concurrency guard

  filters/                  7-filter pipeline + tier ranking
    pipeline.ts             Filter orchestration
    types.ts                FilterConfig, JobEnrichment, PipelineResult
    title.ts                Title keyword include/exclude
    location.ts             City matching, remote/hybrid
    freshness.ts            Posting age check
    experience.ts           YOE extraction from description
    sponsorship.ts          Visa sponsorship detection
    salary.ts               Salary extraction

  ranking/
    tier.ts                 Tier 1/2/3 assignment
    apmSignal.ts            APM program signal detection

  storage/                  Supabase persistence
    supabase.ts             Singleton client
    upsertListing.ts        Batch upsert (50 rows/call)
    parserRuns.ts           Per-run metadata tracking
    deactivateUnseen.ts     Mark stale listings inactive
    pendingBuffer.ts        JSON buffer for outages
    extractSkillsInline.ts  LLM: extract skills from descriptions
    extractYoeInline.ts     LLM: extract YOE from descriptions
    cleanQualsInline.ts     LLM: normalize qualifications

  notify/                   Notifications
    email.ts                Rich HTML email digest (SMTP)
    telegram.ts             Telegram bot digest (MarkdownV2)
    digest.ts               Shared message builders
    labels.ts               Company metadata + display helpers
    healthAlert.ts          Error/suspicious alerting
    healthState.ts          Per-company error history

  fit/                      Phase 3: Resume tailoring web UI
    server.ts               Express server (port 3847) + routes
    generateResume.ts       Bullet selection → fill_resume.js
    render.ts               Server-render Fit page (token-gated)
    skillsOptimizer.ts      Claude: optimize skills section
    summaryGenerator.ts     Claude: generate professional summary
    coverLetterGenerator.ts Claude: tailored cover letters
    types.ts                Zod schemas for scoring/selection
    slug.ts                 Filename slug generator
    client.js               Frontend JS

  airtable/
    upsert.ts               Legacy Airtable upsert (SHA-1 fingerprint)

  lib/
    blackout.ts             Blackout window check (5 PM–5 AM PT)
    normalizeUrl.ts         URL normalization for dedup
    headingAliases.ts       196 heading aliases → 11 canonical buckets
    skillsList.ts           Curated skill/tool keyword lists
    htmlToText.ts           HTML → plain text converter
    timeout.ts              Promise timeout wrapper

  types/
    extractedJD.ts          Zod schema for ExtractedJD (150+ fields)

  # Phase 1 CLI matcher (standalone)
  scraper.ts                Fetch job page, extract requirement sections
  extractor.ts              Groq: parse raw text → atomic requirement phrases
  parser.ts                 Parse resume PDF/text → structured ResumeData
  matcher.ts                Groq: match each requirement against resume
  reporter.ts               Chalk report + match-report.json

  # People finder
  peopleFinder.ts           3-pass hiring intelligence pipeline
  apolloClient.ts           Apollo API client

config/
  targets.json              754 company configs + filter rules (source of truth)
  ats_routing.json          Slug → ATS platform routing
  master_resume.json        Structured resume data
  supabase_schema.sql       Database schema

scripts/
  runScan.ts                Scan entry point (blackout + scheduler)
  syncCompanies.ts          Seed Supabase companies table
  discoverATS.js            ATS auto-detection probe
  extractOne.ts             Extract JD from single URL
  replayPendingBuffer.ts    Replay buffered Supabase writes
  clearDatabase.ts          Reset Supabase state

ats_bullet_selector/        Python service for resume tailoring
  models.py                 Scoring models
  outputs/                  qualification_map.json

build_template.js           ATS-validated .docx/.pdf template generator
fill_resume.js              Populate template from master_resume.json
```

---

## Running

### Hourly Job Scanner (GitHub Actions)
```bash
# Runs automatically via .github/workflows/scan.yml
# Cron: hourly 5 AM–9 PM PDT

# Manual scan (bypasses blackout)
npm run scan:once
```

### CLI Resume Matcher (standalone)
```bash
npm run match -- --job <url> --resume <file> [--verbose]

# Or directly
npx ts-node src/index.ts match --job <url> --resume <path>
```

### Check Fit Resume Tailoring Server
```bash
npm run fit:serve
# Express on http://localhost:3847
# Routes: GET /fit/:jobId, POST /fit/:jobId/{score,select,generate}, GET /fit/:jobId/download/{pdf,docx}
```

### Utility Scripts
```bash
npm run extract:one <url>           # Extract structured JD from URL
npx ts-node scripts/syncCompanies.ts  # Seed Supabase companies table
```

---

## System Overview

Three main products share this codebase:

### 1. Hourly Job Scanner
Discovers PM/APM roles across 754 companies every hour. Scrapes 11 ATS platforms, filters/ranks results through a 7-filter pipeline, persists to Supabase, and sends email + Telegram digests of new matches.

**Flow:** GitHub Actions cron → config loading → two-pool orchestrator (API 12x + Playwright 3x concurrent) → inline filters → JD extraction → local diff → Supabase upsert → notifications

### 2. CLI Resume Matcher
Standalone 5-stage pipeline: scrape job page → extract requirements (Groq) → parse resume (PDF/text) → match requirements vs resume (Groq) → chalk report + JSON output.

### 3. Check Fit Resume Tailoring (Web UI)
Express server with token-gated routes. Scores resume bullets against job qualifications via a Python service, lets users select bullets, regenerates summary/skills via Claude, and produces ATS-optimized PDF/DOCX output.

---

## Environment

```
# AI
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...

# Database
SUPABASE_URL=https://....supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Email notifications
NOTIFY_EMAIL_DIGEST=true
SMTP_HOST=smtp.gmail.com
SMTP_USER=...
SMTP_PASS=...          # Gmail App Password
EMAIL_FROM=...
EMAIL_TO=...

# Telegram notifications
NOTIFY_TELEGRAM_DIGEST=true
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# Fit server
FIT_PORT=3847
FIT_TOKEN_SECRET=...
FIT_BASE_URL=https://pm-scout.example.com
BULLET_SELECTOR_URL=http://127.0.0.1:8001

# People finder
APOLLO_API_KEY=...

# Scan control
IGNORE_BLACKOUT=false
SCAN_POOL=all          # all | api | playwright
DISPLAY_TIMEZONE=America/Los_Angeles
```

---

## Constraints

1. **Two-pool concurrency** — API scrapers (12 concurrent, 15–25s) and Playwright scrapers (3 concurrent, 60s) run in parallel
2. **9-minute run budget** — leaves 3 min buffer before GitHub Actions 12-min hard kill
3. **Fingerprint-based dedup** — SHA-1(company|title|location), URL excluded (session-specific for Google/Meta)
4. **Pre-description filter optimization** — title/location/freshness checked before fetching JD text
5. **Deterministic JD extraction** — regex + keyword matching, LLM only for unrecognized headings
6. **Triple persistence** — Supabase (authoritative) + Airtable (legacy) + JSON buffers (crash recovery)
7. **Pending buffer replay** — failed Supabase writes auto-replay at next scan start
8. **No hallucinated proof** — CLI matcher: `missing` status always has empty `proof`
9. **Blackout window** — 5 PM–5 AM Pacific, configurable, skippable via workflow_dispatch

---

## Future Phases

### Phase 5 — Personalized Email Generation
- Generate distinct emails for: recruiter, hiring manager, team PMs
- User provides preferred email format / template

### Phase 6 — Send & Follow-up Scheduler
- Send via Gmail API or SMTP
- Auto-schedule follow-up after 4 business days
- Track status per contact: Sent → Awaiting Reply → Followed Up
