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
export interface LIPerson {
    name: string;
    title: string;
    url: string;
    snippet: string;
}
/**
 * Find LinkedIn profiles for people who likely manage or are adjacent to
 * the given job. Runs DDG search first (most reliable), then LinkedIn
 * guest search (may return 0 if auth wall blocks everything).
 *
 * Results are deduplicated by LinkedIn slug.
 */
export declare function findLinkedInProfiles(company: string, titleKeywords: string): Promise<LIPerson[]>;
//# sourceMappingURL=linkedInScraper.d.ts.map