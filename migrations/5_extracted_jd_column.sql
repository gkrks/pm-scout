-- Add extracted JD columns to job_listings
alter table job_listings add column extracted_jd jsonb;
alter table job_listings add column extraction_confidence text;
alter table job_listings add column extracted_at timestamptz;
create index idx_job_listings_extracted_at on job_listings(extracted_at);
