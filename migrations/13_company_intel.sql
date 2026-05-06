-- ============================================================
--  company_intel: cached scraped chunks from engineering blogs
--  and Apollo news, embedded for retrieval against JD requirements.
-- ============================================================

create table if not exists public.company_intel (
    id              uuid primary key default gen_random_uuid(),
    company_id      uuid not null references public.companies(id) on delete cascade,
    source_url      text not null,
    source_type     text not null check (source_type in (
                      'eng_blog_rss', 'apollo_news', 'apollo_funding'
                    )),
    published_at    timestamptz,
    chunk_text      text not null,
    embedding       vector(1024),
    intel_type      text not null check (intel_type in (
                      'launch', 'technical_decision', 'hiring',
                      'funding', 'mission_shift', 'other'
                    )),
    fetched_at      timestamptz not null default now()
);

create index if not exists idx_intel_company on public.company_intel(company_id);
create index if not exists idx_intel_source_type on public.company_intel(source_type);
create index if not exists idx_intel_published on public.company_intel(published_at desc);
create index if not exists idx_intel_embedding
    on public.company_intel using ivfflat (embedding vector_cosine_ops) with (lists = 20);
