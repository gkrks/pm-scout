# Architecture: Resume Matcher CLI

## Overview

A TypeScript CLI tool that scrapes a job posting, extracts its requirements, parses your resume, and uses Claude to match each requirement against your experience — producing a color-coded terminal report and a JSON file.

```
resume-matcher match --job <url> --resume <file>
```

---

## Pipeline (6 stages, sequential)

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CLI ENTRYPOINT (index.ts)                     │
│                                                                      │
│  commander parses:  --job <url>  --resume <file>  [--verbose]        │
│                                                                      │
│  1. scrapeJobPage(url)                                               │
│       ↓ rawText: string                                              │
│  2. extractRequirements(rawText)                                     │
│       ↓ requirements: string[]                                       │
│  3. parseResume(filePath)                                            │
│       ↓ resumeData: ResumeData                                       │
│  4. matchRequirements(requirements, resumeData)     ← SEQUENTIAL     │
│       ↓ results: MatchResult[]                                       │
│  5. generateReport(url, requirements, results)                       │
│       stdout (chalk) + match-report.json                             │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Stage 1 — Scraper (`src/scraper.ts`)

```
scrapeJobPage(url)
  │
  ├─ node-fetch (browser User-Agent)
  ├─ cheerio HTML parse
  │
  ├─ scan h1/h2/h3/h4/strong for REQUIREMENT_PATTERNS:
  │    "requirements", "qualifications", "what you bring",
  │    "what we look for", "preferred", "nice to have", …
  │
  ├─ for each matching heading:
  │    walk siblings until next equal/higher heading
  │    collect all text
  │
  └─ fallback (no headings matched):
       extract all <li> bullet text
```

---

## Stage 2 — Extractor (`src/extractor.ts`)

```
extractRequirements(rawText)
  │
  └─ Claude API (claude-opus-4-5, max_tokens=1000, temp=0)
       system: strict requirement parser prompt
       user:   rawText
       →  JSON string[]  (atomic requirement phrases)
       retry once on parse failure
```

---

## Stage 3 — Resume Parser (`src/parser.ts`)

```
parseResume(filePath)
  │
  ├─ .pdf  → pdf-parse → raw text
  ├─ .txt/.md → fs.readFile
  │
  ├─ splitSections(lines)
  │    detect headings: all-caps, known section names,
  │                     line-followed-by-dashes
  │    → ResumeSection[]
  │
  ├─ parseExperience(sections)
  │    find Experience section
  │    for each line:
  │      extractDateRange() → normalizeDate() → "YYYY-MM"
  │      bullet lines → bullets[]
  │      other lines  → title / company
  │    → WorkEntry[]
  │
  ├─ parseEducation(sections) → string[]
  └─ parseSkills(sections)    → string[]
```

---

## Stage 4 — Matcher (`src/matcher.ts`)

```
matchRequirements(requirements, resume)   ← SEQUENTIAL
  │
  for each requirement:
    │
    └─ Claude API (claude-opus-4-5, max_tokens=500, temp=0)
         system: resume analyst prompt
                 special rules for "X+ years" (date math)
                 special rules for degree requirements
         user:   REQUIREMENT: {req}
                 RESUME: {resume.raw}
                 EXPERIENCE ENTRIES (parsed): {JSON}
         →  MatchResult { status, proof, location, confidence }
         retry once on parse failure
         fallback: { status:"missing", proof:"Parse error" }
```

---

## Stage 5 — Reporter (`src/reporter.ts`)

```
generateReport(jobUrl, requirements, results)
  │
  ├─ stdout (chalk colors):
  │    header block
  │    summary: ✅ Met: N  ⚠️  Partial: N  ❌ Missing: N  | score: X%
  │    per result:
  │      met     → green  ✅ + proof + location
  │      partial → yellow ⚠️  + proof + location
  │      missing → red    ❌
  │
  └─ match-report.json:
       { jobUrl, generatedAt, summary, matches[] }
```

---

## Data shapes

```typescript
interface ResumeSection { heading, content, lines[] }
interface WorkEntry     { company, title, startDate, endDate, bullets[] }
interface ResumeData    { raw, sections[], experience[], education[], skills[] }

interface MatchResult {
  requirement: string
  status:      "met" | "partial" | "missing"
  proof:       string   // verbatim excerpt or date calculation; "" if missing
  location:    string   // "Experience > Company > bullet N"
  confidence:  number   // 0.0–1.0
}
```

---

## Key design decisions

- **Sequential matching** — one Claude call per requirement avoids rate limits and makes progress visible.
- **Retry-once strategy** — every Claude call retries once on JSON parse failure; falls back to `missing` on second failure so the report always completes.
- **Date math in prompt** — the matcher prompt instructs Claude to sum months from parsed `WorkEntry[]` dates rather than guessing, producing auditable "X months" calculations.
- **No server, no database** — pure CLI; all state lives in process memory for the duration of a run.
- **chalk v4** — CommonJS-compatible (no ESM `import()` needed).

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@anthropic-ai/sdk` | Claude API client |
| `cheerio` | HTML parsing in scraper |
| `node-fetch` | HTTP requests |
| `pdf-parse` | Extract text from PDF resumes |
| `chalk` | Colored terminal output |
| `commander` | CLI argument parsing |
| `dotenv` | Load ANTHROPIC_API_KEY from .env |
