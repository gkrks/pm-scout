/**
 * CLI for refreshing company intel.
 *
 * Usage:
 *   npx ts-node scripts/refreshIntel.ts --company <slug> [--force] [--domain <url>]
 *
 * Examples:
 *   npx ts-node scripts/refreshIntel.ts --company stripe --force
 *   npx ts-node scripts/refreshIntel.ts --company vercel --domain https://vercel.com
 */

import "dotenv/config";
import { getSupabaseClient } from "../src/storage/supabase";
import { refreshCompanyIntel } from "../src/fit/intel/orchestrator";

async function main() {
  const args = process.argv.slice(2);
  const companyIdx = args.indexOf("--company");
  const forceFlag = args.includes("--force");
  const domainIdx = args.indexOf("--domain");

  if (companyIdx === -1 || !args[companyIdx + 1]) {
    console.error("Usage: npx ts-node scripts/refreshIntel.ts --company <slug> [--force] [--domain <url>]");
    process.exit(1);
  }

  const slug = args[companyIdx + 1];
  const domain = domainIdx !== -1 ? args[domainIdx + 1] : undefined;

  // Look up company by slug
  const supabase = getSupabaseClient();
  const { data: company, error } = await supabase
    .from("companies")
    .select("id, name, slug, careers_url")
    .eq("slug", slug)
    .single();

  if (error || !company) {
    console.error(`Company with slug "${slug}" not found: ${error?.message || "no data"}`);
    process.exit(1);
  }

  console.log(`[intel] Refreshing intel for ${company.name} (${company.slug})`);
  console.log(`[intel] Company ID: ${company.id}`);
  console.log(`[intel] Careers URL: ${company.careers_url}`);
  if (domain) console.log(`[intel] Override domain: ${domain}`);
  if (forceFlag) console.log(`[intel] Force refresh enabled`);

  const result = await refreshCompanyIntel(company.id, {
    force: forceFlag,
    domain: domain || company.careers_url,
  });

  console.log("\n=== Results ===");
  if (result.skipped) {
    console.log(`SKIPPED: ${result.skipReason}`);
  } else {
    console.log(`Feed URL:        ${result.feedUrl || "none"}`);
    console.log(`Feed discovered: ${result.feedDiscovered}`);
    console.log(`Posts processed: ${result.rssPostsAdded}`);
    console.log(`Chunks written:  ${result.chunksWritten}`);
  }

  if (result.failures.length > 0) {
    console.log(`\nFailures (${result.failures.length}):`);
    for (const f of result.failures) {
      console.log(`  - ${f}`);
    }
  }
}

main().catch((err) => {
  console.error("[intel] Fatal error:", err);
  process.exit(1);
});
