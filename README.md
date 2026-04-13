# PM Scout

An automated job search pipeline that discovers early-career Product Manager roles across 100 top tech companies, scores your resume against each posting using Claude, and surfaces exactly where you match — and where you don't.

---

## What it does

1. **Scrapes** Greenhouse and Lever APIs across 100 companies in parallel
2. **Filters** for early-career PM roles (title, experience level, US location, recency)
3. **Scores** your resume against every job description using Claude AI
4. **Displays** match scores, per-requirement breakdowns, and apply recommendations in a web UI

---

## Tech Stack

| Layer | Tools |
|-------|-------|
| Language | TypeScript (Node 20+) |
| AI | Claude (`claude-opus-4-5`) via `@anthropic-ai/sdk` |
| Web server | Express 5 |
| HTML parsing | Cheerio |
| PDF parsing | pdf-parse |
| HTTP | node-fetch v2 |
| CLI | Commander |
| Terminal output | Chalk v4 |
| Config | dotenv |

---

## Setup

```bash
git clone https://github.com/gkrks/pm-scout.git
cd pm-scout
npm install
```

Create a `.env` file:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Optionally set a default resume path (used as the generic fallback):

```
GENERIC_RESUME_PATH=/path/to/your/resume.pdf
```

---

## Running

### Web UI (recommended)

```bash
npm run dev:serve       # dev mode (ts-node, no build needed)
# or
npm run build && npm run serve   # production
```

Open `http://localhost:8080`.

### CLI — single job match

```bash
npm run match -- --job https://company.com/jobs/123 --resume ~/resume.pdf
# or
npx ts-node src/index.ts match --job <url> --resume <file> [--verbose]
```

---

## End-to-End Flow

```
Browser                     Express (server.ts)            External / AI
  │                               │                              │
  │── POST /api/scan ────────────>│                              │
  │                        scrapeAll()                           │
  │                         ┌─ Semaphore(8) ─────────────────── │
  │                         │  scrapeGreenhouse(slug)  ─────────>│ boards-api.greenhouse.io
  │                         │  scrapeLever(slug)       ─────────>│ api.lever.co
  │                         │  filter + deduplicate              │
  │                         └────────────────────────────────────│
  │<─── poll /api/status ────────<│ (jobs added to appState)     │
  │                               │                              │
  │── POST /api/resume/upload ───>│                              │
  │   { pdf_base64, file_name }   │                              │
  │                         extract_text_from_bytes()            │
  │                         appState.resume.uploadedText = text  │
  │                               │                              │
  │── POST /api/run-ats ─────────>│                              │
  │                        scoreAllJobs()                        │
  │                         Semaphore(1): one job at a time      │
  │                         for each job:                        │
  │                          strip HTML from description         │
  │                          extractRequirements() ─────────────>│ Claude
  │                          matchRequirements()                 │
  │                           Semaphore(10): 10 reqs parallel ──>│ Claude ×10
  │                          score = (met + partial×0.5) / total │
  │                          resumeAction = apply/tailor/skip    │
  │<─── poll /api/status ────────<│ (scores fill in live)        │
  │                               │                              │
  │── click row ─────────────────>│                              │
  │<── modal: req breakdown ──────│                              │
```

### Per-job resume flow

Each row in the table has independent upload and matching controls:

```
Upload button clicked
  → browser file picker → FileReader → base64
  → POST /api/jobs/:id/resume  { pdf_base64, file_name }
  → extract_text_from_bytes() → appState.jobResumes[id]
  → localStorage stores { name, base64 } for persistence across reloads

Run Match clicked
  → POST /api/jobs/:id/score
  → server responds 200 immediately (runs async)
  → appState.scoringJobIds.add(id)  ← spinner appears in UI via poll
  → resolves per-job resume (falls back to global if none uploaded)
  → write resume text to /tmp/resume-job-{id}.txt
  → parseResume() → extractRequirements() → matchRequirements()
  → appState.scoringJobIds.delete(id)  ← spinner gone, score appears
```

---

## Pipeline Stages

### Stage 1 — Job Discovery (`src/jobScraper.ts`)

Fetches all jobs from each company's ATS API and applies five filters:

**Title inclusion** — must match one of:
- Associate Product Manager / APM / Associate PM
- Product Manager / Product Manager I / Product Manager 1

**Title exclusion** — rejected if title contains:
`senior` · `sr` · `lead` · `principal` · `director` · `head` · `VP` · `vice president` · `staff` · `group PM/product` · `engineering manager`

**Experience filter** — rejects if description mentions:
- Any single value `> 3` years (e.g. "4+ years", "5 years")
- Any range whose upper bound `> 3` (e.g. "2–5 years", "3–6 years")

**Location filter** — drops ~50 non-US city / country / region tokens.

**Date filter** — keeps jobs posted within the last 6 months (uses `first_published` for Greenhouse, `createdAt` epoch for Lever).

After scraping: deduplication by `company + title`, keeping the entry with the most specific location.

---

### Stage 2 — Requirement Extraction (`src/extractor.ts`)

```
plainText (up to 6000 chars)
  └─ Claude claude-opus-4-5 (temp=0, max_tokens=1000)
       prompt: extract atomic requirement phrases, strip filler
       response: JSON string[]
       retry once on parse failure
```

Returns 5–20 short phrases like:
`"3+ years product management experience"`, `"SQL or equivalent query language"`, `"Bachelor's degree or equivalent"`

---

### Stage 3 — Resume Parser (`src/parser.ts`)

```
.pdf  → pdf-parse → raw text
.txt / .md → fs.readFile

splitSections()
  detect headings: ALL-CAPS lines, known names, dash-underlined lines
  → ResumeSection[]

parseExperience()
  find Experience section
  for each line:
    date range? → normalizeDate() → "YYYY-MM"
    bullet?     → bullets[]
    other?      → company / title
  → WorkEntry[]  (company, title, startDate, endDate, bullets[])

parseEducation() → string[]
parseSkills()    → string[]
```

`"Present"` / `"Current"` normalises to today's `YYYY-MM` for accurate date arithmetic.

---

### Stage 4 — Matching (`src/matcher.ts`)

Up to 10 requirements matched in parallel (semaphore-capped to avoid rate limits):

```
for each requirement:
  Claude claude-opus-4-5 (temp=0, max_tokens=500)
    system: resume analyst prompt with two special rules:
      • "X+ years" → calculate from WorkEntry date math, don't guess
      • degree requirement → check Education section first
    user: REQUIREMENT: {req}
          RESUME: {raw text}
          EXPERIENCE ENTRIES (parsed): {JSON}
    response: { status, proof, location, confidence }
    retry once on failure → fallback { status:"missing", proof:"" }
```

**Scoring:**
```
score = (met × 1.0 + partial × 0.5) / total × 100

≥ 70%  →  apply_as_is
≥ 40%  →  tailor_then_apply
< 40%  →  skip
```

---

### Stage 5 — Reporter (`src/reporter.ts`) — CLI only

Writes a colour-coded terminal report (Chalk) and `match-report.json`:

```
✅  met     → green  + proof excerpt + location
⚠️  partial → yellow + proof excerpt + location
❌  missing → red    (no proof — never hallucinated)
```

---

## API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/` | Serve web UI |
| `GET` | `/api/status` | Poll scan/score state + all jobs |
| `GET` | `/api/companies` | List all 100 companies |
| `POST` | `/api/scan` | Start job scrape (async) |
| `POST` | `/api/resume/upload` | Upload global resume `{ pdf_base64, file_name }` |
| `POST` | `/api/resume/use-generic` | Switch active resume to generic |
| `POST` | `/api/run-ats` | Score all jobs against active resume (async) |
| `POST` | `/api/jobs/:id/resume` | Upload resume for a specific job `{ pdf_base64, file_name }` |
| `POST` | `/api/jobs/:id/score` | Score one job (uses per-job resume or falls back to global) |

---

## Project Structure

```
src/
  companies.ts   100 company slugs (Greenhouse + Lever)
  jobScraper.ts  Fetch + filter jobs from ATS APIs
  extractor.ts   Claude: raw text → requirement phrases
  parser.ts      PDF/text → structured ResumeData
  matcher.ts     Claude: match each requirement (≤10 parallel)
  reporter.ts    CLI chalk output + match-report.json
  scraper.ts     CLI-mode: scrape a single job page URL
  state.ts       Singleton app state (jobs, resumes, status)
  server.ts      Express API + inline web UI
  pdfUtil.ts     pdf-parse wrapper
  index.ts       CLI entrypoint (commander)
```

---

## Phase Roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Job Discovery Engine | ✅ Complete |
| 2 | ATS Resume Matching | ✅ Complete |
| 3 | Resume Tailoring | Planned |
| 4 | People Finder | Planned |
| 5 | Personalised Email Generation | Planned |
| 6 | Send & Follow-up Scheduler | Planned |

---

## Key Design Decisions

- **Semaphore-capped parallelism** — jobs scored one at a time; requirements within a job matched 10 at a time. Keeps Claude API usage within rate limits while being ~10× faster than fully sequential.
- **HTML stripped before Claude** — Greenhouse descriptions are raw HTML. Tags are stripped before sending to the extractor so Claude sees clean requirement text.
- **Date math, not impression** — the matcher prompt instructs Claude to sum months from parsed `WorkEntry` dates for "X+ years" requirements rather than guessing from context.
- **No hallucinated proof** — `missing` status always sets `proof = ""`, enforced in code regardless of what Claude returns.
- **Per-job resume persistence** — uploaded resumes are stored as base64 in `localStorage` and silently re-uploaded on page load so the server always has them ready.
