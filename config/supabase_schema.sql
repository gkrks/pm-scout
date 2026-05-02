-- ============================================================
--  Supabase schema for PM/APM job-listing tracker
--  Companion to: pm_apm_companies.json (reference config)
--
--  Architecture:
--    - companies      : mirrors the JSON reference file. Refresh on each config update.
--    - parser_runs    : one row per parser execution.
--    - job_listings   : one row per (company, role_url). Upsert on each run.
--    - listing_runs   : junction. Records which listings were seen on which run.
--    - applications   : optional — user's application status per listing.
--
--  Upsert contract for job_listings:
--    Unique key:        (company_id, role_url)
--    On insert:         set first_seen_at = last_seen_at = NOW(), is_active = true
--    On match:          set last_seen_at = NOW(), refresh tier/posted_date if changed
--    Post-run cleanup:  any listing for a scanned company NOT seen in this run
--                       should have is_active set to false.
--
--  Idempotency:
--    Re-running the same parser run is safe. UUIDs in pm_apm_companies.json are
--    deterministic (uuidv5 from slug), so re-importing the JSON does not break FKs.
-- ============================================================

-- Required Supabase extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
--  companies
-- ============================================================
create table if not exists public.companies (
    id              uuid primary key,                    -- comes from JSON (deterministic uuidv5)
    slug            text unique not null,
    name            text not null,
    category        text not null,
    careers_url     text not null,
    program_url     text,
    has_apm_program boolean not null default false,
    apm_program_name   text,
    apm_program_status text check (apm_program_status in ('active','paused','intermittent','discontinued')),
    domain_tags     text[] not null default '{}',
    target_roles    text[] not null default '{}',
    notes           text,
    content_hash    text not null,                       -- detects config drift
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists idx_companies_slug          on public.companies(slug);
create index if not exists idx_companies_has_apm       on public.companies(has_apm_program) where has_apm_program = true;
create index if not exists idx_companies_domain_tags   on public.companies using gin(domain_tags);
create index if not exists idx_companies_apm_status    on public.companies(apm_program_status);

comment on table  public.companies is 'Reference companies from pm_apm_companies.json';
comment on column public.companies.id is 'Deterministic uuidv5 from slug; stable across config refreshes';
comment on column public.companies.content_hash is '16-char hash; if changed, re-parse this company';

-- ============================================================
--  parser_runs
-- ============================================================
create table if not exists public.parser_runs (
    id                  uuid primary key default gen_random_uuid(),
    started_at          timestamptz not null default now(),
    completed_at        timestamptz,
    status              text not null default 'running'
                        check (status in ('running','completed','failed','partial')),
    companies_scanned   int not null default 0,
    companies_failed    int not null default 0,
    listings_found      int not null default 0,
    listings_new        int not null default 0,
    listings_updated    int not null default 0,
    listings_deactivated int not null default 0,
    config_version      text,                            -- JSON metadata.version at run time
    config_hash         text,                            -- hash of full filters block
    error_message       text,
    notes               text
);

create index if not exists idx_parser_runs_started_at on public.parser_runs(started_at desc);
create index if not exists idx_parser_runs_status     on public.parser_runs(status);

comment on table public.parser_runs is 'One row per parser execution; ledger of all scans';

-- ============================================================
--  job_listings
-- ============================================================
create table if not exists public.job_listings (
    id              uuid primary key default gen_random_uuid(),
    company_id      uuid not null references public.companies(id) on delete cascade,
    role_url        text not null,                       -- direct link to the JD
    title           text not null,
    location_raw    text,                                -- raw location string from JD
    location_city   text,                                -- normalized to one of allowed_cities
    is_remote       boolean not null default false,
    is_hybrid       boolean not null default false,
    posted_date     date,
    yoe_min         numeric(3,1),
    yoe_max         numeric(3,1),
    yoe_raw         text,                                -- raw experience text from JD
    tier            int check (tier in (1,2,3)),         -- ranking tier
    salary_min      int,
    salary_max      int,
    salary_currency text default 'USD',
    requires_sponsorship_unclear boolean default true,
    sponsorship_offered boolean,                         -- null if unclear
    domain_tags     text[] not null default '{}',
    raw_jd_excerpt  text,                                -- ~500 chars for debugging
    first_seen_at   timestamptz not null default now(),
    last_seen_at    timestamptz not null default now(),
    is_active       boolean not null default true,       -- false when listing disappears
    closed_at       timestamptz,                         -- set when is_active flips false
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    -- The upsert key
    constraint job_listings_company_url_unique unique (company_id, role_url)
);

create index if not exists idx_listings_company    on public.job_listings(company_id);
create index if not exists idx_listings_active     on public.job_listings(is_active) where is_active = true;
create index if not exists idx_listings_tier       on public.job_listings(tier);
create index if not exists idx_listings_first_seen on public.job_listings(first_seen_at desc);
create index if not exists idx_listings_last_seen  on public.job_listings(last_seen_at desc);
create index if not exists idx_listings_posted     on public.job_listings(posted_date desc);
create index if not exists idx_listings_city       on public.job_listings(location_city);

comment on table  public.job_listings is 'One row per (company, role_url). Upsert target for parser.';
comment on column public.job_listings.first_seen_at is 'Set on first insert; never updated';
comment on column public.job_listings.last_seen_at  is 'Updated to NOW() every run the listing is still found';
comment on column public.job_listings.is_active     is 'false when listing was not seen in last run for that company';

-- ============================================================
--  listing_runs (junction)
-- ============================================================
-- Records which listings were observed on which run. Lets you answer
-- "what was new on March 14?" without scanning timestamps.
create table if not exists public.listing_runs (
    id          uuid primary key default gen_random_uuid(),
    run_id      uuid not null references public.parser_runs(id) on delete cascade,
    listing_id  uuid not null references public.job_listings(id) on delete cascade,
    seen_state  text not null check (seen_state in ('new','existing','reactivated')),
    observed_at timestamptz not null default now(),

    constraint listing_runs_unique unique (run_id, listing_id)
);

create index if not exists idx_listing_runs_run     on public.listing_runs(run_id);
create index if not exists idx_listing_runs_listing on public.listing_runs(listing_id);
create index if not exists idx_listing_runs_state   on public.listing_runs(seen_state);

-- ============================================================
--  applications  (optional — user-facing tracker)
-- ============================================================
create table if not exists public.applications (
    id              uuid primary key default gen_random_uuid(),
    listing_id      uuid not null unique references public.job_listings(id) on delete cascade,
    status          text not null default 'not_started'
                    check (status in ('not_started','researching','applied','interviewing','offer','rejected','withdrawn')),
    applied_date    date,
    referral_contact text,
    application_url text,
    notes           text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists idx_applications_status on public.applications(status);

-- ============================================================
--  Trigger: auto-update updated_at
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end $$;

drop trigger if exists trg_companies_updated     on public.companies;
drop trigger if exists trg_listings_updated      on public.job_listings;
drop trigger if exists trg_applications_updated  on public.applications;

create trigger trg_companies_updated     before update on public.companies     for each row execute function public.set_updated_at();
create trigger trg_listings_updated      before update on public.job_listings  for each row execute function public.set_updated_at();
create trigger trg_applications_updated  before update on public.applications  for each row execute function public.set_updated_at();

-- ============================================================
--  Trigger: when is_active flips false, stamp closed_at
-- ============================================================
create or replace function public.set_closed_at_on_inactive()
returns trigger language plpgsql as $$
begin
    if old.is_active = true and new.is_active = false then
        new.closed_at = now();
    elsif new.is_active = true then
        new.closed_at = null;
    end if;
    return new;
end $$;

drop trigger if exists trg_listings_closed_at on public.job_listings;
create trigger trg_listings_closed_at before update on public.job_listings for each row execute function public.set_closed_at_on_inactive();

-- ============================================================
--  Convenience view: currently-open tier-1 roles
-- ============================================================
create or replace view public.v_active_tier1_listings as
select
    jl.id,
    c.name           as company_name,
    c.slug           as company_slug,
    c.has_apm_program,
    c.apm_program_name,
    jl.title,
    jl.role_url,
    jl.location_city,
    jl.is_remote,
    jl.is_hybrid,
    jl.posted_date,
    jl.yoe_min,
    jl.yoe_max,
    jl.tier,
    jl.first_seen_at,
    jl.last_seen_at,
    coalesce(a.status, 'not_started') as application_status
from public.job_listings jl
join public.companies   c on c.id = jl.company_id
left join public.applications a on a.listing_id = jl.id
where jl.is_active = true
  and jl.tier = 1
order by jl.first_seen_at desc;

-- ============================================================
--  Reference upsert query (for the parser)
-- ============================================================
--
-- insert into public.job_listings (
--     company_id, role_url, title, location_raw, location_city,
--     is_remote, is_hybrid, posted_date, yoe_min, yoe_max, yoe_raw,
--     tier, salary_min, salary_max, domain_tags, raw_jd_excerpt
-- ) values (
--     $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
-- )
-- on conflict (company_id, role_url) do update set
--     title           = excluded.title,
--     location_raw    = excluded.location_raw,
--     location_city   = excluded.location_city,
--     is_remote       = excluded.is_remote,
--     is_hybrid       = excluded.is_hybrid,
--     posted_date     = excluded.posted_date,
--     yoe_min         = excluded.yoe_min,
--     yoe_max         = excluded.yoe_max,
--     tier            = excluded.tier,
--     salary_min      = excluded.salary_min,
--     salary_max      = excluded.salary_max,
--     domain_tags     = excluded.domain_tags,
--     raw_jd_excerpt  = excluded.raw_jd_excerpt,
--     last_seen_at    = now(),
--     is_active       = true                              -- reactivate if it was closed
-- returning id, (xmax = 0) as inserted;
--
-- After processing all listings for a company, deactivate the ones not seen:
--
-- update public.job_listings
--    set is_active = false
--  where company_id = $1
--    and last_seen_at < $2;                               -- $2 = run.started_at
--
-- ============================================================
