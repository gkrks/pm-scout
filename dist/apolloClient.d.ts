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
 * Search Apollo for people at a company matching given titles.
 * titleKeywords: array of title strings, e.g. ["Senior PM", "Group PM", "Director of Product"]
 */
export declare function searchApollo(company: string, titleKeywords: string[]): Promise<ApolloPerson[]>;
//# sourceMappingURL=apolloClient.d.ts.map