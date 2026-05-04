/**
 * One-shot script: parse docs/manual_companies.md, detect ATS from URLs,
 * update ats_routing.json and targets.json careers_url.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const MD_PATH = path.join(ROOT, "docs/manual_companies.md");
const ROUTING_PATH = path.join(ROOT, "config/ats_routing.json");
const TARGETS_PATH = path.join(ROOT, "config/targets.json");

// ── Parse markdown tables ──────────────────────────────────────────────
interface ParsedCompany {
  slug: string;
  name: string;
  url: string;
  section: string;
}

function parseMarkdown(): ParsedCompany[] {
  const md = fs.readFileSync(MD_PATH, "utf-8");
  const lines = md.split("\n");
  const results: ParsedCompany[] = [];
  let currentSection = "";

  for (const line of lines) {
    // Detect section headers
    if (line.startsWith("## ")) {
      currentSection = line.replace(/^## /, "").trim();
      continue;
    }
    // Parse table rows (skip header and separator rows)
    if (!line.startsWith("|") || line.includes("---") || line.includes("Slug")) continue;

    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 4) continue;

    // Columns differ by section:
    // Most: # | Slug | Name | Careers URL
    // Subsidiaries: # | Slug | Name | Parent | Careers URL
    // Other Issues: # | Slug | Name | Issue | Careers URL
    const slug = cells[1];
    const name = cells[2];
    let url = "";

    if (currentSection.startsWith("Subsidiaries") || currentSection.startsWith("Other Issues")) {
      url = cells.length >= 5 ? cells[4] : "";
    } else {
      url = cells.length >= 4 ? cells[3] : "";
    }

    // Skip empty, "none found", or placeholder URLs
    if (!url || url === "none found" || url.startsWith("http") === false) continue;

    results.push({ slug, name, url: url.trim(), section: currentSection });
  }

  return results;
}

// ── Detect ATS from URL ────────────────────────────────────────────────
interface ATSDetection {
  ats: string;
  slug?: string;
  host?: string;
  tenant?: string;
  site?: string;
}

function detectATS(url: string): ATSDetection | null {
  // Ashby: jobs.ashbyhq.com/<slug>
  let m = url.match(/jobs\.ashbyhq\.com\/([^\/\?#]+)/);
  if (m) return { ats: "ashby", slug: decodeURIComponent(m[1]) };

  // Greenhouse: job-boards.greenhouse.io/<slug> or boards.greenhouse.io/<slug>
  m = url.match(/(?:job-boards|boards)\.greenhouse\.io\/([^\/\?#]+)/);
  if (m) return { ats: "greenhouse", slug: m[1] };

  // Lever: jobs.lever.co/<slug>
  m = url.match(/jobs\.lever\.co\/([^\/\?#]+)/);
  if (m) return { ats: "lever", slug: m[1] };

  // Workable: apply.workable.com/<slug>
  m = url.match(/apply\.workable\.com\/([^\/\?#]+)/);
  if (m) return { ats: "workable", slug: m[1].replace(/\/$/, "") };

  // Workday: <tenant>.wd<N>.myworkdayjobs.com
  m = url.match(/([^\/]+)\.wd(\d+)\.myworkdayjobs\.com/);
  if (m) {
    return {
      ats: "workday",
      host: `${m[1]}.wd${m[2]}.myworkdayjobs.com`,
      tenant: m[1],
      site: "en-US",
    };
  }

  // SmartRecruiters: careers.<company>.com or jobs.smartrecruiters.com/<slug>
  m = url.match(/jobs\.smartrecruiters\.com\/([^\/\?#]+)/);
  if (m) return { ats: "smartrecruiters", slug: m[1] };

  return null; // Unknown ATS — stays manual but gets careers_url updated
}

// ── Main ───────────────────────────────────────────────────────────────
function main() {
  const companies = parseMarkdown();
  console.log(`Parsed ${companies.length} companies with URLs from manual_companies.md\n`);

  // Load configs
  const routingFile = JSON.parse(fs.readFileSync(ROUTING_PATH, "utf-8"));
  const targetsFile = JSON.parse(fs.readFileSync(TARGETS_PATH, "utf-8"));

  const routing: Record<string, any> = routingFile.routing;
  const companiesArr: any[] = targetsFile.companies;

  // Build slug → index map for targets
  const slugToIdx = new Map<string, number>();
  companiesArr.forEach((c: any, i: number) => slugToIdx.set(c.slug, i));

  let routingUpdated = 0;
  let careersUrlUpdated = 0;
  let atsDetected = 0;
  let stayManual = 0;
  const notInTargets: string[] = [];

  const now = new Date().toISOString();

  for (const co of companies) {
    const detection = detectATS(co.url);

    // 1. Update ats_routing.json
    if (detection) {
      const entry: Record<string, any> = { ats: detection.ats };
      if (detection.slug) entry.slug = detection.slug;
      if (detection.host) entry.host = detection.host;
      if (detection.tenant) entry.tenant = detection.tenant;
      if (detection.site) entry.site = detection.site;
      entry._discovery_method = "manual-companies-md";
      entry._discovered_at = now;

      routing[co.slug] = entry;
      routingUpdated++;
      atsDetected++;
      console.log(`  ATS detected: ${co.slug} → ${detection.ats} (${detection.slug || detection.host || ""})`);
    } else {
      // Keep as manual but add careers_url note
      if (routing[co.slug]?.ats === "manual") {
        routing[co.slug]._careers_url = co.url;
      }
      stayManual++;
    }

    // 2. Update targets.json careers_url
    const idx = slugToIdx.get(co.slug);
    if (idx !== undefined) {
      const prev = companiesArr[idx].careers_url;
      if (!prev || prev === "" || prev === "null") {
        companiesArr[idx].careers_url = co.url;
        careersUrlUpdated++;
      } else if (prev !== co.url) {
        // Update if different
        companiesArr[idx].careers_url = co.url;
        careersUrlUpdated++;
      }
    } else {
      notInTargets.push(co.slug);
    }
  }

  // Write updated configs
  fs.writeFileSync(ROUTING_PATH, JSON.stringify(routingFile, null, 2) + "\n");
  fs.writeFileSync(TARGETS_PATH, JSON.stringify(targetsFile, null, 2) + "\n");

  console.log(`\n── Summary ──`);
  console.log(`  Total companies with URLs: ${companies.length}`);
  console.log(`  ATS detected & routing updated: ${atsDetected}`);
  console.log(`  Stayed manual (no ATS pattern): ${stayManual}`);
  console.log(`  targets.json careers_url updated: ${careersUrlUpdated}`);
  if (notInTargets.length > 0) {
    console.log(`  Not found in targets.json: ${notInTargets.join(", ")}`);
  }
  console.log(`\nDone. Run 'npx ts-node scripts/syncCompanies.ts' to push to Supabase.`);
}

main();
