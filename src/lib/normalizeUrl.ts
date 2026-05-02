/**
 * URL normalization for job role_url deduplication.
 *
 * Strips tracking params, normalizes host/protocol/path so that the same
 * job listing's URL is identical across scans regardless of referral params
 * or minor formatting differences.
 *
 * Conservative approach: strip only known-safe tracking params; preserve
 * everything else by default. Some ATSes use params that look like trackers
 * but are actually required to load the correct job page.
 */

// Params that are universally tracking-only and safe to strip.
const TRACKING_PARAMS = new Set([
  // UTM family — universally tracking, never functional
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  // Greenhouse trackers (the apply URL itself does not need these)
  "gh_src", "gh_jid", "gh_aid",
  // Lever trackers
  "lever-source", "lever-origin", "lever-source[]",
  // Workable
  "utm_referrer",
  // Analytics platform IDs
  "_ga", "_gl", "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid",
  // Generic referral chain — only strip when standalone, not when required by ATS
  "ref", "referrer", "referral_source",
]);

// Params that MUST be preserved for specific ATS hosts because they are required
// to load the correct job page (they look like trackers but are functional).
const ESSENTIAL_PARAMS_BY_HOST: Record<string, Set<string>> = {
  "myworkdayjobs.com": new Set(["source"]),           // Workday sometimes requires
  "icims.com":         new Set(["hashed", "mobile", "in_iframe"]),
  "jobvite.com":       new Set(["nl"]),
  "eightfold.ai":      new Set(["domain"]),
};

function isEssentialParam(host: string, param: string): boolean {
  const pLower = param.toLowerCase();
  for (const [hostPattern, essentialSet] of Object.entries(ESSENTIAL_PARAMS_BY_HOST)) {
    if (host.endsWith(hostPattern) && essentialSet.has(pLower)) return true;
  }
  return false;
}

export function normalizeRoleUrl(input: string): string {
  if (!input) return input;

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    // Not a valid absolute URL — do minimal cleanup and return as-is.
    return input.trim().toLowerCase();
  }

  // Reject non-HTTP URLs that should never be stored as apply links.
  if (url.protocol === "javascript:" || url.protocol === "mailto:") {
    throw new Error(`Refusing to normalize non-http URL: ${input}`);
  }

  // Lowercase host.
  url.hostname = url.hostname.toLowerCase();

  // Strip leading www.
  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
  }

  // Force https where the domain is the same (most ATS APIs are https).
  if (url.protocol === "http:") url.protocol = "https:";

  // Strip tracking params, preserve essentials.
  const keep = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    const kLower = k.toLowerCase();
    if (TRACKING_PARAMS.has(kLower) && !isEssentialParam(url.hostname, kLower)) continue;
    keep.append(k, v);
  }

  // Sort remaining params for determinism (same URL → same key across scans).
  const sortedKeys = [...keep.keys()].sort();
  const sorted = new URLSearchParams();
  for (const k of sortedKeys) {
    for (const v of keep.getAll(k)) sorted.append(k, v);
  }
  url.search = sorted.toString();

  // Strip trailing slash from path (but keep root /).
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  // Drop fragment.
  url.hash = "";

  return url.toString();
}
