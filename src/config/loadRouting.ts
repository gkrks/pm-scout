/**
 * ATS routing config loader — Phase 2
 *
 * Loads config/ats_routing.json and returns a lookup function for the orchestrator.
 * Falls back to the legacy SLUG_TO_ATS map for companies not listed in ats_routing.json.
 */

import * as fs   from "fs";
import * as path from "path";
import type { ATSRouting } from "../scrapers/types";

// ── Schema ────────────────────────────────────────────────────────────────────

export interface RoutingFile {
  version: number;
  routing: Record<string, ATSRouting>;
  unmapped_default: string;
}

// ── Loader ────────────────────────────────────────────────────────────────────

let _cached: RoutingFile | null = null;

/**
 * Load (and cache) the ATS routing config from config/ats_routing.json.
 * Throws on missing or malformed file.
 */
export function loadRoutingConfig(configPath?: string): RoutingFile {
  if (_cached) return _cached;

  const filePath =
    configPath ??
    process.env.ATS_ROUTING_CONFIG_PATH ??
    path.join(process.cwd(), "config", "ats_routing.json");

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[routing] ats_routing.json not found at ${filePath}. ` +
      `Run npm run sync:companies to generate it, or create it manually.`,
    );
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new Error(
      `[routing] Cannot read ${filePath}: ${err instanceof Error ? err.message : err}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`[routing] ats_routing.json is not valid JSON at ${filePath}`);
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.version !== "number" || typeof obj.routing !== "object") {
    throw new Error(
      `[routing] ats_routing.json must have numeric "version" and object "routing" fields`,
    );
  }

  _cached = obj as unknown as RoutingFile;
  const count = Object.keys(_cached.routing).length;
  console.log(`[routing] Loaded ${count} ATS routes (unmapped_default: ${_cached.unmapped_default})`);
  return _cached;
}

/**
 * Get the ATSRouting for a company slug.
 * Resolution order:
 *   1. Exact slug match in ats_routing.json
 *   2. Normalised slug match (lowercase, alphanumeric only)
 *   3. Falls back to unmapped_default from the config
 *
 * Returns null only for ats: "manual" entries (caller should skip these).
 */
export function resolveRouting(
  slug: string,
  config: RoutingFile,
): ATSRouting | null {
  const routing = config.routing;

  // 1. Exact match
  if (routing[slug]) {
    const r = routing[slug];
    if (r.ats === "manual") return null;
    return r;
  }

  // 2. Normalised match
  const norm = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [key, r] of Object.entries(routing)) {
    if (key.toLowerCase().replace(/[^a-z0-9]/g, "") === norm) {
      if (r.ats === "manual") return null;
      return r;
    }
  }

  // 3. Unmapped fallback
  const fallback = config.unmapped_default;
  if (fallback === "manual") return null;
  return { ats: fallback };
}

/** Reset the cache — used in tests */
export function _resetRoutingCache(): void {
  _cached = null;
}
