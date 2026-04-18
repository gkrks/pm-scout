import { Job } from "./state";
export declare const LI_UA: string;
export declare function withPlaywright<T>(fn: () => Promise<T>): Promise<T>;
export declare const CHROMIUM_ARGS: string[];
export declare function launchChromium(): Promise<import("playwright-core").Browser>;
export declare function scrapeLinkedInByKeyword(companyName: string, careersUrl: string): Promise<Job[]>;
export declare function scrapeCompany(platform: string, slug: string, name: string, careersUrl: string, linkedInId?: string, earlyCareerUrl?: string): Promise<Job[]>;
export declare function scrapeAll(): Promise<void>;
//# sourceMappingURL=jobScraper.d.ts.map