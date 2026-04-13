import * as fs from "fs";
import chalk from "chalk";
import { MatchResult } from "./matcher";

const REPORT_FILE = "match-report.json";

function separator(): string {
  return "═".repeat(55);
}

function computeScore(results: MatchResult[]): number {
  if (results.length === 0) return 0;
  const numerator = results.reduce((sum, r) => {
    if (r.status === "met")     return sum + 1.0;
    if (r.status === "partial") return sum + 0.5;
    return sum;
  }, 0);
  return Math.round((numerator / results.length) * 100);
}

/**
 * Print a match report to stdout and write match-report.json.
 */
export function generateReport(
  jobUrl: string,
  requirements: string[],
  results: MatchResult[]
): void {
  const now = new Date();
  const datetime = now.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const metCount     = results.filter((r) => r.status === "met").length;
  const partialCount = results.filter((r) => r.status === "partial").length;
  const missingCount = results.filter((r) => r.status === "missing").length;
  const score        = computeScore(results);

  // ── Header ────────────────────────────────────────────────────────────────────
  console.log("\n" + chalk.bold(separator()));
  console.log(chalk.bold("RESUME MATCH REPORT"));
  console.log(`Job: ${chalk.cyan(jobUrl)}`);
  console.log(`Generated: ${datetime}`);
  console.log(chalk.bold(separator()));

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log(
    chalk.green(`✅ Met: ${metCount}`) +
    "  " +
    chalk.yellow(`⚠️  Partial: ${partialCount}`) +
    "  " +
    chalk.red(`❌ Missing: ${missingCount}`) +
    "  |  " +
    chalk.bold(`Match score: ${score}%`)
  );
  console.log();

  // ── Per-requirement rows ──────────────────────────────────────────────────────
  for (const r of results) {
    switch (r.status) {
      case "met":
        console.log(chalk.green(`✅ ${r.requirement}`));
        if (r.proof) {
          console.log(chalk.green(`   Proof: "${r.proof}"`));
        }
        if (r.location) {
          console.log(chalk.green(`   Location: ${r.location}`));
        }
        break;

      case "partial":
        console.log(chalk.yellow(`⚠️  ${r.requirement}`));
        if (r.proof) {
          console.log(chalk.yellow(`   Proof: "${r.proof}" — partial match`));
        }
        if (r.location) {
          console.log(chalk.yellow(`   Location: ${r.location}`));
        }
        break;

      case "missing":
        console.log(chalk.red(`❌ ${r.requirement}`));
        console.log(chalk.red(`   Not found in resume.`));
        break;
    }
    console.log();
  }

  console.log(chalk.bold(separator()) + "\n");

  // ── JSON report file ──────────────────────────────────────────────────────────
  const report = {
    jobUrl,
    generatedAt: now.toISOString(),
    summary: { met: metCount, partial: partialCount, missing: missingCount, score },
    matches: results,
  };

  try {
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), "utf-8");
    console.log(chalk.dim(`Report saved to ${REPORT_FILE}`));
  } catch (err) {
    console.error(chalk.red(`Warning: could not write ${REPORT_FILE}: ${err}`));
  }
}
