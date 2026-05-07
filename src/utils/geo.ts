/**
 * Shared US location detection utilities.
 *
 * Used by:
 *   - scripts/discover_ashby_companies.ts (Phase 1 — pre-compute US-ness per company)
 *   - src/filters/pipeline.ts (Phase 4 — per-job US filter)
 */

const US_COUNTRY_TOKENS = new Set([
  "united states",
  "usa",
  "us",
  "u.s.",
  "u.s.a.",
]);

// Two-letter US state abbreviations for location string heuristic
const US_STATE_CODES =
  /\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/;

/**
 * Determine whether an Ashby job posting is located in the United States.
 *
 * Checks (in order):
 *   1. address.postalAddress.addressCountry
 *   2. secondaryLocations[].address.addressCountry
 *   3. Location string heuristic: contains a US state code + comma
 *   4. "Remote" with no country qualifier treated as potentially US (returns false — caller decides)
 */
export function isUSJob(job: any): boolean {
  // Primary: structured address country
  const country = (
    job?.address?.postalAddress?.addressCountry || ""
  )
    .toLowerCase()
    .trim();
  if (US_COUNTRY_TOKENS.has(country)) return true;

  // Secondary locations
  const secondary: any[] = job?.secondaryLocations || [];
  if (
    secondary.some((s: any) =>
      US_COUNTRY_TOKENS.has(
        (s?.address?.addressCountry || "").toLowerCase().trim(),
      ),
    )
  )
    return true;

  // Fallback: location string heuristic — must contain a US state code with comma
  const loc = (job?.location || job?.locationName || "").toString();
  if (US_STATE_CODES.test(loc) && loc.includes(",")) return true;

  return false;
}

/**
 * Check if a RawJob (with raw_payload) is a US job.
 * Accepts either a raw Ashby API payload or a RawJob with raw_payload field.
 */
export function isUSRawJob(rawJob: any): boolean {
  const payload = rawJob?.raw_payload || rawJob;
  return isUSJob(payload);
}
