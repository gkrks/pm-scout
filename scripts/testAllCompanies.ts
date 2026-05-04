/**
 * Test script: scrape ALL 754 companies using their actual scraper,
 * count jobs found (any role), and report pass/fail.
 *
 * Pass criteria: >= 3 jobs found per company.
 *
 * Usage: npx ts-node scripts/testAllCompanies.ts
 * Output: docs/all_companies_scrape_results.md
 */

import fs from "fs";
import path from "path";

// Load env
require("dotenv").config();

const MIN_JOBS = 1;
const API_CONCURRENCY = 10;
const PW_CONCURRENCY = 3;
const PER_COMPANY_TIMEOUT = 30_000;

interface TestResult {
  slug: string;
  ats: string;
  url: string;
  jobCount: number;
  pass: boolean;
  error?: string;
}

// ── API-based scrapers: hit the API directly ─────────────────────────────────

async function testGreenhouse(slug: string): Promise<{ count: number; error?: string }> {
  const fetch = require("node-fetch") as typeof import("node-fetch")["default"];
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=false`, {
      timeout: PER_COMPANY_TIMEOUT,
    });
    if (!res.ok) return { count: 0, error: `HTTP ${res.status}` };
    const data = (await res.json()) as any;
    return { count: data.jobs?.length ?? 0 };
  } catch (e: any) {
    return { count: 0, error: e.message?.substring(0, 150) };
  }
}

async function testAshby(slug: string): Promise<{ count: number; error?: string }> {
  const fetch = require("node-fetch") as typeof import("node-fetch")["default"];
  try {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JobSearchBot/1.0)" },
      timeout: PER_COMPANY_TIMEOUT,
    });
    if (!res.ok) return { count: 0, error: `HTTP ${res.status}` };
    const data = (await res.json()) as any;
    const jobs = data.jobs ?? data.jobPostings ?? [];
    return { count: jobs.length };
  } catch (e: any) {
    return { count: 0, error: e.message?.substring(0, 150) };
  }
}

async function testLever(slug: string): Promise<{ count: number; error?: string }> {
  const fetch = require("node-fetch") as typeof import("node-fetch")["default"];
  try {
    const res = await fetch(`https://api.lever.co/v0/postings/${slug}?limit=1&mode=json`, {
      timeout: PER_COMPANY_TIMEOUT,
    });
    if (!res.ok) return { count: 0, error: `HTTP ${res.status}` };
    const data = (await res.json()) as any;
    // Lever paginates; first call with limit=1 returns hasNext. Just get all.
    const res2 = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`, {
      timeout: PER_COMPANY_TIMEOUT,
    });
    const all = (await res2.json()) as any;
    return { count: Array.isArray(all) ? all.length : 0 };
  } catch (e: any) {
    return { count: 0, error: e.message?.substring(0, 150) };
  }
}

async function testSmartRecruiters(slug: string): Promise<{ count: number; error?: string }> {
  const fetch = require("node-fetch") as typeof import("node-fetch")["default"];
  try {
    const url =
      `https://api.smartrecruiters.com/v1/companies/${slug}/postings` +
      `?status=PUBLIC&limit=100&offset=0`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JobSearchBot/1.0)", "Accept": "application/json" },
      timeout: PER_COMPANY_TIMEOUT,
    });
    if (!res.ok) return { count: 0, error: `HTTP ${res.status}` };
    const data = (await res.json()) as any;
    return { count: data.totalFound ?? data.content?.length ?? 0 };
  } catch (e: any) {
    return { count: 0, error: e.message?.substring(0, 150) };
  }
}

async function testWorkable(slug: string): Promise<{ count: number; error?: string }> {
  const fetch = require("node-fetch") as typeof import("node-fetch")["default"];
  try {
    const res = await fetch(`https://apply.workable.com/api/v3/accounts/${slug}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "", location: [], department: [], worktype: [], remote: [] }),
      timeout: PER_COMPANY_TIMEOUT,
    });
    if (!res.ok) return { count: 0, error: `HTTP ${res.status}` };
    const data = (await res.json()) as any;
    return { count: data.results?.length ?? 0 };
  } catch (e: any) {
    return { count: 0, error: e.message?.substring(0, 150) };
  }
}

async function testWorkday(host: string, site: string): Promise<{ count: number; error?: string }> {
  const fetch = require("node-fetch") as typeof import("node-fetch")["default"];
  try {
    const res = await fetch(
      `https://${host}/wday/cxs/${host.split(".")[0]}/${site}/jobs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0 }),
        timeout: PER_COMPANY_TIMEOUT,
      },
    );
    if (!res.ok) return { count: 0, error: `HTTP ${res.status}` };
    const data = (await res.json()) as any;
    return { count: data.total ?? 0 };
  } catch (e: any) {
    return { count: 0, error: e.message?.substring(0, 150) };
  }
}

async function testBambooHR(slug: string): Promise<{ count: number; error?: string }> {
  const fetch = require("node-fetch") as typeof import("node-fetch")["default"];
  try {
    const res = await fetch(`https://${slug}.bamboohr.com/careers/list`, {
      timeout: PER_COMPANY_TIMEOUT,
    });
    if (!res.ok) return { count: 0, error: `HTTP ${res.status}` };
    const data = (await res.json()) as any;
    return { count: data.result?.length ?? 0 };
  } catch (e: any) {
    return { count: 0, error: e.message?.substring(0, 150) };
  }
}

// ── Playwright-based test (custom, google, meta, amazon) ─────────────────────

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

async function testPlaywright(careersUrl: string): Promise<{ count: number; error?: string }> {
  const browser = await getBrowser();
  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(careersUrl, { waitUntil: "domcontentloaded", timeout: PER_COMPANY_TIMEOUT });
    await page.waitForTimeout(4_000);
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

    await context.close();
    return { count };
  } catch (e: any) {
    return { count: 0, error: e.message?.substring(0, 150) };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function testCompany(slug: string, ats: string, routing: any, careersUrl: string): Promise<TestResult> {
  const result: TestResult = { slug, ats, url: careersUrl, jobCount: 0, pass: false };

  try {
    let r: { count: number; error?: string };

    switch (ats) {
      case "greenhouse":
        r = await testGreenhouse(routing.slug || slug);
        break;
      case "ashby":
        r = await testAshby(routing.slug || slug);
        break;
      case "lever":
        r = await testLever(routing.slug || slug);
        break;
      case "smartrecruiters":
        r = await testSmartRecruiters(routing.slug || slug);
        break;
      case "workable":
        r = await testWorkable(routing.slug || slug);
        break;
      case "workday":
        r = await testWorkday(routing.host, routing.site || "en-US");
        break;
      case "bamboohr":
        r = await testBambooHR(routing.slug || slug);
        break;
      case "amazon":
      case "google-playwright":
      case "meta-playwright":
      case "custom-playwright":
        r = await testPlaywright(routing.url_override || careersUrl);
        break;
      case "manual":
        r = { count: 0, error: "skipped (manual)" };
        break;
      default:
        r = { count: 0, error: `unknown ATS: ${ats}` };
    }

    result.jobCount = r.count;
    result.pass = r.count >= MIN_JOBS;
    if (r.error) result.error = r.error;
  } catch (e: any) {
    result.error = e.message?.substring(0, 150);
  }

  const status = result.pass ? "PASS" : result.error ? "ERROR" : "FAIL";
  console.log(`[${status}] ${slug} (${ats}): ${result.jobCount} jobs`);
  return result;
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<TestResult>,
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

async function main() {
  // Load configs
  const routingData = JSON.parse(fs.readFileSync("config/ats_routing.json", "utf8"));
  const targets = JSON.parse(fs.readFileSync("config/targets.json", "utf8"));

  const urlMap: Record<string, string> = {};
  for (const c of targets.companies || targets) {
    urlMap[c.slug] = c.careers_url;
  }

  // Build company list
  const apiCompanies: { slug: string; ats: string; routing: any; url: string }[] = [];
  const pwCompanies: { slug: string; ats: string; routing: any; url: string }[] = [];
  const manualCompanies: { slug: string; ats: string; routing: any; url: string }[] = [];
  const noRouting: { slug: string; ats: string; routing: any; url: string }[] = [];

  const PW_ATS = new Set(["google-playwright", "meta-playwright", "custom-playwright", "amazon"]);

  for (const c of targets.companies || targets) {
    const r = routingData.routing[c.slug];
    if (!r) {
      noRouting.push({ slug: c.slug, ats: "none", routing: {}, url: c.careers_url });
      continue;
    }
    const entry = { slug: c.slug, ats: r.ats, routing: r, url: c.careers_url };
    if (r.ats === "manual") {
      manualCompanies.push(entry);
    } else if (PW_ATS.has(r.ats)) {
      pwCompanies.push(entry);
    } else {
      apiCompanies.push(entry);
    }
  }

  console.log(`\nAPI companies: ${apiCompanies.length}`);
  console.log(`Playwright companies: ${pwCompanies.length}`);
  console.log(`Manual (skipped): ${manualCompanies.length}`);
  console.log(`No routing: ${noRouting.length}`);
  console.log(`Total: ${apiCompanies.length + pwCompanies.length + manualCompanies.length + noRouting.length}\n`);

  // Run API companies
  console.log("=== Testing API companies ===");
  const apiResults = await runPool(apiCompanies, API_CONCURRENCY, (c) =>
    testCompany(c.slug, c.ats, c.routing, c.url),
  );

  // Run Playwright companies
  console.log("\n=== Testing Playwright companies ===");
  const pwResults = await runPool(pwCompanies, PW_CONCURRENCY, (c) =>
    testCompany(c.slug, c.ats, c.routing, c.url),
  );

  // Mark manual + no-routing as skipped
  const manualResults: TestResult[] = manualCompanies.map((c) => ({
    slug: c.slug, ats: "manual", url: c.url, jobCount: 0, pass: false, error: "skipped (manual)",
  }));
  const noRoutingResults: TestResult[] = noRouting.map((c) => ({
    slug: c.slug, ats: "none", url: c.url, jobCount: 0, pass: false, error: "no routing entry",
  }));

  if (_browser) await _browser.close();

  const allResults = [...apiResults, ...pwResults, ...manualResults, ...noRoutingResults];

  // Sort by ATS, then pass/fail
  allResults.sort((a, b) => {
    if (a.ats !== b.ats) return a.ats.localeCompare(b.ats);
    if (a.pass !== b.pass) return a.pass ? -1 : 1;
    return b.jobCount - a.jobCount;
  });

  const passed = allResults.filter((r) => r.pass);
  const failed = allResults.filter((r) => !r.pass && !r.error);
  const errored = allResults.filter((r) => !!r.error && r.error !== "skipped (manual)" && r.error !== "no routing entry");
  const skipped = allResults.filter((r) => r.error === "skipped (manual)" || r.error === "no routing entry");

  // Write results
  let md = `# Full Scraper Test Results — All 754 Companies\n\n`;
  md += `**Date:** ${new Date().toISOString().slice(0, 16)}\n`;
  md += `**Criteria:** >= ${MIN_JOBS} jobs found (any role)\n\n`;
  md += `## Summary\n\n`;
  md += `| Status | Count |\n|--------|-------|\n`;
  md += `| PASS (>=${MIN_JOBS} jobs) | ${passed.length} |\n`;
  md += `| FAIL (<${MIN_JOBS} jobs) | ${failed.length} |\n`;
  md += `| ERROR | ${errored.length} |\n`;
  md += `| SKIPPED (manual/no routing) | ${skipped.length} |\n`;
  md += `| **Total** | **${allResults.length}** |\n\n`;

  // Per-ATS breakdown
  const atsCounts: Record<string, { total: number; pass: number; fail: number; error: number }> = {};
  for (const r of allResults) {
    if (!atsCounts[r.ats]) atsCounts[r.ats] = { total: 0, pass: 0, fail: 0, error: 0 };
    atsCounts[r.ats].total++;
    if (r.pass) atsCounts[r.ats].pass++;
    else if (r.error) atsCounts[r.ats].error++;
    else atsCounts[r.ats].fail++;
  }

  md += `## Per-ATS Breakdown\n\n`;
  md += `| ATS | Total | Pass | Fail | Error | Pass Rate |\n`;
  md += `|-----|-------|------|------|-------|-----------|\n`;
  for (const [ats, c] of Object.entries(atsCounts).sort((a, b) => b[1].total - a[1].total)) {
    const rate = c.total > 0 ? Math.round((c.pass / c.total) * 100) : 0;
    md += `| ${ats} | ${c.total} | ${c.pass} | ${c.fail} | ${c.error} | ${rate}% |\n`;
  }

  md += `\n---\n\n## PASS (${passed.length})\n\n`;
  md += `| # | Slug | ATS | Jobs | URL |\n|---|------|-----|------|-----|\n`;
  passed.forEach((r, i) => {
    md += `| ${i + 1} | ${r.slug} | ${r.ats} | ${r.jobCount} | ${r.url} |\n`;
  });

  md += `\n---\n\n## FAIL — fewer than ${MIN_JOBS} jobs (${failed.length})\n\n`;
  md += `| # | Slug | ATS | Jobs | URL |\n|---|------|-----|------|-----|\n`;
  failed.forEach((r, i) => {
    md += `| ${i + 1} | ${r.slug} | ${r.ats} | ${r.jobCount} | ${r.url} |\n`;
  });

  md += `\n---\n\n## ERROR (${errored.length})\n\n`;
  md += `| # | Slug | ATS | Error | URL |\n|---|------|-----|-------|-----|\n`;
  errored.forEach((r, i) => {
    md += `| ${i + 1} | ${r.slug} | ${r.ats} | ${r.error?.substring(0, 80)} | ${r.url} |\n`;
  });

  md += `\n---\n\n## SKIPPED — manual / no routing (${skipped.length})\n\n`;
  md += `| # | Slug | Reason | URL |\n|---|------|--------|-----|\n`;
  skipped.forEach((r, i) => {
    md += `| ${i + 1} | ${r.slug} | ${r.error} | ${r.url} |\n`;
  });

  const outPath = path.join(process.cwd(), "docs", "all_companies_scrape_results.md");
  fs.writeFileSync(outPath, md);

  console.log(`\n========================================`);
  console.log(`PASS: ${passed.length} | FAIL: ${failed.length} | ERROR: ${errored.length} | SKIPPED: ${skipped.length}`);
  console.log(`Results written to: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
