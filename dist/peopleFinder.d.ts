/**
 * peopleFinder — identifies probable hiring managers for a job posting.
 *
 * Strategy:
 *   1. Extract signals from the JD (product area, team, seniority, scope)
 *   2. Infer org structure and probable reporting chain
 *   3. Return 3–5 high-confidence hiring manager candidates with reasoning
 *   4. Generate LinkedIn search URLs (never automate LinkedIn requests)
 *   5. Provide 2-line tailored outreach angles per top candidate
 */
import { Job } from "./state";
export interface PFCandidate {
    name: string;
    title: string;
    team: string;
    reasoning: string;
    confidence: number;
    linkedInSearchUrl: string;
}
export interface PFResult {
    signals: string;
    orgHypothesis: string;
    candidates: PFCandidate[];
    eliminated: string[];
    outreach: {
        name: string;
        message: string;
    }[];
    linkedInSearches: {
        label: string;
        url: string;
    }[];
}
export declare function findHiringManager(job: Job): Promise<PFResult>;
//# sourceMappingURL=peopleFinder.d.ts.map