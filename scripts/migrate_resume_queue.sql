-- Migration: Create resume_queue table
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query)

CREATE TABLE IF NOT EXISTS public.resume_queue (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id      uuid NOT NULL REFERENCES public.job_listings(id) ON DELETE CASCADE,
    role_url        text NOT NULL,
    title           text NOT NULL,
    company_name    text NOT NULL,
    location_raw    text,
    role_category   text DEFAULT 'PM' CHECK (role_category IN ('PM', 'TPM', 'SWE')),
    yoe_min         numeric(3,1),
    yoe_max         numeric(3,1),
    posted_date     date,
    apm_signal      text,
    ats_platform    text,
    was_resume_created boolean NOT NULL DEFAULT false,
    requested_at    timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    -- Prevent duplicate queue entries for the same listing
    CONSTRAINT resume_queue_listing_unique UNIQUE (listing_id)
);

CREATE INDEX IF NOT EXISTS idx_resume_queue_listing     ON public.resume_queue(listing_id);
CREATE INDEX IF NOT EXISTS idx_resume_queue_category    ON public.resume_queue(role_category);
CREATE INDEX IF NOT EXISTS idx_resume_queue_pending     ON public.resume_queue(was_resume_created) WHERE was_resume_created = false;
CREATE INDEX IF NOT EXISTS idx_resume_queue_requested   ON public.resume_queue(requested_at DESC);

-- Auto-update updated_at
DROP TRIGGER IF EXISTS trg_resume_queue_updated ON public.resume_queue;
CREATE TRIGGER trg_resume_queue_updated
  BEFORE UPDATE ON public.resume_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE  public.resume_queue IS 'Queue of jobs for which the user wants a tailored resume generated';
COMMENT ON COLUMN public.resume_queue.was_resume_created IS 'Set to true once the resume has been generated';
