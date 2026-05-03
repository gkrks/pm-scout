/**
 * CLI for testing JD extraction on a single job by ID or URL.
 *
 * Usage:
 *   npx ts-node scripts/extractOne.ts --jobId google-12345
 *   npx ts-node scripts/extractOne.ts --url https://...
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import fetch from "node-fetch";
import { extractJD } from "../src/jdExtractor";
import type { Job } from "../src/state";

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

async function main() {
  const jobId = getArg("jobId");
  const url = getArg("url");

  if (!jobId && !url) {
    console.error("Usage: npx ts-node scripts/extractOne.ts --jobId <id> | --url <url>");
    process.exit(1);
  }

  let rawHtml: string | undefined;
  let rawText: string | undefined;
  let jobTitle = "Unknown";
  let companyName = "Unknown";
  let sourceAts: string | null = null;
  let sourceUrl: string | null = null;

  if (jobId) {
    const jobsPath = path.join(process.cwd(), "data", "jobs.json");
    if (!fs.existsSync(jobsPath)) {
      console.error(`data/jobs.json not found at ${jobsPath}`);
      process.exit(1);
    }
    const jobs: Job[] = JSON.parse(fs.readFileSync(jobsPath, "utf-8"));
    const job = jobs.find((j) => j.id === jobId);
    if (!job) {
      console.error(`Job ID "${jobId}" not found in data/jobs.json`);
      // Show a few IDs for reference
      console.error("Available IDs (first 10):", jobs.slice(0, 10).map((j) => j.id).join(", "));
      process.exit(1);
    }
    rawHtml = job.description;
    jobTitle = job.title;
    companyName = job.company;
    sourceUrl = job.applyUrl;
    console.error(`Extracting JD for: ${job.company} — ${job.title}`);
  } else if (url) {
    console.error(`Fetching ${url} ...`);
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
    if (!resp.ok) {
      console.error(`HTTP ${resp.status} — ${resp.statusText}`);
      process.exit(1);
    }
    rawHtml = await resp.text();
    sourceUrl = url;
    console.error(`Fetched ${rawHtml.length} chars`);
  }

  const result = await extractJD({
    rawHtml,
    rawText,
    jobTitle,
    companyName,
    sourceAts,
    sourceUrl,
  });

  // Print to stdout so it can be piped
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Extraction failed:", err.message);
  if (err.rawResponse) {
    console.error("Raw response:", err.rawResponse.slice(0, 500));
  }
  if (err.zodErrors) {
    console.error("Zod errors:", err.zodErrors);
  }
  process.exit(1);
});
