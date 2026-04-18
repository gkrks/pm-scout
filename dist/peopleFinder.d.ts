/**
 * peopleFinder — identifies real hiring managers using LinkedIn scraping + Claude.
 *
 * Two-pass approach:
 *   Pass 1 (Claude): extract JD signals, infer org structure, produce title keywords
 *                    to search for on LinkedIn.
 *   Pass 2 (Playwright): scrape DuckDuckGo + LinkedIn guest search for real profiles
 *                        matching those keywords at the company.
 *   Pass 3 (Claude): rank the real scraped profiles by hiring manager probability,
 *                    add reasoning and outreach angles.
 */
import { Job } from "./state";
export interface PFCandidate {
    name: string;
    title: string;
    url: string;
    team: string;
    reasoning: string;
    confidence: number;
    outreach?: string;
}
export interface PFResult {
    signals: string;
    orgHypothesis: string;
    candidates: PFCandidate[];
    eliminated: string[];
    linkedInSearches: {
        label: string;
        url: string;
    }[];
    scrapedCount: number;
}
export declare function findHiringManager(job: Job): Promise<PFResult>;
//# sourceMappingURL=peopleFinder.d.ts.map