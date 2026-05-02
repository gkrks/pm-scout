/**
 * Workable scraper — Phase 2
 *
 * GET https://apply.workable.com/api/v1/widget/accounts/{slug}/jobs
 *     ?details=true&limit=50
 * Public, unauthenticated. Paginated via `nextToken`.
 * Filters client-side for "product manager" titles.
 */

import fetch from "node-fetch";
import { Scraper, ScrapeResult, RawJob, Company, ATSRouting } from "./types";

const UA = "Mozilla/5.0 (compatible; JobSearchBot/1.0)";

interface WorkableJob {
  id:        string;
  shortcode: string;
  title:     string;
  department?: string;
  location?: {
    city?:    string;
    region?:  string;
    country?: string;
    remote?:  boolean;
    telecommuting?: boolean;
  };
  created_at?: string;
  description?: string;
  requirements?: string;
  url?: string;
}

interface WorkableResponse {
  results: WorkableJob[];
  nextToken?: string;
}

const PM_PATTERN = /product.?manager|pm\b|program manager|product lead/i;

export const workableScraper: Scraper = {
  name: "workable",

  async scrape(
    company: Company,
    routing: ATSRouting,
    opts:    { timeoutMs: number },
  ): Promise<ScrapeResult> {
    const slug = routing.slug ?? company.slug;
    const jobs: RawJob[] = [];
    let nextToken: string | undefined;

    do {
      const url =
        `https://apply.workable.com/api/v1/widget/accounts/${slug}/jobs` +
        `?details=true&limit=50` +
        (nextToken ? `&token=${encodeURIComponent(nextToken)}` : "");

      const resp = await (fetch as any)(url, {
        headers: { "User-Agent": UA, "Accept": "application/json" },
        timeout: opts.timeoutMs,
      });

      if (!resp.ok) throw new Error(`Workable ${slug}: HTTP ${resp.status}`);

      const data = (await resp.json()) as WorkableResponse;
      const batch = data.results ?? [];

      for (const j of batch) {
        if (!PM_PATTERN.test(j.title)) continue;

        const loc = [j.location?.city, j.location?.region, j.location?.country]
          .filter(Boolean)
          .join(", ");
        const location_raw =
          j.location?.remote || j.location?.telecommuting ? "Remote" : (loc || "");

        const applyUrl = j.url
          ?? `https://apply.workable.com/${slug}/j/${j.shortcode}`;

        jobs.push({
          title:        j.title,
          role_url:     applyUrl,
          location_raw,
          posted_date:  j.created_at ? j.created_at.slice(0, 10) : null,
          description:  [j.description, j.requirements].filter(Boolean).join("\n\n") || undefined,
          source_meta:  { workable_id: j.id, shortcode: j.shortcode },
        });
      }

      nextToken = data.nextToken;
      if (batch.length === 0) break;
    } while (nextToken && jobs.length < 200);

    return { jobs, fetchedDescriptions: true };
  },
};
