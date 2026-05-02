#!/usr/bin/env node
/**
 * scripts/probeATS.js
 *
 * For each unresolved company, directly probes Greenhouse / Lever / Ashby /
 * SmartRecruiters APIs with common slug variations — no browser required.
 * Much faster and more reliable than Playwright-based detection for API-backed ATSes.
 *
 * Usage:
 *   node scripts/probeATS.js                         # all unresolved
 *   node scripts/probeATS.js --only etsy,shopify     # specific slugs
 *   node scripts/probeATS.js --concurrency 8
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const https = require("https");

const TARGETS_PATH = path.join(__dirname, "..", "config", "targets.json");
const ROUTING_PATH = path.join(__dirname, "..", "config", "ats_routing.json");

// ── HTTP helper ────────────────────────────────────────────────────────────────

function httpGet(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; JobSearchBot/1.0)",
        "Accept": "application/json",
      },
      timeout: timeoutMs,
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function httpPost(url, payload, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: {
        "User-Agent":   "Mozilla/5.0 (compatible; JobSearchBot/1.0)",
        "Content-Type": "application/json",
        "Accept":       "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
      timeout: timeoutMs,
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(data);
    req.end();
  });
}

// ── Slug variations ────────────────────────────────────────────────────────────

function slugVariants(slug, name) {
  const base = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
  const nameSlug = (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const hyphen = slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const variants = new Set([
    slug, base, nameSlug, hyphen,
    // Common suffix/prefix patterns
    base + "careers",
    base + "jobs",
    base + "inc",
    base + "hq",
    "join" + base,
    base.replace(/-/g, ""),
  ]);
  // Remove empty
  variants.delete("");
  return [...variants];
}

// ── Platform probers ───────────────────────────────────────────────────────────

async function probeGreenhouse(slug, name) {
  for (const s of slugVariants(slug, name)) {
    try {
      const r = await httpGet(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`);
      if (r.status === 200) {
        const data = JSON.parse(r.body);
        if (Array.isArray(data.jobs)) return { ats: "greenhouse", slug: s };
      }
    } catch { /* skip */ }
  }
  return null;
}

async function probeLever(slug, name) {
  for (const s of slugVariants(slug, name)) {
    try {
      const r = await httpGet(`https://api.lever.co/v0/postings/${s}?mode=json&limit=1`);
      if (r.status === 200) {
        const data = JSON.parse(r.body);
        if (Array.isArray(data)) return { ats: "lever", slug: s };
      }
    } catch { /* skip */ }
  }
  return null;
}

async function probeAshby(slug, name) {
  for (const s of slugVariants(slug, name)) {
    try {
      const r = await httpGet(`https://api.ashbyhq.com/posting-api/job-board/${s}`);
      if (r.status === 200) {
        const data = JSON.parse(r.body);
        if (data.jobs || data.jobPostings) return { ats: "ashby", slug: s };
      }
    } catch { /* skip */ }
  }
  return null;
}

async function probeSmartRecruiters(slug, name) {
  for (const s of slugVariants(slug, name)) {
    try {
      const r = await httpGet(`https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=1`);
      if (r.status === 200) {
        const data = JSON.parse(r.body);
        if (typeof data.totalFound === "number") return { ats: "smartrecruiters", slug: s };
      }
    } catch { /* skip */ }
  }
  return null;
}

async function probeWorkable(slug, name) {
  for (const s of slugVariants(slug, name)) {
    try {
      const r = await httpGet(`https://apply.workable.com/api/v1/widget/accounts/${s}/jobs?details=false&limit=1`);
      if (r.status === 200) {
        const data = JSON.parse(r.body);
        if (data.results || Array.isArray(data.jobs)) return { ats: "workable", slug: s };
      }
    } catch { /* skip */ }
  }
  return null;
}

async function probeBambooHR(slug, name) {
  for (const s of slugVariants(slug, name)) {
    try {
      const r = await httpGet(`https://${s}.bamboohr.com/careers/list`);
      if (r.status === 200 && r.body.includes('"result"')) {
        return { ats: "bamboohr", slug: s };
      }
    } catch { /* skip */ }
  }
  return null;
}

// ── Per-company probe (all platforms in parallel) ─────────────────────────────

async function probeOne(slug, name) {
  const start = Date.now();
  try {
    const [gh, lv, ash, sr, wb, bhr] = await Promise.all([
      probeGreenhouse(slug, name),
      probeLever(slug, name),
      probeAshby(slug, name),
      probeSmartRecruiters(slug, name),
      probeWorkable(slug, name),
      probeBambooHR(slug, name),
    ]);

    const result = gh || lv || ash || sr || wb || bhr;
    return {
      slug,
      resolved: !!result,
      entry: result
        ? { ...result, _discovery_method: "api-probe", _discovered_at: new Date().toISOString() }
        : null,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return { slug, resolved: false, error: err.message, durationMs: Date.now() - start };
  }
}

// ── Batch runner ───────────────────────────────────────────────────────────────

async function run(opts) {
  const { concurrency, only } = opts;

  const targets = JSON.parse(fs.readFileSync(TARGETS_PATH, "utf-8"));
  const routingFile = JSON.parse(fs.readFileSync(ROUTING_PATH, "utf-8"));

  let companies = targets.companies.filter((c) => {
    const e = routingFile.routing[c.slug];
    // Unresolved custom-playwright (no selectors yet)
    const isUnresolved = e && e._discovery_method && e.ats === "custom-playwright" && !e.selectors;
    // Greenhouse "embed" slug — network-intercept captured the wrong slug
    const isGhEmbed = e && e.ats === "greenhouse" && e.slug === "embed";
    return isUnresolved || isGhEmbed;
  });

  if (only && only.length > 0) {
    const onlySet = new Set(only);
    companies = companies.filter((c) => onlySet.has(c.slug));
  }

  if (companies.length === 0) {
    console.error("[probeATS] Nothing to probe — no unresolved custom-playwright companies.");
    return;
  }

  console.error(`[probeATS] Probing ${companies.length} companies across 6 platforms. Concurrency: ${concurrency}`);

  const queue = [...companies];
  const total  = companies.length;
  let done = 0, resolved = 0, unresolved = 0;

  async function worker() {
    while (queue.length > 0) {
      const company = queue.shift();
      if (!company) break;

      const result = await probeOne(company.slug, company.name);
      done++;

      if (result.resolved && result.entry) {
        routingFile.routing[company.slug] = result.entry;
        resolved++;
        process.stderr.write(
          `[${done}/${total}] ✓ ${company.slug} → ${result.entry.ats}:${result.entry.slug} (${Math.round(result.durationMs / 100) / 10}s)\n`,
        );
      } else {
        unresolved++;
        if (done % 10 === 0) {
          process.stderr.write(`[${done}/${total}] ... ${unresolved} still unresolved\n`);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  fs.writeFileSync(ROUTING_PATH, JSON.stringify(routingFile, null, 2) + "\n");
  console.error(`\n[probeATS] Done — resolved: ${resolved}, unresolved: ${unresolved}`);
  console.error(`[probeATS] Wrote ${ROUTING_PATH}`);
}

// ── CLI ────────────────────────────────────────────────────────────────────────

(async () => {
  const args = process.argv.slice(2);
  const get  = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };
  const onlyArg = get("--only", null);
  await run({
    concurrency: parseInt(get("--concurrency", "10"), 10),
    only:        onlyArg ? onlyArg.split(",").map((s) => s.trim()) : [],
  });
})();
