-- ============================================================
--  scrape_failures: append-only log of all scrape/fetch failures.
--  Never silently swallow errors — log them here for visibility.
-- ============================================================

create table if not exists public.scrape_failures (
    id              uuid primary key default gen_random_uuid(),
    source_url      text not null,
    company_id      uuid references public.companies(id) on delete set null,
    error_class     text not null,
    error_message   text,
    failed_at       timestamptz not null default now()
);

create index if not exists idx_scrape_failures_company on public.scrape_failures(company_id);
create index if not exists idx_scrape_failures_time on public.scrape_failures(failed_at desc);
