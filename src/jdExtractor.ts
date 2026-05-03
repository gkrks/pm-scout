/**
 * JD Extractor — converts raw scraped job postings into structured ExtractedJD JSON
 * using the Groq API with Zod schema validation.
 */

import Groq from "groq-sdk";
import { ExtractedJDSchema, type ExtractedJD } from "./types/extractedJD";
import { htmlToText } from "./lib/htmlToText";

// ── Error type ───────────────────────────────────────────────────────────────

export class JDExtractionError extends Error {
  constructor(
    message: string,
    public readonly rawResponse: string,
    public readonly zodErrors?: string,
  ) {
    super(message);
    this.name = "JDExtractionError";
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_CLEANED_TEXT_LENGTH = 24_000;
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

// ── Groq client (lazy singleton) ─────────────────────────────────────────────

let _client: Groq | null = null;
function getClient(): Groq {
  if (!_client) {
    _client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _client;
}

// ── Few-shot examples ────────────────────────────────────────────────────────

const EXAMPLE_A_INPUT = `Product Manager, Search Quality
Google · Mountain View, CA / New York, NY / Remote (US)

About the role
Search is at the heart of Google. As a PM on the Search Quality team,
you'll define how we measure and improve relevance for billions of users.

Minimum qualifications:
- Bachelor's degree or equivalent practical experience
- 4 years of experience in product management
- 2 years of experience working with technical teams (engineering, ML)

Preferred qualifications:
- Master's degree in Computer Science or related technical field
- Experience with information retrieval, ranking, or search systems
- Experience running A/B tests and analyzing results in SQL
- Excellent written and verbal communication skills

About the job
- Define the product roadmap for Search Quality, partnering with Engineering, UX, and Research.
- Drive experimentation and analysis to inform ranking changes.
- Communicate trade-offs to senior leadership.

The US base salary range for this full-time position is $174,000-$258,000 + bonus + equity + benefits. Google is proud to be an equal opportunity workplace.`;

const EXAMPLE_A_OUTPUT = JSON.stringify({
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
    "Define the product roadmap for Search Quality, partnering with Engineering, UX, and Research.",
    "Drive experimentation and analysis to inform ranking changes.",
    "Communicate trade-offs to senior leadership.",
  ],
  skills: {
    technical: ["A/B testing", "experimentation", "information retrieval", "ranking", "search systems"],
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
    summary: "Define how Google Search measures and improves relevance for billions of users, on the Search Quality team.",
    product_area: "Search Quality",
    team_name: "Search Quality",
    reports_to: null,
    cross_functional_partners: ["Engineering", "UX", "Research"],
    domain_tags: ["search", "ML/AI", "ranking"],
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
    high_priority: ["product management", "Search", "experimentation", "A/B testing", "SQL"],
    medium_priority: ["ranking", "information retrieval", "ML", "Engineering"],
    low_priority: ["UX", "Research", "Master's"],
    acronyms: { PM: "Product Manager", ML: "Machine Learning", UX: "User Experience" },
    job_specific_buzzwords: ["Search Quality", "ranking changes", "trade-offs"],
  },
  extraction_meta: {
    schema_version: "1.0.0",
    extracted_at: "2026-05-02T21:00:00Z",
    source_url: null,
    source_ats: "greenhouse",
    source_content_length: 1048,
    confidence: "high",
    ambiguous_fields: [],
    missing_sections: ["benefits", "application", "authorization"],
    extraction_notes: null,
  },
}, null, 2);

const EXAMPLE_B_INPUT = `Product Manager — Growth
Linear · San Francisco (Hybrid, 3 days/week)

We're building the issue tracker that engineers actually love. As our first
dedicated Growth PM, you'll own the activation funnel end-to-end.

What you'll do
You'll partner with our Growth Engineering team to find leverage in
onboarding, free-to-paid conversion, and team-expansion loops. You'll
ship experiments weekly. You'll talk to users every week without
exception.

What you'll need
- 3+ years as a PM, ideally with growth experience at a B2B SaaS company
- Comfort writing SQL queries and reading dashboards (we use Metabase)
- A track record of shipped, measurable wins

Bonus points
- You've worked at a developer-tools company
- You've built or contributed to a side project that real people use

Compensation: $180K-$220K + meaningful equity. Visa sponsorship available
for exceptional candidates. We do not currently sponsor candidates
requiring relocation to the US.`;

const EXAMPLE_B_OUTPUT = JSON.stringify({
  job_title: "Product Manager — Growth",
  company_name: "Linear",
  location: {
    raw: "San Francisco (Hybrid, 3 days/week)",
    cities: ["San Francisco"],
    states: ["CA"],
    countries: ["US"],
    is_remote: false,
    is_hybrid: true,
    is_onsite: false,
    remote_region_restrictions: null,
    hybrid_days_in_office: 3,
    relocation_offered: false,
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
    years_min: 3,
    years_max: null,
    years_raw: "3+ years as a PM, ideally with growth experience at a B2B SaaS company",
    is_new_grad_friendly: false,
    domains_required: ["growth", "B2B SaaS"],
  },
  education: {
    minimum_degree: "unknown",
    preferred_degree: "unknown",
    fields_of_study: [],
    accepts_equivalent_experience: null,
  },
  required_qualifications: [
    "3+ years as a PM, ideally with growth experience at a B2B SaaS company",
    "Comfort writing SQL queries and reading dashboards (we use Metabase)",
    "A track record of shipped, measurable wins",
  ],
  preferred_qualifications: [
    "You've worked at a developer-tools company",
    "You've built or contributed to a side project that real people use",
  ],
  responsibilities: [
    "Partner with Growth Engineering team to find leverage in onboarding, free-to-paid conversion, and team-expansion loops",
    "Ship experiments weekly",
    "Talk to users every week without exception",
  ],
  skills: {
    technical: ["SQL", "experimentation"],
    tools: ["Metabase"],
    methodologies: ["growth loops", "activation funnel optimization"],
    soft: ["user research"],
    languages: [],
    domain_expertise: ["growth", "B2B SaaS", "developer tools"],
  },
  certifications: { required: [], preferred: [] },
  compensation: {
    base_salary_min: 180000,
    base_salary_max: 220000,
    currency: "USD",
    pay_period: "annual",
    equity_offered: true,
    equity_details: "meaningful equity",
    bonus_offered: null,
    bonus_details: null,
    sign_on_bonus: null,
    pay_transparency_disclosure_present: true,
  },
  authorization: {
    sponsorship_offered: true,
    sponsorship_explicit_statement: "Visa sponsorship available for exceptional candidates. We do not currently sponsor candidates requiring relocation to the US.",
    security_clearance_required: false,
    security_clearance_type: null,
    citizenship_requirement: null,
  },
  role_context: {
    summary: "First dedicated Growth PM at Linear; owns the activation funnel end-to-end.",
    product_area: "Growth",
    team_name: "Growth",
    reports_to: null,
    cross_functional_partners: ["Growth Engineering"],
    domain_tags: ["growth", "B2B SaaS", "developer tools"],
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
    eeo_statement_present: false,
    e_verify: null,
    background_check_required: null,
  },
  ats_keywords: {
    high_priority: ["PM", "growth", "SQL", "B2B SaaS"],
    medium_priority: ["experiments", "onboarding", "developer tools"],
    low_priority: ["Metabase", "activation funnel"],
    acronyms: { PM: "Product Manager" },
    job_specific_buzzwords: ["activation funnel", "free-to-paid conversion", "team-expansion loops"],
  },
  extraction_meta: {
    schema_version: "1.0.0",
    extracted_at: "2026-05-02T21:00:00Z",
    source_url: null,
    source_ats: "lever",
    source_content_length: 680,
    confidence: "high",
    ambiguous_fields: ["authorization.sponsorship_offered"],
    missing_sections: ["benefits", "education", "application", "legal"],
    extraction_notes: "Sponsorship is conditional ('exceptional candidates') and explicitly excludes relocation cases — flagged as ambiguous.",
  },
}, null, 2);

// ── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a job-posting parser. Your only job is to convert a single raw job
posting (HTML or plain text) into a JSON object that conforms exactly to
the ExtractedJD schema you have been given.

Here are two examples of correct extractions:

<example>
INPUT:
${EXAMPLE_A_INPUT}

OUTPUT:
${EXAMPLE_A_OUTPUT}
</example>

<example>
INPUT:
${EXAMPLE_B_INPUT}

OUTPUT:
${EXAMPLE_B_OUTPUT}
</example>

Rules:

1. SEMANTIC NORMALIZATION. Posting headings vary wildly. Map by meaning,
   not by literal heading text. "Basic Qualifications" / "What You'll Need"
   / "Requirements" / "Minimum Qualifications" all mean the same bucket:
   required_qualifications. Use the heading alias rules from the spec.

2. PRESERVE WORDING. For required_qualifications, preferred_qualifications,
   and responsibilities, keep the original phrasing verbatim or near-verbatim.
   Each bullet/sentence becomes a separate array element. Do not summarize
   or rewrite — downstream resume matching depends on exact phrasing.

3. EXTRACT, DON'T INVENT. If a field is not present in the source, set it
   to null (or an empty array for list fields). Never guess salaries,
   degrees, or sponsorship policies. If you guess at all, list the field
   path in extraction_meta.ambiguous_fields and explain in extraction_notes.

4. FILL ALL REQUIRED FIELDS. Never omit a key. Use null / [] / "unknown"
   when truly absent. The schema must validate.

5. SKILL DEDUPLICATION. Skills appear multiple places (in qualifications,
   responsibilities, narrative). Extract once, deduplicate, categorize
   into technical / tools / methodologies / soft / languages / domain_expertise.

6. ATS KEYWORDS. Count term frequency across the entire document. Place
   each high-signal term into one of: high_priority (3+ mentions OR in
   required quals), medium_priority (2 mentions), low_priority (1).
   Expand acronyms when the long form appears anywhere.

7. CONFIDENCE LEVEL.
   - high: every required section was explicitly present, no guesses.
   - medium: some sections inferred from context or had ambiguous phrasing.
   - low: significant content missing, very short posting, or heavy guessing.

8. OUTPUT FORMAT. Return only the JSON object. No prose, no markdown
   fences, no commentary. The first character of your response must be \`{\`.`;

// ── Public API ───────────────────────────────────────────────────────────────

export interface ExtractJDInput {
  rawHtml?: string;
  rawText?: string;
  companyName: string;
  sourceAts: string | null;
  sourceUrl: string | null;
}

export async function extractJD(input: ExtractJDInput): Promise<ExtractedJD> {
  const { companyName, sourceAts, sourceUrl } = input;

  if (!input.rawHtml && !input.rawText) {
    throw new Error("extractJD requires either rawHtml or rawText");
  }

  // Clean HTML → plain text
  let cleanedText = input.rawText ?? htmlToText(input.rawHtml!);

  // Truncate to MAX_CLEANED_TEXT_LENGTH, keeping beginning and end
  if (cleanedText.length > MAX_CLEANED_TEXT_LENGTH) {
    const half = Math.floor(MAX_CLEANED_TEXT_LENGTH / 2);
    cleanedText =
      cleanedText.slice(0, half) +
      "\n\n[... content truncated ...]\n\n" +
      cleanedText.slice(-half);
  }

  const scrapedAt = new Date().toISOString();

  const userPrompt = `SOURCE METADATA
- company: ${companyName}
- ats: ${sourceAts ?? "unknown"}
- url: ${sourceUrl ?? "unknown"}
- scraped_at: ${scrapedAt}

RAW JOB POSTING (cleaned text):
<<<
${cleanedText}
>>>

Extract this posting into the ExtractedJD schema. Return only JSON.`;

  const model = process.env.JD_EXTRACT_MODEL || DEFAULT_MODEL;
  const client = getClient();

  // First attempt
  const rawResponse = await callGroq(client, model, userPrompt);
  const stripped = stripMarkdownFences(rawResponse);

  const firstParse = ExtractedJDSchema.safeParse(safeJsonParse(stripped));
  if (firstParse.success) {
    return applyMeta(firstParse.data, scrapedAt, sourceUrl, sourceAts, cleanedText.length);
  }

  // Retry with Zod error feedback
  const zodErrorMsg = formatZodError(firstParse.error);
  const retryPrompt = `The JSON you returned failed schema validation with these errors:\n\n${zodErrorMsg}\n\nPlease return a corrected JSON object that conforms to the ExtractedJD schema. Return only JSON, no prose.`;

  const retryResponse = await callGroqWithRetry(client, model, userPrompt, rawResponse, retryPrompt);
  const retryStripped = stripMarkdownFences(retryResponse);

  const secondParse = ExtractedJDSchema.safeParse(safeJsonParse(retryStripped));
  if (secondParse.success) {
    return applyMeta(secondParse.data, scrapedAt, sourceUrl, sourceAts, cleanedText.length);
  }

  throw new JDExtractionError(
    `JD extraction failed after retry — schema validation error`,
    retryResponse,
    formatZodError(secondParse.error),
  );
}

// ── Groq API helpers ─────────────────────────────────────────────────────────

async function callGroq(client: Groq, model: string, userPrompt: string): Promise<string> {
  const completion = await client.chat.completions.create({
    model,
    max_tokens: 4096,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) {
    throw new JDExtractionError("Groq returned empty response", JSON.stringify(completion));
  }
  return text;
}

async function callGroqWithRetry(
  client: Groq,
  model: string,
  originalUserPrompt: string,
  originalAssistantResponse: string,
  retryPrompt: string,
): Promise<string> {
  const completion = await client.chat.completions.create({
    model,
    max_tokens: 4096,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: originalUserPrompt },
      { role: "assistant", content: originalAssistantResponse },
      { role: "user", content: retryPrompt },
    ],
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) {
    throw new JDExtractionError("Groq retry returned empty response", JSON.stringify(completion));
  }
  return text;
}

// ── Utility helpers ──────────────────────────────────────────────────────────

function stripMarkdownFences(text: string): string {
  let cleaned = text.trim();
  // Remove ```json ... ``` or ``` ... ```
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return cleaned.trim();
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function formatZodError(error: import("zod").ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
}

function applyMeta(
  data: ExtractedJD,
  extractedAt: string,
  sourceUrl: string | null,
  sourceAts: string | null,
  contentLength: number,
): ExtractedJD {
  // Override meta fields that we know authoritatively
  data.extraction_meta.extracted_at = extractedAt;
  data.extraction_meta.source_url = sourceUrl;
  data.extraction_meta.source_ats = sourceAts;
  data.extraction_meta.source_content_length = contentLength;
  data.extraction_meta.schema_version = "1.0.0";
  return data;
}
