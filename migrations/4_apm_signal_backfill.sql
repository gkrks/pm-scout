-- Migration 4 — Bug Fix 15g: One-time backfill of apm_signal for existing listings
--
-- Run once after migration 3_apm_signal_column.sql has been applied.
-- New scans will populate the column going forward; this backfill covers existing rows.
--
-- Detection uses title regex + raw_jd_excerpt (if stored).
-- Title-only detection is used when raw_jd_excerpt is null.

update job_listings jl
set apm_signal = case
  -- priority_apm: title clearly matches APM/associate PM patterns
  -- AND the company has an active APM program
  when c.has_apm_program = true
    and c.apm_program_status = 'active'
    and (
      jl.title ~* '\m(APM|associate\s+product\s+manager|rotational\s+product\s+manager)\M'
      or (
        jl.raw_jd_excerpt is not null
        and jl.raw_jd_excerpt ~* '\m(rotational\s+program|new\s+grad(uate)?\s+program|early[\s-]career\s+program)\M'
      )
    )
  then 'priority_apm'

  -- apm_company: company has an active program but this role isn't in it
  when c.has_apm_program = true
    and c.apm_program_status = 'active'
  then 'apm_company'

  -- everything else
  else 'none'
end
from companies c
where jl.company_id = c.id
  and jl.is_active = true
  and jl.apm_signal = 'none';  -- only update rows not yet classified

-- Verify the backfill
-- select apm_signal, count(*)
-- from job_listings
-- where is_active = true
-- group by apm_signal
-- order by apm_signal;
