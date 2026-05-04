/**
 * Backfill location_city for listings where it's NULL but location_raw exists.
 *
 * Strategy:
 *   1. Use the existing allowed_cities + aliases from targets.json (exact match)
 *   2. For unmatched: extract "City, ST" or "City, State" patterns deterministically
 *   3. Mark pure remote as "Remote"
 *
 * Usage: npx ts-node scripts/backfillLocationCity.ts [--dry-run]
 */

import "dotenv/config";
import { getSupabaseClient } from "../src/storage/supabase";
import * as fs from "fs";
import * as path from "path";

// ── Load city lookup from targets.json ───────────────────────────────────────

const targets = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../config/targets.json"), "utf-8"),
);
const locConfig = targets.filters.location;
const allowedCities: string[] = locConfig.allowed_cities;
const cityAliases: Record<string, string[]> = locConfig.city_aliases;

const cityLookup = new Map<string, string>();
for (const city of allowedCities) {
  cityLookup.set(city.toLowerCase(), city);
  for (const alias of cityAliases[city] ?? []) {
    cityLookup.set(alias.toLowerCase(), city);
  }
}

// ── Extended city patterns (common Bay Area / tech hub cities not in allowed list) ──

const EXTRA_CITIES: Record<string, string> = {
  "mountain view": "Mountain View",
  "menlo park": "Menlo Park",
  "palo alto": "Palo Alto",
  "sunnyvale": "Sunnyvale",
  "cupertino": "Cupertino",
  "redwood city": "Redwood City",
  "foster city": "Foster City",
  "fremont": "Fremont",
  "oakland": "Oakland",
  "irvine": "Irvine",
  "playa vista": "Playa Vista",
  "culver city": "Culver City",
  "santa monica": "Santa Monica",
  "pasadena": "Pasadena",
  "burlingame": "Burlingame",
  "milpitas": "Milpitas",
  "pleasanton": "Pleasanton",
  "dublin": "Dublin",
  "tempe": "Tempe",
  "scottsdale": "Scottsdale",
  "phoenix": "Phoenix",
  "salt lake city": "Salt Lake City",
  "nashville": "Nashville",
  "charlotte": "Charlotte",
  "raleigh": "Raleigh",
  "durham": "Durham",
  "dallas": "Dallas",
  "houston": "Houston",
  "minneapolis": "Minneapolis",
  "detroit": "Detroit",
  "pittsburgh": "Pittsburgh",
  "columbus": "Columbus",
  "indianapolis": "Indianapolis",
  "st. louis": "St. Louis",
  "st louis": "St. Louis",
  "kansas city": "Kansas City",
  "richmond": "Richmond",
  "arlington": "Arlington",
  "herndon": "Herndon",
  "mclean": "McLean",
  "tysons": "Tysons",
  "reston": "Reston",
  "bethesda": "Bethesda",
};

// ── Remote patterns ──────────────────────────────────────────────────────────

const REMOTE_RE = /\bremote\b/i;
const REMOTE_US_RE = /remote.*(?:us|united states)|(?:us|united states).*remote/i;

// ── City extraction from raw location string ─────────────────────────────────

function extractCity(raw: string): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();

  // 1. Check allowed cities + aliases (longest match first)
  const lower = cleaned.toLowerCase();
  const sortedKeys = [...cityLookup.keys()].sort((a, b) => b.length - a.length);
  for (const term of sortedKeys) {
    if (lower.includes(term)) return cityLookup.get(term)!;
  }

  // 2. Check extended city list
  const extraKeys = Object.keys(EXTRA_CITIES).sort((a, b) => b.length - a.length);
  for (const term of extraKeys) {
    if (lower.includes(term)) return EXTRA_CITIES[term];
  }

  // 3. Try "City, ST" pattern: "US, CA, San Francisco" → "San Francisco"
  const usPrefix = cleaned.match(/^US,\s*[A-Z]{2},\s*(.+)/i);
  if (usPrefix) {
    const city = usPrefix[1].trim().split(/[,;]/)[0].trim();
    if (city.length > 2) return city;
  }

  // 4. Try "City, State/ST" pattern
  const cityState = cleaned.match(/^([A-Za-z\s.]+),\s*(?:[A-Z]{2}|[A-Za-z\s]+)(?:,|\s|$)/);
  if (cityState) {
    const city = cityState[1].trim();
    // Filter out noise
    if (city.length > 2 && !/^(US|USA|United|Product|Remote)$/i.test(city)) return city;
  }

  // 5. Pure remote
  if (REMOTE_RE.test(cleaned)) return "Remote";

  // 6. "United States" alone
  if (/^united states$/i.test(cleaned.trim())) return "United States";

  // 7. Multi-location: take first city
  if (cleaned.includes(";")) {
    const first = cleaned.split(";")[0].trim();
    const result = extractCity(first);
    if (result) return result;
  }

  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const sb = getSupabaseClient();

  // Fetch all listings with null location_city
  const { data: listings, error } = await sb
    .from("job_listings")
    .select("id, location_raw, location_city")
    .is("location_city", null)
    .not("location_raw", "is", null)
    .limit(5000);

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  console.log(`Found ${listings?.length || 0} listings with null location_city\n`);

  const updates: { id: string; location_city: string }[] = [];
  const unresolved: string[] = [];

  for (const l of listings || []) {
    const city = extractCity(l.location_raw);
    if (city) {
      updates.push({ id: l.id, location_city: city });
    } else {
      unresolved.push(l.location_raw);
    }
  }

  console.log(`Resolved: ${updates.length}`);
  console.log(`Unresolved: ${unresolved.length}`);

  if (unresolved.length > 0) {
    console.log("\nUnresolved location_raw values:");
    for (const u of [...new Set(unresolved)]) {
      console.log(`  "${u}"`);
    }
  }

  // Show what we'd update
  const cityCounts = new Map<string, number>();
  for (const u of updates) {
    cityCounts.set(u.location_city, (cityCounts.get(u.location_city) || 0) + 1);
  }
  console.log("\nCity distribution:");
  for (const [city, count] of [...cityCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${city}: ${count}`);
  }

  if (dryRun) {
    console.log("\n[DRY RUN] No updates written.");
    return;
  }

  // Batch update
  let updated = 0;
  const BATCH = 50;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    const promises = batch.map((u) =>
      sb.from("job_listings").update({ location_city: u.location_city }).eq("id", u.id)
    );
    const results = await Promise.all(promises);
    const errors = results.filter((r) => r.error);
    updated += batch.length - errors.length;
    if (errors.length > 0) {
      console.error(`  ${errors.length} errors in batch ${i / BATCH + 1}`);
    }
  }

  console.log(`\nUpdated ${updated} listings.`);
}

main().catch(console.error);
