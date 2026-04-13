export interface Company {
    name: string;
    slug: string;
    platform: "greenhouse" | "lever";
    careersUrl: string;
}
/**
 * 100 top US tech companies — every slug verified live (HTTP 200) against the
 * Greenhouse boards-api or Lever postings API before inclusion.
 * Companies that use Workday, Ashby, or custom ATS are excluded (not scrapeable via API).
 */
export declare function allCompanies(): Company[];
//# sourceMappingURL=companies.d.ts.map