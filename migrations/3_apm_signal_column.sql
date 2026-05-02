-- Migration 3 — Bug Fix 15a: Add apm_signal column to job_listings
--
-- Classifies each active listing into one of three APM priority levels:
--   'priority_apm'  — job is in a named APM / rotational program
--   'apm_company'   — company runs an APM program but this role isn't in it
--   'none'          — not at an APM-program company
--
-- The column is written by the TypeScript layer during each scan.
-- Run 4_apm_signal_backfill.sql after this migration to populate existing rows.

alter table public.job_listings
  add column if not exists apm_signal text
    check (apm_signal in ('priority_apm', 'apm_company', 'none'))
    default 'none';

-- Index for efficient filtering of APM-signal jobs in digest queries.
create index if not exists idx_job_listings_apm_signal
  on public.job_listings(apm_signal)
  where apm_signal != 'none';
