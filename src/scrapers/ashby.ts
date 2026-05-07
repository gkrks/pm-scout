/**
 * Ashby scraper — Phase 2 (DB-driven, exhaustive, US PM-filtered)
 *
 * GET https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true
 * Public, unauthenticated. Handles both `jobs` and `jobPostings` response keys.
 * Descriptions included inline via descriptionSections or descriptionHtml.
 *
 * Key design: outputs are split into TWO sets:
 *   1. allListedAshbyIds — every active listed ID, used for staleness sweep.
 *      Does NOT apply the freshness filter.
 *   2. jobs (ingestable) — fresh enough to add as new rows in this sync.
 */

import fetch from "node-fetch";
import { Scraper, ScrapeResult, RawJob, Company, ATSRouting } from "./types";
import { getSupabaseClient } from "../storage/supabase";
import { classifyHeading, type HeadingBucket } from "../lib/headingAliases";

const UA = "Mozilla/5.0 (compatible; JobSearchBot/1.0)";

// ── Freshness config ────────────────────────────────────────────────────────

const FRESHNESS_DAYS = parseInt(process.env.ASHBY_FRESHNESS_DAYS || "30", 10);

// ── Ashby API types ─────────────────────────────────────────────────────────

interface AshbyJobPosting {
  id: string;
  title: string;
  isRemote?: boolean;
  isListed?: boolean;
  location?: string;
  locationName?: string;
  publishedDate?: string;
  publishedAt?: string;
  applyUrl?: string;
  jobUrl?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  descriptionSections?: Array<{ heading?: string; descriptionHtml?: string }>;
  department?: string;
  team?: string;
  employmentType?: string;
  workplaceType?: string;
  address?: {
    postalAddress?: {
      addressLocality?: string;
      addressRegion?: string;
      addressCountry?: string;
    };
  };
  secondaryLocations?: Array<{
    location?: string;
    address?: {
      addressCountry?: string;
    };
  }>;
  compensation?: {
    compensationTierSummary?: string;
    scrapeableCompensationSalarySummary?: string;
    [key: string]: unknown;
  };
}

interface AshbyResponse {
  jobs?: AshbyJobPosting[];
  jobPostings?: AshbyJobPosting[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function buildAshbyDescription(j: AshbyJobPosting): string {
  if (j.descriptionSections?.length) {
    const html = j.descriptionSections
      .map((s) => (s.heading ? `<h3>${s.heading}</h3>` : "") + (s.descriptionHtml ?? ""))
      .join("\n");
    return html;
  }
  return j.descriptionHtml ?? j.descriptionPlain ?? "";
}

// ── HTML section splitting ─────────────────────────────────────────────────

/**
 * Split flat Ashby descriptionHtml into headed sections.
 *
 * Ashby JDs use two patterns for section dividers:
 *   1. <h1>–<h6> tags (most common)
 *   2. <p><strong>Heading</strong></p> (Replit, Drata, Bubble, etc.)
 *
 * We split on both patterns, extract the heading text, and pair each heading
 * with all HTML content until the next heading.
 */
interface HtmlSection {
  heading: string;
  bucket: HeadingBucket;
  html: string;
}

function splitHtmlIntoSections(html: string): HtmlSection[] {
  if (!html) return [];

  // Match both <h1>–<h6> and <p><strong>Heading Text</strong></p> patterns.
  // The strong pattern only matches when it's the sole content of a <p>.
  const splitter =
    /(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>|<p[^>]*>\s*<(?:strong|b)>[^<]{4,80}<\/(?:strong|b)>\s*<\/p>)/gi;

  const parts = html.split(splitter);
  const sections: HtmlSection[] = [];
  let currentHeading = "";
  let currentBucket: HeadingBucket = "unknown";
  let currentHtml = "";

  for (const part of parts) {
    // Check if this part is a heading
    const headingMatch = part.match(
      /^<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>$/i,
    ) || part.match(
      /^<p[^>]*>\s*<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>\s*<\/p>$/i,
    );

    if (headingMatch) {
      // Flush previous section
      if (currentHtml.trim()) {
        sections.push({ heading: currentHeading, bucket: currentBucket, html: currentHtml });
      }
      // Start new section
      const rawHeading = headingMatch[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&nbsp;/g, " ")
        .trim();
      currentHeading = rawHeading;
      currentBucket = classifyHeading(rawHeading);
      currentHtml = "";
    } else {
      currentHtml += part;
    }
  }

  // Flush final section
  if (currentHtml.trim()) {
    sections.push({ heading: currentHeading, bucket: currentBucket, html: currentHtml });
  }

  return sections;
}

/** Strip HTML tags and decode common entities. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract <li> items from an HTML fragment as plain-text strings. */
function extractListItems(html: string): string[] {
  const items: string[] = [];
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;
  while ((match = liRegex.exec(html)) !== null) {
    const text = stripHtml(match[1]);
    if (text) items.push(text);
  }
  return items;
}

/** Extract paragraph text when there are no list items (some JDs use <p> for each bullet). */
function extractParagraphs(html: string): string[] {
  const items: string[] = [];
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  while ((match = pRegex.exec(html)) !== null) {
    const text = stripHtml(match[1]);
    if (text && text.length > 10) items.push(text);
  }
  return items;
}

// ── Structured extraction from flat HTML ───────────────────────────────────

export interface AshbyStructuredJD {
  responsibilities: string[];
  required: string[];
  preferred: string[];
  role_summary: string | null;
  extracted_via: "html_headings" | "sections";
}

/**
 * Extract responsibilities, qualifications, and preferred qualifications
 * from Ashby descriptionHtml by splitting on heading tags.
 *
 * Falls back to descriptionSections if present (legacy path).
 * Returns null only when no classifiable headings are found in the HTML.
 */
export function extractStructuredJD(j: AshbyJobPosting): AshbyStructuredJD | null {
  // Legacy path: descriptionSections (rarely populated by Ashby API anymore)
  if (j.descriptionSections?.length) {
    const responsibilities: string[] = [];
    const required: string[] = [];
    const preferred: string[] = [];
    let roleSummary: string | null = null;

    for (const section of j.descriptionSections) {
      const heading = section.heading || "";
      const html = section.descriptionHtml || "";
      if (!html) continue;

      const bucket = classifyHeading(heading);
      const items = extractListItems(html);

      if (bucket === "responsibilities") responsibilities.push(...(items.length ? items : extractParagraphs(html)));
      else if (bucket === "required_qualifications") required.push(...(items.length ? items : extractParagraphs(html)));
      else if (bucket === "preferred_qualifications") preferred.push(...(items.length ? items : extractParagraphs(html)));
      else if (bucket === "role_summary" && !roleSummary) roleSummary = stripHtml(html).slice(0, 1000);
    }

    if (responsibilities.length || required.length || preferred.length) {
      return { responsibilities, required, preferred, role_summary: roleSummary, extracted_via: "sections" };
    }
  }

  // Primary path: split flat descriptionHtml on heading tags
  const html = j.descriptionHtml ?? "";
  if (!html) return null;

  const sections = splitHtmlIntoSections(html);
  if (sections.length === 0) return null;

  const responsibilities: string[] = [];
  const required: string[] = [];
  const preferred: string[] = [];
  let roleSummary: string | null = null;

  for (const section of sections) {
    const items = extractListItems(section.html);
    // Fall back to paragraphs when the section uses <p> instead of <ul>/<li>
    const content = items.length ? items : extractParagraphs(section.html);

    switch (section.bucket) {
      case "responsibilities":
        responsibilities.push(...content);
        break;
      case "required_qualifications":
        required.push(...content);
        break;
      case "preferred_qualifications":
        preferred.push(...content);
        break;
      case "role_summary":
        if (!roleSummary) roleSummary = stripHtml(section.html).slice(0, 1000);
        break;
    }
  }

  if (!responsibilities.length && !required.length && !preferred.length) return null;
  return { responsibilities, required, preferred, role_summary: roleSummary, extracted_via: "html_headings" };
}

/**
 * Backward-compatible wrapper — returns the qualifications-only shape
 * that source_meta.qualifications expects.
 */
export function extractStructuredQualifications(
  j: AshbyJobPosting,
): { required: string[]; preferred: string[]; extracted_via: string } | null {
  const jd = extractStructuredJD(j);
  if (!jd) return null;
  if (!jd.required.length && !jd.preferred.length) return null;
  return { required: jd.required, preferred: jd.preferred, extracted_via: jd.extracted_via };
}

export function extractAshbyId(jobUrl: string | undefined): string | null {
  if (!jobUrl) return null;
  try {
    const path = new URL(jobUrl).pathname;
    const parts = path.split("/").filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 1] : null;
  } catch {
    return null;
  }
}

export function parseCompMinMax(summary: string): {
  comp_min: number | null;
  comp_max: number | null;
  comp_currency: string | null;
} {
  if (!summary) return { comp_min: null, comp_max: null, comp_currency: null };

  // Range: "$120K – $160K" or "$120k-$160k"
  const range = summary.match(
    /\$(\d+(?:\.\d+)?)[Kk]\s*[–\-]\s*\$?(\d+(?:\.\d+)?)[Kk]/,
  );
  if (range) {
    return {
      comp_min: parseFloat(range[1]) * 1000,
      comp_max: parseFloat(range[2]) * 1000,
      comp_currency: "USD",
    };
  }

  // Single: "$120K"
  const single = summary.match(/\$(\d+(?:\.\d+)?)[Kk]/);
  if (single) {
    const v = parseFloat(single[1]) * 1000;
    return { comp_min: v, comp_max: v, comp_currency: "USD" };
  }

  return { comp_min: null, comp_max: null, comp_currency: null };
}

function isFresh(j: AshbyJobPosting): boolean {
  const published = j.publishedAt ?? j.publishedDate;
  if (!published) return true; // include if missing
  const ts = Date.parse(published);
  if (Number.isNaN(ts)) return true; // include if unparseable
  return ts >= Date.now() - FRESHNESS_DAYS * 86_400_000;
}

// ── DB-driven company loading ───────────────────────────────────────────────

export interface AshbyCompanyRow {
  id: string;
  ats_slug: string;
  internal_slug: string | null;
  name: string | null;
}

/**
 * Load all valid Ashby companies from the Supabase companies table.
 * Falls back to empty array if Supabase is unavailable.
 */
export async function loadAshbyCompaniesFromDB(): Promise<AshbyCompanyRow[]> {
  if (!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    return [];
  }
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("companies")
      .select("id, ats_slug, internal_slug, name")
      .eq("ats_provider", "ashby")
      .eq("is_valid", true)
      .order("trust_tier", { ascending: true })
      .order("ats_slug", { ascending: true });

    if (error) {
      console.warn(`[ashby] Failed to load companies from DB: ${error.message}`);
      return [];
    }
    return (data ?? []) as AshbyCompanyRow[];
  } catch (e) {
    console.warn(
      `[ashby] DB load error: ${e instanceof Error ? e.message : e}`,
    );
    return [];
  }
}

// ── Scraper ─────────────────────────────────────────────────────────────────

export const ashbyScraper: Scraper = {
  name: "ashby",

  async scrape(
    company: Company,
    routing: ATSRouting,
    opts: { timeoutMs: number },
  ): Promise<ScrapeResult> {
    const slug = routing.slug ?? company.slug;
    const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;

    const resp = await (fetch as any)(url, {
      headers: { "User-Agent": UA },
      timeout: opts.timeoutMs,
    });
    if (!resp.ok) throw new Error(`Ashby ${slug}: HTTP ${resp.status}`);

    const data = (await resp.json()) as AshbyResponse;
    const raw: AshbyJobPosting[] = data.jobs ?? data.jobPostings ?? [];

    // Filter to listed jobs only
    const listed = raw.filter((j) => j.isListed !== false);

    // Set 1: every active listed ID — used for staleness sweep.
    // Does NOT apply the freshness filter, because a 60-day-old job
    // still on the board is still a live job.
    const allListedAshbyIds = listed
      .map((j) => extractAshbyId(j.jobUrl))
      .filter((x): x is string => !!x);

    // Set 2: ingestable subset — fresh enough to add as a new row.
    const ingestableJobs = listed.filter(isFresh);

    if (raw.length > 500) {
      console.warn(`[ashby] ${slug}: large board (${raw.length} jobs)`);
    }
    console.log(
      `[ashby] ${slug}: ${listed.length} listed, ${ingestableJobs.length} fresh`,
    );

    const jobs: RawJob[] = ingestableJobs.map((j): RawJob => {
      const loc =
        j.locationName ?? j.location ?? (j.isRemote ? "Remote" : "");
      const rawDesc = buildAshbyDescription(j);
      const description = rawDesc || (j.descriptionPlain ?? "");
      const posted_date =
        (j.publishedAt ?? j.publishedDate ?? "").slice(0, 10) || null;

      const ashbyId = extractAshbyId(j.jobUrl);
      const addr = j.address?.postalAddress || {};
      const comp = j.compensation || null;

      // Extract structured JD (responsibilities, qualifications, preferred)
      const structuredJD = extractStructuredJD(j);
      const quals = structuredJD
        ? { required: structuredJD.required, preferred: structuredJD.preferred, extracted_via: structuredJD.extracted_via }
        : null;

      return {
        title: j.title,
        role_url: j.jobUrl ?? j.applyUrl ?? company.careers_url,
        location_raw: loc,
        posted_date,
        description,
        source_meta: {
          ashby_id: ashbyId ?? j.id,
          is_remote: j.isRemote ?? null,
          department: j.department ?? null,
          team: j.team ?? null,
          employment_type: j.employmentType ?? null,
          workplace_type: j.workplaceType ?? null,
          is_listed: j.isListed ?? true,
          location_city: addr.addressLocality ?? null,
          location_region: addr.addressRegion ?? null,
          location_country: addr.addressCountry ?? null,
          secondary_locations: j.secondaryLocations ?? [],
          comp_summary: comp?.compensationTierSummary ?? null,
          comp_salary_summary:
            comp?.scrapeableCompensationSalarySummary ?? null,
          comp_raw: comp,
          ...parseCompMinMax(
            comp?.scrapeableCompensationSalarySummary ||
              comp?.compensationTierSummary ||
              "",
          ),
          qualifications: quals,
          responsibilities: structuredJD?.responsibilities ?? null,
          role_summary: structuredJD?.role_summary ?? null,
          raw_payload: j,
        },
      };
    });

    return { jobs, allListedAshbyIds, fetchedDescriptions: true };
  },
};
