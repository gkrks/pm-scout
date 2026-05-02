/**
 * Lever scraper — Phase 2
 *
 * GET https://api.lever.co/v0/postings/{slug}?mode=json
 * Public, unauthenticated. Descriptions included inline.
 * posted_date derived from createdAt (epoch ms).
 */

import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { Scraper, ScrapeResult, RawJob, Company, ATSRouting } from "./types";

const UA = "Mozilla/5.0 (compatible; JobSearchBot/1.0)";

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  /** Epoch milliseconds */
  createdAt: number;
  categories: { location?: string; team?: string };
  descriptionPlain?: string;
  lists?: Array<{ text: string; content: string }>;
}

export const leverScraper: Scraper = {
  name: "lever",

  async scrape(
    company: Company,
    routing: ATSRouting,
    opts: { timeoutMs: number },
  ): Promise<ScrapeResult> {
    const slug = routing.slug ?? company.slug;
    const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;

    const resp = await (fetch as any)(url, {
      headers: { "User-Agent": UA },
      timeout: opts.timeoutMs,
    });
    if (!resp.ok) throw new Error(`Lever ${slug}: HTTP ${resp.status}`);

    const data = (await resp.json()) as LeverJob[];
    const raw: LeverJob[] = Array.isArray(data) ? data : [];

    if (raw.length > 200) {
      console.warn(`[lever] ${slug}: ${raw.length} jobs, capping at 200`);
      raw.splice(200);
    }

    const jobs: RawJob[] = raw.map((j): RawJob => {
      const desc = [
        j.descriptionPlain ?? "",
        ...(j.lists ?? []).map((l) =>
          `${l.text}\n${cheerio.load(l.content).text()}`,
        ),
      ]
        .join("\n\n")
        .trim();

      return {
        title:        j.text,
        role_url:     j.hostedUrl, // Public apply URL — see Bug Fix 13c. NOT applyUrl (deeplink to form).
        location_raw: j.categories?.location ?? "",
        posted_date:  j.createdAt
          ? new Date(j.createdAt).toISOString().slice(0, 10)
          : null,
        description:  desc,
        source_meta: {
          lever_id: j.id,
          team:     j.categories?.team ?? null,
        },
      };
    });

    return { jobs, fetchedDescriptions: true };
  },
};
