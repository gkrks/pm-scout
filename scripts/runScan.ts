#!/usr/bin/env ts-node
/**
 * scripts/runScan.ts
 * Single-run entry point for the job scanner.
 *
 * Usage:
 *   npm run scan:once         — runs immediately, ignoring blackout window
 *   npx ts-node scripts/runScan.ts
 *
 * Exit codes:
 *   0 — success, partial (some companies errored), or blackout skip
 *   1 — the orchestrator itself crashed (unexpected; triggers GH Actions red)
 *
 * A partial run (individual company errors) exits 0 because that is expected
 * behaviour — per-company failures are handled by the Telegram health alert.
 * Only a run that cannot start or crashes mid-flight exits 1.
 */

import "dotenv/config";
import { isInBlackout, describeBlackoutState } from "../src/lib/blackout";
import { runScanOnce } from "../src/scheduler";

async function main(): Promise<void> {
  const ignoreBlackout = process.env.IGNORE_BLACKOUT === "true";

  if (isInBlackout() && !ignoreBlackout) {
    console.log(`[blackout] Skipping run. ${describeBlackoutState()}`);
    console.log(`[blackout] Set IGNORE_BLACKOUT=true (or use workflow_dispatch) to override.`);
    process.exit(0); // clean no-op — workflow run stays green
  }

  if (ignoreBlackout && isInBlackout()) {
    console.log(`[blackout] In blackout window but IGNORE_BLACKOUT=true — proceeding.`);
    console.log(`[blackout] ${describeBlackoutState()}`);
  }

  const trigger  = process.env.RUN_TRIGGER  || "manual";
  const ghRunId  = process.env.RUN_ID_GH    || null;
  const runId    = ghRunId ? `gh-${ghRunId}` : `manual-${Date.now()}`;

  console.log(`[runScan] Starting run ${runId} (trigger=${trigger})`);

  try {
    const result = await runScanOnce(runId);

    console.log(
      `[runScan] Done — ${result.totalJobs} jobs total, ` +
      `${result.newJobs.length} new, ` +
      `${result.errors} company errors`,
    );

    // Partial runs (individual company errors) are expected — stay green.
    // Only a fatal orchestrator crash (caught below) goes red.
    process.exit(0);
  } catch (err) {
    console.error(`[runScan] Fatal error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

main();
