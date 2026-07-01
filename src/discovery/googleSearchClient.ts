/**
 * Google Custom Search API client + dork query builder.
 *
 * Uses Google's Custom Search JSON API (100 free queries/day).
 * Each query targets a specific ATS domain with PM, TPM, and SWE search terms.
 */

import fetch from "node-fetch";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GoogleSearchResult {
  title: string;
  link: string;
  snippet: string;
  formattedUrl: string;
}

export interface DorkQuery {
  /** Full Google search query string */
  query: string;
  /** Human-readable label for logging */
  label: string;
  /** ATS platform this query targets */
  ats: string;
  /** Role category this query targets */
  roleCategory: "SWE" | "DE" | "DA" | "PM" | "TPM";
}

interface CSEResponse {
  items?: Array<{
    title: string;
    link: string;
    snippet: string;
    formattedUrl: string;
  }>;
  searchInformation?: {
    totalResults: string;
  };
  error?: {
    code: number;
    message: string;
  };
}

// ── ATS domains to search ─────────────────────────────────────────────────────

const ATS_DOMAINS: Array<{ site: string; ats: string; label: string }> = [
  { site: "boards.greenhouse.io",     ats: "greenhouse",      label: "Greenhouse" },
  { site: "jobs.lever.co",            ats: "lever",           label: "Lever" },
  { site: "jobs.ashbyhq.com",         ats: "ashby",           label: "Ashby" },
  { site: "myworkdayjobs.com",        ats: "workday",         label: "Workday" },
  { site: "jobs.smartrecruiters.com", ats: "smartrecruiters", label: "SmartRecruiters" },
  { site: "icims.com",               ats: "icims",           label: "iCIMS" },
];

// ── Role-specific search templates ───────────────────────────────────────────

interface RoleSearch {
  roleCategory: "SWE";
  label: string;
  queryPart: string;
}

const ROLE_SEARCHES: RoleSearch[] = [
  {
    roleCategory: "SWE",
    label: "New Grad SWE",
    queryPart:
      `(intitle:"software engineer" -senior -staff -lead -principal ` +
      `("0-1 years" OR "entry level" OR "new grad" OR "early career" OR "junior"))`,
  },
  {
    roleCategory: "SWE",
    label: "New Grad Data Engineer",
    queryPart:
      `(intitle:"data engineer" -senior -staff -lead -principal ` +
      `("0-1 years" OR "entry level" OR "new grad" OR "early career" OR "junior"))`,
  },
  {
    roleCategory: "SWE",
    label: "New Grad Data Analyst",
    queryPart:
      `(intitle:"data analyst" -senior -staff -lead -principal ` +
      `("0-1 years" OR "entry level" OR "new grad" OR "early career" OR "junior"))`,
  },
  {
    roleCategory: "SWE",
    label: "New Grad ML/AI Engineer",
    queryPart:
      `((intitle:"machine learning engineer" OR intitle:"ml engineer" OR intitle:"ai engineer") ` +
      `-senior -staff -lead -principal ` +
      `("0-1 years" OR "entry level" OR "new grad" OR "early career" OR "junior"))`,
  },
];

// ── Query builder ─────────────────────────────────────────────────────────────

/**
 * Build dork queries — one per (ATS domain × role category).
 *
 * With 6 domains × 3 roles = 18 queries per run.
 * At 12 runs/day = 216 queries/day → ~$0.58/day after the free 100.
 * To stay within free tier, pass `roles` to limit which categories run.
 */
export function buildDorkQueries(
  roles: Array<"PM" | "TPM" | "SWE"> = ["PM", "TPM", "SWE"],
): DorkQuery[] {
  const queries: DorkQuery[] = [];

  for (const { site, ats, label: atsLabel } of ATS_DOMAINS) {
    for (const { roleCategory, label: roleLabel, queryPart } of ROLE_SEARCHES) {
      if (!roles.includes(roleCategory)) continue;
      queries.push({
        query: `site:${site} ${queryPart}`,
        label: `${atsLabel} — ${roleLabel}`,
        ats,
        roleCategory,
      });
    }
  }

  return queries;
}

// ── API client ────────────────────────────────────────────────────────────────

const CSE_BASE_URL = "https://www.googleapis.com/customsearch/v1";

/**
 * Execute a Google Custom Search query and return up to `maxResults` results.
 *
 * @param query       Full search query string
 * @param apiKey      Google Cloud API key with Custom Search API enabled
 * @param cseId       Programmable Search Engine ID
 * @param dateRestrict  e.g. "w1" for past week, "d3" for past 3 days
 * @param maxResults  Number of results to fetch (max 20, fetched in pages of 10)
 */
export async function executeSearch(
  query: string,
  apiKey: string,
  cseId: string,
  dateRestrict = "w1",
  maxResults = 20,
): Promise<GoogleSearchResult[]> {
  const results: GoogleSearchResult[] = [];
  const pages = Math.ceil(Math.min(maxResults, 20) / 10);

  for (let page = 0; page < pages; page++) {
    const start = page * 10 + 1;
    const params = new URLSearchParams({
      key: apiKey,
      cx: cseId,
      q: query,
      start: String(start),
      num: "10",
      dateRestrict,
    });

    const url = `${CSE_BASE_URL}?${params}`;
    const res = await fetch(url);
    const body = (await res.json()) as CSEResponse;

    if (body.error) {
      throw new Error(
        `Google CSE error (${body.error.code}): ${body.error.message}`,
      );
    }

    if (!body.items || body.items.length === 0) break;

    for (const item of body.items) {
      results.push({
        title: item.title,
        link: item.link,
        snippet: item.snippet,
        formattedUrl: item.formattedUrl,
      });
    }

    // Stop if we got fewer than 10 — no more pages
    if (body.items.length < 10) break;
  }

  return results;
}
