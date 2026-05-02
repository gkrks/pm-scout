/**
 * Phase 3 — Filter pipeline shared types
 *
 * Every filter is a pure function:
 *   (job fields, config) → FilterResult
 *
 * The pipeline (pipeline.ts) runs them in order and accumulates JobEnrichment.
 */

// ── Config shapes (loaded from config/targets.json filters section) ───────────

export interface LocationConfig {
  allowed_cities: string[];
  /** canonical city → list of accepted aliases */
  city_aliases: Record<string, string[]>;
  accept_onsite: boolean;
  accept_hybrid: boolean;
  accept_remote_us: boolean;
  accept_remote_in_allowed_cities: boolean;
}

export interface ExperienceConfig {
  /** Jobs with yoe_min > this are rejected. Default 3. */
  reject_above_years: number;
}

export interface FreshnessConfig {
  /** Postings older than this are rejected. Default 30. */
  max_posting_age_days: number;
  /** Postings within this threshold get the tier-1 freshness signal. Default 7. */
  tier_1_max_age_days: number;
}

export interface SponsorshipConfig {
  /** Set true when the user requires visa sponsorship. */
  requires_sponsorship: boolean;
  /** Set true to reject any role that explicitly says no sponsorship. */
  reject_if_no_sponsorship_offered: boolean;
}

export interface CompensationConfig {
  /** USD floor for the salary filter. null = filter disabled. */
  min_base_salary_usd: number | null;
}

export interface FilterConfig {
  title_include_keywords: string[];
  title_exclude_keywords: string[];
  location: LocationConfig;
  experience: ExperienceConfig;
  freshness: FreshnessConfig;
  sponsorship: SponsorshipConfig;
  compensation: CompensationConfig;
  preferred_domains: string[];
}

// ── Per-filter result ─────────────────────────────────────────────────────────

export interface FilterResult {
  kept: boolean;
  /** Human-readable explanation (set on rejection, useful on keep too) */
  reason?: string;
  /** Fields contributed to the accumulated JobEnrichment */
  enrichment: Partial<JobEnrichment>;
}

// ── Accumulated enrichment produced by running all filters ───────────────────

export interface JobEnrichment {
  // ── Location (set by locationFilter) ────────────────────────────────────
  /** Canonical allowed city matched, or null for pure US-remote */
  location_city: string | null;
  is_remote: boolean;
  is_hybrid: boolean;

  // ── Experience (set by experienceFilter) ─────────────────────────────────
  yoe_min: number | null;
  yoe_max: number | null;
  /** Verbatim snippet from description that matched, for debugging */
  yoe_raw: string | null;
  /** 'extracted' = YOE numbers found; 'inferred-junior' = kept on language/title signal */
  experience_confidence: "extracted" | "inferred-junior";
  is_new_grad_language: boolean;

  // ── Freshness (set by freshnessFilter) ───────────────────────────────────
  freshness_confidence: "known" | "unknown";
  posted_within_7_days: boolean;
  posted_within_30_days: boolean;

  // ── Sponsorship (set by sponsorshipFilter) ───────────────────────────────
  /** true = confirmed offered, false = confirmed not offered, null = not mentioned */
  sponsorship_offered: boolean | null;
  requires_sponsorship_unclear: boolean;

  // ── Salary (set by salaryFilter) ─────────────────────────────────────────
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
}

// ── Full pipeline result ──────────────────────────────────────────────────────

export interface PipelineResult {
  kept: boolean;
  /**
   * 1, 2, or 3 when kept === true (label only, never causes rejection).
   * null when kept === false (rejected by a filter before tier was computed).
   */
  tier: 1 | 2 | 3 | null;
  enrichment: JobEnrichment;
  /** Which filter rejected this job, if kept === false */
  rejectedBy?: string;
  rejectionReason?: string;
  /** true when company.domain_tags overlaps preferred_domains */
  domainBoosted: boolean;
}
