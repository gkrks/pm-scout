-- ============================================================
--  Qualification Map: Supabase persistence
--  Two tables: meta (shared config, 1 row) + quals (1 row per qual)
-- ============================================================

-- Enable pgvector for embedding storage (Supabase has this available)
create extension if not exists vector;

-- Map metadata (one active row)
create table if not exists public.qualification_map_meta (
    id              uuid primary key default gen_random_uuid(),
    version         int not null default 3,
    embedding_model text not null default 'text-embedding-3-large',
    embedding_dim   int not null default 3072,
    bullets         jsonb not null,         -- {bullet_id: {t, s}}
    groups          jsonb not null,         -- {group_name: [qual_hashes]}
    resume          jsonb not null,         -- education, experiences, total_months
    stats_quals     int not null default 0,
    stats_bullets   int not null default 0,
    stats_groups    int not null default 0,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- Individual qualification entries (one row per qual hash)
create table if not exists public.qualification_map_quals (
    qual_hash       text primary key,       -- SHA256[:12]
    qual_text       text not null,
    qual_type       text not null default 'bullet_match',
    group_name      text not null,
    freq            int not null default 1,
    bullet_ids      text[] not null,        -- ordered ranked bullet IDs
    similarities    real[] not null,         -- parallel to bullet_ids
    embedding       vector(3072),           -- stored for incremental updates
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists idx_qmap_quals_group on public.qualification_map_quals(group_name);

-- Updated-at triggers (reuses existing function from schema)
drop trigger if exists trg_qmap_meta_updated on public.qualification_map_meta;
create trigger trg_qmap_meta_updated before update on public.qualification_map_meta
    for each row execute function public.set_updated_at();

drop trigger if exists trg_qmap_quals_updated on public.qualification_map_quals;
create trigger trg_qmap_quals_updated before update on public.qualification_map_quals
    for each row execute function public.set_updated_at();
