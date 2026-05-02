/**
 * Custom Playwright scraper — Phase 2
 *
 * Selector-driven catch-all for companies with bespoke careers pages.
 * Configuration comes from ats_routing.json per slug (selectors field).
 *
 * For unmapped companies (no selectors), falls back to a generic heuristic:
 *   look for <a> tags whose href contains /jobs/ or /careers/ and whose
 *   text matches PM keywords. Expected to be lossy — log the gap.
 *
 * Descriptions are NOT fetched inline — fetchedDescriptions: false.
 * See docs/custom-playwright-adapter.md for the selector contract.
 */

import { Scraper, ScrapeResult, RawJob, Company, ATSRouting, CustomSelectors } from "./types";
import { LI_UA, launchChromium, withPlaywright } from "./playwright";

const PM_HREF_RE = /\/(jobs|careers|positions|openings)\//i;

// ── Generic fallback extraction ───────────────────────────────────────────────

async function extractGeneric(
  page: import("playwright").Page,
  careersUrl: string,
): Promise<Array<{ title: string; location: string; applyHref: string; postedDate: string }>> {
  return page.evaluate(
    ({ origin, pmRe }: { origin: string; pmRe: string }) => {
      const re = new RegExp(pmRe, "i");
      const results: { title: string; location: string; applyHref: string; postedDate: string }[] = [];
      const seen = new Set<string>();

      document.querySelectorAll("a[href]").forEach((el) => {
        const a = el as HTMLAnchorElement;
        const href = a.href || "";
        const text = a.textContent?.trim() ?? "";

        if (!href || seen.has(href)) return;
        // Must look like a job listing link
        if (!/\/(jobs|careers|positions|openings)\//i.test(href)) return;
        // Must contain PM-like text
        if (!/product\s+manager|associate\s+pm|\bapm\b/i.test(text)) return;

        seen.add(href);
        const applyHref = href.startsWith("http") ? href : origin + href;
        results.push({ title: text, location: "", applyHref, postedDate: "" });
      });

      return results;
    },
    { origin: new URL(careersUrl).origin, pmRe: PM_HREF_RE.source },
  );
}

// ── Selector-driven extraction ────────────────────────────────────────────────

async function extractWithSelectors(
  page: import("playwright").Page,
  selectors: CustomSelectors,
  careersUrl: string,
): Promise<Array<{ title: string; location: string; applyHref: string; postedDate: string }>> {
  const timeoutMs  = selectors.timeoutMs ?? 20_000;
  const waitSel    = selectors.waitForSelector ?? selectors.jobCard;

  await page.waitForSelector(waitSel, { timeout: timeoutMs });

  return page.evaluate(
    (opts: {
      jobCard: string; title: string; location?: string; applyUrl: string;
      postedDate?: string; postedDateAttr?: string; careersOrigin: string;
    }) => {
      const results: { title: string; location: string; applyHref: string; postedDate: string }[] = [];
      document.querySelectorAll(opts.jobCard).forEach((el) => {
        const title    = el.querySelector(opts.title)?.textContent?.trim() ?? "";
        const location = opts.location
          ? (el.querySelector(opts.location)?.textContent?.trim() ?? "")
          : "";
        const applyEl  = el.querySelector(opts.applyUrl) as HTMLAnchorElement | null;
        const rawHref  = applyEl?.href ?? applyEl?.getAttribute("href") ?? "";
        const applyHref = rawHref.startsWith("http") ? rawHref : opts.careersOrigin + rawHref;
        let postedDate = "";
        if (opts.postedDate) {
          const dateEl = el.querySelector(opts.postedDate);
          postedDate = opts.postedDateAttr
            ? (dateEl?.getAttribute(opts.postedDateAttr) ?? "")
            : (dateEl?.textContent?.trim() ?? "");
        }
        if (title && applyHref) results.push({ title, location, applyHref, postedDate });
      });
      return results;
    },
    {
      jobCard:        selectors.jobCard,
      title:          selectors.title,
      location:       selectors.location,
      applyUrl:       selectors.applyUrl,
      postedDate:     selectors.postedDate,
      postedDateAttr: selectors.postedDateAttr,
      careersOrigin:  new URL(careersUrl).origin,
    },
  );
}

// ── Scraper ───────────────────────────────────────────────────────────────────

export const customPlaywrightScraper: Scraper = {
  name: "custom-playwright",

  async scrape(
    company: Company,
    routing: ATSRouting,
    opts: { timeoutMs: number },
  ): Promise<ScrapeResult> {
    const careersUrl = routing.url_override ?? company.careers_url;
    const selectors  = routing.selectors;
    const timeoutMs  = selectors?.timeoutMs ?? opts.timeoutMs;

    return withPlaywright(async () => {
      const browser = await launchChromium();
      try {
        const context = await browser.newContext({
          userAgent: LI_UA,
          viewport:  { width: 1280, height: 900 },
        });
        const page = await context.newPage();

        await page.goto(careersUrl, {
          waitUntil: "domcontentloaded",
          timeout:   timeoutMs,
        });

        if (selectors?.scrollToLoad) {
          for (let i = 0; i < 3; i++) {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(1_500);
          }
        }

        let cards: Array<{ title: string; location: string; applyHref: string; postedDate: string }>;

        if (selectors) {
          cards = await extractWithSelectors(page, selectors, careersUrl);
        } else {
          // No selectors configured — generic heuristic (lossy)
          console.warn(
            `[custom-playwright] ${company.slug}: no selectors in ats_routing.json, ` +
            `using generic fallback (results may be incomplete)`,
          );
          // Try to wait for any content
          await page.waitForTimeout(3_000);
          cards = await extractGeneric(page, careersUrl);
        }

        const jobs: RawJob[] = cards.map((c): RawJob => {
          let posted_date: string | null = null;
          if (c.postedDate) {
            const d = new Date(c.postedDate);
            posted_date = isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
          }
          return {
            title:        c.title,
            role_url:     c.applyHref,
            location_raw: c.location,
            posted_date,
            // descriptions require a second pass — caller fetches after filtering
            source_meta: {
              careers_url: careersUrl,
              has_selectors: !!selectors,
            },
          };
        });

        if (jobs.length > 200) {
          console.warn(`[custom-playwright] ${company.slug}: ${jobs.length} jobs, capping at 200`);
          jobs.splice(200);
        }

        return { jobs, fetchedDescriptions: false };
      } finally {
        await browser.close();
      }
    });
  },
};
