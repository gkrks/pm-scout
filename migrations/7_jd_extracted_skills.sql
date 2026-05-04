-- Add LLM-extracted skill keywords column to job_listings.
-- These are clean, normalized skill terms extracted by OpenAI from the full JD text,
-- used by the skills optimizer to build ATS-targeted skill lines.
alter table job_listings add column jd_extracted_skills text[];
create index idx_job_listings_extracted_skills on job_listings using gin(jd_extracted_skills);
