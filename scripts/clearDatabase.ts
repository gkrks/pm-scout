#!/usr/bin/env ts-node
/**
 * scripts/clearDatabase.ts
 * Deletes all rows from every table in dependency order.
 * Run with: npx ts-node scripts/clearDatabase.ts
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const tables = [
  "applications",   // refs job_listings
  "listing_runs",   // refs parser_runs + job_listings
  "job_listings",   // refs companies
  "parser_runs",
  "companies",
];

async function main() {
  for (const table of tables) {
    const { error, count } = await supabase
      .from(table)
      .delete({ count: "exact" })
      .neq("id", "00000000-0000-0000-0000-000000000000"); // matches all rows

    if (error) {
      console.error(`✗ ${table}: ${error.message}`);
      process.exit(1);
    }
    console.log(`✓ ${table}: ${count ?? "?"} rows deleted`);
  }
  console.log("\nDone — all tables cleared.");
}

main();
