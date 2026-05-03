import { ExtractedJDSchema } from "../types/extractedJD";
import { htmlToText } from "../lib/htmlToText";

// ── Fixture: valid ExtractedJD matching Example A from spec ──────────────────

const VALID_FIXTURE = {
  job_title: "Product Manager, Search Quality",
  company_name: "Google",
  location: {
    raw: "Mountain View, CA / New York, NY / Remote (US)",
    cities: ["Mountain View", "New York"],
    states: ["CA", "NY"],
    countries: ["US"],
    is_remote: true,
    is_hybrid: false,
    is_onsite: false,
    remote_region_restrictions: ["US"],
    hybrid_days_in_office: null,
    relocation_offered: null,
  },
  employment: {
    type: "full_time",
    duration_months: null,
    start_date: null,
    end_date: null,
    is_early_career: false,
    seniority_level: "mid",
    is_people_manager: null,
    team_size_managed: null,
  },
  experience: {
    years_min: 4,
    years_max: null,
    years_raw: "4 years of experience in product management",
    is_new_grad_friendly: false,
    domains_required: [],
  },
  education: {
    minimum_degree: "bachelors",
    preferred_degree: "masters",
    fields_of_study: ["Computer Science"],
    accepts_equivalent_experience: true,
  },
  required_qualifications: [
    "Bachelor's degree or equivalent practical experience",
    "4 years of experience in product management",
    "2 years of experience working with technical teams (engineering, ML)",
  ],
  preferred_qualifications: [
    "Master's degree in Computer Science or related technical field",
    "Experience with information retrieval, ranking, or search systems",
    "Experience running A/B tests and analyzing results in SQL",
    "Excellent written and verbal communication skills",
  ],
  responsibilities: [
    "Define the product roadmap for Search Quality.",
    "Drive experimentation and analysis to inform ranking changes.",
    "Communicate trade-offs to senior leadership.",
  ],
  skills: {
    technical: ["A/B testing", "experimentation"],
    tools: ["SQL"],
    methodologies: [],
    soft: ["written communication", "verbal communication"],
    languages: [],
    domain_expertise: ["search", "ML"],
  },
  certifications: { required: [], preferred: [] },
  compensation: {
    base_salary_min: 174000,
    base_salary_max: 258000,
    currency: "USD",
    pay_period: "annual",
    equity_offered: true,
    equity_details: "+ equity",
    bonus_offered: true,
    bonus_details: "+ bonus",
    sign_on_bonus: null,
    pay_transparency_disclosure_present: true,
  },
  authorization: {
    sponsorship_offered: null,
    sponsorship_explicit_statement: null,
    security_clearance_required: false,
    security_clearance_type: null,
    citizenship_requirement: null,
  },
  role_context: {
    summary: "Define how Google Search measures and improves relevance.",
    product_area: "Search Quality",
    team_name: "Search Quality",
    reports_to: null,
    cross_functional_partners: ["Engineering", "UX", "Research"],
    domain_tags: ["search", "ML/AI"],
  },
  company_context: {
    description: null,
    industry: null,
    stage: null,
    size_employees: null,
    mission_statement: null,
  },
  logistics: {
    travel_required: null,
    travel_percentage: null,
    on_call_required: null,
    standard_hours: null,
  },
  benefits: {
    health_insurance: null,
    dental_vision: null,
    retirement_plan: null,
    pto_days: null,
    pto_unlimited: null,
    parental_leave: null,
    learning_stipend: null,
    wellness_stipend: null,
    remote_work_stipend: null,
    raw_perks: [],
  },
  application: {
    deadline: null,
    process_steps: [],
    estimated_timeline: null,
    recruiter_name: null,
    recruiter_email: null,
    referral_program: null,
    requires_cover_letter: null,
    requires_portfolio: null,
  },
  legal: {
    eeo_statement_present: true,
    e_verify: null,
    background_check_required: null,
  },
  ats_keywords: {
    high_priority: ["product management", "Search"],
    medium_priority: ["ranking"],
    low_priority: ["UX"],
    acronyms: { PM: "Product Manager" },
    job_specific_buzzwords: ["Search Quality"],
  },
  extraction_meta: {
    schema_version: "1.0.0" as const,
    extracted_at: "2026-05-02T21:00:00Z",
    source_url: null,
    source_ats: "greenhouse",
    source_content_length: 1048,
    confidence: "high" as const,
    ambiguous_fields: [],
    missing_sections: ["benefits", "application"],
    extraction_notes: null,
  },
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ExtractedJDSchema", () => {
  it("parses a valid fixture matching Example A", () => {
    const result = ExtractedJDSchema.safeParse(VALID_FIXTURE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.job_title).toBe("Product Manager, Search Quality");
      expect(result.data.compensation.base_salary_min).toBe(174000);
      expect(result.data.extraction_meta.schema_version).toBe("1.0.0");
    }
  });

  it("rejects JSON missing required job_title", () => {
    const invalid = { ...VALID_FIXTURE, job_title: "" };
    const result = ExtractedJDSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects JSON missing company_name entirely", () => {
    const { company_name: _, ...noCompany } = VALID_FIXTURE;
    const result = ExtractedJDSchema.safeParse(noCompany);
    expect(result.success).toBe(false);
  });

  it("rejects invalid schema_version", () => {
    const invalid = {
      ...VALID_FIXTURE,
      extraction_meta: { ...VALID_FIXTURE.extraction_meta, schema_version: "2.0.0" },
    };
    const result = ExtractedJDSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe("htmlToText", () => {
  it("strips <script> and <style> tags", () => {
    const html = `
      <style>.foo { color: red; }</style>
      <script>alert('hi')</script>
      <p>Hello world</p>
    `;
    const text = htmlToText(html);
    expect(text).not.toContain("color: red");
    expect(text).not.toContain("alert");
    expect(text).toContain("Hello world");
  });

  it("preserves heading structure as line breaks", () => {
    const html = `<h2>Requirements</h2><p>Must have 3 years experience</p>`;
    const text = htmlToText(html);
    expect(text).toContain("Requirements");
    expect(text).toContain("Must have 3 years experience");
    // Heading should be on its own line
    const lines = text.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it("converts list items to dash-prefixed lines", () => {
    const html = `<ul><li>SQL</li><li>Python</li><li>A/B testing</li></ul>`;
    const text = htmlToText(html);
    expect(text).toContain("- SQL");
    expect(text).toContain("- Python");
    expect(text).toContain("- A/B testing");
  });

  it("decodes HTML entities", () => {
    const html = `<p>Salary: $100,000 &ndash; $150,000 &amp; equity</p>`;
    const text = htmlToText(html);
    expect(text).toContain("$100,000");
    expect(text).toContain("& equity");
  });

  it("collapses excessive whitespace", () => {
    const html = `<p>Hello</p><p></p><p></p><p></p><p></p><p>World</p>`;
    const text = htmlToText(html);
    // Should not have more than 2 consecutive newlines
    expect(text).not.toMatch(/\n{3,}/);
  });
});
