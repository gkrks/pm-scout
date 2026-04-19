/**
 * peopleFinder — structured 3-persona hiring intelligence pipeline.
 *
 * Pass 1 (Groq): Extract JD signals → team, seniority, product area,
 *                generate persona-specific Apollo search strategies.
 * Pass 2 (Apollo): Run 3 parallel searches — hiring managers, recruiters, peers.
 * Pass 3 (Groq): Categorize + score every returned profile.
 *                Assigns: category, relevance_score (1-5), confidence (0-100),
 *                reasoning, outreach for top HM candidates.
 */
import { Job } from "./state";
export type CandidateCategory = "hiring_manager" | "recruiter" | "peer";
export interface PFCandidate {
    name: string;
    title: string;
    url: string;
    team: string;
    category: CandidateCategory;
    relevanceScore: number;
    confidence: number;
    reasoning: string;
    outreach?: string;
}
export interface JDSignals {
    team: string;
    productArea: string;
    seniorityLevel: string;
    keyKeywords: string[];
    coreProblemSpace: string;
    orgHypothesis: string;
}
export interface SearchStrategy {
    hiringManager: {
        titles: string[];
        seniorities: string[];
    };
    recruiter: {
        titles: string[];
    };
    peers: {
        titles: string[];
        seniorities: string[];
    };
    booleanStrings: {
        hiringManager: string;
        recruiter: string;
        peers: string;
    };
}
export interface PFResult {
    jdSignals: JDSignals;
    searchStrategy: SearchStrategy;
    candidates: PFCandidate[];
    eliminated: string[];
    scrapedCount: number;
    linkedInSearches: {
        label: string;
        url: string;
    }[];
}
export declare function findHiringManager(job: Job): Promise<PFResult>;
//# sourceMappingURL=peopleFinder.d.ts.map