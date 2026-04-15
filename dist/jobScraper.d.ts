import { Job } from "./state";
export declare function scrapeLinkedInByKeyword(companyName: string, careersUrl: string): Promise<Job[]>;
export declare function scrapeCompany(platform: string, slug: string, name: string, careersUrl: string, linkedInId?: string): Promise<Job[]>;
export declare function scrapeAll(): Promise<void>;
//# sourceMappingURL=jobScraper.d.ts.map