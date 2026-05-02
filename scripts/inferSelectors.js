#!/usr/bin/env node
/**
 * scripts/inferSelectors.js
 *
 * For each unresolved custom-playwright company, this script:
 *   1. Navigates to the careers page with a longer wait + scroll (catches lazy-loaded ATSes)
 *   2. Re-runs ATS network detection — many companies load their ATS after interaction
 *   3. If still unresolved, inspects the DOM for job-card patterns and infers CSS selectors
 *   4. Writes results back to config/ats_routing.json
 *
 * Usage:
 *   node scripts/inferSelectors.js                    # all unresolved
 *   node scripts/inferSelectors.js --only shopify,zoom,spotify
 *   node scripts/inferSelectors.js --concurrency 3
 *   node scripts/inferSelectors.js --timeout 45000
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const TARGETS_PATH = path.join(__dirname, "..", "config", "targets.json");
const ROUTING_PATH = path.join(__dirname, "..", "config", "ats_routing.json");

// ── ATS detection signals (same as discoverATS.js) ─────────────────────────────

const ATS_SIGNALS = [
  { name: "greenhouse",  patterns: ["boards-api.greenhouse.io", "boards.greenhouse.io", "greenhouse.io/boards", "greenhouse.io/embed"] },
  { name: "lever",       patterns: ["api.lever.co", "jobs.lever.co"] },
  { name: "ashby",       patterns: ["api.ashbyhq.com", "jobs.ashbyhq.com"] },
  { name: "workday",     patterns: ["myworkdayjobs.com"] },
  { name: "smartrecruiters", patterns: ["api.smartrecruiters.com", "careers.smartrecruiters.com"] },
  { name: "icims",       patterns: ["icims.com"] },
  { name: "taleo",       patterns: ["taleo.net"] },
  { name: "jobvite",     patterns: ["jobvite.com"] },
  { name: "eightfold",   patterns: ["eightfold.ai"] },
  { name: "avature",     patterns: ["avature.net"] },
  { name: "successfactors", patterns: ["successfactors.com", "sapsf.com"] },
  { name: "oraclecloud", patterns: ["oraclecloud.com/hcmUI", "fa.us2.oraclecloud"] },
  { name: "bamboohr",    patterns: ["bamboohr.com"] },
  { name: "breezyhr",    patterns: ["breezy.hr"] },
  { name: "workable",    patterns: ["apply.workable.com", "workable.com"] },
];

function matchesAny(url, patterns) {
  const u = url.toLowerCase();
  return patterns.some((p) => u.includes(p));
}

function extractWorkdayParams(url) {
  const m = url.match(/https?:\/\/([^.]+\.[^.]+\.myworkdayjobs\.com)\/([^/?#]+)/i);
  if (!m) return null;
  const host   = m[1];
  const site   = m[2];
  const tenant = host.split(".")[0];
  return { host, tenant, site };
}

function extractSlugFrom(url, atsName) {
  if (atsName === "greenhouse") {
    const m = url.match(/boards(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/)?([^/?#]+)/i);
    return m ? m[1] : null;
  }
  if (atsName === "lever") {
    const m = url.match(/(?:api\.lever\.co\/v0\/postings|jobs\.lever\.co)\/([^/?#]+)/i);
    return m ? m[1] : null;
  }
  if (atsName === "ashby") {
    const m = url.match(/(?:api\.ashbyhq\.com\/posting-api\/job-board|jobs\.ashbyhq\.com)\/([^/?#]+)/i);
    return m ? m[1] : null;
  }
  if (atsName === "workable") {
    const m = url.match(/apply\.workable\.com\/([^/?#]+)/i);
    return m ? m[1] : null;
  }
  return null;
}

// ── DOM selector inference ─────────────────────────────────────────────────────

/**
 * Try to infer job card selectors from the page DOM.
 * Strategy:
 *   1. Find all <a> elements whose text contains job-title-like phrases
 *   2. Walk up to find a common repeating ancestor (the "card")
 *   3. Derive selectors for title, location, and apply link within the card
 */
async function inferSelectorsFromPage(page, careersUrl) {
  try {
    // Scroll to trigger lazy loading
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1500);

    const result = await page.evaluate(() => {
      // ── Step 1: find all links/elements containing job-title keywords ───────
      const JOB_KEYWORDS = [
        "product manager", "associate pm", "apm", "program manager",
        "software engineer", "data scientist", "designer", "analyst",
        "engineer", "manager", "director",
      ];

      function looksLikeJobTitle(text) {
        const t = text.trim().toLowerCase();
        if (t.length < 5 || t.length > 120) return false;
        return JOB_KEYWORDS.some((k) => t.includes(k));
      }

      // Gather candidate "title" elements — could be any element with job text
      const allEls = Array.from(document.querySelectorAll("a, h2, h3, h4, li, span, div"));
      const titleCandidates = allEls.filter((el) => {
        // Only look at leaf-ish elements (low child element count)
        const directChildEls = el.querySelectorAll(":scope > *").length;
        if (directChildEls > 5) return false;
        return looksLikeJobTitle(el.textContent || "");
      });

      if (titleCandidates.length < 2) return null;

      // ── Step 2: walk up from each candidate to find a repeating ancestor ───
      function getPath(el) {
        const parts = [];
        let cur = el;
        while (cur && cur !== document.body) {
          let selector = cur.tagName.toLowerCase();
          if (cur.id) {
            selector += "#" + cur.id;
          } else if (cur.className && typeof cur.className === "string") {
            const classes = cur.className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
            if (classes.length) selector += "." + classes.join(".");
          }
          parts.unshift(selector);
          cur = cur.parentElement;
        }
        return parts;
      }

      // Find the first ancestor that appears for >= 3 title candidates
      function findCommonCardAncestor(candidates) {
        // For each candidate, collect ancestors up to depth 8
        const ancestorSets = candidates.slice(0, 10).map((el) => {
          const ancestors = [];
          let cur = el.parentElement;
          let depth = 0;
          while (cur && cur !== document.body && depth < 8) {
            ancestors.push(cur);
            cur = cur.parentElement;
            depth++;
          }
          return ancestors;
        });

        // Find ancestors that appear in most candidate chains
        const countMap = new Map();
        for (const set of ancestorSets) {
          for (const anc of set) {
            countMap.set(anc, (countMap.get(anc) || 0) + 1);
          }
        }

        // Find the deepest ancestor appearing for >= min(3, candidates.length) candidates
        const threshold = Math.min(3, candidates.length);
        let bestCard = null;
        let bestDepth = -1;

        for (const [anc, count] of countMap.entries()) {
          if (count < threshold) continue;
          // Prefer deeper (more specific) ancestors
          const depth = getPath(anc).length;
          if (depth > bestDepth) {
            bestDepth = depth;
            bestCard = anc;
          }
        }

        return bestCard;
      }

      const cardEl = findCommonCardAncestor(titleCandidates);
      if (!cardEl) return null;

      // ── Step 3: derive CSS selector for the card ────────────────────────────
      function toCssSelector(el) {
        if (el.id) return "#" + el.id;
        const tag = el.tagName.toLowerCase();
        const classes = typeof el.className === "string"
          ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2)
          : [];
        if (classes.length) return tag + "." + classes.join(".");
        // fall back to nth-child — avoid this; just use tag
        return tag;
      }

      const cardSelector = toCssSelector(cardEl);

      // Verify: how many elements match this selector?
      const cardMatches = document.querySelectorAll(cardSelector);
      if (cardMatches.length < 2) return null;

      // ── Step 4: inside one card, find title / location / link ──────────────
      const sampleCard = cardMatches[0];

      // Title: the element inside the card that looks like a job title
      let titleSelector = null;
      for (const el of Array.from(sampleCard.querySelectorAll("a, h2, h3, h4, span, div, p"))) {
        if (looksLikeJobTitle(el.textContent || "")) {
          titleSelector = toCssSelector(el);
          break;
        }
      }

      // Apply URL: the first <a> inside the card with an href
      let applyUrlSelector = null;
      const linkEl = sampleCard.querySelector("a[href]");
      if (linkEl) applyUrlSelector = "a[href]";

      // Location: look for elements containing location-like text
      let locationSelector = null;
      const LOC_PATTERNS = ["remote", "new york", "san francisco", "seattle", "austin", "london", ", ca", ", ny", ", wa", ", tx"];
      for (const el of Array.from(sampleCard.querySelectorAll("span, div, p, li"))) {
        const t = (el.textContent || "").toLowerCase().trim();
        if (t.length < 3 || t.length > 80) continue;
        if (LOC_PATTERNS.some((p) => t.includes(p))) {
          locationSelector = toCssSelector(el);
          break;
        }
      }

      if (!titleSelector || !applyUrlSelector) return null;

      return {
        jobCard:  cardSelector,
        title:    titleSelector,
        location: locationSelector,
        applyUrl: applyUrlSelector,
        _card_count: cardMatches.length,
      };
    });

    return result;
  } catch (e) {
    return null;
  }
}

// ── Core per-company inspection ────────────────────────────────────────────────

async function inspectOne(slug, careersUrl, timeoutMs) {
  const start = Date.now();
  const chromiumArgs = [
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
    "--disable-gpu", "--no-first-run", "--ignore-certificate-errors",
  ];

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: chromiumArgs });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    const networkUrls = [];
    page.on("request",  (r) => networkUrls.push(r.url()));
    page.on("response", (r) => networkUrls.push(r.url()));

    // Navigate with generous timeout
    await Promise.race([
      page.goto(careersUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("nav timeout")), timeoutMs)),
    ]);

    // Wait longer for SPAs + scroll to trigger lazy ATS loads
    await page.waitForTimeout(5000);
    await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight / 2); });
    await page.waitForTimeout(2000);
    await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
    await page.waitForTimeout(2000);

    // Also capture iframe srcs and job-link hrefs
    const iframeUrls = await page.$$eval("iframe[src]", (els) => els.map((e) => e.getAttribute("src") || ""));
    const jobLinks   = await page.$$eval("a[href]", (els) =>
      els
        .filter((a) => {
          const h = (a.getAttribute("href") || "").toLowerCase();
          return h.includes("job") || h.includes("career") || h.includes("apply") || h.includes("position");
        })
        .slice(0, 50)
        .map((a) => a.href || a.getAttribute("href") || ""),
    ).catch(() => []);

    const allUrls = [...new Set([...networkUrls, ...iframeUrls, ...jobLinks])];

    // ── ATS detection ─────────────────────────────────────────────────────────
    let atsName = null;
    let hitUrl  = null;
    for (const signal of ATS_SIGNALS) {
      const hit = allUrls.find((u) => matchesAny(u, signal.patterns));
      if (hit) {
        atsName = signal.name;
        hitUrl  = hit;
        break;
      }
    }

    if (atsName && atsName !== "custom-playwright") {
      let entry;
      if (atsName === "workday" && hitUrl) {
        const wp = extractWorkdayParams(hitUrl);
        if (wp) {
          entry = { ats: "workday", host: wp.host, tenant: wp.tenant, site: wp.site };
        } else {
          entry = { ats: "workday" };
        }
      } else {
        const atsSlug = hitUrl ? extractSlugFrom(hitUrl, atsName) : null;
        entry = { ats: atsName, slug: atsSlug || slug };
      }
      await browser.close();
      return {
        slug,
        resolved: true,
        method: "ats-detected",
        entry: { ...entry, _discovery_method: "network-intercept", _discovered_at: new Date().toISOString() },
        durationMs: Date.now() - start,
      };
    }

    // ── DOM selector inference ────────────────────────────────────────────────
    const selectors = await inferSelectorsFromPage(page, careersUrl);
    await browser.close();

    if (selectors) {
      const { _card_count, ...selectorFields } = selectors;
      return {
        slug,
        resolved: true,
        method: "dom-inferred",
        cardCount: _card_count,
        entry: {
          ats: "custom-playwright",
          selectors: selectorFields,
          _discovery_method: "dom-inferred",
          _discovered_at: new Date().toISOString(),
        },
        durationMs: Date.now() - start,
      };
    }

    return {
      slug,
      resolved: false,
      method: "unresolved",
      durationMs: Date.now() - start,
    };

  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return {
      slug,
      resolved: false,
      method: "error",
      error: err.message,
      durationMs: Date.now() - start,
    };
  }
}

// ── Batch runner ───────────────────────────────────────────────────────────────

async function run(opts) {
  const { concurrency, timeoutMs, only } = opts;

  const targets = JSON.parse(fs.readFileSync(TARGETS_PATH, "utf-8"));
  const routingFile = JSON.parse(fs.readFileSync(ROUTING_PATH, "utf-8"));

  // Build list of unresolved companies
  let companies = targets.companies.filter((c) => {
    const e = routingFile.routing[c.slug];
    return e && e._discovery_method && e.ats === "custom-playwright" && !e.selectors;
  });

  if (only && only.length > 0) {
    const onlySet = new Set(only);
    companies = companies.filter((c) => onlySet.has(c.slug));
  }

  if (companies.length === 0) {
    console.error("[inferSelectors] Nothing to process — no unresolved custom-playwright companies found.");
    return;
  }

  console.error(
    `[inferSelectors] Processing ${companies.length} unresolved companies. ` +
    `Concurrency: ${concurrency}, timeout: ${timeoutMs}ms`,
  );

  const queue = [...companies];
  const total  = companies.length;
  let done     = 0;
  let atsResolved   = 0;
  let domInferred   = 0;
  let stillUnresolved = 0;
  let errored  = 0;

  async function worker() {
    while (queue.length > 0) {
      const company = queue.shift();
      if (!company) break;

      const result = await inspectOne(company.slug, company.careers_url, timeoutMs);
      done++;

      const tag = result.resolved
        ? (result.method === "ats-detected"
            ? `✓ ats:${result.entry.ats}${result.entry.slug ? `:${result.entry.slug}` : ""}`
            : `✓ dom-inferred (${result.cardCount} cards)`)
        : (result.method === "error" ? `✗ error: ${result.error?.slice(0, 60)}` : "✗ unresolved");

      process.stderr.write(`[${done}/${total}] ${company.slug} → ${tag} (${Math.round(result.durationMs / 100) / 10}s)\n`);

      if (result.resolved) {
        routingFile.routing[company.slug] = result.entry;
        if (result.method === "ats-detected") atsResolved++;
        else domInferred++;
      } else {
        if (result.method === "error") errored++;
        else stillUnresolved++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  fs.writeFileSync(ROUTING_PATH, JSON.stringify(routingFile, null, 2) + "\n");

  console.error(
    `\n[inferSelectors] Done — ` +
    `ats-resolved: ${atsResolved}, dom-inferred: ${domInferred}, ` +
    `still-unresolved: ${stillUnresolved}, errored: ${errored}`,
  );
  console.error(`[inferSelectors] Wrote ${ROUTING_PATH}`);
}

// ── CLI ────────────────────────────────────────────────────────────────────────

(async () => {
  const args = process.argv.slice(2);

  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
  };

  const onlyArg = get("--only", null);

  await run({
    concurrency: parseInt(get("--concurrency", "3"), 10),
    timeoutMs:   parseInt(get("--timeout", "45000"), 10),
    only:        onlyArg ? onlyArg.split(",").map((s) => s.trim()) : [],
  });
})();
