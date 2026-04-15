import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { allCompanies } from "./companies";
import { appState, Job } from "./state";

const UA = "Mozilla/5.0 (compatible; JobSearchBot/1.0)";
const FETCH_TIMEOUT_MS = 15_000;

// ── Title filters ─────────────────────────────────────────────────────────────

const TITLE_INCLUDE = [
  /associate\s+product\s+manager/i,
  // APM only when it stands alone or is clearly the role title (not e.g. "APM Retrieval")
  /^apm$/i,
  /^associate\s+pm$/i,
  /product\s+manager\s+(i|1)\b/i,
  /\bproduct\s+manager\b/i,
];

const TITLE_EXCLUDE = [
  /\bsenior\b/i, /\bsr\.?\b/i, /\blead\b/i, /\bprincipal\b/i,
  /\bdirector\b/i, /\bhead\b/i, /\bvp\b/i, /\bvice\s+president\b/i,
  /\bstaff\b/i, /\bgroup\s+pm\b/i, /\bgroup\s+product\b/i,
  /\bmanager,\s+product\s+management\b/i,
  /\bengineering\s+manager\b/i,
];

function isPmRole(title: string): boolean {
  if (!TITLE_INCLUDE.some((re) => re.test(title))) return false;
  return !TITLE_EXCLUDE.some((re) => re.test(title));
}

// ── Early-career detection ────────────────────────────────────────────────────

const EARLY_CAREER_TITLE = [
  /associate\s+product\s+manager/i,
  /\bapm\b/i,
  /\bjunior\b/i,
  /\bentry[\s-]level\b/i,
  /\bnew\s+grad(uate)?\b/i,
  /\buniversity\s+grad(uate)?\b/i,
  /\bearly[\s-]career\b/i,
  /\brotational\b/i,
];

const EARLY_CAREER_BODY = [
  /new\s+grad(uate)?/i,
  /entry[\s-]level/i,
  /early[\s-]career/i,
  /university\s+(grad|hire|recruit)/i,
  /campus\s+recruit/i,
  /0[\s-]+to[\s-]+1\s+year/i,
  /rotational\s+program/i,
  /intern(ship)?\s+to\s+(full[\s-]?time|fte)/i,
];

function isEarlyCareer(title: string, description: string): boolean {
  if (EARLY_CAREER_TITLE.some((re) => re.test(title))) return true;
  return EARLY_CAREER_BODY.some((re) => re.test(description.slice(0, 2000)));
}

// ── Location filters ──────────────────────────────────────────────────────────

const NON_US_TOKENS = [
  "canada", "ontario", "british columbia", "toronto", "vancouver", "montreal", "calgary",
  "united kingdom", "uk", "london", "manchester", "edinburgh", "cambridge",
  "india", "bangalore", "bengaluru", "hyderabad", "delhi", "mumbai", "pune", "chennai",
  "germany", "berlin", "munich", "hamburg",
  "france", "paris", "lyon",
  "netherlands", "amsterdam",
  "australia", "sydney", "melbourne",
  "singapore", "hong kong", "japan", "tokyo",
  "south korea", "korea", "seoul", "busan", "incheon",
  "taiwan", "taipei",
  "china", "beijing", "shanghai", "shenzhen",
  "brazil", "são paulo", "sao paulo",
  "mexico", "mexico city",
  "sweden", "stockholm",
  "israel", "tel aviv",
  "ireland", "dublin",
  "poland", "warsaw",
  "emea", "apac", "latam", "international", "global",
  "europe", "asia",
];

function isUsLocation(loc: string): boolean {
  if (!loc.trim()) return true; // blank location = don't exclude
  const lower = loc.toLowerCase();
  return !NON_US_TOKENS.some((token) => lower.includes(token));
}

// ── Experience cap (≤ 3 years) ────────────────────────────────────────────────

// Ranges like "2-5 years" or "2 to 5 years" — both bounds matter.
// Spec: reject if upper bound > 3 (e.g. "2-5 years", "3-6 years").
const EXP_RANGE_RE = /(\d+)\s*(?:-|–|to)\s*(\d+)\+?\s*years?/gi;
// Single values like "4+ years", "5 years of experience".
const EXP_SINGLE_RE = /(\d+)\+?\s*years?(?:\s+of)?(?:\s+(?:relevant|related|prior|professional)\s+)?(?:\s*experience)?/gi;

function passesExperienceFilter(text: string): boolean {
  const clean = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  // Check ranges first; reject if upper bound exceeds 3.
  for (const m of clean.matchAll(EXP_RANGE_RE)) {
    const lo = parseInt(m[1], 10);
    const hi = parseInt(m[2], 10);
    if (lo > 1900 && lo < 2100) continue; // calendar year, not duration
    if (hi > 3) return false;
  }

  // Remove matched ranges so the single-value pass doesn't re-examine them.
  const noRanges = clean.replace(/(\d+)\s*(?:-|–|to)\s*(\d+)\+?\s*years?/gi, "");

  // Check single values; reject if value exceeds 3.
  for (const m of noRanges.matchAll(EXP_SINGLE_RE)) {
    const yrs = parseInt(m[1], 10);
    if (yrs > 1900 && yrs < 2100) continue; // calendar year, not duration
    if (yrs > 3) return false;
  }

  return true;
}

// ── Work-type inference ───────────────────────────────────────────────────────

function workTypeFrom(loc: string): string {
  const lower = loc.toLowerCase();
  if (lower.includes("remote")) return "Remote";
  if (lower.includes("hybrid")) return "Hybrid";
  if (!loc.trim()) return "—";
  return "Onsite";
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function formatDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  // Return just the date portion (YYYY-MM-DD)
  return iso.slice(0, 10);
}

function epochToDate(ms: number | undefined | null): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 10);
}

// ── Unique ID ─────────────────────────────────────────────────────────────────

function makeId(company: string, externalId: string): string {
  return `${company.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${externalId}`;
}

// ── 3-month date cutoff ───────────────────────────────────────────────────────

function getDateCutoff(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// ── Fetch helper with timeout ─────────────────────────────────────────────────

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // node-fetch v2 doesn't support AbortController, use the timeout option
    const resp = await (fetch as any)(url, {
      headers: { "User-Agent": UA },
      timeout: FETCH_TIMEOUT_MS,
    });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

// ── Greenhouse scraper ────────────────────────────────────────────────────────

interface GHJob {
  id: number;
  title: string;
  location: { name: string };
  first_published?: string; // ISO timestamp — when the job was first posted
  updated_at: string;       // ISO timestamp — last update
  absolute_url: string;
  content?: string;         // HTML description
}

async function scrapeGreenhouse(companyName: string, slug: string, careersUrl: string): Promise<Job[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  const resp = await fetchWithTimeout(url);
  if (!resp.ok) throw new Error(`GH ${slug}: HTTP ${resp.status}`);

  const data = (await resp.json()) as { jobs: GHJob[] };
  const jobs: Job[] = [];
  const cutoff = getDateCutoff();

  for (const j of data.jobs ?? []) {
    if (!isPmRole(j.title)) continue;
    if (!isUsLocation(j.location?.name ?? "")) continue;

    // Prefer first_published (exact posting date); fall back to updated_at
    const datePosted = j.first_published
      ? formatDate(j.first_published)
      : formatDate(j.updated_at);

    // Skip jobs older than 3 months
    if (datePosted !== "—" && datePosted < cutoff) continue;

    // Strip HTML from description for text comparison
    const descText = j.content
      ? cheerio.load(j.content).text()
      : "";

    if (!passesExperienceFilter(descText)) continue;

    jobs.push({
      id:          makeId(companyName, String(j.id)),
      company:     companyName,
      title:       j.title,
      location:    j.location?.name ?? "",
      workType:    workTypeFrom(j.location?.name ?? ""),
      datePosted,
      applyUrl:    j.absolute_url,
      careersUrl,
      earlyCareer: isEarlyCareer(j.title, descText),
      description: j.content ?? descText, // keep HTML for requirement extraction
    });
  }

  return jobs;
}

// ── Lever scraper ─────────────────────────────────────────────────────────────

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt: number;  // epoch ms — actual posting date
  categories: { location?: string; team?: string };
  descriptionPlain?: string;
  lists?: Array<{ text: string; content: string }>;
}

async function scrapeLever(companyName: string, slug: string, careersUrl: string): Promise<Job[]> {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  const resp = await fetchWithTimeout(url);
  if (!resp.ok) throw new Error(`Lever ${slug}: HTTP ${resp.status}`);

  const data = (await resp.json()) as LeverJob[];
  const jobs: Job[] = [];
  const cutoff = getDateCutoff();

  for (const j of Array.isArray(data) ? data : []) {
    if (!isPmRole(j.text)) continue;
    const loc = j.categories?.location ?? "";
    if (!isUsLocation(loc)) continue;

    const datePosted = epochToDate(j.createdAt);

    // Skip jobs older than 3 months
    if (datePosted !== "—" && datePosted < cutoff) continue;

    // Build plain-text description from all sections
    const descText = [
      j.descriptionPlain ?? "",
      ...(j.lists ?? []).map((l) =>
        `${l.text}\n${cheerio.load(l.content).text()}`
      ),
    ].join("\n\n");

    if (!passesExperienceFilter(descText)) continue;

    jobs.push({
      id:          makeId(companyName, j.id),
      company:     companyName,
      title:       j.text,
      location:    loc,
      workType:    workTypeFrom(loc),
      datePosted,
      applyUrl:    j.hostedUrl,
      careersUrl,
      earlyCareer: isEarlyCareer(j.text, descText),
      description: descText,
    });
  }

  return jobs;
}

// ── Ashby scraper ─────────────────────────────────────────────────────────────

interface AshbyJob {
  id: string;
  title: string;
  isRemote: boolean;
  location?: string;
  locationName?: string;
  publishedDate?: string;   // ISO timestamp (some Ashby boards)
  publishedAt?: string;     // ISO timestamp (most Ashby boards use this)
  applyUrl?: string;
  jobUrl?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  descriptionSections?: Array<{ heading?: string; descriptionHtml?: string }>;
}

interface AshbyResponse {
  jobs?: AshbyJob[];
  jobPostings?: AshbyJob[];
}

async function scrapeAshby(companyName: string, slug: string, careersUrl: string): Promise<Job[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
  const resp = await fetchWithTimeout(url);
  if (!resp.ok) throw new Error(`Ashby ${slug}: HTTP ${resp.status}`);

  const data = (await resp.json()) as AshbyResponse;
  const rawJobs: AshbyJob[] = data.jobs ?? data.jobPostings ?? [];
  const jobs: Job[] = [];
  const cutoff = getDateCutoff();

  for (const j of rawJobs) {
    if (!isPmRole(j.title)) continue;

    const loc = j.locationName ?? j.location ?? (j.isRemote ? "Remote" : "");
    if (!isUsLocation(loc)) continue;

    const datePosted = j.publishedAt
      ? formatDate(j.publishedAt)
      : j.publishedDate
        ? formatDate(j.publishedDate)
        : "—";
    if (datePosted !== "—" && datePosted < cutoff) continue;

    // Build description from sections if available, else fall back to plain/html
    let descHtml = "";
    if (j.descriptionSections?.length) {
      descHtml = j.descriptionSections
        .map((s) => (s.heading ? `<h3>${s.heading}</h3>` : "") + (s.descriptionHtml ?? ""))
        .join("\n");
    } else {
      descHtml = j.descriptionHtml ?? j.descriptionPlain ?? "";
    }

    const descText = descHtml
      ? cheerio.load(descHtml).text()
      : (j.descriptionPlain ?? "");

    if (!passesExperienceFilter(descText)) continue;

    const applyUrl = j.applyUrl ?? j.jobUrl ?? careersUrl;

    jobs.push({
      id:          makeId(companyName, j.id),
      company:     companyName,
      title:       j.title,
      location:    loc,
      workType:    j.isRemote ? "Remote" : workTypeFrom(loc),
      datePosted,
      applyUrl,
      careersUrl,
      earlyCareer: isEarlyCareer(j.title, descText),
      description: descHtml || descText,
    });
  }

  return jobs;
}

// ── Amazon scraper ────────────────────────────────────────────────────────────
// Uses amazon.jobs public search JSON endpoint (no auth required).

interface AmazonJob {
  id_icims: string;
  title: string;
  location: string;
  posted_date?: string; // "Month DD, YYYY" or "YYYY-MM-DD"
  job_path: string;     // "/en/jobs/..."
  description_short?: string;
  basic_qualifications?: string;
  preferred_qualifications?: string;
  job_family_value?: string;
}

interface AmazonResponse {
  jobs: AmazonJob[];
  hits: number;
}

function parseAmazonDate(s: string | undefined): string {
  if (!s) return "—";
  // Try ISO first
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // "April 10, 2024"
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

async function fetchAmazonJobs(
  query: string,
  careersUrl: string,
  sourceLabel?: string,
): Promise<Job[]> {
  const base = "https://www.amazon.jobs/en/search.json";
  const jobs: Job[] = [];
  const cutoff = getDateCutoff();
  let offset = 0;
  const limit = 100;

  while (true) {
    // Note: do NOT pass country=us — it returns 0 results due to an Amazon
    // API quirk. Instead filter by location format "US, ..." below.
    const params = new URLSearchParams({
      base_query:   query,
      result_limit: String(limit),
      offset:       String(offset),
    });
    const resp = await fetchWithTimeout(`${base}?${params}`);
    if (!resp.ok) throw new Error(`Amazon jobs API: HTTP ${resp.status}`);

    const data = (await resp.json()) as AmazonResponse;
    const batch = data.jobs ?? [];
    if (batch.length === 0) break;

    for (const j of batch) {
      if (!isPmRole(j.title)) continue;

      const loc = j.location ?? "";
      const locLower = loc.toLowerCase();
      const isUS = !loc ||
        locLower.startsWith("us,") ||
        locLower === "virtual" ||
        locLower.includes("remote") ||
        locLower.includes("virtual");
      if (!isUS) continue;

      const datePosted = parseAmazonDate(j.posted_date);
      if (datePosted !== "—" && datePosted < cutoff) continue;

      const descText = [
        j.description_short ?? "",
        j.basic_qualifications ?? "",
        j.preferred_qualifications ?? "",
      ].join("\n");

      if (!passesExperienceFilter(descText)) continue;

      jobs.push({
        id:          makeId("amazon", j.id_icims),
        company:     "Amazon",
        title:       j.title,
        location:    j.location ?? "",
        workType:    workTypeFrom(j.location ?? ""),
        datePosted,
        applyUrl:    `https://www.amazon.jobs${j.job_path}`,
        careersUrl,
        earlyCareer: isEarlyCareer(j.title, descText),
        description: descText,
        ...(sourceLabel ? { sourceLabel } : {}),
      });
    }

    if (batch.length < limit) break;
    offset += limit;
    if (offset >= 500) break;
  }

  return jobs;
}

async function scrapeAmazon(careersUrl: string, earlyCareerUrl?: string): Promise<Job[]> {
  // Main product manager search
  const main = await fetchAmazonJobs("product manager", careersUrl);

  // University / early-career pass — targets Amazon\\'s dedicated university portal
  let university: Job[] = [];
  if (earlyCareerUrl) {
    try {
      university = await fetchAmazonJobs(
        "product manager new grad university",
        earlyCareerUrl,
        "Early Careers Portal",
      );
    } catch (err) {
      console.warn(`[scraper] Amazon university pass failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Deduplicate: university results that match a main result by ICIMS id are skipped
  const mainIds = new Set(main.map((j) => j.id));
  const newUniversity = university.filter((j) => !mainIds.has(j.id));
  return [...main, ...newUniversity];
}

// ── LinkedIn guest-API scraper ────────────────────────────────────────────────
// LinkedIn's public guest job-search endpoint returns HTML job cards without
// requiring authentication. Used as an aggregator fallback for companies whose
// own career sites are JS-rendered SPAs (Google, Meta).
//
// Endpoint: /jobs-guest/jobs/api/seeMoreJobPostings/search
// Key params: keywords, location, f_C (company ID), start, count
// Rate limit: 1 req/s is safe; we stay well under that per scan.

const LI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/120.0.0.0 Safari/537.36";

async function scrapeLinkedIn(
  companyName: string,
  linkedInId: string,
  careersUrl: string,
): Promise<Job[]> {
  const base = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";
  const jobs: Job[] = [];
  const seen = new Set<string>(); // deduplicate by job URL
  const cutoff = getDateCutoff();
  const pageSize = 25;
  let start = 0;

  for (let page = 0; page < 4; page++) { // max 100 results (4 × 25)
    const params = new URLSearchParams({
      keywords: "product manager",
      location: "United States",
      f_C:      linkedInId,
      start:    String(start),
      count:    String(pageSize),
    });

    const resp = await (fetch as any)(`${base}?${params}`, {
      headers: { "User-Agent": LI_UA },
      timeout: FETCH_TIMEOUT_MS,
    });

    if (resp.status === 429) {
      console.warn(`[scraper] LinkedIn rate-limited for ${companyName}, stopping pagination`);
      break;
    }
    if (!resp.ok) throw new Error(`LinkedIn (${companyName}): HTTP ${resp.status}`);

    const html: string = await resp.text();
    if (!html.trim() || html.trim() === "<!DOCTYPE html>") break; // empty page

    const $ = cheerio.load(html);
    let pageCount = 0;

    $(".base-search-card").each((_i, el) => {
      const title = $(el).find(".base-search-card__title").text().trim();
      const loc   = $(el).find(".job-search-card__location").text().trim();
      const dt    = $(el).find("time").attr("datetime") ?? "";
      const href  = $(el).find("a.base-card__full-link").attr("href") ?? "";

      // Strip tracking params from LinkedIn URL
      const cleanUrl = href.split("?")[0];
      if (!cleanUrl || seen.has(cleanUrl)) return;
      seen.add(cleanUrl);
      pageCount++;

      if (!isPmRole(title)) return;
      if (!isUsLocation(loc)) return;

      const datePosted = dt ? dt.slice(0, 10) : "—";
      if (datePosted !== "—" && datePosted < cutoff) return;

      // No description text available from LinkedIn search cards — experience
      // filter is skipped here (fetching each detail page would hammer LinkedIn).
      jobs.push({
        id:          makeId(companyName, cleanUrl.replace(/[^a-z0-9]/gi, "-").slice(-30)),
        company:     companyName,
        title,
        location:    loc,
        workType:    workTypeFrom(loc),
        datePosted,
        applyUrl:    cleanUrl,    // LinkedIn job page — has "Apply on company website" button
        careersUrl,
        earlyCareer: isEarlyCareer(title, ""),
        description: "",          // not available without individual page fetch
        sourceLabel: "LinkedIn",  // marks this as aggregator-sourced
      });
    });

    if (pageCount < pageSize) break; // last page
    start += pageSize;
  }

  return jobs;
}

// ── Playwright serializer ─────────────────────────────────────────────────────
// Only one Chromium instance at a time — each needs ~150-200 MB RAM which
// is tight on Render free (512 MB total). Serialise all headless launches.

let _pwQueue = Promise.resolve();
function withPlaywright<T>(fn: () => Promise<T>): Promise<T> {
  const next = _pwQueue.then(fn);
  _pwQueue = next.then(() => { /* empty */ }, () => { /* empty */ });
  return next;
}

// Common Chromium args for low-memory hosts (Render free, serverless)
const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-blink-features=AutomationControlled",
  "--disable-gpu",
  "--no-zygote",
  "--single-process",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-sync",
  "--no-first-run",
  "--mute-audio",
];

// Known system Chromium paths — tried in order when Playwright's own browser is unavailable
const SYSTEM_CHROMIUM_PATHS = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
];

async function launchChromium() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pw = require("playwright") as typeof import("playwright");

  // 1. Try Playwright's own browser (may already be installed)
  try {
    const browser = await pw.chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    console.log("[playwright] launched Playwright browser");
    return browser;
  } catch (e) {
    console.warn(`[playwright] own browser unavailable: ${e instanceof Error ? e.message : e}`);
  }

  // 2. Try installing browser at runtime (handles Render node_modules cache
  //    skipping postinstall, or any other environment where install was missed)
  try {
    console.log("[playwright] attempting runtime browser install...");
    const { execFileSync } = require("child_process") as typeof import("child_process");
    // Find playwright CLI relative to this module
    const pwCliPath = require.resolve("playwright/package.json").replace(/package\.json$/, "") + "node_modules/.bin/playwright";
    const cli = require("fs").existsSync(pwCliPath) ? pwCliPath : "./node_modules/.bin/playwright";
    execFileSync(cli, ["install", "chromium"], {
      env: { ...process.env },
      stdio: "inherit",
      timeout: 120_000,
    });
    const browser = await pw.chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    console.log("[playwright] launched after runtime install");
    return browser;
  } catch (e) {
    console.warn(`[playwright] runtime install failed: ${e instanceof Error ? e.message : e}`);
  }

  // 3. Try known system Chromium paths (Render Debian base image)
  const fs = require("fs") as typeof import("fs");
  for (const executablePath of SYSTEM_CHROMIUM_PATHS) {
    if (!fs.existsSync(executablePath)) continue;
    try {
      const browser = await pw.chromium.launch({ headless: true, args: CHROMIUM_ARGS, executablePath });
      console.log(`[playwright] launched system chromium at ${executablePath}`);
      return browser;
    } catch (e) {
      console.warn(`[playwright] failed with ${executablePath}: ${e instanceof Error ? e.message : e}`);
    }
  }

  throw new Error("No Chromium available — all install attempts failed");
}

// ── Google scraper ────────────────────────────────────────────────────────────
// Google Careers is a JS-rendered Angular SPA with no public API.
// NOTE: Google does not expose posting dates anywhere (confirmed via DOM, HTML
//       source, and JSON-LD inspection) — datePosted will be "—".
// Strategy:
//   1. Playwright Chromium headless — renders the real page, extracts DOM cards
//   2. LinkedIn guest API           — fallback if Playwright unavailable/fails
//
// Confirmed selectors (verified 2026-04-15):
//   Cards:    li.lLd3Je
//   Title:    h3 inside card
//   Location: span.r0wTof (first one, without .p3oCrc)
//   Job ID:   jsdata attr "Aiqs8c;{id};$N" on the inner div
//   URL:      <a> href (relative) — prepend https://careers.google.com/

/** Shared helper — extracts job cards from a loaded Google Careers page */
async function extractGoogleCards(
  page: import("playwright").Page,
  careersUrl: string,
  sourceLabel?: string,
): Promise<Job[]> {
  await page.waitForSelector("li.lLd3Je", { timeout: 15_000 });

  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  }

  type CardData = { title: string; loc: string; href: string; jobId: string };
  const cards: CardData[] = await page.evaluate(() => {
    const results: { title: string; loc: string; href: string; jobId: string }[] = [];
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

  const jobs: Job[] = [];
  for (const c of cards) {
    if (!isPmRole(c.title)) continue;
    if (!isUsLocation(c.loc)) continue;
    const applyUrl = c.href.startsWith("http") ? c.href : `https://careers.google.com/${c.href}`;
    jobs.push({
      id:          makeId("google", c.jobId || applyUrl.slice(-20)),
      company:     "Google",
      title:       c.title,
      location:    c.loc,
      workType:    workTypeFrom(c.loc),
      datePosted:  "—",
      applyUrl,
      careersUrl,
      earlyCareer: isEarlyCareer(c.title, ""),
      description: "",
      ...(sourceLabel ? { sourceLabel } : {}),
    });
  }
  return jobs;
}

async function scrapeGooglePlaywright(careersUrl: string, earlyCareerUrl?: string): Promise<Job[]> {
  return withPlaywright(async () => {
  const browser = await launchChromium();

  try {
    const context = await browser.newContext({ userAgent: LI_UA, viewport: { width: 1280, height: 900 } });

    // ── Main careers page ─────────────────────────────────────────────────────
    const mainPage = await context.newPage();
    // "load" fires once HTML+subresources finish — don't use "networkidle" because
    // Google's Angular SPA keeps firing background XHRs and never settles on slow hosts.
    await mainPage.goto(
      "https://careers.google.com/jobs/results/?q=product+manager&location=United+States",
      { waitUntil: "load", timeout: 60_000 },
    );
    const mainJobs = await extractGoogleCards(mainPage, careersUrl);
    await mainPage.close();

    // ── Students / Early Careers page ─────────────────────────────────────────
    let studentJobs: Job[] = [];
    if (earlyCareerUrl) {
      try {
        const studentPage = await context.newPage();
        // students/ URL supports the same search params
        await studentPage.goto(
          earlyCareerUrl + "?q=product+manager&location=United+States",
          { waitUntil: "load", timeout: 60_000 },
        );
        studentJobs = await extractGoogleCards(studentPage, earlyCareerUrl, "Early Careers Portal");
        await studentPage.close();
      } catch (err) {
        console.warn(`[scraper] Google students page failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Merge — student page jobs that already appear on main page are deduplicated
    const mainIds = new Set(mainJobs.map((j) => j.id));
    const newStudentJobs = studentJobs.filter((j) => !mainIds.has(j.id));
    return [...mainJobs, ...newStudentJobs];

  } finally {
    await browser.close();
  }
  }); // end withPlaywright
}

async function scrapeGoogle(linkedInId: string, careersUrl: string, earlyCareerUrl?: string): Promise<Job[]> {
  try {
    const jobs = await scrapeGooglePlaywright(careersUrl, earlyCareerUrl);
    if (jobs.length > 0) {
      console.log(`[scraper] Google: ${jobs.length} jobs via headless browser`);
      return jobs;
    }
    console.warn("[scraper] Google headless returned 0 results — using LinkedIn fallback");
  } catch (err) {
    console.warn(
      `[scraper] Google careers requires JS rendering — fallback triggered: ${err instanceof Error ? err.message : err}`,
    );
  }
  console.log("[scraper] Google: using LinkedIn fallback");
  return scrapeLinkedIn("Google", linkedInId, careersUrl);
}

// ── Meta scraper ──────────────────────────────────────────────────────────────
// Meta Careers is a React SPA. The page makes a GraphQL call to
// metacareers.com/graphql that returns all matching jobs in one response.
// NOTE: Meta does not expose posting dates anywhere — datePosted will be "—".
// Strategy:
//   1. Playwright — loads the page, intercepts the GraphQL response, extracts jobs
//   2. LinkedIn guest API — fallback if Playwright unavailable/fails
//
// GraphQL response shape (verified 2026-04-15):
//   data.job_search_with_featured_jobs.all_jobs[]
//     id, title, locations[], teams[], sub_teams[]  (no date fields exposed)

interface MetaGQLJob {
  id: string;
  title: string;
  locations?: string[];
  teams?: string[];
}

/** Shared helper — intercepts Meta GraphQL responses and builds Job objects */
async function fetchMetaGraphQLJobs(
  page: import("playwright").Page,
  url: string,
  careersUrl: string,
  sourceLabel?: string,
): Promise<MetaGQLJob[]> {
  const captured: MetaGQLJob[] = [];
  page.on("response", async (resp) => {
    if (!resp.url().includes("graphql")) return;
    try {
      const body = (await resp.json()) as { data?: { job_search_with_featured_jobs?: { all_jobs?: MetaGQLJob[] } } };
      const jobs = body?.data?.job_search_with_featured_jobs?.all_jobs;
      if (jobs?.length) captured.push(...jobs);
    } catch { /* non-JSON — skip */ }
  });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35_000 });
  await page.waitForTimeout(9_000);
  return captured;
}

function metaGQLToJobs(
  rawJobs: MetaGQLJob[],
  careersUrl: string,
  sourceLabel?: string,
): Job[] {
  const jobs: Job[] = [];
  const seen = new Set<string>();
  for (const j of rawJobs) {
    if (seen.has(j.id)) continue;
    seen.add(j.id);
    const title = j.title ?? "";
    if (!isPmRole(title)) continue;
    const usLocs = (j.locations ?? []).filter((l) => isUsLocation(l));
    if (usLocs.length === 0) continue;
    const loc = usLocs[0];
    jobs.push({
      id:          makeId("meta", j.id),
      company:     "Meta",
      title,
      location:    loc,
      workType:    workTypeFrom(loc),
      datePosted:  "—",
      applyUrl:    `https://www.metacareers.com/profile/job_details/${j.id}`,
      careersUrl,
      earlyCareer: isEarlyCareer(title, ""),
      description: "",
      ...(sourceLabel ? { sourceLabel } : {}),
    });
  }
  return jobs;
}

async function scrapeMetaPlaywright(careersUrl: string, earlyCareerUrl?: string): Promise<Job[]> {
  return withPlaywright(async () => {
  const browser = await launchChromium();

  try {
    const context = await browser.newContext({ userAgent: LI_UA });

    // ── Main careers page ─────────────────────────────────────────────────────
    const mainPage = await context.newPage();
    const mainRaw = await fetchMetaGraphQLJobs(
      mainPage,
      "https://www.metacareers.com/jobs?offices=United+States&teams=Product+Management&q=product+manager",
      careersUrl,
    );
    await mainPage.close();
    const mainJobs = metaGQLToJobs(mainRaw, careersUrl);

    // ── Early Careers portal ──────────────────────────────────────────────────
    let earlyJobs: Job[] = [];
    if (earlyCareerUrl) {
      try {
        const earlyPage = await context.newPage();
        const earlyRaw = await fetchMetaGraphQLJobs(
          earlyPage,
          earlyCareerUrl,
          earlyCareerUrl,
          "Early Careers Portal",
        );
        await earlyPage.close();
        earlyJobs = metaGQLToJobs(earlyRaw, earlyCareerUrl, "Early Careers Portal");
      } catch (err) {
        console.warn(`[scraper] Meta early career page failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (mainJobs.length === 0 && earlyJobs.length === 0) {
      throw new Error("Meta Playwright: no jobs captured from GraphQL responses");
    }

    // Deduplicate early-career results that are already in main
    const mainIds = new Set(mainJobs.map((j) => j.id));
    const newEarlyJobs = earlyJobs.filter((j) => !mainIds.has(j.id));
    return [...mainJobs, ...newEarlyJobs];

  } finally {
    await browser.close();
  }
  }); // end withPlaywright
}

async function scrapeMeta(linkedInId: string, careersUrl: string, earlyCareerUrl?: string): Promise<Job[]> {
  try {
    const jobs = await scrapeMetaPlaywright(careersUrl, earlyCareerUrl);
    if (jobs.length > 0) {
      console.log(`[scraper] Meta: ${jobs.length} jobs via headless browser`);
      return jobs;
    }
    console.warn("[scraper] Meta headless returned 0 results — using LinkedIn fallback");
  } catch (err) {
    console.warn(`[scraper] Meta scraper failed: ${err instanceof Error ? err.message : err} — using LinkedIn fallback`);
  }
  console.log("[scraper] Meta: using LinkedIn fallback");
  return scrapeLinkedIn("Meta", linkedInId, careersUrl);
}

// ── LinkedIn keyword scraper ──────────────────────────────────────────────────
// Used for user-added companies where we don't have a LinkedIn company ID.
// Searches "product manager {companyName}" and filters results by company name.

export async function scrapeLinkedInByKeyword(
  companyName: string,
  careersUrl: string,
): Promise<Job[]> {
  const base = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";
  const jobs: Job[] = [];
  const seen = new Set<string>();
  const cutoff = getDateCutoff();
  const nameLower = companyName.toLowerCase();

  const params = new URLSearchParams({
    keywords: `product manager ${companyName}`,
    location: "United States",
    start:    "0",
    count:    "25",
  });

  const resp = await (fetch as any)(`${base}?${params}`, {
    headers: { "User-Agent": LI_UA },
    timeout: FETCH_TIMEOUT_MS,
  });

  if (resp.status === 429) throw new Error(`LinkedIn rate-limited for ${companyName}`);
  if (!resp.ok) throw new Error(`LinkedIn keyword search (${companyName}): HTTP ${resp.status}`);

  const html: string = await resp.text();
  const $ = cheerio.load(html);

  $(".base-search-card").each((_i, el) => {
    const title   = $(el).find(".base-search-card__title").text().trim();
    const company = $(el).find(".base-search-card__subtitle").text().trim();
    const loc     = $(el).find(".job-search-card__location").text().trim();
    const dt      = $(el).find("time").attr("datetime") ?? "";
    const href    = $(el).find("a.base-card__full-link").attr("href") ?? "";

    // Only keep results that actually belong to this company
    if (!company.toLowerCase().includes(nameLower.split(/\s+/)[0])) return;

    const cleanUrl = href.split("?")[0];
    if (!cleanUrl || seen.has(cleanUrl)) return;
    seen.add(cleanUrl);

    if (!isPmRole(title)) return;
    if (!isUsLocation(loc)) return;

    const datePosted = dt ? dt.slice(0, 10) : "—";
    if (datePosted !== "—" && datePosted < cutoff) return;

    jobs.push({
      id:          makeId(companyName, cleanUrl.replace(/[^a-z0-9]/gi, "-").slice(-30)),
      company:     companyName,
      title,
      location:    loc,
      workType:    workTypeFrom(loc),
      datePosted,
      applyUrl:    cleanUrl,
      careersUrl,
      earlyCareer: isEarlyCareer(title, ""),
      description: "",
      sourceLabel: "LinkedIn",
    });
  });

  return jobs;
}

// ── Meta scraper ──────────────────────────────────────────────────────────────
// ── Semaphore ─────────────────────────────────────────────────────────────────

class Semaphore {
  private count: number;
  private readonly queue: Array<() => void> = [];
  constructor(n: number) { this.count = n; }
  acquire(): Promise<void> {
    if (this.count > 0) { this.count--; return Promise.resolve(); }
    return new Promise((resolve) => this.queue.push(resolve));
  }
  release(): void {
    if (this.queue.length > 0) { this.queue.shift()!(); }
    else { this.count++; }
  }
}

// ── Single-company scrape (used by "Add Company" endpoint) ────────────────────

export async function scrapeCompany(
  platform: string,
  slug: string,
  name: string,
  careersUrl: string,
  linkedInId?: string,
  earlyCareerUrl?: string,
): Promise<Job[]> {
  if (platform === "greenhouse") return scrapeGreenhouse(name, slug, careersUrl);
  if (platform === "lever")      return scrapeLever(name, slug, careersUrl);
  if (platform === "ashby")      return scrapeAshby(name, slug, careersUrl);
  if (platform === "amazon")     return scrapeAmazon(careersUrl, earlyCareerUrl);
  if (platform === "google")     return scrapeGoogle(linkedInId ?? "", careersUrl, earlyCareerUrl);
  if (platform === "meta")       return scrapeMeta(linkedInId ?? "", careersUrl, earlyCareerUrl);
  // "linkedin" — with or without company ID
  if (linkedInId) return scrapeLinkedIn(name, linkedInId, careersUrl);
  return scrapeLinkedInByKeyword(name, careersUrl);
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function scrapeAll(): Promise<void> {
  const companies = allCompanies();
  const total = companies.length;

  appState.status = {
    state:         "scanning",
    progress:      0,
    total,
    currentCompany: "",
    completedAt:   "",
    jobCount:      0,
    errors:        0,
    companyErrors: [],
    scoreProgress: 0,
    scoreTotal:    0,
    scoreLabel:    "",
    scoreCurrent:  "",
  };
  appState.jobs = [];

  const sem = new Semaphore(8); // max 8 concurrent company requests

  await Promise.all(
    companies.map(async (company) => {
      await sem.acquire();
      try {
        appState.status.currentCompany = company.name;

        let jobs: Job[];
        if (company.platform === "greenhouse") {
          jobs = await scrapeGreenhouse(company.name, company.slug, company.careersUrl);
        } else if (company.platform === "lever") {
          jobs = await scrapeLever(company.name, company.slug, company.careersUrl);
        } else if (company.platform === "ashby") {
          jobs = await scrapeAshby(company.name, company.slug, company.careersUrl);
        } else if (company.platform === "amazon") {
          jobs = await scrapeAmazon(company.careersUrl, company.earlyCareerUrl);
        } else if (company.platform === "google") {
          if (!company.linkedInId) throw new Error("Google: no LinkedIn ID configured");
          jobs = await scrapeGoogle(company.linkedInId, company.careersUrl, company.earlyCareerUrl);
        } else if (company.platform === "meta") {
          if (!company.linkedInId) throw new Error("Meta: no LinkedIn ID configured");
          jobs = await scrapeMeta(company.linkedInId, company.careersUrl, company.earlyCareerUrl);
        } else {
          // platform === "linkedin" — Workday/custom ATS companies
          if (company.linkedInId) {
            // Known company ID: precise company-filtered search
            jobs = await scrapeLinkedIn(company.name, company.linkedInId, company.careersUrl);
          } else {
            // User-added company: keyword search fallback
            jobs = await scrapeLinkedInByKeyword(company.name, company.careersUrl);
          }
        }

        appState.jobs.push(...jobs);
        appState.status.jobCount = appState.jobs.length;
        if (jobs.length > 0) {
          console.log(`[scraper] ${company.name}: ${jobs.length} PM role(s)`);
        }
      } catch (err) {
        appState.status.errors += 1;
        const reason = err instanceof Error ? err.message : String(err);
        appState.status.companyErrors.push({ name: company.name, reason, careersUrl: company.careersUrl });
        console.error(`[scraper] ${company.name}: ${reason}`);
      } finally {
        appState.status.progress += 1;
        sem.release();
      }
    })
  );

  // Deduplicate: same company + same title = same job posted in multiple locations.
  // Keep the entry with the most specific location (longer string wins).
  const seen = new Map<string, Job>();
  for (const job of appState.jobs) {
    const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
    const existing = seen.get(key);
    if (!existing || job.location.length > existing.location.length) {
      seen.set(key, job);
    }
  }
  appState.jobs = [...seen.values()];
  appState.status.jobCount = appState.jobs.length;

  appState.status.state        = "done";
  appState.status.completedAt  = new Date().toUTCString();
  appState.status.currentCompany = "";
  console.log(
    `[scraper] Done. ${appState.jobs.length} unique jobs found across ` +
    `${total - appState.status.errors}/${total} companies ` +
    `(${appState.status.errors} errors).`
  );
}
