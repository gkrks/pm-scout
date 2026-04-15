/**
 * companyDetector.ts
 *
 * Given a company name (and optional careers URL hint), detects the correct
 * ATS platform and slug so we can scrape jobs immediately.
 *
 * Detection order:
 *   1. Greenhouse boards-api
 *   2. Lever postings API
 *   3. Ashby posting-api
 *   4. LinkedIn guest search (company name as keyword — no company ID needed)
 */
import { Company } from "./companies";
export declare function generateSlugs(name: string): string[];
export interface DetectionResult {
    platform: Company["platform"];
    slug: string;
    careersUrl: string;
    linkedInId?: string;
    jobCount: number;
    source: string;
}
export declare function detectCompany(name: string, careersUrlHint?: string): Promise<DetectionResult>;
//# sourceMappingURL=companyDetector.d.ts.map