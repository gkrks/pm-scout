# Resume Matcher — Job Search Automation Pipeline

## Current Phase
**Phase 2 — Custom Deterministic ATS Tool** (Active)

## Phase Roadmap
| Phase | Name | Status |
|-------|------|--------|
| 1 | Job Discovery Engine | Complete |
| 2 | Custom Deterministic ATS Tool | In Progress |
| 3 | Resume Tailoring | Pending |
| 4 | People Finder | Pending |
| 5 | Personalized Email Generation | Pending |
| 6 | Send & Follow-up Scheduler | Pending |

---

## Tech Stack
- **Language**: TypeScript (Node.js 20+)
- **Build**: `tsc` → `dist/`, dev via `ts-node`
- **AI**: Claude API via `@anthropic-ai/sdk` (model: `claude-opus-4-5`)
- **HTTP**: `node-fetch` (CommonJS v2)
- **HTML parsing**: `cheerio`
- **PDF parsing**: `pdf-parse`
- **CLI**: `commander`
- **Terminal output**: `chalk` v4 (CommonJS)
- **Env**: `dotenv` reads `ANTHROPIC_API_KEY` from `.env`

---

## Project Structure

```
src/
  scraper.ts    Stage 1 — Fetch job page, extract requirement sections
  extractor.ts  Stage 2 — Claude: parse raw text → atomic requirement phrases
  parser.ts     Stage 3 — Parse resume PDF/text → structured ResumeData
  matcher.ts    Stage 4 — Claude: match each requirement against resume (sequential)
  reporter.ts   Stage 5 — Print chalk report + write match-report.json
  index.ts      Stage 6 — CLI entrypoint (commander)
```

---

## Running

```bash
# Dev (no build needed)
npm run match -- --job https://example.com/jobs/123 --resume ~/resume.pdf

# Or directly
npx ts-node src/index.ts match --job <url> --resume <path> [--verbose]

# Build then run
npm run build
node dist/index.js match --job <url> --resume <path>
```

---

## CLI Interface

```
resume-matcher match --job <url> --resume <file-path> [--verbose]
```

- `--job` — URL of the job posting page (required)
- `--resume` — Path to resume file: `.pdf`, `.txt`, or `.md` (required)
- `--verbose` — Print raw scraped text + parsed requirements to stdout

---

## Output

**Terminal** (chalk colored):
- Header with job URL and timestamp
- Summary line: `✅ Met: N  ⚠️  Partial: N  ❌ Missing: N  |  Match score: X%`
- Per-requirement rows: green = met, yellow = partial, red = missing

**File**: `match-report.json` — always written, even on partial errors

---

## Environment

```
ANTHROPIC_API_KEY=sk-ant-...
```

Add to a `.env` file in the project root or export in shell.

---

## Stage Details

### Stage 1 — Scraper
- `scrapeJobPage(url: string): Promise<string>`
- Looks for headings matching requirement section patterns (case-insensitive)
- Collects all content under matching headings until the next equal/higher heading
- Fallback: all `<li>` bullets if no matching headings found

### Stage 2 — Extractor
- `extractRequirements(rawText: string): Promise<string[]>`
- Claude `claude-opus-4-5`, `max_tokens: 1000`, `temperature: 0`
- Returns atomic requirement phrases (5–15 words each)
- Strips filler language; keeps domain terms verbatim
- Retries once on JSON parse failure

### Stage 3 — Resume Parser
- `parseResume(filePath: string): Promise<ResumeData>`
- PDF → `pdf-parse`; `.txt`/`.md` → `fs.readFile`
- Detects section headings: all-caps lines, known names, dash-underlined lines
- Parses work entries: company, title, date range → normalized `"YYYY-MM"`
- `"Present"` → today's date

### Stage 4 — Matcher
- `matchRequirements(requirements, resume): Promise<MatchResult[]>`
- **Parallel (≤10 concurrent)** — semaphore-capped to avoid rate limits
- Claude `claude-opus-4-5`, `max_tokens: 500`, `temperature: 0`
- Returns `{ status: "met"|"partial"|"missing", proof, location, confidence }`
- Special rule: "X+ years" requirements → date math from parsed work entries
- Special rule: degree requirements → looks in Education section first
- Retries once; falls back to `{ status: "missing", proof: "Parse error" }`

### Stage 5 — Reporter
- `generateReport(jobUrl, requirements, results): void`
- Score = `(met × 1.0 + partial × 0.5) / total × 100`
- If `status === "missing"`, proof is always empty string (no hallucination)

---

## Constraints

1. **Parallel matching (≤10)** — semaphore-capped at 10 concurrent Claude calls
2. **JSON-only Claude responses** — parse failure → retry once → fallback result
3. **No hallucinated proof** — `missing` status always has empty `proof`
4. **Date math is calculated** — not inferred from Claude's impression
5. **Report always written** — `match-report.json` is written even if some matches errored

---

## Future Phases

### Phase 3 — Resume Tailoring
- Accept a job URL + resume; produce a tailored resume draft
- User reviews diffs, accepts/rejects individual changes
- Re-run matcher to confirm score improvement

### Phase 4 — People Finder
- For a selected company: find hiring manager, recruiter, 2–3 PMs on the same team
- Provide LinkedIn search URLs (never automate LinkedIn requests)

### Phase 5 — Personalized Email Generation
- Generate distinct emails for: recruiter, hiring manager, team PMs
- User provides preferred email format / template

### Phase 6 — Send & Follow-up Scheduler
- Send via Gmail API or SMTP
- Auto-schedule follow-up after 4 business days
- Track status per contact: Sent → Awaiting Reply → Followed Up
