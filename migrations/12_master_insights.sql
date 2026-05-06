-- ============================================================
--  master_insights: non-obvious lessons/decisions/takes from
--  the candidate's projects, embedded for semantic retrieval.
-- ============================================================

create extension if not exists vector;

create table if not exists public.master_insights (
    id              uuid primary key default gen_random_uuid(),
    project_id      text not null,
    insight_type    text not null check (insight_type in (
                      'hard_decision', 'lesson', 'surprise',
                      'philosophical_take', 'would_do_differently'
                    )),
    text            text not null,
    source_url      text,
    embedding       vector(1024),
    accepted_at     timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists idx_insights_project_accepted
    on public.master_insights(project_id) where accepted_at is not null;

create index if not exists idx_insights_embedding
    on public.master_insights using ivfflat (embedding vector_cosine_ops) with (lists = 10);
