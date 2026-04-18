"use strict";
/**
 * linkedInScraper — finds real LinkedIn profiles for hiring manager discovery.
 *
 * Strategy:
 *   1. DuckDuckGo HTML search: site:linkedin.com/in "Company" titles
 *      → no auth, no CAPTCHA on the html endpoint, returns real LI profile URLs
 *   2. LinkedIn people search (limited guest view) — extra profiles if visible
 *
 * Playwright is used to render both pages (avoids JS-based bot detection).
 * Uses the shared withPlaywright() serializer — only 1 browser at a time.
 */
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.findLinkedInProfiles = findLinkedInProfiles;
const cheerio = __importStar(require("cheerio"));
const jobScraper_1 = require("./jobScraper");
// ── DuckDuckGo HTML search ────────────────────────────────────────────────────
/**
 * Search DuckDuckGo's non-JS HTML endpoint for LinkedIn profiles matching
 * a company + title query. Returns up to 10 real LinkedIn profile links.
 */
async function searchDDG(company, titleQuery) {
    return (0, jobScraper_1.withPlaywright)(async () => {
        const browser = await (0, jobScraper_1.launchChromium)();
        try {
            const page = await browser.newPage();
            await page.setExtraHTTPHeaders({ "User-Agent": jobScraper_1.LI_UA });
            // DuckDuckGo's static HTML endpoint — no JS required, minimal bot detection
            const q = encodeURIComponent(`site:linkedin.com/in "${company}" (${titleQuery})`);
            await page.goto(`https://html.duckduckgo.com/html/?q=${q}`, {
                waitUntil: "domcontentloaded",
                timeout: 30000,
            });
            const html = await page.content();
            const $ = cheerio.load(html);
            const people = [];
            $(".result__body, .links_main").each((_i, el) => {
                const anchor = $(el).find("a.result__a, .result__title a").first();
                const snippet = $(el).find(".result__snippet").text().trim();
                const rawHref = anchor.attr("href") ?? "";
                // DDG wraps URLs: //duckduckgo.com/l/?uddg=https%3A%2F%2F...
                const uddg = new URLSearchParams(rawHref.split("?")[1] ?? "").get("uddg") ?? rawHref;
                const url = decodeURIComponent(uddg).split("?")[0];
                if (!url.includes("linkedin.com/in/"))
                    return;
                // Page title format: "First Last - Title at Company | LinkedIn"
                //                 or "First Last - Title - Company | LinkedIn"
                const fullTitle = anchor.text().trim().replace(/\s+/g, " ");
                const withoutSuffix = fullTitle.replace(/\s*[|–—]\s*LinkedIn\s*$/i, "").trim();
                const parts = withoutSuffix.split(/\s*[-–—]\s/);
                const name = parts[0]?.trim() ?? "";
                const title = parts.slice(1).join(" – ").replace(/\s+at\s+.+$/, "").trim();
                if (!name || !url)
                    return;
                people.push({ name, title, url, snippet });
            });
            return people.slice(0, 10);
        }
        finally {
            await browser.close();
        }
    });
}
// ── LinkedIn people search (limited guest view) ───────────────────────────────
/**
 * LinkedIn's own people search — shows a few cards before the auth wall.
 * Augments DDG results with extra profiles that may not be indexed.
 */
async function searchLinkedInPeople(company, titleQuery) {
    return (0, jobScraper_1.withPlaywright)(async () => {
        const browser = await (0, jobScraper_1.launchChromium)();
        try {
            const context = await browser.newContext({
                userAgent: jobScraper_1.LI_UA,
                viewport: { width: 1280, height: 900 },
            });
            const page = await context.newPage();
            const q = encodeURIComponent(`${company} ${titleQuery}`);
            await page.goto(`https://www.linkedin.com/search/results/people/?keywords=${q}&origin=GLOBAL_SEARCH_HEADER`, { waitUntil: "domcontentloaded", timeout: 30000 });
            await page.waitForTimeout(3000);
            const people = await page.evaluate(() => {
                const results = [];
                // LinkedIn renders cards in .entity-result__item or similar
                const cards = document.querySelectorAll(".entity-result__item, .search-result, [data-chameleon-result-urn]");
                cards.forEach((card) => {
                    const nameEl = card.querySelector(".entity-result__title-text span[aria-hidden='true'], .actor-name, .name");
                    const titleEl = card.querySelector(".entity-result__primary-subtitle, .subline-level-1, .search-result__info .subline-level-1");
                    const linkEl = card.querySelector("a[href*='linkedin.com/in/']");
                    if (!nameEl || !linkEl)
                        return;
                    const url = linkEl.href.split("?")[0];
                    if (!url.includes("linkedin.com/in/"))
                        return;
                    results.push({
                        name: nameEl.textContent?.trim() ?? "",
                        title: titleEl?.textContent?.trim() ?? "",
                        url,
                        snippet: "",
                    });
                });
                return results;
            });
            return people.filter((p) => p.name).slice(0, 8);
        }
        finally {
            await browser.close();
        }
    });
}
// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Find LinkedIn profiles for people who likely manage or are adjacent to
 * the given job. Runs DDG search first (most reliable), then LinkedIn
 * guest search (may return 0 if auth wall blocks everything).
 *
 * Results are deduplicated by LinkedIn slug.
 */
async function findLinkedInProfiles(company, titleKeywords) {
    console.log(`[people-finder] searching LinkedIn profiles: "${company}" – ${titleKeywords}`);
    // Run both searches — they go through the shared Playwright serializer
    // so they execute sequentially, not in parallel.
    const [ddg, li] = await Promise.allSettled([
        searchDDG(company, titleKeywords),
        searchLinkedInPeople(company, titleKeywords),
    ]);
    const ddgPeople = ddg.status === "fulfilled" ? ddg.value : [];
    const liPeople = li.status === "fulfilled" ? li.value : [];
    if (ddg.status === "rejected")
        console.warn("[people-finder] DDG search failed:", ddg.reason);
    if (li.status === "rejected")
        console.warn("[people-finder] LinkedIn search failed:", li.reason);
    // Merge — deduplicate by LinkedIn slug
    const seen = new Set();
    const merged = [];
    for (const p of [...ddgPeople, ...liPeople]) {
        const slug = p.url.replace(/^.*linkedin\.com\/in\//, "").replace(/\/$/, "");
        if (!slug || seen.has(slug))
            continue;
        seen.add(slug);
        merged.push(p);
    }
    console.log(`[people-finder] found ${merged.length} LinkedIn profiles`);
    return merged.slice(0, 12);
}
//# sourceMappingURL=linkedInScraper.js.map