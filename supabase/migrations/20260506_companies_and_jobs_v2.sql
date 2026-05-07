-- Migration: Ashby DB-driven pipeline — extend companies + job_listings tables
-- Created: 2026-05-06
--
-- Existing schema:
--   companies(id uuid, slug, name, category, careers_url, ...)
--   job_listings(id uuid, company_id uuid FK, role_url, title, ...)

-- Required extension for trigram title search
create extension if not exists pg_trgm;

-- ── companies: add ATS discovery columns ────────────────────────────────────
alter table public.companies add column if not exists ats_provider text;
alter table public.companies add column if not exists ats_slug text;
alter table public.companies add column if not exists internal_slug text;
alter table public.companies add column if not exists website text;
alter table public.companies add column if not exists is_valid boolean default true;
alter table public.companies add column if not exists is_us_company boolean;
alter table public.companies add column if not exists us_job_ratio numeric;
alter table public.companies add column if not exists total_jobs_seen integer default 0;
alter table public.companies add column if not exists trust_tier smallint default 2;
alter table public.companies add column if not exists source text;
alter table public.companies add column if not exists last_validated_at timestamptz;
alter table public.companies add column if not exists last_synced_at timestamptz;

-- Unique constraint for ATS-discovered companies (slug per provider)
-- Can't use a simple UNIQUE because ats_provider/ats_slug may be null for existing rows
create unique index if not exists companies_ats_provider_slug_idx
  on public.companies (ats_provider, ats_slug)
  where ats_provider is not null and ats_slug is not null;

create index if not exists companies_provider_valid_idx
  on public.companies (ats_provider, is_valid)
  where is_valid = true;

create index if not exists companies_us_idx
  on public.companies (is_us_company)
  where is_us_company = true and is_valid = true;

-- ── job_listings: add exhaustive Ashby fields ───────────────────────────────
alter table public.job_listings add column if not exists ats_provider text;
alter table public.job_listings add column if not exists ashby_id text;
alter table public.job_listings add column if not exists department text;
alter table public.job_listings add column if not exists team text;
alter table public.job_listings add column if not exists employment_type text;
alter table public.job_listings add column if not exists workplace_type text;
alter table public.job_listings add column if not exists is_listed boolean;
alter table public.job_listings add column if not exists location_region text;
alter table public.job_listings add column if not exists location_country text;
alter table public.job_listings add column if not exists secondary_locations jsonb;
alter table public.job_listings add column if not exists qualifications jsonb;
alter table public.job_listings add column if not exists comp_summary text;
alter table public.job_listings add column if not exists comp_salary_summary text;
alter table public.job_listings add column if not exists comp_min numeric;
alter table public.job_listings add column if not exists comp_max numeric;
alter table public.job_listings add column if not exists comp_currency text;
alter table public.job_listings add column if not exists comp_raw jsonb;
alter table public.job_listings add column if not exists raw_payload jsonb;

create index if not exists job_listings_active_published_idx
  on public.job_listings (is_active, posted_date desc) where is_active = true;
create index if not exists job_listings_country_idx
  on public.job_listings (location_country) where is_active = true;
create index if not exists job_listings_ashby_id_idx
  on public.job_listings (ashby_id) where ashby_id is not null;
create index if not exists job_listings_title_trgm_idx
  on public.job_listings using gin (title gin_trgm_ops);
create index if not exists job_listings_qualifications_idx
  on public.job_listings using gin (qualifications);
