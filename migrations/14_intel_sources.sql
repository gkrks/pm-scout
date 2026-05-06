-- ============================================================
--  intel_sources: registry of RSS/Atom feeds per company.
--  The scraper reads this to know what to fetch and tracks
--  failure streaks for circuit-breaking.
-- ============================================================

create table if not exists public.intel_sources (
    id                    uuid primary key default gen_random_uuid(),
    company_id            uuid not null references public.companies(id) on delete cascade,
    feed_url              text not null,
    feed_type             text not null check (feed_type in ('rss', 'atom')),
    last_fetched_at       timestamptz,
    last_status           text,
    consecutive_failures  int not null default 0,
    created_at            timestamptz not null default now()
);

create unique index if not exists idx_intel_sources_company_feed
    on public.intel_sources(company_id, feed_url);
