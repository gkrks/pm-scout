#!/usr/bin/env node
import "dotenv/config";
import * as fs from "fs";
import { Command } from "commander";
import chalk from "chalk";

import { scrapeJobPage } from "./scraper";
import { extractRequirements } from "./extractor";
import { parseResume } from "./parser";
import { matchRequirements } from "./matcher";
import { generateReport } from "./reporter";

// ── CLI ───────────────────────────────────────────────────────────────────────
// One command: `resume-matcher match --job <url> --resume <file>`
// The scanner itself runs via `npm run scan:once` (scripts/runScan.ts) or
// on a schedule via GitHub Actions (.github/workflows/scan.yml).

const program = new Command();

program
  .name("resume-matcher")
  .description("Match your resume against a job posting using Claude")
  .version("1.0.0");

program
  .command("match")
  .description("Run a full resume ↔ job match analysis")
  .requiredOption("--job <url>", "URL of the job posting")
  .requiredOption("--resume <file>", "Path to your resume (.pdf, .txt, or .md)")
  .option("--verbose", "Print extra debug output", false)
  .action(async (opts: { job: string; resume: string; verbose: boolean }) => {
    const { job: jobUrl, resume: resumePath, verbose } = opts;

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error(
        chalk.red("Error: ANTHROPIC_API_KEY is not set. Add it to a .env file.")
      );
      process.exit(1);
    }

    if (!fs.existsSync(resumePath)) {
      console.error(chalk.red(`Error: Resume file not found: ${resumePath}`));
      process.exit(1);
    }

    try {
      // Stage 1: Scrape
      console.log(chalk.bold("\nFetching job page..."));
      let rawText: string;
      try {
        rawText = await scrapeJobPage(jobUrl);
      } catch (err) {
        console.error(chalk.red(`Error fetching job page: ${err}`));
        process.exit(1);
      }

      if (!rawText.trim()) {
        console.error(
          chalk.red(
            "Could not find requirement sections on this page. " +
              "Try a different URL or paste the requirements text manually."
          )
        );
        process.exit(1);
      }

      if (verbose) {
        console.log(chalk.dim(`\n--- Raw scraped text (${rawText.length} chars) ---`));
        console.log(chalk.dim(rawText.slice(0, 600) + (rawText.length > 600 ? "..." : "")));
        console.log(chalk.dim("---\n"));
      }

      // Stage 2: Extract requirements
      console.log(chalk.bold("Extracting requirements..."));
      let requirements: string[];
      try {
        requirements = await extractRequirements(rawText);
      } catch (err) {
        console.error(chalk.red(`Error extracting requirements: ${err}`));
        process.exit(1);
      }

      console.log(chalk.dim(`Found ${requirements.length} requirements.`));
      if (verbose) {
        requirements.forEach((r, i) => console.log(chalk.dim(`  ${i + 1}. ${r}`)));
      }

      // Stage 3: Parse resume
      console.log(chalk.bold("Parsing resume..."));
      let resumeData;
      try {
        resumeData = await parseResume(resumePath);
      } catch (err) {
        console.error(chalk.red(`Error parsing resume: ${err}`));
        process.exit(1);
      }

      if (verbose) {
        console.log(
          chalk.dim(
            `Resume: ${resumeData.sections.length} sections, ` +
              `${resumeData.experience.length} work entries, ` +
              `${resumeData.skills.length} skills`
          )
        );
      }

      // Stage 4: Match
      console.log(chalk.bold(`Matching ${requirements.length} requirements against resume...`));
      const results = await matchRequirements(
        requirements,
        resumeData,
        (current: number, total: number) => {
          process.stdout.write(`\r  Matching requirement ${current}/${total}...`);
        }
      );
      process.stdout.write("\n");

      // Stage 5: Report
      generateReport(jobUrl, requirements, results);
    } catch (err) {
      console.error(chalk.red(`\nUnexpected error: ${err}`));
      process.exit(1);
    }
  });

program.parse(process.argv);

if (process.argv.length < 3) {
  program.help();
}
