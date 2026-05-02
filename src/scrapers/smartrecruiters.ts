/**
 * SmartRecruiters scraper — Phase 2
 *
 * GET https://api.smartrecruiters.com/v1/companies/{slug}/postings
 *     ?status=PUBLIC&limit=100&q=product+manager
 * Public, unauthenticated. Paginated via offset/limit.
 * Descriptions included inline.
 */

import fetch from "node-fetch";
import { Scraper, ScrapeResult, RawJob, Company, ATSRouting } from "./types";

const UA = "Mozilla/5.0 (compatible; JobSearchBot/1.0)";

interface SRJob {
  id:        string;
  name:      string;
  location?: { city?: string; region?: string; country?: string; remote?: boolean };
  releasedDate?: string;
  ref:       string;  // canonical apply URL
  jobAd?: {
    sections?: {
      jobDescription?: { text?: string };
      qualifications?: { text?: string };
    };
  };
}

interface SRResponse {
  totalFound: number;
  content:    SRJob[];
}

export const smartRecruitersScraper: Scraper = {
  name: "smartrecruiters",

  async scrape(
    company: Company,
    routing: ATSRouting,
    opts:    { timeoutMs: number },
  ): Promise<ScrapeResult> {
    const slug     = routing.slug ?? company.slug;
    const limit    = 100;
    let   offset   = 0;
    let   total    = Infinity;
    const jobs: RawJob[] = [];

    while (offset < total && jobs.length < 200) {
      const url =
        `https://api.smartrecruiters.com/v1/companies/${slug}/postings` +
        `?status=PUBLIC&limit=${limit}&offset=${offset}&q=product+manager`;

      const resp = await (fetch as any)(url, {
        headers: { "User-Agent": UA, "Accept": "application/json" },
        timeout: opts.timeoutMs,
      });

      if (!resp.ok) throw new Error(`SmartRecruiters ${slug}: HTTP ${resp.status}`);

      const data = (await resp.json()) as SRResponse;
      total = data.totalFound ?? 0;

      const batch = data.content ?? [];
      if (batch.length === 0) break;

      for (const j of batch) {
        const loc = [j.location?.city, j.location?.region, j.location?.country]
          .filter(Boolean)
          .join(", ");
        const location_raw = j.location?.remote ? "Remote" : (loc || "");

        const description = [
          j.jobAd?.sections?.jobDescription?.text ?? "",
          j.jobAd?.sections?.qualifications?.text ?? "",
        ].filter(Boolean).join("\n\n");

        jobs.push({
          title:        j.name,
          role_url:     j.ref,
          location_raw,
          posted_date:  j.releasedDate ? j.releasedDate.slice(0, 10) : null,
          description:  description || undefined,
          source_meta:  { sr_id: j.id },
        });
      }

      offset += batch.length;
      if (batch.length < limit) break;
    }

    if (jobs.length > 200) jobs.splice(200);

    return { jobs, fetchedDescriptions: true };
  },
};
