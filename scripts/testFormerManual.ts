/**
 * Test just the 52 formerly-manual companies.
 * Output: docs/former_manual_scrape_results.md
 */
import fs from "fs";
import path from "path";
require("dotenv").config();

const MIN_JOBS = 1;
const PW_CONCURRENCY = 3;
const PAGE_TIMEOUT = 25_000;
const WAIT_AFTER_LOAD = 4_000;

interface TestResult {
  slug: string;
  url: string;
  jobCount: number;
  pass: boolean;
  error?: string;
}

let _browser: import("playwright").Browser | null = null;

async function getBrowser(): Promise<import("playwright").Browser> {
  if (_browser) return _browser;
  const pw = require("playwright") as typeof import("playwright");
  _browser = await pw.chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled", "--disable-gpu"],
  });
  return _browser;
}

async function testPlaywright(slug: string, careersUrl: string): Promise<TestResult> {
  const result: TestResult = { slug, url: careersUrl, jobCount: 0, pass: false };
  const browser = await getBrowser();
  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(careersUrl, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
    await page.waitForTimeout(WAIT_AFTER_LOAD);
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1_000);
    }

    const count = await page.evaluate(() => {
      const seen = new Set<string>();
      let n = 0;
      document.querySelectorAll("a[href]").forEach((el) => {
        const a = el as HTMLAnchorElement;
        const href = a.href || "";
        const text = (a.textContent || "").trim().replace(/\s+/g, " ");
        if (!href || seen.has(href) || text.length < 3 || text.length > 200) return;
        const isJobUrl =
          /\/(jobs?|careers?|positions?|openings?|roles?|opportunities|vacancies)\//i.test(href) ||
          /\/(jobs?|careers?|positions?|openings?|roles?)\?/i.test(href) ||
          /\/job\/|\/posting\/|\/requisition\//i.test(href) ||
          /lever\.co|greenhouse\.io|ashbyhq\.com|workable\.com|myworkday/i.test(href) ||
          /apply|job[-_]?id|req[-_]?id/i.test(href);
        const isJobText =
          /manager|engineer|designer|analyst|director|lead|specialist|coordinator|associate|intern|developer|scientist|architect|consultant|strategist|head of|vp of/i.test(text);
        const parent = a.closest("[class*='job'], [class*='position'], [class*='opening'], [class*='career'], [class*='listing'], [data-job], [data-position]");
        if (isJobUrl || isJobText || parent) {
          seen.add(href);
          n++;
        }
      });
      return n;
    });

    result.jobCount = count;
    result.pass = count >= MIN_JOBS;
    await context.close();
  } catch (e: any) {
    result.error = e.message?.substring(0, 200) || String(e);
  }

  const status = result.pass ? "PASS" : result.error ? "ERROR" : "FAIL";
  console.log(`[${status}] ${slug}: ${result.jobCount} jobs (${careersUrl})`);
  return result;
}

async function main() {
  const routing = JSON.parse(fs.readFileSync("config/ats_routing.json", "utf8"));
  const targets = JSON.parse(fs.readFileSync("config/targets.json", "utf8"));

  const urlMap: Record<string, string> = {};
  for (const c of targets.companies || targets) {
    urlMap[c.slug] = c.careers_url;
  }

  // Get the 52 formerly-manual companies
  const companies: { slug: string; url: string }[] = [];
  for (const [slug, entry] of Object.entries(routing.routing) as [string, any][]) {
    if (entry._discovery_method === "manual-to-custom") {
      const url = entry.url_override || urlMap[slug] || entry._careers_url;
      if (url) companies.push({ slug, url });
      else console.log(`SKIP ${slug}: no URL`);
    }
  }

  console.log(`Testing ${companies.length} formerly-manual companies...\n`);

  const results: TestResult[] = [];
  for (let i = 0; i < companies.length; i += PW_CONCURRENCY) {
    const batch = companies.slice(i, i + PW_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((c) => testPlaywright(c.slug, c.url)),
    );
    results.push(...batchResults);
  }

  if (_browser) await _browser.close();

  results.sort((a, b) => {
    if (a.pass !== b.pass) return a.pass ? -1 : 1;
    if (!!a.error !== !!b.error) return a.error ? 1 : -1;
    return b.jobCount - a.jobCount;
  });

  const passed = results.filter((r) => r.pass);
  const failed = results.filter((r) => !r.pass && !r.error);
  const errored = results.filter((r) => !!r.error);

  let md = `# Former Manual Companies — Scrape Test Results\n\n`;
  md += `**Date:** ${new Date().toISOString().slice(0, 16)}\n`;
  md += `**Tested:** ${results.length} companies\n`;
  md += `**Criteria:** >= ${MIN_JOBS} job(s) found (any role)\n\n`;
  md += `| Status | Count |\n|--------|-------|\n`;
  md += `| PASS (>=${MIN_JOBS} job) | ${passed.length} |\n`;
  md += `| FAIL (0 jobs) | ${failed.length} |\n`;
  md += `| ERROR | ${errored.length} |\n\n`;

  md += `---\n\n## PASS (${passed.length})\n\n`;
  md += `| # | Slug | Jobs | URL |\n|---|------|------|-----|\n`;
  passed.forEach((r, i) => {
    md += `| ${i + 1} | ${r.slug} | ${r.jobCount} | ${r.url} |\n`;
  });

  md += `\n---\n\n## FAIL — 0 jobs (${failed.length})\n\n`;
  md += `| # | Slug | URL |\n|---|------|-----|\n`;
  failed.forEach((r, i) => {
    md += `| ${i + 1} | ${r.slug} | ${r.url} |\n`;
  });

  md += `\n---\n\n## ERROR (${errored.length})\n\n`;
  md += `| # | Slug | Error | URL |\n|---|------|-------|-----|\n`;
  errored.forEach((r, i) => {
    md += `| ${i + 1} | ${r.slug} | ${r.error?.substring(0, 80)} | ${r.url} |\n`;
  });

  const outPath = path.join(process.cwd(), "docs", "former_manual_scrape_results.md");
  fs.writeFileSync(outPath, md);
  console.log(`\n========================================`);
  console.log(`PASS: ${passed.length} | FAIL: ${failed.length} | ERROR: ${errored.length}`);
  console.log(`Results written to: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
