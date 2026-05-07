#!/usr/bin/env npx ts-node
/**
 * Brute-force Ashby slug discovery via direct API probing.
 *
 * Strategy:
 *   1. Start with existing slugs from ats_routing.json (176 known)
 *   2. Generate candidate slugs from common company name patterns
 *   3. Validate each candidate via Ashby's GraphQL endpoint
 *   4. Output a CSV in the format expected by discover_ashby_companies.ts
 *
 * Much faster than web-search-based discovery since it hits the API directly.
 */

import * as fs from "fs";
import * as path from "path";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const OUTPUT_CSV = path.join(process.cwd(), "data", "akshatbhat_verified_ashby_slugs.csv");
const CONCURRENCY = 12;
const TIMEOUT_MS = 8000;

// ── Slug candidates from multiple sources ───────────────────────────────────

function loadExistingAshbySlugs(): string[] {
  const routingPath = path.join(process.cwd(), "config", "ats_routing.json");
  const raw = JSON.parse(fs.readFileSync(routingPath, "utf8"));
  const routing = raw.routing || raw;
  const slugs: string[] = [];
  for (const [key, val] of Object.entries(routing) as [string, any][]) {
    if (val.ats !== "ashby") continue;
    slugs.push(val.slug ?? key);
  }
  return slugs;
}

// Large curated list of tech company slugs to probe
// Sourced from: YC companies, Forbes Cloud 100, major tech employers
function generateCandidateSlugs(): string[] {
  const candidates = [
    // YC batch companies (common Ashby users)
    "airbnb", "stripe", "doordash", "instacart", "coinbase", "dropbox", "reddit",
    "twitch", "zapier", "gitlab", "gusto", "brex", "faire", "retool", "webflow",
    "vercel", "supabase", "replit", "linear", "loom", "notion", "figma",
    "airtable", "coda", "miro", "canva", "calendly", "gong", "highspot",
    "outreach", "salesloft", "vidyard", "sendbird", "stream", "agora",
    "clerk", "stytch", "auth0", "okta", "snyk", "lacework", "orca-security",
    "wiz", "abnormal-security", "material-security", "tessian", "vanta",
    "drata", "secureframe", "launchdarkly", "split", "optimizely",
    "amplitude", "mixpanel", "heap", "fullstory", "hotjar", "pendo",
    "walkme", "appcues", "userflow", "chameleon", "whatfix",
    // AI/ML companies
    "openai", "anthropic", "cohere", "huggingface", "stability-ai",
    "midjourney", "runway", "jasper", "copy-ai", "writer",
    "grammarly", "deepmind", "inflection", "character-ai", "character",
    "adept", "together-ai", "anyscale", "modal", "replicate",
    "weights-and-biases", "wandb", "neptune", "mlflow",
    "scale", "scaleai", "labelbox", "snorkel", "superannotate",
    "perplexity", "perplexity-ai", "mistral", "mistralai",
    "databricks", "snowflake", "fivetran", "airbyte", "meltano",
    "dbt-labs", "monte-carlo", "bigeye", "anomalo", "great-expectations",
    "hex", "mode", "sigma", "thoughtspot", "looker",
    // Fintech
    "plaid", "marqeta", "lithic", "unit", "treasury-prime",
    "mercury", "ramp", "navan", "center", "divvy", "airbase",
    "zip", "procurify", "coupa", "tipalti", "bill",
    "affirm", "klarna", "afterpay", "sezzle", "bread",
    "chime", "current", "varo", "aspiration", "greenlight",
    "robinhood", "wealthfront", "betterment", "acorns", "stash",
    // Infrastructure/DevTools
    "datadog", "new-relic", "dynatrace", "splunk", "elastic",
    "grafana", "chronosphere", "lightstep", "honeycomb",
    "hashicorp", "pulumi", "terraform", "spacelift",
    "docker", "containerd", "isovalent", "cilium",
    "tailscale", "cloudflare", "fastly", "netlify",
    "fly", "flyio", "render", "railway", "porter",
    "temporal", "inngest", "trigger-dev", "windmill",
    "prisma", "planetscale", "neon", "cockroach", "cockroachdb",
    "singlestore", "timescale", "questdb", "clickhouse",
    "confluent", "redpanda", "warpstream", "materialize",
    "dagger", "depot", "earthly", "buildkite", "circleci",
    // Security
    "crowdstrike", "sentinelone", "palo-alto-networks",
    "zscaler", "cloudflare", "netskope", "cato-networks",
    "1password", "bitwarden", "dashlane", "keeper",
    "cyberark", "delinea", "beyondtrust", "sailpoint",
    // Healthcare
    "oscar-health", "devoted-health", "clover-health",
    "hims-and-hers", "ro", "nurx", "maven-clinic",
    "cerebral", "talkspace", "betterhelp", "headspace",
    "calm", "noom", "whoop", "oura", "garmin",
    "veracyte", "tempus", "flatiron-health", "komodo-health",
    // E-commerce/Marketplace
    "shopify", "bigcommerce", "woocommerce", "squarespace",
    "etsy", "poshmark", "mercari", "offerup",
    "wayfair", "chewy", "grove", "thrive-market",
    "faire", "handshake", "orderful", "pipe17",
    // Real Estate/PropTech
    "zillow", "redfin", "compass", "opendoor",
    "offerpad", "knock", "divvy-homes", "arrived",
    "lessen", "procore", "buildertrend", "plangrid",
    // Logistics/Supply Chain
    "flexport", "project44", "fourkites", "transfix",
    "convoy", "uber-freight", "loadsmart", "shipbob",
    "deliverr", "stord", "fabric", "attabotics",
    // HR/People
    "rippling", "deel", "remote", "oyster", "velocity-global",
    "papaya-global", "letsdeel", "remotecom",
    "lattice", "culture-amp", "15five", "betterworks",
    "lever", "greenhouse", "gem", "ashby",
    "checkr", "certn", "sterling", "hireright",
    // Education
    "duolingo", "coursera", "udemy", "skillshare",
    "masterclass", "brilliant", "kahoot", "quizlet",
    "instructure", "powerschool", "schoology",
    // Gaming
    "roblox", "epic-games", "riot-games", "supercell",
    "niantic", "zynga", "scopely", "jam-city",
    "unity", "unreal", "godot",
    // Communication
    "slack", "discord", "zoom", "dialpad",
    "ringcentral", "vonage", "twilio", "bandwidth",
    "intercom", "zendesk", "freshworks", "helpscout",
    "front", "missive", "crisp", "drift",
    // Crypto/Web3
    "consensys", "alchemy", "infura", "chainlink",
    "polygon", "arbitrum", "optimism", "starkware",
    "dydx", "uniswap", "aave", "compound",
    "opensea", "blur", "magic-eden", "tensor",
    "fireblocks", "anchorage", "bitgo", "copper",
    // General tech names
    "airwallex", "assembled", "athenian", "ashby",
    "benchling", "bilt", "boundary", "buildkite",
    "cartography", "celonis", "chainalysis", "chromatic",
    "circleci", "clay", "clearbit", "clockwise",
    "cockroach-labs", "coder", "contentful", "contrast-security",
    "cribl", "crossbeam", "crusoe", "cybereason",
    "dagster", "dbt", "deepgram", "deepwatch",
    "demandbase", "descope", "ditto", "docker",
    "doppel", "earnin", "electric", "eleven-labs",
    "elevenlabs", "encore", "eppo", "everai",
    "everlane", "exafunction", "exiger", "f5",
    "fastly", "finch", "firsthand", "flock-safety",
    "foresight", "found", "foundry", "foxglove",
    "freshpaint", "garner-health", "gather", "glean",
    "glia", "goldsky", "groundlight", "growthbook",
    "harbor", "harness", "hasura", "headway",
    "hive", "honeycomb", "humane", "hyperscience",
    "ideo", "imprint", "incident-io", "ironclad",
    "iter8", "joby", "juniper-square", "justworks",
    "k-health", "knight-scope", "komodor", "lacework",
    "lambda", "latch", "lattice", "lemon-squeezy",
    "lightspark", "livekit", "logz", "lumos",
    "magic-leap", "majesty", "materialize", "memfault",
    "meta", "metabase", "mighty", "mila",
    "minimal", "mixpanel", "modern-treasury", "monad",
    "monzo", "motherduck", "moveworks", "multiply",
    "mysten-labs", "narvar", "natera", "navan",
    "near", "neeva", "nerdwallet", "next-insurance",
    "nimble", "notion", "nova", "nuna",
    "observe", "okta", "omada-health", "orca",
    "orchard", "oura", "outreach", "own",
    "oxbow", "pachyderm", "palantir", "panther",
    "para", "paragon", "pave", "persona",
    "pilot", "pinecone", "pipe", "plaid",
    "planet", "platform-sh", "plume", "podium",
    "postman", "procore", "pulley", "puzzle",
    "qonto", "radar", "ramp", "readme",
    "rebuy", "recurly", "replit", "revolut",
    "ridgeline", "rivet", "robust-intelligence", "rocket-money",
    "runway", "samsara", "sardine", "sauce-labs",
    "scale-ai", "scribe", "seismic", "semgrep",
    "sequoia", "shippo", "side", "sigma-computing",
    "siteline", "skydio", "smartcar", "snorkel-ai",
    "snowflake", "sourcegraph", "sprig", "starburst",
    "statsig", "stord", "storytel", "superhuman",
    "suvie", "sword-health", "sysdig", "tanium",
    "tegus", "terrascope", "thumbtack", "tidal",
    "toast", "tome", "tophat", "transcend",
    "truewind", "truework", "trunk", "turntide",
    "unqork", "upstart", "upwork", "vanta",
    "veho", "vendor", "vercel", "verkada",
    "vidyard", "vimeo", "vouch", "warmly",
    "watershed", "webflow", "weights-biases", "whatnot",
    "whoop", "wise", "workato", "workspace",
    "xata", "yotpo", "zebra", "zip",
    "zora", "zuora", "zymergen",
  ];

  // Deduplicate
  return [...new Set(candidates)];
}

// ── Validation ──────────────────────────────────────────────────────────────

interface ValidatedSlug {
  slug: string;
  name: string;
  website: string;
  status: "VERIFIED" | "INVALID";
}

async function validateSlug(slug: string): Promise<ValidatedSlug> {
  try {
    // Use the posting API directly — it's not rate-limited like GraphQL
    const resp = await fetch(
      `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; JobSearchBot/1.0)" },
        timeout: TIMEOUT_MS,
      } as any,
    );

    if (!resp.ok) {
      return { slug, name: "", website: "", status: "INVALID" };
    }

    const data = (await resp.json()) as any;
    const jobs: any[] = data.jobs ?? data.jobPostings ?? [];

    // Valid board — it returned data (even if 0 jobs, the endpoint responded 200)
    // Infer company name from the first job's company name or slug
    let name = slug;
    if (jobs.length > 0 && jobs[0]?.organizationName) {
      name = jobs[0].organizationName;
    }

    return {
      slug,
      name,
      website: "",
      status: "VERIFIED",
    };
  } catch {
    return { slug, name: "", website: "", status: "INVALID" };
  }
}

// ── Concurrent runner ───────────────────────────────────────────────────────

async function runConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const queue = items.map((item, idx) => ({ item, idx }));
  let processed = 0;

  const worker = async () => {
    while (true) {
      const entry = queue.shift();
      if (!entry) break;
      results[entry.idx] = await fn(entry.item);
      processed++;
      if (processed % 50 === 0) {
        const verified = results.filter((r: any) => r?.status === "VERIFIED").length;
        console.log(`  Progress: ${processed}/${items.length} tested, ${verified} verified`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Brute-Force Ashby Slug Discovery ===\n");

  // Load existing known slugs
  const existingSlugs = loadExistingAshbySlugs();
  console.log(`Existing Ashby slugs from ats_routing.json: ${existingSlugs.length}`);

  // Generate candidates
  const candidates = generateCandidateSlugs();
  console.log(`Generated candidate slugs: ${candidates.length}`);

  // Merge and deduplicate
  const allSlugs = [...new Set([...existingSlugs, ...candidates])];
  console.log(`Total unique slugs to validate: ${allSlugs.length}\n`);

  // Validate all slugs
  console.log("Validating via Ashby GraphQL API...");
  const results = await runConcurrent(allSlugs, CONCURRENCY, validateSlug);

  const verified = results.filter((r) => r.status === "VERIFIED");
  const invalid = results.filter((r) => r.status === "INVALID");

  console.log(`\n✓ Verified: ${verified.length}`);
  console.log(`✗ Invalid: ${invalid.length}`);

  // Write CSV
  const csvHeader = "slug,inferred_company_name,ashby_url,source_type,source_url,verification_status,notes";
  const csvRows = verified.map((r) =>
    `${r.slug},"${r.name.replace(/"/g, '""')}",https://jobs.ashbyhq.com/${r.slug},direct_probe,,VERIFIED,"Validated via GraphQL API"`,
  );
  const csv = [csvHeader, ...csvRows].join("\n") + "\n";

  fs.mkdirSync(path.dirname(OUTPUT_CSV), { recursive: true });
  fs.writeFileSync(OUTPUT_CSV, csv, "utf8");
  console.log(`\nCSV written to ${OUTPUT_CSV} (${verified.length} rows)`);
}

main().catch((e) => {
  console.error("Discovery failed:", e);
  process.exit(1);
});
