/**
 * Google Playwright scraper — Phase 2
 *
 * Google Careers is a JS-rendered Angular SPA with no public API.
 * Strategy: headless Chromium → wait for li.lLd3Je cards → scroll 3×
 *   → extract title/location/URL → fetch descriptions (concurrency 2).
 *
 * Google does not expose posting dates — posted_date is always null.
 * No LinkedIn fallback. On failure: retry once after 5s with fresh context.
 *
 * Confirmed selectors (verified 2026-04-15):
 *   Cards:    li.lLd3Je
 *   Title:    h3 inside card
 *   Location: span.r0wTof:not(.p3oCrc)
 *   URL:      <a> href
 */

import { Scraper, ScrapeResult, RawJob, Company, ATSRouting } from "./types";
import {
  LI_UA,
  launchChromium,
  withPlaywright,
  fetchDescriptionBatch,
} from "./playwright";

const SEARCH_URL =
  "https://careers.google.com/jobs/results/?q=product+manager&location=United+States";

type GoogleCard = { title: string; loc: string; href: string; jobId: string };

async function extractCards(
  page: import("playwright").Page,
): Promise<GoogleCard[]> {
  await page.waitForSelector("li.lLd3Je", { timeout: 15_000 });
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1_500);
  }

  return page.evaluate((): GoogleCard[] => {
    const results: GoogleCard[] = [];
    document.querySelectorAll("li.lLd3Je").forEach((li) => {
      const title  = li.querySelector("h3")?.textContent?.trim() ?? "";
      const locEl  = li.querySelector("span.r0wTof:not(.p3oCrc)") as HTMLElement | null;
      const loc    = locEl?.textContent?.trim() ?? "";
      const href   = (li.querySelector("a") as HTMLAnchorElement | null)?.href?.split("?")[0] ?? "";
      const jsdata = (li.querySelector("[jsdata]") as HTMLElement | null)?.getAttribute("jsdata") ?? "";
      const jobId  = jsdata.split(";")[1] ?? href.split("/").filter(Boolean).pop() ?? "";
      if (title && href) results.push({ title, loc, href, jobId });
    });
    return results;
  });
}

async function scrapeOnce(company: Company): Promise<RawJob[]> {
  return withPlaywright(async () => {
    const browser = await launchChromium();
    try {
      const context = await browser.newContext({
        userAgent: LI_UA,
        viewport: { width: 1280, height: 900 },
      });

      // ── Main page ────────────────────────────────────────────────────────────
      const mainPage = await context.newPage();
      await mainPage.goto(SEARCH_URL, { waitUntil: "load", timeout: 60_000 });
      const mainCards = await extractCards(mainPage);
      await mainPage.close();

      // ── Students / early-careers page ────────────────────────────────────────
      let earlyCards: GoogleCard[] = [];
      if (company.program_url) {
        try {
          const earlyPage = await context.newPage();
          await earlyPage.goto(
            `${company.program_url}?q=product+manager&location=United+States`,
            { waitUntil: "load", timeout: 60_000 },
          );
          earlyCards = await extractCards(earlyPage);
          await earlyPage.close();
        } catch (err) {
          console.warn(
            `[google] early-career page failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      // Deduplicate early-career results
      const mainIds = new Set(mainCards.map((c) => c.jobId));
      const allCards = [
        ...mainCards,
        ...earlyCards.filter((c) => !mainIds.has(c.jobId)),
      ];

      // Build RawJob list
      const jobs: RawJob[] = allCards.map((c): RawJob => {
        const role_url = c.href.startsWith("http")
          ? c.href
          : `https://careers.google.com/${c.href}`;
        return {
          title:        c.title,
          role_url,
          location_raw: c.loc,
          posted_date:  null, // Google does not expose posting dates
          description:  "",
          source_meta: {
            google_job_id: c.jobId,
            source: c.jobId && mainIds.has(c.jobId) ? "main" : "early-careers",
          },
        };
      });

      // Fetch full descriptions in-session (concurrency 2)
      if (jobs.length > 0) {
        await fetchDescriptionBatch(context, jobs, "Google");
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

export const googlePlaywrightScraper: Scraper = {
  name: "google-playwright",

  async scrape(
    company: Company,
    _routing: ATSRouting,
    _opts: { timeoutMs: number },
  ): Promise<ScrapeResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const jobs = await scrapeOnce(company);
        if (jobs.length > 0) {
          console.log(`[google] ${jobs.length} jobs via headless browser`);
          return { jobs, fetchedDescriptions: true };
        }
        if (attempt === 0) {
          console.warn("[google] headless returned 0 results — retrying in 5s");
          await sleep(5_000);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 0) {
          console.warn(`[google] Playwright failed (attempt 1): ${msg} — retrying in 5s`);
          await sleep(5_000);
        } else {
          throw new Error(`Google Playwright failed after 2 attempts: ${msg}`);
        }
      }
    }
    throw new Error("Google Playwright returned 0 results after 2 attempts");
  },
};
