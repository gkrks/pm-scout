#!/usr/bin/env node
/**
 * scripts/discoverATS.js — Phase 2
 *
 * One-shot ATS detection helper. Takes a company slug, fetches its careers_url
 * from config/targets.json, launches Playwright headless, inspects network
 * requests and DOM, then suggests an ats_routing.json entry.
 *
 * Usage:
 *   node scripts/discoverATS.js <slug>
 *   node scripts/discoverATS.js stripe
 *   node scripts/discoverATS.js --url https://company.com/careers
 *
 * Run MANUALLY for new companies — do NOT run in production scans.
 * Append the printed JSON to config/ats_routing.json routing object.
 */

"use strict";

const path    = require("path");
const fs      = require("fs");
const { chromium } = require("playwright");

// ── Config ────────────────────────────────────────────────────────────────────

const TARGETS_PATH = path.join(__dirname, "..", "config", "targets.json");
const ROUTING_PATH = path.join(__dirname, "..", "config", "ats_routing.json");

const ATS_SIGNALS = [
  {
    name: "greenhouse",
    networkPatterns: ["boards-api.greenhouse.io", "greenhouse.io/boards"],
    iframePatterns:  ["boards.greenhouse.io"],
    applyUrlPatterns: ["greenhouse.io"],
    note: "Use boards-api.greenhouse.io/v1/boards/{slug}/jobs",
  },
  {
    name: "lever",
    networkPatterns: ["api.lever.co", "jobs.lever.co"],
    iframePatterns:  ["jobs.lever.co"],
    applyUrlPatterns: ["lever.co"],
    note: "Use api.lever.co/v0/postings/{slug}?mode=json",
  },
  {
    name: "ashby",
    networkPatterns: ["api.ashbyhq.com", "ashbyhq.com"],
    iframePatterns:  ["ashbyhq.com"],
    applyUrlPatterns: ["ashbyhq.com"],
    note: "Use api.ashbyhq.com/posting-api/job-board/{slug}",
  },
  {
    name: "workday",
    networkPatterns: ["myworkdayjobs.com", "wd1.myworkdayjobs", "wd2.myworkdayjobs",
                      "wd3.myworkdayjobs", "wd5.myworkdayjobs", "wd12.myworkdayjobs"],
    iframePatterns:  ["myworkdayjobs.com"],
    applyUrlPatterns: ["myworkdayjobs.com"],
    note: "Extract host, tenant, site from the URL pattern {tenant}.wd*.myworkdayjobs.com/{site}",
  },
  {
    name: "smartrecruiters",
    networkPatterns: ["api.smartrecruiters.com", "smartrecruiters.com"],
    iframePatterns:  [],
    applyUrlPatterns: ["smartrecruiters.com", "careers.smartrecruiters.com"],
    note: "SmartRecruiters — not yet supported by a dedicated scraper; use custom-playwright",
  },
  {
    name: "icims",
    networkPatterns: ["icims.com"],
    iframePatterns:  ["icims.com"],
    applyUrlPatterns: ["icims.com"],
    note: "iCIMS — not yet supported by a dedicated scraper; use custom-playwright",
  },
  {
    name: "taleo",
    networkPatterns: ["taleo.net"],
    iframePatterns:  ["taleo.net"],
    applyUrlPatterns: ["taleo.net"],
    note: "Taleo — not yet supported by a dedicated scraper; use custom-playwright",
  },
  {
    name: "jobvite",
    networkPatterns: ["jobvite.com"],
    iframePatterns:  ["jobvite.com"],
    applyUrlPatterns: ["jobvite.com"],
    note: "Jobvite — not yet supported by a dedicated scraper; use custom-playwright",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchesAny(haystack, patterns) {
  return patterns.some((p) => haystack.toLowerCase().includes(p));
}

function getCompanyCareersUrl(slug) {
  if (!fs.existsSync(TARGETS_PATH)) {
    throw new Error(`targets.json not found at ${TARGETS_PATH}`);
  }
  const data = JSON.parse(fs.readFileSync(TARGETS_PATH, "utf-8"));
  const company = data.companies.find((c) => c.slug === slug);
  if (!company) throw new Error(`Slug "${slug}" not found in targets.json`);
  return { careersUrl: company.careers_url, name: company.name };
}

function extractWorkdayParams(url) {
  // Pattern: https://{tenant}.wd*.myworkdayjobs.com/{site}/...
  const m = url.match(/https?:\/\/([^.]+\.[^.]+\.myworkdayjobs\.com)\/([^/?]+)/i);
  if (!m) return null;
  const host = m[1];
  const site = m[2];
  const tenantM = host.match(/^([^.]+)\./);
  const tenant = tenantM ? tenantM[1] : host;
  return { host, tenant, site };
}

// ── Main (single-slug interactive mode) ───────────────────────────────────────

async function discover(careersUrl, label) {
  console.error(`\n[discoverATS] Inspecting: ${careersUrl}`);
  console.error(`[discoverATS] This may take up to 30s...\n`);

  let entry;
  try {
    entry = await discoverRaw(careersUrl, label);
  } catch (err) {
    console.error(`[discoverATS] Detection failed: ${err.message}`);
    printSuggestion(label, { ats: "custom-playwright" }, null);
    return;
  }

  if (entry.ats === "custom-playwright" && !entry.slug) {
    console.error(
      `[discoverATS] Could not detect ATS automatically.\n` +
      `Inspect the network tab in Chrome DevTools for ${careersUrl}\n` +
      `then add an entry manually to config/ats_routing.json.\n` +
      `Defaulting suggestion to custom-playwright.\n`,
    );
    printSuggestion(label, { ats: "custom-playwright" }, null);
    return;
  }

  const atsName = entry.ats;
  const signal  = ATS_SIGNALS.find((s) => s.name === atsName);
  console.error(`[discoverATS] Detected: ${atsName}`);
  if (signal?.note) console.error(`[discoverATS] Note: ${signal.note}`);

  // Strip internal metadata fields before printing
  const { _discovery_method, _discovered_at, ...routingEntry } = entry;
  printSuggestion(label, routingEntry, signal ?? null);
}

function printSuggestion(slug, routing, signal) {
  const existing = fs.existsSync(ROUTING_PATH)
    ? JSON.parse(fs.readFileSync(ROUTING_PATH, "utf-8"))
    : null;

  if (existing?.routing?.[slug]) {
    console.error(`\n[discoverATS] NOTE: "${slug}" already exists in ats_routing.json.`);
  }

  console.log(`\n--- Suggested entry for config/ats_routing.json ---\n`);
  const entry = {};
  entry[slug] = routing;
  console.log(JSON.stringify(entry, null, 2));
  console.log(`\n---------------------------------------------------\n`);

  if (signal?.name === "custom-playwright" || routing.ats === "custom-playwright") {
    console.log(
      `This company needs custom-playwright selectors.\n` +
      `Open ${signal ? "" : "the careers page in Chrome DevTools and "}inspect the DOM,\n` +
      `then add selectors.jobCard, selectors.title, selectors.location, selectors.applyUrl\n` +
      `to the entry above. See docs/custom-playwright-adapter.md for guidance.\n`,
    );
  }
}

// ── Batch discovery helpers ────────────────────────────────────────────────────

/**
 * Discover ATS for a single company and return a structured result.
 * Never throws — returns { slug, ats, entry, error } instead.
 */
async function discoverOne(slug, careersUrl, timeoutMs) {
  const start = Date.now();
  try {
    const result = await Promise.race([
      discoverRaw(careersUrl, slug),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    return { slug, ok: true, entry: result, durationMs: Date.now() - start };
  } catch (err) {
    return { slug, ok: false, error: err.message, durationMs: Date.now() - start };
  }
}

/**
 * Core discovery logic — returns a routing entry object instead of printing.
 */
async function discoverRaw(careersUrl, label) {
  const chromiumArgs = [
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
    "--disable-gpu", "--no-first-run",
  ];

  const browser = await chromium.launch({ headless: true, args: chromiumArgs });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  const networkHits = [];
  const iframeUrls  = [];
  const applyUrls   = [];

  page.on("request",  (req) => networkHits.push(req.url()));
  page.on("response", (res) => networkHits.push(res.url()));

  try {
    await page.goto(careersUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(4_000);

    const frames = await page.$$("iframe[src]");
    for (const frame of frames) {
      const src = await frame.getAttribute("src");
      if (src) iframeUrls.push(src);
    }

    const links = await page.$$eval("a[href]", (els) =>
      els
        .filter((a) => {
          const h = (a.getAttribute("href") || "").toLowerCase();
          return (
            h.includes("apply") || h.includes("job") || h.includes("career") ||
            h.includes("position") || h.includes("opening")
          );
        })
        .slice(0, 30)
        .map((a) => a.href || a.getAttribute("href") || ""),
    );
    applyUrls.push(...links);
  } finally {
    await browser.close();
  }

  const allUrls = [...new Set([...networkHits, ...iframeUrls, ...applyUrls])];

  let detected = null;
  let workdayParams = null;

  for (const signal of ATS_SIGNALS) {
    const hit = allUrls.find(
      (u) =>
        matchesAny(u, signal.networkPatterns) ||
        matchesAny(u, signal.iframePatterns)  ||
        matchesAny(u, signal.applyUrlPatterns),
    );
    if (hit) {
      detected = signal;
      if (signal.name === "workday") {
        workdayParams = extractWorkdayParams(hit);
      }
      break;
    }
  }

  if (!detected) {
    return { ats: "custom-playwright", _discovery_method: "network-intercept", _discovered_at: new Date().toISOString() };
  }

  let routing;
  if (detected.name === "workday" && workdayParams) {
    routing = {
      ats: "workday",
      host: workdayParams.host,
      tenant: workdayParams.tenant,
      site: workdayParams.site,
    };
  } else if (["greenhouse", "lever", "ashby"].includes(detected.name)) {
    let atsSlug = label;
    const hitUrl = allUrls.find(
      (u) =>
        matchesAny(u, detected.networkPatterns) ||
        matchesAny(u, detected.iframePatterns),
    ) ?? "";

    if (detected.name === "greenhouse") {
      const m = hitUrl.match(/boards(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/)?([^/?]+)/i);
      if (m) atsSlug = m[1];
    } else if (detected.name === "lever") {
      const m = hitUrl.match(/api\.lever\.co\/v0\/postings\/([^/?]+)/i) ||
                hitUrl.match(/jobs\.lever\.co\/([^/?]+)/i);
      if (m) atsSlug = m[1];
    } else if (detected.name === "ashby") {
      const m = hitUrl.match(/ashbyhq\.com\/posting-api\/job-board\/([^/?]+)/i) ||
                hitUrl.match(/jobs\.ashbyhq\.com\/([^/?]+)/i);
      if (m) atsSlug = m[1];
    }
    routing = { ats: detected.name, slug: atsSlug };
  } else {
    routing = { ats: "custom-playwright" };
  }

  return { ...routing, _discovery_method: "network-intercept", _discovered_at: new Date().toISOString() };
}

/**
 * Run batch discovery.
 * Reads companies from targets.json, skips already-mapped entries (unless --overwrite),
 * processes in chunks of --concurrency with per-company timeout, and merges results
 * back into ats_routing.json.
 */
async function runBatch(opts) {
  const { offset, limit, concurrency, timeoutMs, overwrite, only } = opts;

  if (!fs.existsSync(TARGETS_PATH)) {
    console.error(`[batch] targets.json not found at ${TARGETS_PATH}`);
    process.exit(1);
  }

  const targets = JSON.parse(fs.readFileSync(TARGETS_PATH, "utf-8"));
  let companies = targets.companies || [];

  // Filter to --only list if provided
  if (only && only.length > 0) {
    const onlySet = new Set(only);
    companies = companies.filter((c) => onlySet.has(c.slug));
    if (companies.length === 0) {
      console.error(`[batch] None of the --only slugs found in targets.json: ${only.join(", ")}`);
      process.exit(1);
    }
  } else {
    // Sort deterministically, then apply offset/limit
    companies.sort((a, b) => a.slug.localeCompare(b.slug));
    if (offset > 0) companies = companies.slice(offset);
    if (limit > 0)  companies = companies.slice(0, limit);
  }

  // Load existing routing
  let routingFile = { version: 1, routing: {}, unmapped_default: "custom-playwright" };
  if (fs.existsSync(ROUTING_PATH)) {
    try {
      routingFile = JSON.parse(fs.readFileSync(ROUTING_PATH, "utf-8"));
    } catch (e) {
      console.error(`[batch] Could not parse existing ats_routing.json: ${e.message}`);
    }
  }

  // Skip already-mapped companies unless --overwrite.
  // A "manually-curated" entry has no _discovery_method field — always preserve those.
  // An "auto-discovered but unresolved" entry has _discovery_method: "network-intercept"
  // AND ats: "custom-playwright" — re-discover those (maybe detection improves).
  const toDiscover = overwrite
    ? companies
    : companies.filter((c) => {
        const existing = routingFile.routing[c.slug];
        if (!existing) return true;                                 // no entry → discover
        if (!existing._discovery_method) return false;              // manually curated → skip
        // Auto-discovered previously unresolved → re-try
        return existing.ats === "custom-playwright";
      });

  console.error(
    `[batch] Discovering ${toDiscover.length} companies ` +
    `(${companies.length - toDiscover.length} already mapped, skipped). ` +
    `Concurrency: ${concurrency}, timeout: ${timeoutMs}ms`,
  );

  if (toDiscover.length === 0) {
    console.error(`[batch] Nothing to do — all companies in this range are already mapped.`);
    return;
  }

  let mapped = 0, unresolved = 0, errored = 0;
  const queue = [...toDiscover];
  const total  = queue.length;
  let done     = 0;

  async function worker() {
    while (queue.length > 0) {
      const company = queue.shift();
      if (!company) break;

      const result = await discoverOne(company.slug, company.careers_url, timeoutMs);
      done++;

      if (done % 10 === 0 || done === total) {
        process.stderr.write(
          `[${done}/${total}] ${company.slug} → ` +
          (result.ok
            ? `${result.entry.ats}${result.entry.slug ? `:${result.entry.slug}` : ""}`
            : `ERROR: ${result.error}`) +
          ` (${Math.round(result.durationMs / 100) / 10}s)\n`,
        );
      }

      if (result.ok) {
        if (result.entry.ats === "custom-playwright" && !result.entry.slug) {
          unresolved++;
        } else {
          mapped++;
        }
        // Merge into routing — never overwrite manually-curated entries (no _discovery_method)
        const existing = routingFile.routing[company.slug];
        const existingIsManual = existing && !existing._discovery_method;
        if (!existingIsManual || overwrite) {
          routingFile.routing[company.slug] = result.entry;
        }
      } else {
        errored++;
        // Record as unresolved so we don't keep re-trying timed-out companies.
        // Only write if there is no existing entry (don't touch manually-curated ones).
        const existing = routingFile.routing[company.slug];
        const existingIsManual = existing && !existing._discovery_method;
        if (!existing || (!existingIsManual && overwrite)) {
          routingFile.routing[company.slug] = {
            ats: "custom-playwright",
            _discovery_method: "network-intercept",
            _discovered_at: new Date().toISOString(),
            _discovery_error: result.error,
          };
        }
      }
    }
  }

  // Run workers in parallel
  await Promise.all(Array.from({ length: concurrency }, worker));

  // Write merged routing file
  fs.writeFileSync(ROUTING_PATH, JSON.stringify(routingFile, null, 2) + "\n");

  const totalEntries = Object.keys(routingFile.routing).length;
  console.error(
    `\n[batch] Done — mapped: ${mapped}, unresolved: ${unresolved}, errored: ${errored}. ` +
    `Total entries in ats_routing.json: ${totalEntries}`,
  );
  console.error(`[batch] Wrote ${ROUTING_PATH}`);
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

(async () => {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage:\n" +
      "  node scripts/discoverATS.js <slug>               # single slug from targets.json\n" +
      "  node scripts/discoverATS.js --url <url>          # inspect a URL directly\n" +
      "  node scripts/discoverATS.js --batch              # batch-discover all unmapped companies\n" +
      "    [--offset N]       Skip first N companies (sorted by slug)\n" +
      "    [--limit N]        Process at most N companies\n" +
      "    [--concurrency N]  Parallel browser instances (default: 3)\n" +
      "    [--timeout N]      Per-company timeout in ms (default: 45000)\n" +
      "    [--overwrite]      Re-discover companies already in ats_routing.json\n" +
      "    [--only a,b,c]     Only discover these slugs (comma-separated)\n",
    );
    process.exit(1);
  }

  // ── Batch mode ──────────────────────────────────────────────────────────────
  if (args.includes("--batch")) {
    const get = (flag, def) => {
      const i = args.indexOf(flag);
      return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
    };
    const onlyArg = get("--only", null);
    await runBatch({
      offset:      parseInt(get("--offset", "0"), 10),
      limit:       parseInt(get("--limit",  "0"), 10),
      concurrency: parseInt(get("--concurrency", "3"), 10),
      timeoutMs:   parseInt(get("--timeout", "45000"), 10),
      overwrite:   args.includes("--overwrite"),
      only:        onlyArg ? onlyArg.split(",").map((s) => s.trim()) : [],
    });
    return;
  }

  // ── Single-slug / URL modes ─────────────────────────────────────────────────
  let careersUrl;
  let label;

  if (args[0] === "--url") {
    careersUrl = args[1];
    label      = "unknown";
    if (!careersUrl) {
      console.error("--url requires a URL argument");
      process.exit(1);
    }
  } else {
    const slug = args[0];
    label = slug;
    try {
      const found = getCompanyCareersUrl(slug);
      careersUrl  = found.careersUrl;
      label       = slug;
      console.error(`[discoverATS] Company: ${found.name} (${slug})`);
    } catch (err) {
      console.error(`[discoverATS] ${err.message}`);
      process.exit(1);
    }
  }

  try {
    await discover(careersUrl, label);
  } catch (err) {
    console.error(`[discoverATS] Fatal: ${err.message}`);
    process.exit(1);
  }
})();
