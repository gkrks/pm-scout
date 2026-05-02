/**
 * Phase 5 — Notification label helpers.
 *
 * - Category → short label mapping (for email + Telegram)
 * - CompanyMeta type
 * - loadCompanyMetaMap() reads raw targets.json to pick up the fields that the
 *   CompanyConfig adapter strips out (category, domain_tags, apm info).
 */

import * as fs from "fs";
import * as path from "path";

// ── Short category labels ─────────────────────────────────────────────────────

export const SHORT_CATEGORY: Record<string, string> = {
  "AI Labs & Foundation Model Companies":                    "AI Labs",
  "AI Infrastructure & Developer Tools":                     "AI Infra",
  "AI-Native Applications & Vertical AI":                    "AI Apps",
  "AI Consulting & Services with Product Arms":              "AI Services",
  "Big Tech & Mega-Cap Public Tech":                         "Big Tech",
  "Fintech & Payments":                                      "Fintech",
  "Healthtech & Bio AI":                                     "Healthtech",
  "Cybersecurity":                                           "Security",
  "Edtech & Learning":                                       "Edtech",
  "Climate Tech & Energy":                                   "Climate",
  "Consumer Tech & Social":                                  "Consumer",
  "Enterprise SaaS & B2B Software (AI-Forward)":            "Enterprise SaaS",
  "Productivity & Collaboration":                            "Productivity",
  "Data & Analytics":                                        "Data",
  "Marketplaces & Gig Economy":                              "Marketplace",
  "Logistics, Mobility & Autonomous":                        "Mobility",
  "Early-Stage AI/Tech Startups (Seed-Series A)":            "Startup (Seed–A)",
  "Mid-Stage Growth Startups (Series B-D)":                  "Startup (B–D)",
  "Featured: Companies with Dedicated APM / Rotational Programs": "APM Program",
};

// ── Company metadata ──────────────────────────────────────────────────────────

export interface CompanyMeta {
  category?:          string;
  domain_tags?:       string[];
  has_apm_program?:   boolean;
  apm_program_name?:  string | null;
  apm_program_status?: string | null;
}

/** name → CompanyMeta */
export type CompanyMetaMap = Map<string, CompanyMeta>;

/**
 * Load company metadata from the raw targets.json.
 * Reads only the fields that the CompanyConfig adapter discards.
 * Returns an empty map on any read/parse error — graceful degradation.
 */
export function loadCompanyMetaMap(): CompanyMetaMap {
  const configPath =
    process.env.TARGETS_CONFIG_PATH ??
    path.join(process.cwd(), "config", "targets.json");

  const map: CompanyMetaMap = new Map();

  if (!fs.existsSync(configPath)) return map;

  try {
    const raw  = fs.readFileSync(configPath, "utf-8");
    const json = JSON.parse(raw) as unknown;

    if (typeof json !== "object" || json === null) return map;
    const obj = json as Record<string, unknown>;

    const companies = Array.isArray(obj["companies"]) ? obj["companies"] : [];
    for (const c of companies) {
      if (typeof c !== "object" || c === null) continue;
      const comp = c as Record<string, unknown>;
      const name = typeof comp["name"] === "string" ? comp["name"] : null;
      if (!name) continue;

      map.set(name, {
        category:           typeof comp["category"]           === "string"  ? comp["category"]  : undefined,
        domain_tags:        Array.isArray(comp["domain_tags"])               ? comp["domain_tags"] as string[] : undefined,
        has_apm_program:    typeof comp["has_apm_program"]    === "boolean" ? comp["has_apm_program"] : undefined,
        apm_program_name:   typeof comp["apm_program_name"]   === "string"  ? comp["apm_program_name"] : null,
        apm_program_status: typeof comp["apm_program_status"] === "string"  ? comp["apm_program_status"] : null,
      });
    }
  } catch {
    // Best-effort — metadata is display-only, not critical.
  }

  return map;
}

// ── Display helpers ───────────────────────────────────────────────────────────

/** "AI Labs · AI/ML, Platform"  |  ""  */
export function formatCompanyType(meta: CompanyMeta | undefined): string {
  if (!meta) return "";
  const short = SHORT_CATEGORY[meta.category ?? ""] ?? meta.category ?? "";
  const tags  = (meta.domain_tags ?? []).slice(0, 2).join(", ");
  if (!short && !tags) return "";
  if (!short) return tags;
  if (!tags)  return short;
  return `${short} · ${tags}`;
}

/** Returns APM program name if active, null otherwise. */
export function activeApmProgram(meta: CompanyMeta | undefined): string | null {
  if (!meta) return null;
  if (!meta.has_apm_program) return null;
  if (meta.apm_program_status !== "active") return null;
  return meta.apm_program_name ?? "APM Program";
}

/** "Posted 2d ago (Apr 29)" | "Posted date unknown" */
export function formatPostedAgo(datePosted: string, now: Date): string {
  if (!datePosted || datePosted === "—") return "Date unknown";
  const d = new Date(datePosted);
  if (isNaN(d.getTime())) return "Date unknown";
  const diffDays = Math.round((now.getTime() - d.getTime()) / 86_400_000);
  const label =
    diffDays === 0 ? "Today" :
    diffDays === 1 ? "Yesterday" :
    diffDays <   7 ? `${diffDays}d ago` :
    diffDays <  30 ? `${Math.round(diffDays / 7)}w ago` :
                     `${Math.round(diffDays / 30)}mo ago`;
  const shortDate = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return diffDays === 0 ? "Today" : `${label} (${shortDate})`;
}

/** "SF (Hybrid)" | "Remote US" | "NYC" */
export function formatLocation(location: string | undefined, workType: string | undefined): string {
  const loc = (location ?? "").trim();
  switch (workType) {
    case "Remote":  return "Remote US";
    case "Hybrid":  return loc ? `${loc} (Hybrid)` : "Hybrid";
    case "Onsite":  return loc || "Onsite";
    default:        return loc || "Location unknown";
  }
}

/** "Entry-level" if earlyCareer, else "≤3 yrs" (all passing jobs meet this). */
export function formatExperience(earlyCareer: boolean): string {
  return earlyCareer ? "Entry-level" : "≤3 yrs";
}
