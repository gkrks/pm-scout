/**
 * Greenhouse scraper — Phase 2
 *
 * GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
 * Public, unauthenticated. Descriptions included inline.
 */

import fetch from "node-fetch";
import { Scraper, ScrapeResult, RawJob, Company, ATSRouting } from "./types";

const UA = "Mozilla/5.0 (compatible; JobSearchBot/1.0)";

interface GHJob {
  id: number;
  title: string;
  location: { name: string };
  /** When the posting was first published — preferred over updated_at */
  first_published?: string;
  updated_at: string;
  absolute_url: string;
  /** HTML job description */
  content?: string;
}

interface GHResponse {
  jobs: GHJob[];
}

export const greenhouseScraper: Scraper = {
  name: "greenhouse",

  async scrape(
    company: Company,
    routing: ATSRouting,
    opts: { timeoutMs: number },
  ): Promise<ScrapeResult> {
    const slug = routing.slug ?? company.slug;
    const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;

    const resp = await (fetch as any)(url, {
      headers: { "User-Agent": UA },
      timeout: opts.timeoutMs,
    });
    if (!resp.ok) throw new Error(`Greenhouse ${slug}: HTTP ${resp.status}`);

    const data = (await resp.json()) as GHResponse;
    const raw: GHJob[] = data.jobs ?? [];

    if (raw.length > 200) {
      console.warn(`[greenhouse] ${slug}: ${raw.length} jobs, capping at 200`);
      raw.splice(200);
    }

    const jobs: RawJob[] = raw.map((j): RawJob => ({
      title:        j.title,
      role_url:     j.absolute_url,
      location_raw: j.location?.name ?? "",
      // Prefer first_published (exact post date); fall back to updated_at
      posted_date: (j.first_published ?? j.updated_at ?? "").slice(0, 10) || null,
      description:  j.content ?? "",
      source_meta: {
        greenhouse_id: j.id,
        updated_at:    j.updated_at,
      },
    }));

    return { jobs, fetchedDescriptions: true };
  },
};
