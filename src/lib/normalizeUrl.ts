/**
 * URL normalization for job role_url deduplication.
 *
 * Strips tracking params, normalizes host/protocol/path so that the same
 * job listing's URL is identical across scans regardless of referral params
 * or minor formatting differences.
 */

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gh_src", "gh_jid", "ref", "referrer", "source", "src",
  "lever-source", "lever-origin",
  "_ga", "_gl", "fbclid", "gclid", "msclkid",
  "mc_cid", "mc_eid",
  "s", "t",               // common short trackers
]);

export function normalizeRoleUrl(input: string): string {
  if (!input) return input;

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    // Not a valid URL — do minimal cleanup and return as-is.
    return input.trim().toLowerCase();
  }

  // Lowercase host.
  url.hostname = url.hostname.toLowerCase();

  // Strip leading www.
  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
  }

  // Force https where the domain is the same (most ATS APIs are https).
  if (url.protocol === "http:") url.protocol = "https:";

  // Strip tracking params.
  const keep = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    if (!TRACKING_PARAMS.has(k.toLowerCase())) keep.append(k, v);
  }

  // Sort remaining params for determinism.
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
