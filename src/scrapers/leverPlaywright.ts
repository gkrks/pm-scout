/**
 * Lever HTML fallback scraper — uses Playwright to scrape jobs.lever.co/{slug}
 * directly, bypassing the JSON API which can lag 6–8 hours behind new postings.
 *
 * Only used as a supplement for priority Lever companies; results are merged
 * with API results in jobScraper.ts (API wins on overlap).
 */

import type { RawJob } from "./types";
import { launchChromium, LI_UA, CHROMIUM_ARGS } from "./playwright";

/**
 * Priority Lever slugs that get the Playwright fallback.
 * These are high-value companies where 8-hour API lag is unacceptable.
 */
export const LEVER_PRIORITY_SLUGS = new Set([
  "zoox",
  "atlassian",
  "plaid",
  "outreach",
  "netflix",
  "palantir",
  "neon",
  "mistral",
  "clari",
  "highspot",
  "freshworks",
  "wandb",
  "cohere",
]);

/**
 * Scrape a Lever job board HTML page and return raw job listings.
 * Does NOT fetch descriptions — only titles, locations, and URLs.
 */
export async function scrapeLeverHtml(slug: string): Promise<RawJob[]> {
  const browser = await launchChromium();
  try {
    const context = await browser.newContext({ userAgent: LI_UA });
    const page = await context.newPage();
    const url = `https://jobs.lever.co/${slug}`;

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });

    // Wait for job cards to render
    try {
      await page.waitForSelector(".posting", { timeout: 10_000 });
    } catch {
      // Page loaded but no .posting elements — board may be empty or layout changed
      console.warn(`[lever-pw] ${slug}: no .posting elements found`);
      return [];
    }

    const rawJobs = await page.evaluate(() => {
      const results: Array<{
        title: string;
        url: string;
        location: string;
      }> = [];

      const postings = document.querySelectorAll(".posting");
      postings.forEach((posting) => {
        const linkEl = posting.querySelector("a.posting-title") as HTMLAnchorElement | null;
        if (!linkEl) return;

        const titleEl = linkEl.querySelector("h5") ?? linkEl;
        const title = (titleEl.textContent ?? "").trim();
        const href = linkEl.href ?? "";

        const locEl = posting.querySelector(".sort-by-location, .location, .posting-categories .workplaceTypes");
        const location = (locEl?.textContent ?? "").trim();

        if (title && href) {
          results.push({ title, url: href, location });
        }
      });

      return results;
    });

    const jobs: RawJob[] = rawJobs.map((j) => ({
      title:        j.title,
      role_url:     j.url,
      location_raw: j.location,
      posted_date:  null, // Lever HTML listing does not expose posted dates
      description:  "",
      source_meta: {
        lever_source: "html-fallback",
      },
    }));

    if (jobs.length > 200) jobs.splice(200);

    console.log(`[lever-pw] ${slug}: scraped ${jobs.length} jobs from HTML`);
    return jobs;
  } finally {
    await browser.close();
  }
}
