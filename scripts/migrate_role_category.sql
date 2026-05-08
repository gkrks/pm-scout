-- Migration: Add role_category column to job_listings
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query)

ALTER TABLE public.job_listings
ADD COLUMN IF NOT EXISTS role_category text DEFAULT 'PM';

-- Add check constraint separately (IF NOT EXISTS not supported for constraints)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_listings_role_category_check'
  ) THEN
    ALTER TABLE public.job_listings
    ADD CONSTRAINT job_listings_role_category_check
    CHECK (role_category IN ('PM', 'TPM', 'SWE'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_listings_role_category
ON public.job_listings(role_category);

COMMENT ON COLUMN public.job_listings.role_category IS
'Job family: PM (Product Manager), TPM (Technical Program Manager), SWE (Software Engineer)';

-- Backfill existing rows (all current listings are PM)
UPDATE public.job_listings SET role_category = 'PM' WHERE role_category IS NULL;
