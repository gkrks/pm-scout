/**
 * JD Extractor — deterministic extraction of structured job data from HTML/text.
 *
 * Phase 1: Split HTML into sections by heading, classify headings deterministically.
 * Phase 2: Extract fields using regex/keyword matching (reuses existing filters).
 *
 * LLM (Groq) is only used as a fallback to classify unrecognized headings.
 */

import * as cheerio from "cheerio";
import { ExtractedJDSchema, type ExtractedJD } from "./types/extractedJD";
import { htmlToText } from "./lib/htmlToText";
import { classifyHeading, type HeadingBucket } from "./lib/headingAliases";
import { extractYoeSignals } from "./filters/experience";
import {
  TECHNICAL_SKILLS, TOOLS, METHODOLOGIES, SOFT_SKILLS,
  DOMAIN_EXPERTISE, CERTIFICATIONS, matchSkills,
} from "./lib/skillsList";

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

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExtractJDInput {
  rawHtml?: string;
  rawText?: string;
  jobTitle: string;
  companyName: string;
  sourceAts: string | null;
  sourceUrl: string | null;
}

interface Section {
  heading: string;
  bucket: HeadingBucket;
  content: string[];
}

// ── Phase 1: Section Splitting ───────────────────────────────────────────────

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function headingLevel(tagName: string): number {
  const levels: Record<string, number> = {
    h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6, strong: 7,
  };
  return levels[tagName.toLowerCase()] ?? 99;
}

/**
 * Decode HTML entities (e.g. &lt;h2&gt; → <h2>) so cheerio can parse tags.
 * Jobs stored in data/jobs.json have entity-encoded HTML in the description field.
 */
function decodeEntities(html: string): string {
  if (!html.includes("&lt;")) return html;
  // Decode common entities that represent HTML tags
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Parse HTML into sections based on headings.
 * Each section has a heading, classified bucket, and content lines.
 */
function parseSections(html: string): Section[] {
  const decoded = decodeEntities(html);
  const $ = cheerio.load(decoded);
  $("script, style, noscript, iframe, svg").remove();

  const sections: Section[] = [];
  let currentHeading = "";
  let currentBucket: HeadingBucket = "role_summary"; // content before any heading
  let currentContent: string[] = [];

  function flushSection() {
    if (currentContent.length > 0) {
      sections.push({
        heading: currentHeading,
        bucket: currentBucket,
        content: [...currentContent],
      });
    }
    currentContent = [];
  }

  // Walk all top-level elements in body
  $("body").children().each((_, el) => {
    const $el = $(el);
    const tagName = (el as any).tagName?.toLowerCase() ?? "";

    if (HEADING_TAGS.has(tagName)) {
      flushSection();
      currentHeading = $el.text().trim();
      currentBucket = classifyHeading(currentHeading);
      return;
    }

    // Check for strong-as-heading: only if the strong text matches a known heading alias
    const $strong = $el.find("strong").first();
    if ($strong.length && $strong.text().trim() === $el.text().trim() && $strong.text().trim().length < 100) {
      const strongText = $strong.text().trim();
      const strongBucket = classifyHeading(strongText);
      if (strongBucket !== "unknown") {
        flushSection();
        currentHeading = strongText;
        currentBucket = strongBucket;
        return;
      }
    }

    // Extract list items as individual content lines
    const $lis = $el.find("li");
    if ($lis.length > 0) {
      $lis.each((_, li) => {
        const text = $(li).text().trim();
        if (text) currentContent.push(text);
      });
      return;
    }

    // Regular paragraph/div text
    const text = $el.text().trim();
    if (text) {
      currentContent.push(text);
    }
  });

  flushSection();

  // If no sections were created, treat the whole text as one section
  if (sections.length === 0) {
    const allText = htmlToText(html);
    if (allText) {
      sections.push({
        heading: "",
        bucket: "role_summary",
        content: allText.split("\n").filter((l) => l.trim()),
      });
    }
  }

  return sections;
}

/**
 * Parse plain text into sections by detecting heading-like lines.
 * A heading line is: all-caps, or short (<80 chars) followed by a colon, or a known alias.
 */
function parseSectionsFromText(text: string): Section[] {
  const lines = text.split("\n");
  const sections: Section[] = [];
  let currentHeading = "";
  let currentBucket: HeadingBucket = "role_summary";
  let currentContent: string[] = [];

  function flushSection() {
    if (currentContent.length > 0) {
      sections.push({
        heading: currentHeading,
        bucket: currentBucket,
        content: [...currentContent],
      });
    }
    currentContent = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect heading-like lines
    const isAllCaps = trimmed.length > 3 && trimmed.length < 80 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
    const endsWithColon = trimmed.length < 80 && trimmed.endsWith(":");
    const classified = classifyHeading(trimmed.replace(/:$/, ""));

    if ((isAllCaps || endsWithColon || classified !== "unknown") && trimmed.length < 80) {
      flushSection();
      currentHeading = trimmed.replace(/:$/, "");
      currentBucket = classified !== "unknown" ? classified : classifyHeading(currentHeading);
      continue;
    }

    // Bullet lines
    if (trimmed.startsWith("- ") || trimmed.startsWith("• ") || /^\d+\.\s/.test(trimmed)) {
      currentContent.push(trimmed.replace(/^[-•]\s+/, "").replace(/^\d+\.\s+/, ""));
    } else {
      currentContent.push(trimmed);
    }
  }

  flushSection();
  return sections;
}

// ── Phase 2: Deterministic Field Extraction ──────────────────────────────────

function getSectionContent(sections: Section[], bucket: HeadingBucket): string[] {
  return sections.filter((s) => s.bucket === bucket).flatMap((s) => s.content);
}

function getAllText(sections: Section[]): string {
  return sections.flatMap((s) => s.content).join("\n");
}

// ── Location extraction ──────────────────────────────────────────────────────

const REMOTE_RE = /\bremote\b/i;
const HYBRID_RE = /\bhybrid\b/i;
const ONSITE_RE = /\bon[\s-]?site\b|\bin[\s-]?office\b|\bin[\s-]?person\b/i;
const HYBRID_DAYS_RE = /(\d)\s*days?\s*(?:\/\s*week|per\s*week|in[\s-]?office)/i;
const REMOTE_RESTRICTION_RE = /remote\s*[-–—]?\s*(us|united states|usa|eu|uk|canada|emea|apac)/gi;

const US_STATE_CITIES: Record<string, string> = {
  "new york": "NY", "nyc": "NY", "manhattan": "NY", "brooklyn": "NY",
  "san francisco": "CA", "sf": "CA", "los angeles": "CA",
  "san jose": "CA", "palo alto": "CA", "mountain view": "CA", "sunnyvale": "CA",
  "menlo park": "CA", "cupertino": "CA", "santa clara": "CA", "san mateo": "CA",
  "redwood city": "CA", "san diego": "CA", "irvine": "CA", "oakland": "CA",
  "seattle": "WA", "bellevue": "WA", "redmond": "WA",
  "austin": "TX", "dallas": "TX", "houston": "TX", "san antonio": "TX",
  "boston": "MA", "cambridge": "MA",
  "chicago": "IL",
  "denver": "CO", "boulder": "CO",
  "atlanta": "GA",
  "miami": "FL", "tampa": "FL", "orlando": "FL",
  "washington": "DC", "dc": "DC",
  "portland": "OR",
  "pittsburgh": "PA", "philadelphia": "PA",
  "minneapolis": "MN",
  "nashville": "TN",
  "detroit": "MI", "ann arbor": "MI",
  "raleigh": "NC", "durham": "NC", "charlotte": "NC",
  "salt lake city": "UT",
  "phoenix": "AZ", "scottsdale": "AZ",
};

function extractLocation(fullText: string, locationRaw?: string) {
  const searchText = locationRaw ? `${locationRaw}\n${fullText}` : fullText;

  const is_remote = REMOTE_RE.test(searchText);
  const is_hybrid = HYBRID_RE.test(searchText);
  const is_onsite = !is_remote && !is_hybrid && ONSITE_RE.test(searchText);

  const hybridDaysMatch = HYBRID_DAYS_RE.exec(searchText);
  const hybrid_days_in_office = hybridDaysMatch ? parseInt(hybridDaysMatch[1], 10) : null;

  const restrictions: string[] = [];
  let m: RegExpExecArray | null;
  const restrictRe = new RegExp(REMOTE_RESTRICTION_RE.source, "gi");
  while ((m = restrictRe.exec(searchText)) !== null) {
    restrictions.push(m[1].toUpperCase());
  }

  // Extract cities and states from location string
  const cities: string[] = [];
  const states = new Set<string>();
  const locSource = locationRaw ?? fullText.slice(0, 500);
  const locLower = locSource.toLowerCase();

  for (const [city, state] of Object.entries(US_STATE_CITIES)) {
    if (locLower.includes(city)) {
      cities.push(city.split(" ").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "));
      states.add(state);
    }
  }

  // Detect country
  const countries: string[] = [];
  if (/\bus\b|\bunited states\b|\busa\b/i.test(locSource) || states.size > 0) countries.push("US");
  if (/\buk\b|\bunited kingdom\b/i.test(locSource)) countries.push("UK");
  if (/\bcanada\b/i.test(locSource)) countries.push("CA");
  if (/\bgermany\b/i.test(locSource)) countries.push("DE");
  if (/\bindia\b/i.test(locSource)) countries.push("IN");

  const relocationMatch = /relocation\s+(?:assistance|support|package|offered|available)/i.test(fullText);

  return {
    raw: locationRaw ?? "",
    cities: [...new Set(cities)],
    states: [...states],
    countries: [...new Set(countries)],
    is_remote,
    is_hybrid,
    is_onsite: is_onsite || (!is_remote && !is_hybrid && cities.length > 0),
    remote_region_restrictions: restrictions.length > 0 ? restrictions : null,
    hybrid_days_in_office,
    relocation_offered: relocationMatch || null,
  };
}

// ── Employment extraction ────────────────────────────────────────────────────

function extractEmployment(fullText: string, title: string) {
  const text = `${title}\n${fullText}`;

  let type: "full_time" | "part_time" | "contract" | "internship" | "temporary" | "unknown" = "unknown";
  if (/\bfull[\s-]?time\b/i.test(text)) type = "full_time";
  else if (/\bpart[\s-]?time\b/i.test(text)) type = "part_time";
  else if (/\bcontract\b|\bfreelance\b|\bconsulting\b/i.test(text)) type = "contract";
  else if (/\bintern(?:ship)?\b/i.test(text)) type = "internship";
  else if (/\btemporary\b|\btemp\b/i.test(text)) type = "temporary";
  else type = "full_time"; // default assumption

  const is_early_career = /\b(?:entry[\s-]level|new\s+grad|early[\s-]career|associate\s+product\s+manager|apm|rotational)\b/i.test(text);

  let seniority: "intern" | "entry" | "mid" | "senior" | "staff" | "principal" | "director" | "vp" | "unknown" = "unknown";
  const titleLower = title.toLowerCase();
  if (/\bintern\b/i.test(titleLower)) seniority = "intern";
  else if (/\b(?:entry|junior|associate|apm)\b/i.test(titleLower) || is_early_career) seniority = "entry";
  else if (/\bvp\b|\bvice\s+president\b/i.test(titleLower)) seniority = "vp";
  else if (/\bdirector\b/i.test(titleLower)) seniority = "director";
  else if (/\bprincipal\b/i.test(titleLower)) seniority = "principal";
  else if (/\bstaff\b/i.test(titleLower)) seniority = "staff";
  else if (/\bsenior\b|\bsr\.?\b/i.test(titleLower)) seniority = "senior";
  else if (/\blead\b/i.test(titleLower)) seniority = "senior";
  else seniority = "mid";

  const is_people_manager = /\bmanage\s+a\s+team\b|\bdirect\s+reports?\b|\bpeople\s+manager\b|\bmanaging\s+\d+/i.test(fullText) || null;
  const teamSizeMatch = /\bmanag(?:e|ing)\s+(?:a\s+team\s+of\s+)?(\d+)/i.exec(fullText);

  const durationMatch = /(\d+)\s*[-–]?\s*months?\s*(?:contract|assignment|engagement)/i.exec(fullText);

  return {
    type,
    duration_months: durationMatch ? parseInt(durationMatch[1], 10) : null,
    start_date: null as string | null,
    end_date: null as string | null,
    is_early_career,
    seniority_level: seniority,
    is_people_manager,
    team_size_managed: teamSizeMatch ? parseInt(teamSizeMatch[1], 10) : null,
  };
}

// ── Education extraction ─────────────────────────────────────────────────────

type MinDegree = "high_school" | "associates" | "bachelors" | "masters" | "phd" | "mba" | "none" | "unknown";
type PrefDegree = "bachelors" | "masters" | "phd" | "mba" | "none" | "unknown";

function extractEducation(fullText: string) {
  const text = fullText.toLowerCase();

  function detectDegree(searchText: string): MinDegree {
    if (/\bph\.?d\.?\b|\bdoctorate\b|\bdoctoral\b/i.test(searchText)) return "phd";
    if (/\bmba\b/i.test(searchText)) return "mba";
    if (/\bmaster'?s?\b|\bm\.?s\.?\b(?!\s*office)|\bm\.?a\.\b/i.test(searchText)) return "masters";
    if (/\bbachelor'?s?\b|\bb\.?s\.?\b|\bb\.?a\.\b|\bundergraduate\b/i.test(searchText)) return "bachelors";
    if (/\bassociate'?s?\b/i.test(searchText)) return "associates";
    return "unknown";
  }

  // Find "required" vs "preferred" degree context
  const minimum_degree = detectDegree(text);

  // Look for preferred degree (higher than minimum)
  let preferred_degree: PrefDegree = "unknown";
  const prefMatch = /prefer(?:red)?[^.]*(?:master|mba|ph\.?d|doctorate)/i.exec(fullText);
  if (prefMatch) {
    const detected = detectDegree(prefMatch[0]);
    // Only use values valid for preferred_degree
    if (detected === "bachelors" || detected === "masters" || detected === "phd" || detected === "mba") {
      preferred_degree = detected;
    }
  }

  // Fields of study
  const fields: string[] = [];
  const fieldPatterns = [
    /(?:degree|major|field)\s+in\s+([^.,;]+)/i,
    /(?:computer science|engineering|business|mathematics|statistics|economics|design|information systems|data science)/gi,
  ];
  for (const re of fieldPatterns) {
    let m: RegExpExecArray | null;
    const globalRe = new RegExp(re.source, "gi");
    while ((m = globalRe.exec(fullText)) !== null) {
      const field = (m[1] ?? m[0]).trim();
      if (field.length < 50) fields.push(field);
    }
  }

  const accepts_equivalent_experience = /or\s+equivalent\s+(?:practical\s+)?experience|equivalent\s+work\s+experience|or\s+equivalent/i.test(fullText) || null;

  return {
    minimum_degree,
    preferred_degree,
    fields_of_study: [...new Set(fields)].slice(0, 10),
    accepts_equivalent_experience,
  };
}

// ── Compensation extraction ──────────────────────────────────────────────────

function extractCompensation(fullText: string) {
  const NON_USD_RE = /(?:€|£|¥|₹|CAD|AUD|EUR|GBP|JPY|SGD|MXN)\s*\d/;
  const isNonUsd = NON_USD_RE.test(fullText);

  let base_salary_min: number | null = null;
  let base_salary_max: number | null = null;
  let currency: string | null = null;

  if (!isNonUsd) {
    // Range: "$120,000 – $160,000"
    const rangeRe = /\$(\d{2,3}),(\d{3})\s*(?:-|–|—|to)\s*\$?(\d{2,3}),(\d{3})/i;
    const rangeMatch = rangeRe.exec(fullText);
    if (rangeMatch) {
      base_salary_min = parseInt(rangeMatch[1] + rangeMatch[2], 10);
      base_salary_max = parseInt(rangeMatch[3] + rangeMatch[4], 10);
      currency = "USD";
    } else {
      // Single: "$120,000"
      const singleRe = /\$(\d{2,3}),(\d{3})/;
      const singleMatch = singleRe.exec(fullText);
      if (singleMatch) {
        base_salary_min = parseInt(singleMatch[1] + singleMatch[2], 10);
        base_salary_max = base_salary_min;
        currency = "USD";
      }
    }

    // K-format: "$180K-$220K"
    if (!currency) {
      const kRangeRe = /\$(\d{2,3})[Kk]\s*(?:-|–|—|to)\s*\$?(\d{2,3})[Kk]/;
      const kMatch = kRangeRe.exec(fullText);
      if (kMatch) {
        base_salary_min = parseInt(kMatch[1], 10) * 1000;
        base_salary_max = parseInt(kMatch[2], 10) * 1000;
        currency = "USD";
      }
    }
  } else {
    currency = "non-USD";
  }

  const equity_offered = /\bequity\b|\brsu\b|\bstock\b|\boptions\b/i.test(fullText) || null;
  const equityMatch = /(?:equity|rsu|stock|options)[^.]{0,60}/i.exec(fullText);
  const bonus_offered = /\bbonus\b/i.test(fullText) || null;
  const bonusMatch = /bonus[^.]{0,60}/i.exec(fullText);
  const sign_on = /\bsign[\s-]?on\s+bonus\b|\bsigning\s+bonus\b/i.test(fullText) || null;
  const pay_transparency = base_salary_min !== null;

  return {
    base_salary_min,
    base_salary_max,
    currency,
    pay_period: (base_salary_min !== null ? "annual" : null) as "annual" | "monthly" | "hourly" | null,
    equity_offered,
    equity_details: equityMatch ? equityMatch[0].trim() : null,
    bonus_offered,
    bonus_details: bonusMatch ? bonusMatch[0].trim() : null,
    sign_on_bonus: sign_on,
    pay_transparency_disclosure_present: pay_transparency,
  };
}

// ── Authorization extraction ─────────────────────────────────────────────────

function extractAuthorization(fullText: string) {
  const NO_SPONSORSHIP_RE = /unable to sponsor|no\s+(?:visa\s+)?sponsorship|not eligible for sponsorship|must be authorized to work.*without sponsorship|cannot\s+sponsor|does not\s+sponsor|not\s+able to\s+sponsor|will not\s+sponsor/i;
  const OFFERS_SPONSORSHIP_RE = /visa sponsorship (?:is\s+)?(?:offered|available)|we\s+(?:do\s+)?sponsor|h[\s-]?1b sponsorship|sponsorship is available|able to\s+sponsor|will\s+sponsor|open to\s+sponsoring/i;

  let sponsorship_offered: boolean | null = null;
  if (NO_SPONSORSHIP_RE.test(fullText)) sponsorship_offered = false;
  else if (OFFERS_SPONSORSHIP_RE.test(fullText)) sponsorship_offered = true;

  const sponsorMatch = /(?:visa|sponsorship|h-?1b|work authorization)[^.]*\./i.exec(fullText);

  const clearance = /\bsecurity\s+clearance\b/i.test(fullText);
  const clearanceTypeMatch = /\b(secret|top secret|ts\/sci|sci)\b/i.exec(fullText);
  const citizenMatch = /\b(us citizen|u\.s\. citizen|eu resident|permanent resident)\b/i.exec(fullText);

  return {
    sponsorship_offered,
    sponsorship_explicit_statement: sponsorMatch ? sponsorMatch[0].trim() : null,
    security_clearance_required: clearance,
    security_clearance_type: clearanceTypeMatch ? clearanceTypeMatch[1] : null,
    citizenship_requirement: citizenMatch ? citizenMatch[1] : null,
  };
}

// ── Benefits extraction ──────────────────────────────────────────────────────

function extractBenefits(fullText: string, sections: Section[]) {
  const benefitText = [
    ...getSectionContent(sections, "benefits"),
    fullText,
  ].join("\n");

  return {
    health_insurance: /\bhealth\s+insurance\b|\bmedical\b/i.test(benefitText) || null,
    dental_vision: /\bdental\b|\bvision\b/i.test(benefitText) || null,
    retirement_plan: /\b401\s*\(?\s*k\s*\)?\b|\bretirement\b|\bpension\b/i.test(benefitText) || null,
    pto_days: null as number | null,
    pto_unlimited: /\bunlimited\s+(?:pto|paid\s+time\s+off|vacation)\b/i.test(benefitText) || null,
    parental_leave: /\bparental\s+leave\b|\bmaternity\b|\bpaternity\b/i.test(benefitText) || null,
    learning_stipend: /\blearning\b.*\bstipend\b|\beducation\s+(?:stipend|budget|allowance|reimbursement)\b|\btuition\s+reimbursement\b/i.test(benefitText) || null,
    wellness_stipend: /\bwellness\b.*\b(?:stipend|budget|allowance)\b/i.test(benefitText) || null,
    remote_work_stipend: /\bremote\b.*\b(?:stipend|budget|allowance)\b|\bhome\s+office\b.*\b(?:stipend|budget|allowance)\b/i.test(benefitText) || null,
    raw_perks: [] as string[],
  };
}

// ── Legal extraction ─────────────────────────────────────────────────────────

function extractLegal(fullText: string) {
  return {
    eeo_statement_present: /\bequal\s+opportunity\b|\beeo\b|\bwe\s+are\s+an\s+equal\b/i.test(fullText),
    e_verify: /\be[\s-]?verify\b/i.test(fullText) || null,
    background_check_required: /\bbackground\s+check\b/i.test(fullText) || null,
  };
}

// ── Logistics extraction ─────────────────────────────────────────────────────

function extractLogistics(fullText: string) {
  const travelMatch = /(\d+)\s*%?\s*travel/i.exec(fullText);
  return {
    travel_required: /\btravel\s+required\b|\bwillingness\s+to\s+travel\b/i.test(fullText) || null,
    travel_percentage: travelMatch ? parseInt(travelMatch[1], 10) : null,
    on_call_required: /\bon[\s-]?call\b/i.test(fullText) || null,
    standard_hours: null as string | null,
  };
}

// ── Role context extraction ──────────────────────────────────────────────────

function extractRoleContext(sections: Section[], fullText: string) {
  const summaryContent = getSectionContent(sections, "role_summary");
  const teamContent = getSectionContent(sections, "team_info");

  // Cross-functional partners
  const partners: string[] = [];
  const partnerRe = /\b(engineering|design|data science|data analytics|marketing|sales|operations|legal|finance|research|ux|customer success|support)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = partnerRe.exec(fullText)) !== null) {
    partners.push(m[1]);
  }

  // Domain tags from text
  const domainTags = matchSkills(fullText, DOMAIN_EXPERTISE);

  return {
    summary: summaryContent.length > 0 ? summaryContent.slice(0, 3).join(" ") : null,
    product_area: null as string | null,
    team_name: teamContent.length > 0 ? sections.find((s) => s.bucket === "team_info")?.heading ?? null : null,
    reports_to: null as string | null,
    cross_functional_partners: [...new Set(partners.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()))].slice(0, 10),
    domain_tags: domainTags.slice(0, 10),
  };
}

// ── ATS keyword extraction (term frequency) ──────────────────────────────────

function extractAtsKeywords(fullText: string) {
  // Count word/bigram frequency
  const words = fullText.toLowerCase().replace(/[^a-z0-9\s/+-]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }

  // Filter out common stop words
  const STOP_WORDS = new Set([
    "the", "and", "for", "are", "with", "you", "our", "will", "that", "this",
    "have", "from", "your", "they", "not", "been", "has", "all", "can", "was",
    "more", "about", "their", "who", "what", "how", "one", "also", "other",
    "experience", "work", "team", "role", "ability", "new", "including",
  ]);

  const high: string[] = [];
  const medium: string[] = [];
  const low: string[] = [];

  for (const [word, count] of freq.entries()) {
    if (STOP_WORDS.has(word)) continue;
    if (count >= 3) high.push(word);
    else if (count === 2) medium.push(word);
  }

  // Add required qualifications keywords as high priority
  const allSkills = [
    ...matchSkills(fullText, TECHNICAL_SKILLS),
    ...matchSkills(fullText, TOOLS),
  ];
  for (const skill of allSkills) {
    if (!high.includes(skill.toLowerCase())) {
      high.push(skill);
    }
  }

  return {
    high_priority: high.slice(0, 20),
    medium_priority: medium.slice(0, 20),
    low_priority: low.slice(0, 10),
    acronyms: {} as Record<string, string>,
    job_specific_buzzwords: [] as string[],
  };
}

// ── ATS platform detection from URL ──────────────────────────────────────────

function detectAtsFromUrl(url: string | null, html?: string): string | null {
  const source = `${url ?? ""} ${html ?? ""}`;
  if (/greenhouse\.io|gh_jid/i.test(source)) return "greenhouse";
  if (/lever\.co|jobs\.lever/i.test(source)) return "lever";
  if (/myworkdayjobs\.com|wd[1-5]\./i.test(source)) return "workday";
  if (/ashbyhq\.com/i.test(source)) return "ashby";
  if (/smartrecruiters\.com/i.test(source)) return "smartrecruiters";
  if (/workable\.com/i.test(source)) return "workable";
  if (/bamboohr\.com/i.test(source)) return "bamboohr";
  if (/amazon\.jobs/i.test(source)) return "amazon";
  if (/careers\.google\.com/i.test(source)) return "google";
  if (/metacareers\.com/i.test(source)) return "meta";
  if (/powered by greenhouse/i.test(source)) return "greenhouse";
  if (/powered by lever/i.test(source)) return "lever";
  return null;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function extractJD(input: ExtractJDInput): Promise<ExtractedJD> {
  const { jobTitle, companyName, sourceAts, sourceUrl } = input;

  if (!input.rawHtml && !input.rawText) {
    throw new Error("extractJD requires either rawHtml or rawText");
  }

  // Phase 1: Parse into sections
  const sections = input.rawHtml
    ? parseSections(input.rawHtml)
    : parseSectionsFromText(input.rawText!);

  const cleanedText = input.rawText ?? htmlToText(input.rawHtml!);
  const fullText = cleanedText;

  // Log unrecognized headings for debugging
  const unknownHeadings = sections.filter((s) => s.bucket === "unknown").map((s) => s.heading);
  if (unknownHeadings.length > 0) {
    console.warn(`[jdExtractor] Unrecognized headings: ${unknownHeadings.join(", ")}`);
  }

  // Phase 2: Deterministic field extraction
  const yoeSignals = extractYoeSignals(fullText);
  const extractedAt = new Date().toISOString();

  // Determine confidence
  const hasSections = sections.some((s) => s.bucket === "required_qualifications" || s.bucket === "responsibilities");
  const unknownCount = unknownHeadings.length;
  const confidence = hasSections && unknownCount === 0 ? "high"
    : hasSections ? "medium"
    : "low";

  // Collect missing sections
  const missingBuckets: string[] = [];
  const bucketSet = new Set(sections.map((s) => s.bucket));
  for (const b of ["required_qualifications", "responsibilities", "compensation", "benefits", "education"] as const) {
    if (!bucketSet.has(b as HeadingBucket)) missingBuckets.push(b);
  }

  const result: ExtractedJD = {
    job_title: input.companyName ? "" : "", // Will be set below
    company_name: companyName,

    location: extractLocation(fullText),
    employment: extractEmployment(fullText, jobTitle),
    experience: {
      years_min: yoeSignals.yoe_min,
      years_max: yoeSignals.yoe_max,
      years_raw: yoeSignals.yoe_raw,
      is_new_grad_friendly: yoeSignals.has_junior_language,
      domains_required: matchSkills(fullText, DOMAIN_EXPERTISE).slice(0, 5),
    },
    education: extractEducation(fullText),
    required_qualifications: getSectionContent(sections, "required_qualifications"),
    preferred_qualifications: getSectionContent(sections, "preferred_qualifications"),
    responsibilities: getSectionContent(sections, "responsibilities"),
    skills: {
      technical: matchSkills(fullText, TECHNICAL_SKILLS),
      tools: matchSkills(fullText, TOOLS),
      methodologies: matchSkills(fullText, METHODOLOGIES),
      soft: matchSkills(fullText, SOFT_SKILLS),
      languages: [],
      domain_expertise: matchSkills(fullText, DOMAIN_EXPERTISE),
    },
    certifications: {
      required: matchSkills(getSectionContent(sections, "required_qualifications").join(" "), CERTIFICATIONS),
      preferred: matchSkills(getSectionContent(sections, "preferred_qualifications").join(" "), CERTIFICATIONS),
    },
    compensation: extractCompensation(fullText),
    authorization: extractAuthorization(fullText),
    role_context: extractRoleContext(sections, fullText),
    company_context: {
      description: getSectionContent(sections, "company_info").slice(0, 3).join(" ") || null,
      industry: null,
      stage: null,
      size_employees: null,
      mission_statement: null,
    },
    logistics: extractLogistics(fullText),
    benefits: extractBenefits(fullText, sections),
    application: {
      deadline: null,
      process_steps: getSectionContent(sections, "application"),
      estimated_timeline: null,
      recruiter_name: null,
      recruiter_email: null,
      referral_program: null,
      requires_cover_letter: null,
      requires_portfolio: /\bportfolio\b/i.test(fullText) || null,
    },
    legal: extractLegal(fullText),
    ats_keywords: extractAtsKeywords(fullText),
    extraction_meta: {
      schema_version: "1.0.0",
      extracted_at: extractedAt,
      source_url: sourceUrl,
      source_ats: detectAtsFromUrl(sourceUrl, input.rawHtml) ?? sourceAts,
      source_content_length: fullText.length,
      confidence: confidence as "high" | "medium" | "low",
      ambiguous_fields: unknownHeadings.length > 0 ? ["section_classification"] : [],
      missing_sections: missingBuckets,
      extraction_notes: unknownHeadings.length > 0
        ? `Unrecognized headings: ${unknownHeadings.join(", ")}`
        : null,
    },
  };

  result.job_title = jobTitle || companyName;

  // Validate with Zod
  const parseResult = ExtractedJDSchema.safeParse(result);
  if (!parseResult.success) {
    const errors = parseResult.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    console.warn(`[jdExtractor] Schema validation issues (non-fatal): ${errors}`);
    // Return the result anyway — partial data is better than no data
  }

  return result;
}
