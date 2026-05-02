/**
 * Amazon scraper — Phase 2
 *
 * Uses amazon.jobs/en/search.json public endpoint — no auth required.
 * Runs two passes: main PM search + optional early-careers (program_url).
 * Descriptions included inline (basic_qualifications + preferred_qualifications).
 */

import fetch from "node-fetch";
import { Scraper, ScrapeResult, RawJob, Company, ATSRouting } from "./types";

const UA = "Mozilla/5.0 (compatible; JobSearchBot/1.0)";
const BASE_URL = "https://www.amazon.jobs/en/search.json";

interface AmazonJob {
  id_icims: string;
  title: string;
  location: string;
  posted_date?: string;       // "Month DD, YYYY" or "YYYY-MM-DD"
  job_path: string;            // "/en/jobs/..."
  description_short?: string;
  basic_qualifications?: string;
  preferred_qualifications?: string;
}

interface AmazonResponse {
  jobs: AmazonJob[];
  hits: number;
}

function parseAmazonDate(s: string | undefined): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function fetchAmazonPass(
  query: string,
  careersUrl: string,
  timeoutMs: number,
): Promise<RawJob[]> {
  const jobs: RawJob[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    // NOTE: Do NOT pass country=us — Amazon's API returns 0 results with it.
    // Instead filter by location format "US, ..." below.
    const params = new URLSearchParams({
      base_query:   query,
      result_limit: String(limit),
      offset:       String(offset),
    });

    const resp = await (fetch as any)(`${BASE_URL}?${params}`, {
      headers: { "User-Agent": UA },
      timeout: timeoutMs,
    });
    if (!resp.ok) throw new Error(`Amazon API: HTTP ${resp.status}`);

    const data = (await resp.json()) as AmazonResponse;
    const batch = data.jobs ?? [];
    if (batch.length === 0) break;

    for (const j of batch) {
      const loc = j.location ?? "";
      const locLower = loc.toLowerCase();
      // Include blank location, "US, *" prefix, remote/virtual
      const isUS =
        !loc ||
        locLower.startsWith("us,") ||
        locLower === "virtual" ||
        locLower.includes("remote") ||
        locLower.includes("virtual");
      if (!isUS) continue;

      const desc = [
        j.description_short ?? "",
        j.basic_qualifications ?? "",
        j.preferred_qualifications ?? "",
      ]
        .filter(Boolean)
        .join("\n\n");

      jobs.push({
        title:        j.title,
        role_url:     `https://www.amazon.jobs${j.job_path}`,
        location_raw: loc,
        posted_date:  parseAmazonDate(j.posted_date),
        description:  desc,
        source_meta: {
          icims_id:   j.id_icims,
          careers_url: careersUrl,
        },
      });
    }

    if (batch.length < limit) break;
    offset += limit;
    if (offset >= 500) break;
  }

  return jobs;
}

export const amazonScraper: Scraper = {
  name: "amazon",

  async scrape(
    company: Company,
    _routing: ATSRouting,
    opts: { timeoutMs: number },
  ): Promise<ScrapeResult> {
    const main = await fetchAmazonPass("product manager", company.careers_url, opts.timeoutMs);

    // Optional second pass: Amazon's early-careers portal (program_url)
    let earlyCareer: RawJob[] = [];
    if (company.program_url) {
      try {
        earlyCareer = await fetchAmazonPass(
          "product manager new grad university",
          company.program_url,
          opts.timeoutMs,
        );
      } catch (err) {
        console.warn(
          `[amazon] early-career pass failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // Deduplicate: early-career results that appear in main (by role_url) are dropped
    const mainUrls = new Set(main.map((j) => j.role_url));
    const newEarly = earlyCareer.filter((j) => !mainUrls.has(j.role_url));

    const jobs = [...main, ...newEarly];
    if (jobs.length > 200) {
      console.warn(`[amazon] ${jobs.length} jobs, capping at 200`);
      jobs.splice(200);
    }

    return { jobs, fetchedDescriptions: true };
  },
};
