import { ResumeData } from "./parser";
export interface MatchResult {
    requirement: string;
    status: "met" | "partial" | "missing";
    proof: string;
    location: string;
    confidence: number;
}
/**
 * Match each requirement against the resume with up to CONCURRENCY requests in
 * flight at once. Results are returned in the original requirement order.
 * Retries once on failure; falls back to { status: "missing" } on second failure.
 */
export declare function matchRequirements(requirements: string[], resume: ResumeData, onProgress?: (current: number, total: number) => void): Promise<MatchResult[]>;
//# sourceMappingURL=matcher.d.ts.map