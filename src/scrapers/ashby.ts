/**
 * Ashby scraper — Phase 2
 *
 * GET https://api.ashbyhq.com/posting-api/job-board/{slug}
 * Public, unauthenticated. Handles both `jobs` and `jobPostings` response keys.
 * Descriptions included inline via descriptionSections or descriptionHtml.
 */

import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { Scraper, ScrapeResult, RawJob, Company, ATSRouting } from "./types";

const UA = "Mozilla/5.0 (compatible; JobSearchBot/1.0)";

interface AshbyJobPosting {
  id: string;
  title: string;
  isRemote: boolean;
  location?: string;
  locationName?: string;
  publishedDate?: string;
  publishedAt?: string;
  applyUrl?: string;
  jobUrl?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  descriptionSections?: Array<{ heading?: string; descriptionHtml?: string }>;
}

interface AshbyResponse {
  jobs?: AshbyJobPosting[];
  jobPostings?: AshbyJobPosting[];
}

function buildAshbyDescription(j: AshbyJobPosting): string {
  if (j.descriptionSections?.length) {
    const html = j.descriptionSections
      .map((s) => (s.heading ? `<h3>${s.heading}</h3>` : "") + (s.descriptionHtml ?? ""))
      .join("\n");
    return html;
  }
  return j.descriptionHtml ?? j.descriptionPlain ?? "";
}

export const ashbyScraper: Scraper = {
  name: "ashby",

  async scrape(
    company: Company,
    routing: ATSRouting,
    opts: { timeoutMs: number },
  ): Promise<ScrapeResult> {
    const slug = routing.slug ?? company.slug;
    const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}`;

    const resp = await (fetch as any)(url, {
      headers: { "User-Agent": UA },
      timeout: opts.timeoutMs,
    });
    if (!resp.ok) throw new Error(`Ashby ${slug}: HTTP ${resp.status}`);

    const data = (await resp.json()) as AshbyResponse;
    const raw: AshbyJobPosting[] = data.jobs ?? data.jobPostings ?? [];

    if (raw.length > 200) {
      console.warn(`[ashby] ${slug}: ${raw.length} jobs, capping at 200`);
      raw.splice(200);
    }

    const jobs: RawJob[] = raw.map((j): RawJob => {
      const loc = j.locationName ?? j.location ?? (j.isRemote ? "Remote" : "");

      const rawDesc = buildAshbyDescription(j);
      const description = rawDesc || (j.descriptionPlain ?? "");

      const posted_date =
        (j.publishedAt ?? j.publishedDate ?? "").slice(0, 10) || null;

      return {
        title:        j.title,
        // Public apply URL — see Bug Fix 13c. Prefer jobUrl (canonical public page)
        // over applyUrl (may be a deeplink to the application form only).
        role_url:     j.jobUrl ?? j.applyUrl ?? company.careers_url,
        location_raw: loc,
        posted_date,
        description,
        source_meta: {
          ashby_id:  j.id,
          is_remote: j.isRemote,
        },
      };
    });

    return { jobs, fetchedDescriptions: true };
  },
};
