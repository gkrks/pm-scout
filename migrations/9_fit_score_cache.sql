-- ============================================================
--  fit_score_cache: stores LLM-generated Check Fit results
--  so repeat visits don't re-run expensive scoring/summary calls
-- ============================================================

create table if not exists public.fit_score_cache (
    id                  uuid primary key default gen_random_uuid(),
    listing_id          uuid not null unique references public.job_listings(id) on delete cascade,
    score_response      jsonb not null,       -- ranked_candidates, final_selection, pre_resolved
    summary_candidates  jsonb,                -- array of summary candidate objects
    summary_recommended int,
    summary_jd_analysis text,
    optimized_skills    jsonb,                -- array of skill line objects
    skills_gap_filled   jsonb,                -- string[]
    skills_gap_remaining jsonb,               -- string[]
    model_version       text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index if not exists idx_fit_score_cache_listing on public.fit_score_cache(listing_id);

-- Reuse existing updated_at trigger
drop trigger if exists trg_fit_score_cache_updated on public.fit_score_cache;
create trigger trg_fit_score_cache_updated before update on public.fit_score_cache
    for each row execute function public.set_updated_at();
