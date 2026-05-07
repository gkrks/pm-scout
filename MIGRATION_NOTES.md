# Ashby DB-Driven Migration Notes

## Production Run Order

1. **Apply schema migration**
   ```sql
   -- Run in Supabase SQL Editor or via migration tool
   \i supabase/migrations/20260506_companies_and_jobs_v2.sql
   ```

2. **Prepare discovery data**
   - Run [AkshatBhat/find-companies-using-ashby-job-boards](https://github.com/AkshatBhat/find-companies-using-ashby-job-boards) with `--max-results 5000`
   - Place output CSV at `data/akshatbhat_verified_ashby_slugs.csv`
   - (Optional) Export Bloomberry data to `data/bloomberry_ashby.csv`

3. **Run discovery script**
   ```bash
   npx ts-node scripts/discover_ashby_companies.ts
   # Use --dry-run to preview without writing to Supabase
   # Use --skip-validation to skip GraphQL validation (faster, less accurate)
   ```

4. **First sync** — run the normal scan; the updated Ashby scraper will use the DB-populated companies table.
   ```bash
   npm run scan:once
   ```

## Rollback

- **Companies table**: `DROP TABLE IF EXISTS public.companies CASCADE;`
- **Jobs columns**: The new columns are additive (`ADD COLUMN IF NOT EXISTS`). They can be dropped individually if needed, but the existing scraper code will simply not populate them.
- **Scraper**: Revert `src/scrapers/ashby.ts` to the previous version (git checkout).

## Verification Queries

Run these after the first full sync:

```sql
-- 1. Total US PM jobs active
SELECT count(*) FROM public.jobs
WHERE ats_provider = 'ashby' AND is_active = true
  AND lower(title) LIKE '%product%' AND lower(title) LIKE '%manager%'
  AND lower(location_country) IN ('united states','usa','us');

-- 2. Top 20 companies by active US PM postings
SELECT c.name, c.ats_slug, count(*) AS pm_jobs
FROM public.jobs j JOIN public.companies c ON c.id = j.company_id
WHERE j.ats_provider = 'ashby' AND j.is_active = true
  AND lower(j.title) LIKE '%product%' AND lower(j.title) LIKE '%manager%'
  AND lower(j.location_country) IN ('united states','usa','us')
GROUP BY 1, 2 ORDER BY pm_jobs DESC LIMIT 20;

-- 3. Qualifications extraction coverage
SELECT qualifications->>'extracted_via' AS method, count(*)
FROM public.jobs
WHERE ats_provider = 'ashby' AND is_active = true
  AND lower(title) LIKE '%product%' AND lower(title) LIKE '%manager%'
GROUP BY 1;

-- 4. Staleness sanity check
SELECT is_active, count(*) FROM public.jobs WHERE ats_provider = 'ashby' GROUP BY 1;

-- 5. CRITICAL: staleness correctness — should return NON-ZERO
SELECT count(*) AS active_old_jobs FROM public.jobs
WHERE ats_provider = 'ashby' AND is_active = true
  AND posted_date < (current_date - interval '30 days');

-- 6. Freshness filter sanity
SELECT min(posted_date), max(posted_date), count(*) FROM public.jobs
WHERE ats_provider = 'ashby'
  AND first_seen_at >= now() - interval '24 hours';

-- 7. Large boards (previously truncated by 200 cap)
SELECT c.ats_slug, c.total_jobs_seen
FROM public.companies c
WHERE c.ats_provider = 'ashby' AND c.total_jobs_seen > 200
ORDER BY c.total_jobs_seen DESC;
```

## Common Pitfalls

### Freshness vs. Staleness Set Distinction

**This is the most important architectural detail in this migration.**

The Ashby scraper produces TWO output sets:

| Set | What it contains | Used for |
|-----|------------------|----------|
| `allListedAshbyIds` | Every listed job ID on the board, regardless of age | Staleness sweep |
| `jobs` (ingestable) | Only jobs within the freshness window (default 30 days) | New row ingestion |

**Why this matters**: A 60-day-old job that's still on a company's board is a *live* job. It appears in `allListedAshbyIds` but NOT in `jobs` (since the freshness filter excluded it from ingestion). If the staleness sweep incorrectly uses the `jobs` set instead of `allListedAshbyIds`, it would mark every live-but-old job as `is_active=false` on day 31.

**How to verify**: Query 5 above should return NON-ZERO after the first sync. If it returns zero, the staleness sweep is broken.

### Partial Sync Guard

The staleness sweep includes a minimum-expected-seen guard (`MIN_EXPECTED_SEEN = 100`). If fewer than 100 Ashby IDs are seen across all companies, the sweep is aborted to prevent a network outage or Supabase downtime from marking all jobs inactive.

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ASHBY_FRESHNESS_DAYS` | `30` | Skip ingesting postings older than N days |
| `STRICT_PM` | `false` | Exclude Product Marketing Manager titles |
