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

const MAX_CLEANED_TEXT_LENGTH = 6_000;
const DEFAULT_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

// ── Groq client (lazy singleton) ─────────────────────────────────────────────

let _client: Groq | null = null;
function getClient(): Groq {
  if (!_client) {
    _client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _client;
}

// ── Condensed few-shot example ───────────────────────────────────────────────
// Kept minimal to stay within Groq free-tier token limits.

const FEW_SHOT_EXAMPLE = `<example>
INPUT:
Product Manager, Growth · Acme Inc · San Francisco (Hybrid, 3 days/week)
About the role: Own the activation funnel end-to-end.
What you'll do: Partner with Engineering on onboarding and conversion. Ship experiments weekly.
What you'll need: 3+ years as a PM in B2B SaaS. Comfort with SQL (we use Metabase).
Bonus points: Worked at a developer-tools company.
Compensation: $180K-$220K + equity. Visa sponsorship for exceptional candidates.

OUTPUT:
{"job_title":"Product Manager, Growth","company_name":"Acme Inc","location":{"raw":"San Francisco (Hybrid, 3 days/week)","cities":["San Francisco"],"states":["CA"],"countries":["US"],"is_remote":false,"is_hybrid":true,"is_onsite":false,"remote_region_restrictions":null,"hybrid_days_in_office":3,"relocation_offered":null},"employment":{"type":"full_time","duration_months":null,"start_date":null,"end_date":null,"is_early_career":false,"seniority_level":"mid","is_people_manager":null,"team_size_managed":null},"experience":{"years_min":3,"years_max":null,"years_raw":"3+ years as a PM in B2B SaaS","is_new_grad_friendly":false,"domains_required":["B2B SaaS"]},"education":{"minimum_degree":"unknown","preferred_degree":"unknown","fields_of_study":[],"accepts_equivalent_experience":null},"required_qualifications":["3+ years as a PM in B2B SaaS","Comfort with SQL (we use Metabase)"],"preferred_qualifications":["Worked at a developer-tools company"],"responsibilities":["Partner with Engineering on onboarding and conversion","Ship experiments weekly"],"skills":{"technical":["SQL","experimentation"],"tools":["Metabase"],"methodologies":[],"soft":[],"languages":[],"domain_expertise":["B2B SaaS","growth"]},"certifications":{"required":[],"preferred":[]},"compensation":{"base_salary_min":180000,"base_salary_max":220000,"currency":"USD","pay_period":"annual","equity_offered":true,"equity_details":"+ equity","bonus_offered":null,"bonus_details":null,"sign_on_bonus":null,"pay_transparency_disclosure_present":true},"authorization":{"sponsorship_offered":true,"sponsorship_explicit_statement":"Visa sponsorship for exceptional candidates","security_clearance_required":false,"security_clearance_type":null,"citizenship_requirement":null},"role_context":{"summary":"Own the activation funnel end-to-end.","product_area":"Growth","team_name":null,"reports_to":null,"cross_functional_partners":["Engineering"],"domain_tags":["growth","B2B SaaS"]},"company_context":{"description":null,"industry":null,"stage":null,"size_employees":null,"mission_statement":null},"logistics":{"travel_required":null,"travel_percentage":null,"on_call_required":null,"standard_hours":null},"benefits":{"health_insurance":null,"dental_vision":null,"retirement_plan":null,"pto_days":null,"pto_unlimited":null,"parental_leave":null,"learning_stipend":null,"wellness_stipend":null,"remote_work_stipend":null,"raw_perks":[]},"application":{"deadline":null,"process_steps":[],"estimated_timeline":null,"recruiter_name":null,"recruiter_email":null,"referral_program":null,"requires_cover_letter":null,"requires_portfolio":null},"legal":{"eeo_statement_present":false,"e_verify":null,"background_check_required":null},"ats_keywords":{"high_priority":["PM","SQL","B2B SaaS"],"medium_priority":["growth","experimentation"],"low_priority":["Metabase"],"acronyms":{"PM":"Product Manager"},"job_specific_buzzwords":["activation funnel"]},"extraction_meta":{"schema_version":"1.0.0","extracted_at":"2026-05-02T21:00:00Z","source_url":null,"source_ats":null,"source_content_length":350,"confidence":"high","ambiguous_fields":["authorization.sponsorship_offered"],"missing_sections":["benefits","education","application","legal"],"extraction_notes":"Sponsorship is conditional."}}
</example>`;

// ── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a job-posting parser. Convert a raw job posting into a JSON object conforming to the ExtractedJD schema.

${FEW_SHOT_EXAMPLE}

Heading aliases — map by MEANING, not literal text:
- required_qualifications: "Basic Qualifications", "Minimum Qualifications", "Requirements", "What You'll Need", "What We Expect", "Must Have", "Who You Are", "What you bring"
- preferred_qualifications: "Preferred", "Nice to Have", "Bonus Points", "Pluses", "Even Better"
- responsibilities: "Responsibilities", "What You'll Do", "Key Responsibilities", "Your Role", "The Opportunity", "Your Impact"

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

8. ATS DETECTION. Detect the Applicant Tracking System (ATS) from content
   clues and set extraction_meta.source_ats. Look for:
   - URL patterns: "boards.greenhouse.io" → "greenhouse",
     "jobs.lever.co" → "lever", "myworkdayjobs.com" → "workday",
     "jobs.ashbyhq.com" → "ashby", "jobs.smartrecruiters.com" → "smartrecruiters",
     "apply.workable.com" → "workable", "bamboohr.com/careers" → "bamboohr",
     "amazon.jobs" → "amazon"
   - Footer text: "Powered by Greenhouse", "Powered by Lever", etc.
   - Structural patterns: Greenhouse uses "gh_jid" params; Lever uses
     "/apply/" suffixes; Workday uses "wd1/wd5" subdomains; Ashby uses
     specific JSON-LD schemas
   - CSS/class names: "greenhouse-job-board", "lever-job", etc.
   Valid values: "greenhouse", "lever", "ashby", "workday",
   "smartrecruiters", "workable", "bamboohr", "amazon", "google",
   "meta", or null if undetectable. Never guess — set null if unsure.

9. OUTPUT FORMAT. Return only the JSON object. No prose, no markdown
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
  // Keep LLM-detected ATS; fall back to config value only if LLM returned null
  if (!data.extraction_meta.source_ats) {
    data.extraction_meta.source_ats = sourceAts;
  }
  data.extraction_meta.source_content_length = contentLength;
  data.extraction_meta.schema_version = "1.0.0";
  return data;
}
