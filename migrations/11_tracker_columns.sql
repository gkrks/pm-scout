-- Add phone_screen to status check, add tracker columns
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_status_check
  CHECK (status IN ('not_started','researching','applied','phone_screen','interviewing','offer','rejected','withdrawn'));

ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS email_used text;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS is_referral boolean not null default false;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS referrer_name text;
