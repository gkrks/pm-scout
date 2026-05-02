# PM Scout

An automated job search pipeline that watches 754 US tech and AI companies for Product Manager and Associate Product Manager openings, applies a strict filter pipeline, and notifies you via email and Telegram when new roles appear.

---

## How it runs

The scanner runs on GitHub Actions, hourly from 5 AM PST through 4 PM PST (12 runs/day). It is silent during 5 PM PST → 4:59 AM PST. Daylight Saving Time is handled automatically — the blackout window is defined in Pacific local time, not UTC.

### Manual scan

**From GitHub:** Actions tab → Hourly Job Scan → Run workflow → (optional) tick "Run even if currently in the blackout window" → Run workflow.

**From your laptop:**
```bash
npm run scan:once
```

### Where the data goes

- **Email digest** (this is the product): arrives shortly after each run if there are new tier-1 or tier-2 jobs.
- **Supabase**: the `job_listings` table is the full database. Use Supabase's built-in table editor to mark jobs as Reviewed / Applied / Rejected and add notes. There is no separate UI — Supabase is the UI.
- **Telegram**: real-time digest + health alerts for scraper errors.

### How it doesn't run

- No server. Nothing is awake except during the ~5–7 minutes per hour the workflow is executing.
- No webhook listener.
- No status polling endpoint.

### Monitoring

- GitHub Actions tab shows every run, green or red. Red runs upload logs as artifacts (7-day retention).
- Telegram health channel pings you when companies fail at the run level.
- Supabase `parser_runs` table has the full audit trail.

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/your-org/pm-scout.git
cd pm-scout
npm install
```

### 2. Configure GitHub Secrets

In your repo → Settings → Secrets and variables → Actions, add:

| Secret | Description |
|--------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (not anon) |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_DIGEST_CHAT_ID` | Chat ID for new-job digest |
| `TELEGRAM_HEALTH_CHAT_ID` | Chat ID for error alerts (can be same) |
| `SMTP_USER` | Gmail address |
| `SMTP_PASS` | Gmail App Password |
| `EMAIL_FROM` | Sender address |
| `EMAIL_TO` | Recipient address |

### 3. Sync company config to Supabase

```bash
cp .env.example .env   # fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm run sync:companies
```

### 4. Enable GitHub Actions

Push to `main`. The workflow at `.github/workflows/scan.yml` starts automatically.

---

## Local development

```bash
cp .env.example .env   # fill in credentials
npm run scan:once      # run immediately, bypasses blackout window
```

### CLI — single job match

```bash
npm run match -- --job https://company.com/jobs/123 --resume ~/resume.pdf
# or
npx ts-node src/index.ts match --job <url> --resume <file> [--verbose]
```

---

## Tech Stack

| Layer | Tools |
|-------|-------|
| Language | TypeScript (Node 20+) |
| Scheduling | GitHub Actions (hourly cron) |
| Scrapers | Greenhouse, Lever, Ashby, Workday, Amazon, Google, Meta, Custom Playwright |
| Persistence | Supabase (Postgres via `@supabase/supabase-js`) |
| Notifications | Nodemailer (SMTP) + Telegram Bot API |
| HTML parsing | Cheerio |
| PDF parsing | pdf-parse |
| HTTP | node-fetch v2 |
| CLI | Commander |
| Terminal output | Chalk v4 |

---

## Pipeline

```
pm_apm_companies.json (754 companies)
  └─ sync:companies → Supabase: companies table

GitHub Actions (hourly)
  └─ scripts/runScan.ts
       └─ src/scheduler.ts → src/orchestrator/runScan.ts
            ├─ API pool    (concurrency 12): Greenhouse, Lever, Ashby, Workday, Amazon
            └─ Playwright pool (concurrency 3): Google, Meta, custom-playwright

            for each company:
              scrape → filter pipeline → Supabase upsert
              ├─ title filter    (include/exclude keywords)
              ├─ location filter (SF, NYC, LA, Seattle, Remote US, Hybrid)
              ├─ experience filter (reject if yoe_min > 3)
              ├─ freshness filter (reject if > 30 days old)
              ├─ sponsorship filter
              ├─ salary filter (optional)
              └─ tier ranking   (tier 1 = apply today, tier 2 = this week, tier 3 = dropped)

            → Supabase: job_listings upsert (dedup by company + role_url)
            → Telegram digest + health alert
            → Email digest
```

---

## Project Structure

```
src/
  scheduler.ts          Entry point for scan runs
  orchestrator/         Two-pool orchestration logic
  scrapers/             Per-ATS scraper implementations
  filters/              Title, location, experience, freshness, sponsorship, salary
  ranking/              Tier assignment (tier.ts)
  storage/              Supabase persistence layer
  notify/               Telegram + email digest builders
  lib/                  Shared utilities (blackout guard, logging)
  config/               Config loader for pm_apm_companies.json
  extractor.ts          Claude: raw text → requirement phrases (CLI match command)
  matcher.ts            Claude: match each requirement against resume (CLI)
  state.ts              Singleton scan status (used during a run)
  index.ts              CLI entrypoint (commander)

scripts/
  runScan.ts            One-shot scan entry point (called by GitHub Actions)
  syncCompanies.ts      Sync pm_apm_companies.json → Supabase companies table
  discoverATS.js        Manual helper: detect which ATS a company's careers page uses
  replayPendingBuffer.ts Replay any Supabase writes that failed during a run

config/
  pm_apm_companies.json Source of truth: 754 companies, filters, ranking rules
  ats_routing.json      slug → ATS mapping (Greenhouse/Lever/Ashby/Workday/Playwright)

.github/workflows/
  scan.yml              Hourly cron + workflow_dispatch trigger
```

---

## Phase Roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Job Discovery Engine | Complete |
| 2 | Custom Deterministic ATS Tool | In Progress |
| 3 | Resume Tailoring | Planned |
| 4 | People Finder | Planned |
| 5 | Personalised Email Generation | Planned |
| 6 | Send & Follow-up Scheduler | Planned |
