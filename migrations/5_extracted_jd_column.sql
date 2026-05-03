-- Add per-section extracted JD columns to job_listings
-- Each top-level section of the ExtractedJD schema gets its own JSONB column.

-- Identity (plain text)
alter table job_listings add column jd_job_title text;
alter table job_listings add column jd_company_name text;

-- Structured sections (jsonb)
alter table job_listings add column jd_location jsonb;
alter table job_listings add column jd_employment jsonb;
alter table job_listings add column jd_experience jsonb;
alter table job_listings add column jd_education jsonb;
alter table job_listings add column jd_required_qualifications jsonb;
alter table job_listings add column jd_preferred_qualifications jsonb;
alter table job_listings add column jd_responsibilities jsonb;
alter table job_listings add column jd_skills jsonb;
alter table job_listings add column jd_certifications jsonb;
alter table job_listings add column jd_compensation jsonb;
alter table job_listings add column jd_authorization jsonb;
alter table job_listings add column jd_role_context jsonb;
alter table job_listings add column jd_company_context jsonb;
alter table job_listings add column jd_logistics jsonb;
alter table job_listings add column jd_benefits jsonb;
alter table job_listings add column jd_application jsonb;
alter table job_listings add column jd_legal jsonb;
alter table job_listings add column jd_ats_keywords jsonb;

-- Extraction metadata
alter table job_listings add column jd_extraction_meta jsonb;
alter table job_listings add column extracted_at timestamptz;

create index idx_job_listings_extracted_at on job_listings(extracted_at);
