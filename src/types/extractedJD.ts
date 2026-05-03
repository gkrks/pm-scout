import { z } from "zod";

export const ExtractedJDSchema = z.object({
  // === IDENTITY (required) ============================================
  job_title: z.string().min(1),
  company_name: z.string().min(1),

  // === LOCATION (required, structured) ================================
  location: z.object({
    raw: z.string(),
    cities: z.array(z.string()),
    states: z.array(z.string()),
    countries: z.array(z.string()),
    is_remote: z.boolean(),
    is_hybrid: z.boolean(),
    is_onsite: z.boolean(),
    remote_region_restrictions: z.array(z.string()).nullable(),
    hybrid_days_in_office: z.number().int().nullable(),
    relocation_offered: z.boolean().nullable(),
  }),

  // === EMPLOYMENT (required) ==========================================
  employment: z.object({
    type: z.enum(["full_time", "part_time", "contract", "internship", "temporary", "unknown"]),
    duration_months: z.number().nullable(),
    start_date: z.string().nullable(),
    end_date: z.string().nullable(),
    is_early_career: z.boolean(),
    seniority_level: z.enum(["intern", "entry", "mid", "senior", "staff", "principal", "director", "vp", "unknown"]),
    is_people_manager: z.boolean().nullable(),
    team_size_managed: z.number().int().nullable(),
  }),

  // === EXPERIENCE =====================================================
  experience: z.object({
    years_min: z.number().nullable(),
    years_max: z.number().nullable(),
    years_raw: z.string().nullable(),
    is_new_grad_friendly: z.boolean(),
    domains_required: z.array(z.string()),
  }),

  // === EDUCATION ======================================================
  education: z.object({
    minimum_degree: z.enum(["high_school", "associates", "bachelors", "masters", "phd", "mba", "none", "unknown"]),
    preferred_degree: z.enum(["bachelors", "masters", "phd", "mba", "none", "unknown"]),
    fields_of_study: z.array(z.string()),
    accepts_equivalent_experience: z.boolean().nullable(),
  }),

  // === REQUIREMENTS (required) ========================================
  required_qualifications: z.array(z.string()),
  preferred_qualifications: z.array(z.string()),

  // === RESPONSIBILITIES (required) ====================================
  responsibilities: z.array(z.string()),

  // === SKILLS =========================================================
  skills: z.object({
    technical: z.array(z.string()),
    tools: z.array(z.string()),
    methodologies: z.array(z.string()),
    soft: z.array(z.string()),
    languages: z.array(z.string()),
    domain_expertise: z.array(z.string()),
  }),

  // === CERTIFICATIONS =================================================
  certifications: z.object({
    required: z.array(z.string()),
    preferred: z.array(z.string()),
  }),

  // === COMPENSATION ===================================================
  compensation: z.object({
    base_salary_min: z.number().nullable(),
    base_salary_max: z.number().nullable(),
    currency: z.string().nullable(),
    pay_period: z.enum(["annual", "monthly", "hourly"]).nullable(),
    equity_offered: z.boolean().nullable(),
    equity_details: z.string().nullable(),
    bonus_offered: z.boolean().nullable(),
    bonus_details: z.string().nullable(),
    sign_on_bonus: z.boolean().nullable(),
    pay_transparency_disclosure_present: z.boolean(),
  }),

  // === WORK AUTHORIZATION =============================================
  authorization: z.object({
    sponsorship_offered: z.boolean().nullable(),
    sponsorship_explicit_statement: z.string().nullable(),
    security_clearance_required: z.boolean(),
    security_clearance_type: z.string().nullable(),
    citizenship_requirement: z.string().nullable(),
  }),

  // === ROLE CONTEXT ===================================================
  role_context: z.object({
    summary: z.string().nullable(),
    product_area: z.string().nullable(),
    team_name: z.string().nullable(),
    reports_to: z.string().nullable(),
    cross_functional_partners: z.array(z.string()),
    domain_tags: z.array(z.string()),
  }),

  // === COMPANY CONTEXT ================================================
  company_context: z.object({
    description: z.string().nullable(),
    industry: z.string().nullable(),
    stage: z.string().nullable(),
    size_employees: z.string().nullable(),
    mission_statement: z.string().nullable(),
  }),

  // === LOGISTICS ======================================================
  logistics: z.object({
    travel_required: z.boolean().nullable(),
    travel_percentage: z.number().nullable(),
    on_call_required: z.boolean().nullable(),
    standard_hours: z.string().nullable(),
  }),

  // === BENEFITS =======================================================
  benefits: z.object({
    health_insurance: z.boolean().nullable(),
    dental_vision: z.boolean().nullable(),
    retirement_plan: z.boolean().nullable(),
    pto_days: z.number().nullable(),
    pto_unlimited: z.boolean().nullable(),
    parental_leave: z.boolean().nullable(),
    learning_stipend: z.boolean().nullable(),
    wellness_stipend: z.boolean().nullable(),
    remote_work_stipend: z.boolean().nullable(),
    raw_perks: z.array(z.string()),
  }),

  // === APPLICATION PROCESS ============================================
  application: z.object({
    deadline: z.string().nullable(),
    process_steps: z.array(z.string()),
    estimated_timeline: z.string().nullable(),
    recruiter_name: z.string().nullable(),
    recruiter_email: z.string().nullable(),
    referral_program: z.boolean().nullable(),
    requires_cover_letter: z.boolean().nullable(),
    requires_portfolio: z.boolean().nullable(),
  }),

  // === LEGAL / EEO ====================================================
  legal: z.object({
    eeo_statement_present: z.boolean(),
    e_verify: z.boolean().nullable(),
    background_check_required: z.boolean().nullable(),
  }),

  // === ATS KEYWORDS ===================================================
  ats_keywords: z.object({
    high_priority: z.array(z.string()),
    medium_priority: z.array(z.string()),
    low_priority: z.array(z.string()),
    acronyms: z.record(z.string(), z.string()),
    job_specific_buzzwords: z.array(z.string()),
  }),

  // === EXTRACTION META (required) =====================================
  extraction_meta: z.object({
    schema_version: z.literal("1.0.0"),
    extracted_at: z.string(),
    source_url: z.string().nullable(),
    source_ats: z.string().nullable(),
    source_content_length: z.number().int(),
    confidence: z.enum(["high", "medium", "low"]),
    ambiguous_fields: z.array(z.string()),
    missing_sections: z.array(z.string()),
    extraction_notes: z.string().nullable(),
  }),
});

export type ExtractedJD = z.infer<typeof ExtractedJDSchema>;
