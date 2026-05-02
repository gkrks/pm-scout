-- Migration 2: upsert_listing_returning_state
--
-- Atomic upsert that returns seen_state ('new' | 'existing' | 'reactivated')
-- without relying on the xmax trick or ORM-level interpretation.
--
-- NOTE: The TypeScript layer (src/storage/upsertListing.ts) uses the pre-fetch
-- approach instead, which is equivalent and avoids an extra DB round-trip per
-- batch. This function is provided as an authoritative reference implementation
-- and can replace the pre-fetch approach if more atomic guarantees are needed.

create or replace function public.upsert_listing_returning_state(
  p_company_id                   uuid,
  p_role_url                     text,
  p_title                        text,
  p_location_raw                 text,
  p_location_city                text,
  p_is_remote                    boolean,
  p_is_hybrid                    boolean,
  p_posted_date                  date,
  p_yoe_min                      numeric,
  p_yoe_max                      numeric,
  p_yoe_raw                      text,
  p_tier                         int,
  p_salary_min                   int,
  p_salary_max                   int,
  p_domain_tags                  text[],
  p_raw_jd_excerpt               text,
  p_requires_sponsorship_unclear boolean,
  p_sponsorship_offered          boolean
) returns table(listing_id uuid, seen_state text) language plpgsql as $$
declare
  v_existing record;
  v_id       uuid;
  v_state    text;
begin
  -- Look up the existing row (if any) BEFORE the upsert so we know its prior is_active state.
  select id, is_active into v_existing
  from public.job_listings
  where company_id = p_company_id and role_url = p_role_url;

  insert into public.job_listings (
    company_id, role_url, title, location_raw, location_city,
    is_remote, is_hybrid, posted_date, yoe_min, yoe_max, yoe_raw,
    tier, salary_min, salary_max, domain_tags, raw_jd_excerpt,
    requires_sponsorship_unclear, sponsorship_offered
  ) values (
    p_company_id, p_role_url, p_title, p_location_raw, p_location_city,
    p_is_remote, p_is_hybrid, p_posted_date, p_yoe_min, p_yoe_max, p_yoe_raw,
    p_tier, p_salary_min, p_salary_max, p_domain_tags, p_raw_jd_excerpt,
    p_requires_sponsorship_unclear, p_sponsorship_offered
  )
  on conflict (company_id, role_url) do update set
    title                        = excluded.title,
    location_raw                 = excluded.location_raw,
    location_city                = excluded.location_city,
    is_remote                    = excluded.is_remote,
    is_hybrid                    = excluded.is_hybrid,
    posted_date                  = excluded.posted_date,
    yoe_min                      = excluded.yoe_min,
    yoe_max                      = excluded.yoe_max,
    yoe_raw                      = excluded.yoe_raw,
    tier                         = excluded.tier,
    salary_min                   = excluded.salary_min,
    salary_max                   = excluded.salary_max,
    domain_tags                  = excluded.domain_tags,
    raw_jd_excerpt               = excluded.raw_jd_excerpt,
    requires_sponsorship_unclear = excluded.requires_sponsorship_unclear,
    sponsorship_offered          = excluded.sponsorship_offered,
    last_seen_at                 = now(),
    is_active                    = true
  returning id into v_id;

  if v_existing.id is null then
    v_state := 'new';
  elsif v_existing.is_active = false then
    v_state := 'reactivated';
  else
    v_state := 'existing';
  end if;

  return query select v_id, v_state;
end;
$$;
