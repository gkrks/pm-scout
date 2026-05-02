/**
 * Phase 3.2 — Location filter
 *
 * Accepts a job's raw location string and resolves it against the allowed-city list
 * (plus aliases) and the remote/hybrid rules from FilterConfig.
 *
 * Enrichment output:
 *   location_city  — canonical allowed city matched, or null for pure US-remote
 *   is_remote      — true when "remote" (US) is the primary work mode
 *   is_hybrid      — true when the role is explicitly hybrid
 *
 * Rejection logic (from targets.json):
 *   "Reject only if role is restricted to a city/region NOT in allowed_cities
 *    AND not US-remote."
 */

import type { FilterConfig, FilterResult, JobEnrichment } from "./types";

// ── Pre-compiled patterns ─────────────────────────────────────────────────────

/** Matches common US-remote phrasings. */
const REMOTE_US_RE =
  /remote.*(?:us|united states)|(?:us|united states).*remote|remote[\s,–—-]+us\b/i;

/** "Remote" alone (without a city qualifier) — for accept_remote_us */
const REMOTE_ONLY_RE = /^remote$/i;

/** Starts with "Hybrid" */
const HYBRID_PREFIX_RE = /^hybrid/i;

// ── City lookup builder ───────────────────────────────────────────────────────

/**
 * Build a Map from every lowercase location term to its canonical city name.
 * Entries: canonical city name + all declared aliases.
 * Built fresh per call — the dataset is tiny (~30 cities × ~5 aliases each).
 */
function buildCityLookup(
  allowed_cities: string[],
  city_aliases: Record<string, string[]>,
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const city of allowed_cities) {
    lookup.set(city.toLowerCase(), city);
    for (const alias of city_aliases[city] ?? []) {
      lookup.set(alias.toLowerCase(), city);
    }
  }
  return lookup;
}

/**
 * Scan the raw location string for any allowed city term (exact substring match).
 * Returns the canonical city name, or null if none found.
 */
function matchCity(
  locationRaw: string,
  lookup: Map<string, string>,
): string | null {
  const lower = locationRaw.toLowerCase();
  // Longest-match wins: sort descending so "San Francisco, CA" beats "San Francisco"
  const candidates = [...lookup.keys()].sort((a, b) => b.length - a.length);
  for (const term of candidates) {
    if (lower.includes(term)) return lookup.get(term)!;
  }
  return null;
}

// ── Filter ────────────────────────────────────────────────────────────────────

/**
 * 3.2 Location filter
 *
 * Pure function — no side effects.
 */
export function filterLocation(
  locationRaw: string,
  config: Pick<FilterConfig, "location">,
): FilterResult {
  const { location: loc } = config;
  const lookup = buildCityLookup(loc.allowed_cities, loc.city_aliases);
  const city = matchCity(locationRaw, lookup);

  let kept = false;
  const enrichment: Partial<JobEnrichment> = {
    location_city: null,
    is_remote: false,
    is_hybrid: false,
  };

  // ── 1. Pure remote US ─────────────────────────────────────────────────────
  // "Remote (US)", "US Remote", "Remote – United States", "Remote" (bare)
  if (
    loc.accept_remote_us &&
    (REMOTE_US_RE.test(locationRaw) || REMOTE_ONLY_RE.test(locationRaw.trim()))
  ) {
    kept = true;
    enrichment.is_remote = true;
    enrichment.location_city = null; // pure remote — no physical city
  }

  // ── 2. Remote anchored to an allowed city ─────────────────────────────────
  // "Remote — San Francisco", "Remote (Austin)", "Remote in NYC"
  if (
    !kept &&
    loc.accept_remote_in_allowed_cities &&
    /remote/i.test(locationRaw) &&
    city
  ) {
    kept = true;
    enrichment.is_remote = true;
    enrichment.location_city = city;
  }

  // ── 3. Hybrid in an allowed city ──────────────────────────────────────────
  // "Hybrid - Austin", "Hybrid (San Francisco)"
  if (!kept && loc.accept_hybrid && HYBRID_PREFIX_RE.test(locationRaw) && city) {
    kept = true;
    enrichment.is_hybrid = true;
    enrichment.location_city = city;
  }

  // ── 4. Onsite in an allowed city ──────────────────────────────────────────
  if (!kept && loc.accept_onsite && city) {
    kept = true;
    enrichment.location_city = city;
  }

  if (!kept) {
    return {
      kept: false,
      reason: `Location "${locationRaw}" is not in an allowed city and is not US-remote`,
      enrichment: {},
    };
  }

  return { kept: true, enrichment };
}
