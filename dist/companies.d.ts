export interface Company {
    name: string;
    slug: string;
    platform: "greenhouse" | "lever" | "ashby" | "amazon" | "google" | "meta" | "linkedin";
    careersUrl: string;
    linkedInId?: string;
    earlyCareerUrl?: string;
}
/**
 * ~150 top US tech companies.
 * GH/LV slugs are verified against the public API before inclusion.
 * Companies on Workday or custom ATS fall back to LinkedIn guest scraping.
 */
export declare function allCompanies(): Company[];
//# sourceMappingURL=companies.d.ts.map