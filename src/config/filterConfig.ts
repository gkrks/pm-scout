/**
 * Phase 3 — Filter config loader
 *
 * Reads and validates the `filters` section from config/targets.json,
 * returning a typed FilterConfig. Result is module-level cached.
 *
 * Does NOT touch the companies array or ATS routing — those are
 * handled by targets.ts and loadRouting.ts respectively.
 */

import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import type { FilterConfig } from "../filters/types";

// ── Raw Zod schemas (permissive — we normalise below) ────────────────────────

const RawLocationSchema = z.object({
  allowed_cities: z.array(z.string()),
  city_aliases: z.record(z.array(z.string())).default({}),
  accept_onsite: z.boolean().default(true),
  accept_hybrid: z.boolean().default(true),
  accept_remote_us: z.boolean().default(true),
  accept_remote_in_allowed_cities: z.boolean().default(true),
});

const RawExperienceSchema = z
  .object({
    reject_above_years: z.number().optional(),
    max_years: z.number().optional(),
  })
  .passthrough();

const RawFreshnessSchema = z
  .object({
    max_posting_age_days: z.number().optional(),
    tier_1_max_age_days: z.number().optional(),
  })
  .passthrough();

const RawSponsorshipSchema = z
  .object({
    requires_sponsorship: z.boolean().optional(),
    reject_if_no_sponsorship_offered: z.boolean().optional(),
  })
  .passthrough();

const RawCompensationSchema = z
  .object({
    min_base_salary_usd: z.number().nullable().optional(),
  })
  .passthrough();

const RawFiltersSchema = z
  .object({
    title_include_keywords: z.array(z.string()).default([]),
    title_exclude_keywords: z.array(z.string()).default([]),
    location: RawLocationSchema,
    experience: RawExperienceSchema.default({}),
    freshness: RawFreshnessSchema.default({}),
    sponsorship: RawSponsorshipSchema.default({}),
    compensation: RawCompensationSchema.default({}),
    preferred_domains: z.array(z.string()).default([]),
  })
  .passthrough();

// ── Normaliser: raw validated JSON → FilterConfig ─────────────────────────────

function normalise(raw: z.infer<typeof RawFiltersSchema>): FilterConfig {
  return {
    title_include_keywords: raw.title_include_keywords,
    title_exclude_keywords: raw.title_exclude_keywords,
    location: {
      allowed_cities: raw.location.allowed_cities,
      city_aliases: raw.location.city_aliases,
      accept_onsite: raw.location.accept_onsite,
      accept_hybrid: raw.location.accept_hybrid,
      accept_remote_us: raw.location.accept_remote_us,
      accept_remote_in_allowed_cities: raw.location.accept_remote_in_allowed_cities,
    },
    experience: {
      reject_above_years:
        raw.experience.reject_above_years ?? raw.experience.max_years ?? 3,
    },
    freshness: {
      max_posting_age_days: raw.freshness.max_posting_age_days ?? 30,
      tier_1_max_age_days: raw.freshness.tier_1_max_age_days ?? 7,
    },
    sponsorship: {
      requires_sponsorship: raw.sponsorship.requires_sponsorship ?? false,
      reject_if_no_sponsorship_offered:
        raw.sponsorship.reject_if_no_sponsorship_offered ?? false,
    },
    compensation: {
      min_base_salary_usd: raw.compensation.min_base_salary_usd ?? null,
    },
    preferred_domains: raw.preferred_domains,
  };
}

// ── Loader ────────────────────────────────────────────────────────────────────

let _cache: FilterConfig | null = null;

/**
 * Load and validate the `filters` section from config/targets.json.
 *
 * Throws with a descriptive error on missing file, invalid JSON, or
 * schema validation failure. Result is module-cached after first call.
 *
 * @param configPath  Override the path to targets.json (for tests).
 */
export function loadFilterConfig(configPath?: string): FilterConfig {
  if (_cache) return _cache;

  const filePath =
    configPath ??
    process.env.TARGETS_CONFIG_PATH ??
    path.join(process.cwd(), "config", "targets.json");

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[filterConfig] targets.json not found at ${filePath}. ` +
        `Set TARGETS_CONFIG_PATH to override.`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    throw new Error(
      `[filterConfig] Failed to parse ${filePath}: ${err instanceof Error ? err.message : err}`,
    );
  }

  const root = z
    .object({ filters: RawFiltersSchema })
    .passthrough()
    .safeParse(json);

  if (!root.success) {
    const issues = root.error.issues
      .slice(0, 8)
      .map((i) => `  • filters.${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `[filterConfig] Invalid filters section in ${filePath}:\n${issues}`,
    );
  }

  _cache = normalise(root.data.filters);
  return _cache;
}

/** Reset the module cache — useful in tests or after the config file changes. */
export function clearFilterConfigCache(): void {
  _cache = null;
}
