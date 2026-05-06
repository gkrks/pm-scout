/**
 * Insight extraction orchestrator.
 * Reads config/insight_sources.json, fetches content, extracts insights
 * via Claude, stages drafts in data/insights_drafts.json, then runs
 * the interactive review CLI.
 *
 * Usage: npx ts-node scripts/runInsightsExtraction.ts
 */

import "dotenv/config";
import fs from "fs";
import path from "path";

import { fetchSourceContent } from "../src/fit/insights/fetcher";
import { extractInsights } from "../src/fit/insights/extractor";
import { reviewInsights, DraftInsight } from "../src/fit/insights/reviewCli";

interface SourceEntry {
  url: string;
  type: string;
}

interface ProjectConfig {
  project_id: string;
  one_line: string;
  sources: SourceEntry[];
}

const CONFIG_PATH = path.resolve(__dirname, "../config/insight_sources.json");
const DRAFTS_PATH = path.resolve(__dirname, "../data/insights_drafts.json");

const REVIEW_ONLY = process.argv.includes("--review-only");

async function main() {
  let allDrafts: DraftInsight[];

  if (REVIEW_ONLY) {
    // Skip extraction, load existing drafts
    if (!fs.existsSync(DRAFTS_PATH)) {
      console.error("No drafts found at", DRAFTS_PATH);
      process.exit(1);
    }
    allDrafts = JSON.parse(fs.readFileSync(DRAFTS_PATH, "utf8"));
    console.log(`[insights] Loaded ${allDrafts.length} draft insights from ${DRAFTS_PATH}`);
  } else {
    // Full extraction pipeline
    if (!fs.existsSync(CONFIG_PATH)) {
      console.error("config/insight_sources.json not found");
      process.exit(1);
    }

    const projects: ProjectConfig[] = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    console.log(`[insights] Loaded ${projects.length} project(s) from config`);

    allDrafts = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const project of projects) {
      console.log(`\n=== ${project.project_id}: ${project.one_line} ===`);

      for (const source of project.sources) {
        console.log(`  Fetching ${source.type}: ${source.url}`);
        const fetched = await fetchSourceContent(source.url, source.type);

        if (!fetched) {
          console.log(`  FAILED — logged to scrape_failures`);
          continue;
        }

        console.log(`  Fetched ${fetched.content.length} chars, extracting insights...`);
        try {
          const result = await extractInsights(
            project.project_id,
            project.one_line,
            source.url,
            fetched.content,
          );

          totalInputTokens += result.inputTokens;
          totalOutputTokens += result.outputTokens;

          console.log(`  Extracted ${result.insights.length} insights`);
          for (const insight of result.insights) {
            allDrafts.push({
              ...insight,
              project_id: project.project_id,
              source_url: source.url,
            });
          }
        } catch (err: any) {
          console.error(`  Extraction failed: ${err.message}`);
        }
      }
    }

    // Stage drafts to disk
    fs.writeFileSync(DRAFTS_PATH, JSON.stringify(allDrafts, null, 2));
    console.log(`\n[insights] Staged ${allDrafts.length} draft insights to ${DRAFTS_PATH}`);
    console.log(`[insights] Token usage: ${totalInputTokens} input / ${totalOutputTokens} output`);
  }

  if (allDrafts.length === 0) {
    console.log("[insights] No insights to review.");
    return;
  }

  // Interactive review
  console.log("\n=== Starting interactive review ===\n");
  const result = await reviewInsights(allDrafts);
  console.log(`\n[insights] Review complete: ${result.accepted} accepted, ${result.rejected} rejected, ${result.skipped} skipped`);
}

main().catch((err) => {
  console.error("[insights] Fatal error:", err);
  process.exit(1);
});
