/**
 * Scraper registry — Phase 2
 *
 * Maps ATS platform names (from ats_routing.json) to their Scraper instances.
 * Import getScraper() in the orchestrator (Phase 5).
 */

export type { Scraper, ScrapeResult, RawJob, Company, ATSRouting, CustomSelectors } from "./types";

export { greenhouseScraper }  from "./greenhouse";
export { leverScraper }        from "./lever";
export { ashbyScraper }        from "./ashby";
export { workdayScraper }      from "./workday";
export { amazonScraper }       from "./amazon";
export { googlePlaywrightScraper } from "./googlePlaywright";
export { metaPlaywrightScraper }   from "./metaPlaywright";
export { customPlaywrightScraper } from "./customPlaywright";
export { smartRecruitersScraper }  from "./smartrecruiters";
export { workableScraper }         from "./workable";
export { bambooHRScraper }         from "./bamboohr";

import { greenhouseScraper }       from "./greenhouse";
import { leverScraper }             from "./lever";
import { ashbyScraper }             from "./ashby";
import { workdayScraper }           from "./workday";
import { amazonScraper }            from "./amazon";
import { googlePlaywrightScraper }  from "./googlePlaywright";
import { metaPlaywrightScraper }    from "./metaPlaywright";
import { customPlaywrightScraper }  from "./customPlaywright";
import { smartRecruitersScraper }   from "./smartrecruiters";
import { workableScraper }          from "./workable";
import { bambooHRScraper }          from "./bamboohr";
import type { Scraper }             from "./types";

export const SCRAPER_REGISTRY: Record<string, Scraper> = {
  greenhouse:          greenhouseScraper,
  lever:               leverScraper,
  ashby:               ashbyScraper,
  workday:             workdayScraper,
  amazon:              amazonScraper,
  "google-playwright": googlePlaywrightScraper,
  "meta-playwright":   metaPlaywrightScraper,
  "custom-playwright": customPlaywrightScraper,
  smartrecruiters:     smartRecruitersScraper,
  workable:            workableScraper,
  bamboohr:            bambooHRScraper,
};

/**
 * Look up a scraper by ATS platform name.
 * Returns null for "manual" and any unknown platform.
 */
export function getScraper(atsName: string): Scraper | null {
  return SCRAPER_REGISTRY[atsName] ?? null;
}
