# Unified Outreach System

## Data Flow End-to-End

```
config/insight_sources.json
       │
       ▼
[1] Fetch sources (GitHub, blog, local files)
       │
       ▼
[2] Claude Sonnet extracts insights (5 types)
       │
       ▼
[3] User reviews via CLI (accept/reject/edit)
       │
       ▼
[4] Voyage embeds accepted insights → master_insights table
       │
       ║ (parallel path)
       ║
[5] RSS feed discovery → intel_sources table
       │
       ▼
[6] Fetch + chunk blog posts → Voyage embed → company_intel table
       │
       ║ (at outreach time)
       ▼
[7] Embed JD summary → cosine similarity → top-K insights + intel
       │
       ▼
[8] Claude Sonnet synthesizes 3 hook candidates (specificity scored)
       │
       ▼
[9] If best hook >= 7: Claude Sonnet writes body around hook
       │
       ▼
[10] Composer assembles by mode (cover letter / LinkedIn variants)
       │
       ▼
[11] Serve via /fit/:jobId/outreach → UI renders with copy + download
```

## Four Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `master_insights` | Non-obvious lessons from candidate's projects | `project_id`, `insight_type`, `text`, `embedding` (1024d), `accepted_at` |
| `company_intel` | Scraped blog/news chunks per company | `company_id` (FK), `chunk_text`, `embedding`, `intel_type`, `published_at` |
| `intel_sources` | Registry of RSS feeds per company | `company_id`, `feed_url`, `feed_type`, `consecutive_failures` |
| `scrape_failures` | Append-only error log | `source_url`, `error_class`, `error_message`, `failed_at` |

### Relationships
- `company_intel.company_id` → `companies.id`
- `intel_sources.company_id` → `companies.id`
- `scrape_failures.company_id` → `companies.id` (nullable)
- `master_insights` is not company-specific — insights are matched to any company via embedding similarity

## SKIP Threshold

The hook finder returns `skip: true` when the best hook's `specificity_score < 7`.

**Specificity rubric:**
- 10 = recruiter could NOT have inferred this from the resume AND the company fact is recent + specific
- 7-9 = strong connection, specific on both sides
- 4-6 = connection exists but one side is generic
- 1-3 = generic enthusiasm, could apply to any company

**Tuning:** Adjust `minSpecificity` in `findHook()` options. Lower to 5-6 if you want hooks for more companies (at the cost of weaker connections). Raise to 8+ for only the strongest matches.

## How to Add a New Project's Insights

1. Edit `config/insight_sources.json` — add a new entry:
```json
{
  "project_id": "my_project",
  "one_line": "One-sentence description of the project",
  "sources": [
    { "url": "https://github.com/you/repo", "type": "github_readme" },
    { "url": "docs/path/to/local.md", "type": "local_file" },
    { "url": "https://blog.example.com/post", "type": "blog" }
  ]
}
```

2. Run extraction:
```bash
npx ts-node scripts/runInsightsExtraction.ts
```

3. Review interactively (or bulk-accept):
```bash
npx ts-node scripts/runInsightsExtraction.ts --review-only
```

## How to Refresh a Company's Intel

```bash
# Automatic feed discovery + fetch
npx ts-node scripts/refreshIntel.ts --company <slug> --force

# With explicit domain (if careers URL doesn't have a blog)
npx ts-node scripts/refreshIntel.ts --company stripe --domain https://stripe.com

# Via the UI: click "Refresh Company Intel" in the outreach modal
```

Cache policy: feeds are not re-fetched within 7 days unless `--force` is passed. Circuit breaker skips feeds with 5+ consecutive failures.

## Modes

| Mode | Target Words | Signature | Ask |
|------|:---:|---|---|
| `cover_letter` | 150-220 | `Best regards,\n{name}` | In body |
| `linkedin_referral_peer` | 100-150 body | `{name}` | "Would love 15 min if you're up for it." |
| `linkedin_referral_open_to_connect` | 100-150 body | `{name}` | "If this looks like a fit, would you be open to passing my resume along?" |
| `linkedin_hiring_manager` | 100-150 body | `{name}` | None |

LinkedIn modes optionally accept `personIntel` (free-text about the recipient) which generates a personalized opening line.

## Known Limitations

1. **RSS-only intel** — companies without engineering blogs (or with JavaScript-rendered blogs) won't have intel. Workaround: manually seed `company_intel` from news articles.
2. **Insight quality depends on source richness** — GitHub READMEs with minimal content produce shallow insights. Blog posts with real numbers/decisions produce much better ones.
3. **LinkedIn word counts include opener + ask** — the body itself targets 100-150 words but the full assembled message is longer due to personalization line and closing ask.
4. **No dedup on insights** — running extraction multiple times on the same sources will create duplicate insights. Check `data/insights_drafts.json` before bulk-accepting.
5. **Voyage rate limits** — bulk embedding of 200+ insights in one run may hit rate limits on free tier. The batch size (20) mitigates this.
6. **Feed discovery** — only checks 16 common paths + HTML link tags. Sites with non-standard feed URLs need `--domain` override or manual `intel_sources` insertion.

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/fit/:jobId/outreach` | Generate outreach (hook + body) |
| GET | `/fit/:jobId/download/outreach` | Download cover letter DOCX |
| POST | `/fit/:jobId/intel/refresh` | Refresh company intel |
| POST | `/fit/:jobId/cover-letter` | Legacy cover letter (unchanged) |
| GET | `/fit/:jobId/download/cover-letter` | Legacy cover letter download |

## Cost Structure

Per outreach generation:
- Hook synthesis: ~4K input + ~550 output tokens (Sonnet)
- Body writing: ~800 input + ~260 output tokens (Sonnet)
- Personalization (LinkedIn only): ~200 input + ~40 output tokens (Sonnet)
- **Total: ~5-6K tokens per generation (~$0.02)**

One-time costs:
- Insight extraction: ~46K input + ~12K output tokens for 24 sources
- Voyage embedding: ~220 insights at ~$0.01 total
- Intel refresh: varies by feed size (Cloudflare: 200 chunks, ~$0.05 Voyage)
