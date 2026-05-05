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

/**
 * Meta detail pages are React SPAs. The reliable extraction strategy:
 *   1. Wait for networkidle so React hydrates and data loads
 *   2. Try Meta-specific selectors (these rotate, so we try several)
 *   3. Fall back to the largest content block on the page
 */
async function fetchMetaDescription(
  context: import("playwright").BrowserContext,
  url: string,
): Promise<string> {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 });

    const html = await page.evaluate(() => {
      // Meta-specific selectors (obfuscated classes rotate — try known + structural)
      const selectors = [
        "._job_requirements", "._6nq", "._1n3p",
        "[data-testid='job-description']",
        "[role='main'] [dir='auto']",
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && (el.textContent ?? "").trim().length > 150) return el.innerHTML;
      }

      // Fallback: find the largest text block inside [role="main"] or body.
      // Meta renders JD content in nested divs — grab the one with the most text.
      const root = document.querySelector("[role='main']") ?? document.body;
      let best: Element | null = null;
      let bestLen = 0;
      root.querySelectorAll("div, section, article").forEach((el) => {
        const len = (el.textContent ?? "").trim().length;
        // Must be substantial (>300 chars) and a leaf-ish container (not a huge wrapper)
        if (len > 300 && len < 15_000 && len > bestLen) {
          // Prefer elements that contain <li> or <p> — they look like JD content
          const hasList = el.querySelector("li, p, ul, ol");
          if (hasList || len > 500) {
            bestLen = len;
            best = el;
          }
        }
      });
      return best ? (best as Element).innerHTML : "";
    });

    return html;
  } catch {
    return "";
  } finally {
    await page.close();
  }
}

/**
 * Fetch Meta descriptions in batches of 2, mutating job.description in-place.
 */
async function fetchMetaDescriptionBatch(
  context: import("playwright").BrowserContext,
  jobs: RawJob[],
): Promise<void> {
  let done = 0;
  const BATCH = 2;
  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (job) => {
        job.description = await fetchMetaDescription(context, job.role_url);
        done++;
      }),
    );
    console.log(`[meta] fetched descriptions ${done}/${jobs.length}`);
  }
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
          earlyRaw = await interceptMetaJobs(earlyPage, company.program_url);
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

      // Fetch descriptions in-session (concurrency 2, Meta-specific strategy)
      if (jobs.length > 0) {
        await fetchMetaDescriptionBatch(context, jobs);
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
