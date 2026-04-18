/**
 * apolloClient — people search via Apollo.io API.
 * Searches are free (0 credits). No email/phone reveals.
 * Results cached in memory to avoid repeat API calls for the same query.
 */
export interface ApolloPerson {
    name: string;
    title: string;
    organization: string;
    linkedInUrl: string;
}
/**
 * Search Apollo for people at a company.
 * - Always searches broad PM/leadership base titles
 * - Merges JD-inferred title keywords (hiring manager level titles)
 * - If teamArea provided, also searches for that team name in titles
 *   (catches "Product Manager, Shopping Graph" style titles)
 * - Deduplicates results by LinkedIn URL or name
 */
export declare function searchApollo(company: string, titleKeywords: string[], teamArea?: string): Promise<ApolloPerson[]>;
//# sourceMappingURL=apolloClient.d.ts.map