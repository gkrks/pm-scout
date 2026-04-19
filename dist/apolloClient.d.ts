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
export interface ApolloSearchOptions {
    titles: string[];
    seniorities?: string[];
    departments?: string[];
    teamArea?: string;
    perPage?: number;
}
/**
 * Search Apollo for people at a company.
 * Deduplicates results by LinkedIn URL or name.
 */
export declare function searchApollo(company: string, opts: ApolloSearchOptions): Promise<ApolloPerson[]>;
//# sourceMappingURL=apolloClient.d.ts.map