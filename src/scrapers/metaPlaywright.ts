/**
 * Meta Playwright scraper — Phase 2
 *
 * Meta Careers is a React SPA. The page fires a GraphQL call to
 * metacareers.com/graphql — we intercept the response to extract all jobs.
 * Meta does not expose posting dates — posted_date is always null.
 * No LinkedIn fallback. On failure: retry once after 5s with fresh context.
 *
 * GraphQL response shape (verified 2026-04-15):
 *   data.job_search_with_featured_jobs.all_jobs[]
 *     id, title, locations[], teams[]  (no date fields)
 */

import { Scraper, ScrapeResult, RawJob, Company, ATSRouting } from "./types";
import {
  LI_UA,
  launchChromium,
  withPlaywright,
  fetchDescriptionBatch,
} from "./playwright";

const SEARCH_URL =
  "https://www.metacareers.com/jobs?offices=United+States&teams=Product+Management&q=product+manager";

interface MetaGQLJob {
  id: string;
  title: string;
  locations?: string[];
  teams?: string[];
}

interface MetaGQLResponse {
  data?: {
    job_search_with_featured_jobs?: {
      all_jobs?: MetaGQLJob[];
    };
  };
}

async function interceptMetaJobs(
  page: import("playwright").Page,
  url: string,
): Promise<MetaGQLJob[]> {
  const captured: MetaGQLJob[] = [];

  page.on("response", async (resp) => {
    if (!resp.url().includes("graphql")) return;
    try {
      const body = (await resp.json()) as MetaGQLResponse;
      const jobs = body?.data?.job_search_with_featured_jobs?.all_jobs;
      if (jobs?.length) captured.push(...jobs);
    } catch { /* non-JSON — skip */ }
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35_000 });
  // Wait for the GraphQL response to arrive
  await page.waitForTimeout(9_000);

  return captured;
}

async function scrapeOnce(company: Company): Promise<RawJob[]> {
  return withPlaywright(async () => {
    const browser = await launchChromium();
    try {
      const context = await browser.newContext({ userAgent: LI_UA });

      // ── Main page ────────────────────────────────────────────────────────────
      const mainPage = await context.newPage();
      const mainRaw  = await interceptMetaJobs(mainPage, SEARCH_URL);
      await mainPage.close();

      // ── Early-careers portal ─────────────────────────────────────────────────
      let earlyRaw: MetaGQLJob[] = [];
      if (company.program_url) {
        try {
          const earlyPage = await context.newPage();
          earlyRaw = await interceptMetaJobs(mainPage, company.program_url);
          await earlyPage.close();
        } catch (err) {
          console.warn(
            `[meta] early-career page failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      if (mainRaw.length === 0 && earlyRaw.length === 0) {
        throw new Error("Meta Playwright: no jobs captured from GraphQL responses");
      }

      // Deduplicate
      const seen = new Set<string>();
      const allRaw = [...mainRaw, ...earlyRaw].filter((j) => {
        if (seen.has(j.id)) return false;
        seen.add(j.id);
        return true;
      });

      const jobs: RawJob[] = allRaw.map((j): RawJob => ({
        title:        j.title,
        role_url:     `https://www.metacareers.com/profile/job_details/${j.id}`,
        location_raw: j.locations?.[0] ?? "",
        posted_date:  null, // Meta does not expose posting dates
        description:  "",
        source_meta: {
          meta_id:    j.id,
          locations:  j.locations ?? [],
          teams:      j.teams ?? [],
        },
      }));

      // Fetch descriptions in-session (concurrency 2)
      if (jobs.length > 0) {
        await fetchDescriptionBatch(context, jobs, "Meta");
      }

      return jobs;
    } finally {
      await browser.close();
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const metaPlaywrightScraper: Scraper = {
  name: "meta-playwright",

  async scrape(
    company: Company,
    _routing: ATSRouting,
    _opts: { timeoutMs: number },
  ): Promise<ScrapeResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const jobs = await scrapeOnce(company);
        if (jobs.length > 0) {
          console.log(`[meta] ${jobs.length} jobs via headless browser`);
          return { jobs, fetchedDescriptions: true };
        }
        if (attempt === 0) {
          console.warn("[meta] headless returned 0 results — retrying in 5s");
          await sleep(5_000);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 0) {
          console.warn(`[meta] Playwright failed (attempt 1): ${msg} — retrying in 5s`);
          await sleep(5_000);
        } else {
          throw new Error(`Meta Playwright failed after 2 attempts: ${msg}`);
        }
      }
    }
    throw new Error("Meta Playwright returned 0 results after 2 attempts");
  },
};
