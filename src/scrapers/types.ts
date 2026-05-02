/**
 * Phase 2 — Scraper interface types
 *
 * All scrapers implement the Scraper interface and return RawJob[] with no
 * filtering applied. Filtering is Phase 3; persistence is Phase 4.
 */

export type ScrapeResult = {
  jobs: RawJob[];
  /** true when description HTML/text is already populated in every job */
  fetchedDescriptions: boolean;
};

export type RawJob = {
  /** Job title as returned by the ATS — no normalisation */
  title: string;
  /** Canonical deeplink URL — unique per (company_id, role_url) in Supabase */
  role_url: string;
  /** Unprocessed location string from ATS source */
  location_raw: string;
  /** ISO-8601 date (YYYY-MM-DD), or null when the ATS doesn't expose it */
  posted_date: string | null;
  /** Full description text or HTML — may be absent; fetched lazily by orchestrator */
  description?: string;
  /** Extra fields preserved for debugging — never used in filter logic */
  source_meta: Record<string, unknown>;
};

// ── ATS routing config (loaded from config/ats_routing.json) ──────────────────

export interface CustomSelectors {
  jobCard: string;
  title: string;
  location?: string;
  applyUrl: string;
  postedDate?: string;
  /** HTML attribute to read the date from (e.g. "datetime") */
  postedDateAttr?: string;
  scrollToLoad?: boolean;
  waitForSelector?: string;
  timeoutMs?: number;
}

export interface ATSRouting {
  /** ATS platform identifier */
  ats: string;
  /** ATS-specific board/tenant slug — may differ from company slug */
  slug?: string;
  /** Workday tenant identifier */
  tenant?: string;
  /** Workday host (e.g. salesforce.wd12.myworkdayjobs.com) */
  host?: string;
  /** Workday site name (e.g. External_Career_Site) */
  site?: string;
  /** Workday max page size (some instances cap below 50, e.g. Snap caps at 20) */
  pageSize?: number;
  /** Override the URL used for custom-playwright scrapes */
  url_override?: string;
  /** CSS selector config for custom-playwright scrapes */
  selectors?: CustomSelectors;
}

// ── Company record (subset of Supabase companies table / targets.json) ────────

export interface Company {
  id?: string;
  slug: string;
  name: string;
  careers_url: string;
  program_url?: string | null;
  has_apm_program?: boolean;
  apm_program_name?: string | null;
  apm_program_status?: string | null;
  domain_tags?: string[];
  target_roles?: string[];
  notes?: string | null;
}

// ── Scraper interface ─────────────────────────────────────────────────────────

export interface Scraper {
  /** Platform name — matches ats field in ats_routing.json */
  name: string;
  scrape(
    company: Company,
    routing: ATSRouting,
    opts: { timeoutMs: number },
  ): Promise<ScrapeResult>;
}
