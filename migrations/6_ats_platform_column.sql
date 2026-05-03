-- Add ATS platform column to job_listings
alter table job_listings add column ats_platform text;
create index idx_job_listings_ats_platform on job_listings(ats_platform);
