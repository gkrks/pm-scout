/**
 * Test script: visit every custom-playwright company's careers URL,
 * count ALL job-like links (not just PM), and report pass/fail.
 *
 * Pass criteria: >= 3 job links found on the page.
 *
 * Usage: npx ts-node scripts/testCustomPlaywright.ts
 * Output: docs/custom_playwright_results.md
 */

import fs from "fs";
import path from "path";

const CONCURRENCY = 3;
const PAGE_TIMEOUT = 25_000;
const WAIT_AFTER_LOAD = 4_000;
const MIN_JOBS = 3;

interface TestResult {
  slug: string;
  url: string;
  jobCount: number;
  pass: boolean;
  error?: string;
  sampleLinks: string[];
}

async function testUrl(
  browser: import("playwright").Browser,
  slug: string,
  careersUrl: string,
): Promise<TestResult> {
  const result: TestResult = { slug, url: careersUrl, jobCount: 0, pass: false, sampleLinks: [] };
  let page: import("playwright").Page | null = null;

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    page = await context.newPage();

    await page.goto(careersUrl, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
    await page.waitForTimeout(WAIT_AFTER_LOAD);

    // Scroll to trigger lazy loading
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1_000);
    }

    // Count ALL links that look like job listings (broad heuristic)
    const links = await page.evaluate(() => {
      const results: { text: string; href: string }[] = [];
      const seen = new Set<string>();

      document.querySelectorAll("a[href]").forEach((el) => {
        const a = el as HTMLAnchorElement;
        const href = a.href || "";
        const text = (a.textContent || "").trim().replace(/\s+/g, " ");

        if (!href || seen.has(href)) return;
        if (text.length < 3 || text.length > 200) return;

        // Job-like URL patterns
        const isJobUrl =
          /\/(jobs?|careers?|positions?|openings?|roles?|opportunities|vacancies)\//i.test(href) ||
          /\/(jobs?|careers?|positions?|openings?|roles?)\?/i.test(href) ||
          /\/job\/|\/posting\/|\/requisition\//i.test(href) ||
          /lever\.co|greenhouse\.io|ashbyhq\.com|workable\.com|myworkday/i.test(href) ||
          /apply|job[-_]?id|req[-_]?id/i.test(href);

        // Job-like link text patterns (broad)
        const isJobText =
          /manager|engineer|designer|analyst|director|lead|specialist|coordinator|associate|intern|developer|scientist|architect|consultant|strategist|head of|vp of/i.test(text);

        // Also catch structured job cards: parent has role-like class
        const parent = a.closest("[class*='job'], [class*='position'], [class*='opening'], [class*='career'], [class*='listing'], [data-job], [data-position]");

        if (isJobUrl || isJobText || parent) {
          seen.add(href);
          results.push({ text: text.substring(0, 100), href });
        }
      });

      return results;
    });

    result.jobCount = links.length;
    result.pass = links.length >= MIN_JOBS;
    result.sampleLinks = links.slice(0, 5).map((l) => `${l.text} → ${l.href}`);

    await context.close();
  } catch (e: any) {
    result.error = e.message?.substring(0, 200) || String(e);
    if (page) {
      try { await page.context().close(); } catch {}
    }
  }

  const status = result.pass ? "PASS" : result.error ? "ERROR" : "FAIL";
  console.log(`[${status}] ${slug}: ${result.jobCount} jobs (${careersUrl})`);
  return result;
}

async function main() {
  const pw = require("playwright") as typeof import("playwright");

  // Load routing config
  const routingPath = path.join(process.cwd(), "config", "ats_routing.json");
  const routing = JSON.parse(fs.readFileSync(routingPath, "utf8"));

  // Load targets for careers_url
  const targetsPath = path.join(process.cwd(), "config", "targets.json");
  const targets = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
  const urlMap: Record<string, string> = {};
  for (const c of targets.companies || targets) {
    urlMap[c.slug] = c.careers_url;
  }

  // Collect custom-playwright companies from manual-companies-md
  const companies: { slug: string; url: string }[] = [];
  for (const [slug, entry] of Object.entries(routing.routing) as [string, any][]) {
    if (entry.ats === "custom-playwright" && entry._discovery_method === "manual-companies-md") {
      const url = entry.url_override || urlMap[slug] || entry._careers_url;
      if (url) companies.push({ slug, url });
    }
  }

  console.log(`Testing ${companies.length} custom-playwright companies (concurrency: ${CONCURRENCY})...\n`);

  const browser = await pw.chromium.launch({
    headless: true,
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled", "--disable-gpu",
    ],
  });

  const results: TestResult[] = [];

  // Process in batches
  for (let i = 0; i < companies.length; i += CONCURRENCY) {
    const batch = companies.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((c) => testUrl(browser, c.slug, c.url)),
    );
    results.push(...batchResults);
  }

  await browser.close();

  // Sort: pass first, then fail, then error
  results.sort((a, b) => {
    if (a.pass !== b.pass) return a.pass ? -1 : 1;
    if (!!a.error !== !!b.error) return a.error ? 1 : -1;
    return b.jobCount - a.jobCount;
  });

  const passed = results.filter((r) => r.pass);
  const failed = results.filter((r) => !r.pass && !r.error);
  const errored = results.filter((r) => !!r.error);

  // Write results file
  let md = `# Custom Playwright Scraper Test Results\n\n`;
  md += `**Date:** ${new Date().toISOString().slice(0, 16)}\n`;
  md += `**Tested:** ${results.length} companies\n`;
  md += `**Criteria:** >= ${MIN_JOBS} job links found (any role, not just PM)\n\n`;
  md += `| Status | Count |\n|--------|-------|\n`;
  md += `| PASS (>=${MIN_JOBS} jobs) | ${passed.length} |\n`;
  md += `| FAIL (<${MIN_JOBS} jobs) | ${failed.length} |\n`;
  md += `| ERROR (page failed) | ${errored.length} |\n\n`;

  md += `---\n\n## PASS (${passed.length})\n\n`;
  md += `| # | Slug | Jobs Found | URL |\n|---|------|-----------|-----|\n`;
  passed.forEach((r, i) => {
    md += `| ${i + 1} | ${r.slug} | ${r.jobCount} | ${r.url} |\n`;
  });

  md += `\n---\n\n## FAIL — fewer than ${MIN_JOBS} jobs (${failed.length})\n\n`;
  md += `| # | Slug | Jobs Found | URL |\n|---|------|-----------|-----|\n`;
  failed.forEach((r, i) => {
    md += `| ${i + 1} | ${r.slug} | ${r.jobCount} | ${r.url} |\n`;
  });

  md += `\n---\n\n## ERROR — page load failed (${errored.length})\n\n`;
  md += `| # | Slug | Error | URL |\n|---|------|-------|-----|\n`;
  errored.forEach((r, i) => {
    md += `| ${i + 1} | ${r.slug} | ${r.error?.substring(0, 80)} | ${r.url} |\n`;
  });

  const outPath = path.join(process.cwd(), "docs", "custom_playwright_results.md");
  fs.writeFileSync(outPath, md);
  console.log(`\n========================================`);
  console.log(`PASS: ${passed.length} | FAIL: ${failed.length} | ERROR: ${errored.length}`);
  console.log(`Results written to: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
