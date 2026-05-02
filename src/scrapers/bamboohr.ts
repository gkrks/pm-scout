/**
 * BambooHR scraper — Phase 2
 *
 * GET https://{slug}.bamboohr.com/careers/list
 * Public, unauthenticated. Returns a JSON object with `result` array.
 * Filters client-side for "product manager" titles.
 */

import fetch from "node-fetch";
import { Scraper, ScrapeResult, RawJob, Company, ATSRouting } from "./types";

const UA = "Mozilla/5.0 (compatible; JobSearchBot/1.0)";

interface BambooJob {
  id:          string;
  jobOpeningName: string;
  location?:   { city?: string; state?: string; country?: string };
  datePosted?: string;
  jobUrl?:     string;
}

interface BambooResponse {
  result: BambooJob[];
}

const PM_PATTERN = /product.?manager|pm\b|program manager|product lead/i;

export const bambooHRScraper: Scraper = {
  name: "bamboohr",

  async scrape(
    company: Company,
    routing: ATSRouting,
    opts:    { timeoutMs: number },
  ): Promise<ScrapeResult> {
    const slug = routing.slug ?? company.slug;
    const url  = `https://${slug}.bamboohr.com/careers/list`;

    const resp = await (fetch as any)(url, {
      headers: {
        "User-Agent": UA,
        "Accept":     "application/json",
      },
      timeout: opts.timeoutMs,
    });

    if (!resp.ok) throw new Error(`BambooHR ${slug}: HTTP ${resp.status}`);

    const data = (await resp.json()) as BambooResponse;
    const allJobs = data.result ?? [];
    const jobs: RawJob[] = [];

    for (const j of allJobs) {
      if (!PM_PATTERN.test(j.jobOpeningName)) continue;

      const loc = [j.location?.city, j.location?.state, j.location?.country]
        .filter(Boolean)
        .join(", ");

      const applyUrl = j.jobUrl
        ?? `https://${slug}.bamboohr.com/careers/${j.id}`;

      jobs.push({
        title:        j.jobOpeningName,
        role_url:     applyUrl,
        location_raw: loc,
        posted_date:  j.datePosted ? j.datePosted.slice(0, 10) : null,
        source_meta:  { bamboohr_id: j.id },
      });
    }

    return { jobs, fetchedDescriptions: false };
  },
};
