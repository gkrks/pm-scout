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
  publishedDate?: string;   // ISO timestamp
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

    const datePosted = j.publishedDate ? formatDate(j.publishedDate) : "—";
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

async function scrapeAmazon(careersUrl: string): Promise<Job[]> {
  const base = "https://www.amazon.jobs/en/search.json";
  const jobs: Job[] = [];
  const cutoff = getDateCutoff();
  let offset = 0;
  const limit = 100;

  while (true) {
    // Note: do NOT pass country=us — it returns 0 results due to an Amazon
    // API quirk. Instead filter by location format "US, ..." below.
    const params = new URLSearchParams({
      base_query:   "product manager",
      result_limit: String(limit),
      offset:       String(offset),
    });
    const url = `${base}?${params}`;
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) throw new Error(`Amazon jobs API: HTTP ${resp.status}`);

    const data = (await resp.json()) as AmazonResponse;
    const batch = data.jobs ?? [];
    if (batch.length === 0) break;

    for (const j of batch) {
      if (!isPmRole(j.title)) continue;

      // Amazon location format: "US, WA, Seattle" | "Virtual" | "US, TX, Austin"
      // Filter to US-only by checking country prefix or virtual/remote keywords.
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
      });
    }

    // If we got fewer than limit, we've exhausted the results
    if (batch.length < limit) break;
    offset += limit;
    // Safety cap: don't pull more than 500 results
    if (offset >= 500) break;
  }

  return jobs;
}

// ── Google scraper ────────────────────────────────────────────────────────────
// Google Careers is a fully JS-rendered SPA with no public JSON API.
// We throw a descriptive error so it surfaces in the scan-error panel.

async function scrapeGoogle(careersUrl: string): Promise<Job[]> {
  throw new Error(`JS-rendered SPA — no public API. Check ${careersUrl} directly.`);
}

// ── Meta scraper ──────────────────────────────────────────────────────────────
// Uses the public Meta Careers JSON search endpoint.

// ── Meta scraper ──────────────────────────────────────────────────────────────
// Meta Careers is a fully JS-rendered SPA; their search endpoint requires
// signed session tokens that are not publicly accessible without a browser.
// We throw a descriptive error so it surfaces in the scan-error panel.

async function scrapeMeta(careersUrl: string): Promise<Job[]> {
  throw new Error(`JS-rendered SPA — no public API. Check ${careersUrl} directly.`);
}

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
          jobs = await scrapeAmazon(company.careersUrl);
        } else if (company.platform === "google") {
          jobs = await scrapeGoogle(company.careersUrl);
        } else {
          jobs = await scrapeMeta(company.careersUrl);
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
