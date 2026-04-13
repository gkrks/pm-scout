"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrapeAll = scrapeAll;
const node_fetch_1 = __importDefault(require("node-fetch"));
const cheerio = __importStar(require("cheerio"));
const companies_1 = require("./companies");
const state_1 = require("./state");
const UA = "Mozilla/5.0 (compatible; JobSearchBot/1.0)";
const FETCH_TIMEOUT_MS = 15000;
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
function isPmRole(title) {
    if (!TITLE_INCLUDE.some((re) => re.test(title)))
        return false;
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
function isEarlyCareer(title, description) {
    if (EARLY_CAREER_TITLE.some((re) => re.test(title)))
        return true;
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
function isUsLocation(loc) {
    if (!loc.trim())
        return true; // blank location = don't exclude
    const lower = loc.toLowerCase();
    return !NON_US_TOKENS.some((token) => lower.includes(token));
}
// ── Experience cap (≤ 3 years) ────────────────────────────────────────────────
// Ranges like "2-5 years" or "2 to 5 years" — both bounds matter.
// Spec: reject if upper bound > 3 (e.g. "2-5 years", "3-6 years").
const EXP_RANGE_RE = /(\d+)\s*(?:-|–|to)\s*(\d+)\+?\s*years?/gi;
// Single values like "4+ years", "5 years of experience".
const EXP_SINGLE_RE = /(\d+)\+?\s*years?(?:\s+of)?(?:\s+(?:relevant|related|prior|professional)\s+)?(?:\s*experience)?/gi;
function passesExperienceFilter(text) {
    const clean = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    // Check ranges first; reject if upper bound exceeds 3.
    for (const m of clean.matchAll(EXP_RANGE_RE)) {
        const lo = parseInt(m[1], 10);
        const hi = parseInt(m[2], 10);
        if (lo > 1900 && lo < 2100)
            continue; // calendar year, not duration
        if (hi > 3)
            return false;
    }
    // Remove matched ranges so the single-value pass doesn't re-examine them.
    const noRanges = clean.replace(/(\d+)\s*(?:-|–|to)\s*(\d+)\+?\s*years?/gi, "");
    // Check single values; reject if value exceeds 3.
    for (const m of noRanges.matchAll(EXP_SINGLE_RE)) {
        const yrs = parseInt(m[1], 10);
        if (yrs > 1900 && yrs < 2100)
            continue; // calendar year, not duration
        if (yrs > 3)
            return false;
    }
    return true;
}
// ── Work-type inference ───────────────────────────────────────────────────────
function workTypeFrom(loc) {
    const lower = loc.toLowerCase();
    if (lower.includes("remote"))
        return "Remote";
    if (lower.includes("hybrid"))
        return "Hybrid";
    if (!loc.trim())
        return "—";
    return "Onsite";
}
// ── Date helpers ──────────────────────────────────────────────────────────────
function formatDate(iso) {
    if (!iso)
        return "—";
    // Return just the date portion (YYYY-MM-DD)
    return iso.slice(0, 10);
}
function epochToDate(ms) {
    if (!ms)
        return "—";
    return new Date(ms).toISOString().slice(0, 10);
}
// ── Unique ID ─────────────────────────────────────────────────────────────────
function makeId(company, externalId) {
    return `${company.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${externalId}`;
}
// ── 3-month date cutoff ───────────────────────────────────────────────────────
function getDateCutoff() {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}
// ── Fetch helper with timeout ─────────────────────────────────────────────────
async function fetchWithTimeout(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        // node-fetch v2 doesn't support AbortController, use the timeout option
        const resp = await node_fetch_1.default(url, {
            headers: { "User-Agent": UA },
            timeout: FETCH_TIMEOUT_MS,
        });
        return resp;
    }
    finally {
        clearTimeout(timer);
    }
}
async function scrapeGreenhouse(companyName, slug, careersUrl) {
    const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
    const resp = await fetchWithTimeout(url);
    if (!resp.ok)
        throw new Error(`GH ${slug}: HTTP ${resp.status}`);
    const data = (await resp.json());
    const jobs = [];
    const cutoff = getDateCutoff();
    for (const j of data.jobs ?? []) {
        if (!isPmRole(j.title))
            continue;
        if (!isUsLocation(j.location?.name ?? ""))
            continue;
        // Prefer first_published (exact posting date); fall back to updated_at
        const datePosted = j.first_published
            ? formatDate(j.first_published)
            : formatDate(j.updated_at);
        // Skip jobs older than 3 months
        if (datePosted !== "—" && datePosted < cutoff)
            continue;
        // Strip HTML from description for text comparison
        const descText = j.content
            ? cheerio.load(j.content).text()
            : "";
        if (!passesExperienceFilter(descText))
            continue;
        jobs.push({
            id: makeId(companyName, String(j.id)),
            company: companyName,
            title: j.title,
            location: j.location?.name ?? "",
            workType: workTypeFrom(j.location?.name ?? ""),
            datePosted,
            applyUrl: j.absolute_url,
            careersUrl,
            earlyCareer: isEarlyCareer(j.title, descText),
            description: j.content ?? descText, // keep HTML for requirement extraction
        });
    }
    return jobs;
}
async function scrapeLever(companyName, slug, careersUrl) {
    const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
    const resp = await fetchWithTimeout(url);
    if (!resp.ok)
        throw new Error(`Lever ${slug}: HTTP ${resp.status}`);
    const data = (await resp.json());
    const jobs = [];
    const cutoff = getDateCutoff();
    for (const j of Array.isArray(data) ? data : []) {
        if (!isPmRole(j.text))
            continue;
        const loc = j.categories?.location ?? "";
        if (!isUsLocation(loc))
            continue;
        const datePosted = epochToDate(j.createdAt);
        // Skip jobs older than 3 months
        if (datePosted !== "—" && datePosted < cutoff)
            continue;
        // Build plain-text description from all sections
        const descText = [
            j.descriptionPlain ?? "",
            ...(j.lists ?? []).map((l) => `${l.text}\n${cheerio.load(l.content).text()}`),
        ].join("\n\n");
        if (!passesExperienceFilter(descText))
            continue;
        jobs.push({
            id: makeId(companyName, j.id),
            company: companyName,
            title: j.text,
            location: loc,
            workType: workTypeFrom(loc),
            datePosted,
            applyUrl: j.hostedUrl,
            careersUrl,
            earlyCareer: isEarlyCareer(j.text, descText),
            description: descText,
        });
    }
    return jobs;
}
// ── Semaphore ─────────────────────────────────────────────────────────────────
class Semaphore {
    constructor(n) {
        this.queue = [];
        this.count = n;
    }
    acquire() {
        if (this.count > 0) {
            this.count--;
            return Promise.resolve();
        }
        return new Promise((resolve) => this.queue.push(resolve));
    }
    release() {
        if (this.queue.length > 0) {
            this.queue.shift()();
        }
        else {
            this.count++;
        }
    }
}
// ── Main entry ────────────────────────────────────────────────────────────────
async function scrapeAll() {
    const companies = (0, companies_1.allCompanies)();
    const total = companies.length;
    state_1.appState.status = {
        state: "scanning",
        progress: 0,
        total,
        currentCompany: "",
        completedAt: "",
        jobCount: 0,
        errors: 0,
        scoreProgress: 0,
        scoreTotal: 0,
        scoreLabel: "",
        scoreCurrent: "",
    };
    state_1.appState.jobs = [];
    const sem = new Semaphore(8); // max 8 concurrent company requests
    await Promise.all(companies.map(async (company) => {
        await sem.acquire();
        try {
            state_1.appState.status.currentCompany = company.name;
            const jobs = company.platform === "greenhouse"
                ? await scrapeGreenhouse(company.name, company.slug, company.careersUrl)
                : await scrapeLever(company.name, company.slug, company.careersUrl);
            state_1.appState.jobs.push(...jobs);
            state_1.appState.status.jobCount = state_1.appState.jobs.length;
            if (jobs.length > 0) {
                console.log(`[scraper] ${company.name}: ${jobs.length} PM role(s)`);
            }
        }
        catch (err) {
            state_1.appState.status.errors += 1;
            console.error(`[scraper] ${company.name}: ${err}`);
        }
        finally {
            state_1.appState.status.progress += 1;
            sem.release();
        }
    }));
    // Deduplicate: same company + same title = same job posted in multiple locations.
    // Keep the entry with the most specific location (longer string wins).
    const seen = new Map();
    for (const job of state_1.appState.jobs) {
        const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
        const existing = seen.get(key);
        if (!existing || job.location.length > existing.location.length) {
            seen.set(key, job);
        }
    }
    state_1.appState.jobs = [...seen.values()];
    state_1.appState.status.jobCount = state_1.appState.jobs.length;
    state_1.appState.status.state = "done";
    state_1.appState.status.completedAt = new Date().toUTCString();
    state_1.appState.status.currentCompany = "";
    console.log(`[scraper] Done. ${state_1.appState.jobs.length} unique jobs found across ` +
        `${total - state_1.appState.status.errors}/${total} companies ` +
        `(${state_1.appState.status.errors} errors).`);
}
//# sourceMappingURL=jobScraper.js.map