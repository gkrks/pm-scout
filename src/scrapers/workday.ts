/**
 * Workday scraper — Phase 2 (new)
 *
 * POST https://{host}/wday/cxs/{tenant}/{site}/jobs
 * Body: { appliedFacets: {}, limit: 50, offset: 0, searchText: "product manager" }
 * Paginates until total reached or 200 results.
 *
 * Descriptions are NOT fetched inline — fetchedDescriptions: false.
 * Use fetchWorkdayDescription() after applying title/location filters.
 */

import fetch from "node-fetch";
import { Scraper, ScrapeResult, RawJob, Company, ATSRouting } from "./types";

const UA = "Mozilla/5.0 (compatible; JobSearchBot/1.0)";

// ── Workday API types ─────────────────────────────────────────────────────────

interface WorkdayJobPosting {
  bulletFields?: string[];
  jobPostingId?: string;
  title: string;
  locationsText?: string;
  postedOn?: string;           // e.g. "Posted 3 Days Ago", "Posted Yesterday"
  externalPath?: string;       // relative job detail path
}

interface WorkdayJobsResponse {
  total: number;
  jobPostings: WorkdayJobPosting[];
}

interface WorkdayJobDetail {
  jobPostingInfo?: {
    title?: string;
    jobDescription?: string;
    additionalJobDescription?: string;
  };
}

// ── Date parsing ──────────────────────────────────────────────────────────────

/**
 * Convert Workday relative date strings to ISO YYYY-MM-DD.
 * Uses runStartMs as the reference point so all jobs in a run are consistent.
 */
export function parseWorkdayDate(
  postedOn: string | undefined,
  runStartMs: number = Date.now(),
): string | null {
  if (!postedOn) return null;

  const s = postedOn.trim().toLowerCase();
  const ref = new Date(runStartMs);

  if (s.includes("today")) {
    return ref.toISOString().slice(0, 10);
  }
  if (s.includes("yesterday")) {
    ref.setDate(ref.getDate() - 1);
    return ref.toISOString().slice(0, 10);
  }

  // "Posted 30+ Days Ago" — clamp to exactly 30 per spec
  if (/30\+/.test(s)) {
    ref.setDate(ref.getDate() - 30);
    return ref.toISOString().slice(0, 10);
  }

  // "Posted N Days Ago"
  const m = s.match(/(\d+)\s+days?\s+ago/);
  if (m) {
    ref.setDate(ref.getDate() - parseInt(m[1], 10));
    return ref.toISOString().slice(0, 10);
  }

  // "Posted N Weeks Ago"
  const wm = s.match(/(\d+)\s+weeks?\s+ago/);
  if (wm) {
    ref.setDate(ref.getDate() - parseInt(wm[1], 10) * 7);
    return ref.toISOString().slice(0, 10);
  }

  // Attempt direct ISO parse (some Workday instances return ISO dates)
  const d = new Date(postedOn);
  if (!isNaN(d.getTime())) {
    // Clamp future dates to now
    const clamped = d > ref ? ref : d;
    return clamped.toISOString().slice(0, 10);
  }

  return null;
}

// ── Description fetcher (second pass, used by orchestrator) ──────────────────

/**
 * Fetch job description for a single Workday job.
 * Hits the CXS detail endpoint: https://{host}/wday/cxs/{tenant}/{site}/job/{jobId}
 * Returns description text or empty string on failure.
 */
export async function fetchWorkdayDescription(
  host: string,
  tenant: string,
  site: string,
  jobId: string,
  timeoutMs: number = 15_000,
): Promise<string> {
  const url = `https://${host}/wday/cxs/${tenant}/${site}/job/${jobId}`;
  try {
    const resp = await (fetch as any)(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "application/json",
      },
      timeout: timeoutMs,
    });
    if (!resp.ok) return "";
    const data = (await resp.json()) as WorkdayJobDetail;
    const info = data.jobPostingInfo;
    if (!info) return "";
    return [info.jobDescription ?? "", info.additionalJobDescription ?? ""]
      .filter(Boolean)
      .join("\n\n");
  } catch {
    return "";
  }
}

// ── Scraper ───────────────────────────────────────────────────────────────────

export const workdayScraper: Scraper = {
  name: "workday",

  async scrape(
    company: Company,
    routing: ATSRouting,
    opts: { timeoutMs: number },
  ): Promise<ScrapeResult> {
    const host   = routing.host;
    const tenant = routing.tenant;
    const site   = routing.site;

    if (!host || !tenant || !site) {
      throw new Error(
        `Workday routing for ${company.slug} requires host, tenant, and site fields in ats_routing.json`,
      );
    }

    const baseUrl = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
    const runStartMs = Date.now();
    const jobs: RawJob[] = [];
    let offset = 0;
    const limit = routing.pageSize ?? 20;
    let total = Infinity;

    // Some Workday instances reject searchText in the body (HTTP 400).
    // On first 400, retry without it and filter titles client-side instead.
    let useSearchText = true;

    while (offset < total && jobs.length < 200) {
      const body: Record<string, unknown> = {
        appliedFacets: {},
        limit,
        offset,
      };
      if (useSearchText) body.searchText = "product manager";

      const resp = await (fetch as any)(baseUrl, {
        method:  "POST",
        headers: {
          "User-Agent":   UA,
          "Content-Type": "application/json",
          "Accept":       "application/json",
        },
        body:    JSON.stringify(body),
        timeout: opts.timeoutMs,
      });

      // Retry without searchText if the instance doesn't support it
      if (resp.status === 400 && useSearchText) {
        useSearchText = false;
        continue;
      }

      if (!resp.ok) throw new Error(`Workday ${company.slug}: HTTP ${resp.status}`);

      const data = (await resp.json()) as WorkdayJobsResponse;
      total = data.total ?? 0;

      const batch = data.jobPostings ?? [];
      if (batch.length === 0) break;

      for (const j of batch) {
        // Extract jobId from externalPath: e.g. "/en-US/tenant/job/Location/Title_JR123"
        const jobId = j.jobPostingId
          ?? j.externalPath?.split("/").pop()
          ?? "";

        // Public apply URL — see Bug Fix 13c. Constructed from externalPath (relative).
        const role_url = j.externalPath
          ? `https://${host}${j.externalPath}`
          : company.careers_url;

        jobs.push({
          title:        j.title,
          role_url,
          location_raw: j.locationsText ?? "",
          posted_date:  parseWorkdayDate(j.postedOn, runStartMs),
          // descriptions fetched lazily — see fetchWorkdayDescription()
          source_meta: {
            workday_id:   jobId,
            posted_on_raw: j.postedOn ?? null,
            host,
            tenant,
            site,
          },
        });
      }

      offset += batch.length;
      if (batch.length < limit) break;
    }

    if (jobs.length > 200) jobs.splice(200);

    return { jobs, fetchedDescriptions: false };
  },
};
