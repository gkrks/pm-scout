/**
 * Phase 5 — Main orchestration function.
 *
 * Replaces the monolithic scrapeFromConfig() call in scheduler.ts with a
 * structured two-pool executor that provides:
 *
 *   ✓ Separate API pool (concurrency 12) and Playwright pool (concurrency 3)
 *   ✓ Per-company timeouts with automatic retry and backoff
 *   ✓ Run budget enforcement (default 9-min ceiling)
 *   ✓ Failure classification: ok / suspicious / timeout / error / skipped / skipped-budget
 *   ✓ Suspicious-detection via per-company 30-day baseline from Supabase
 */

import type { TargetsConfig } from "../config/targets";
import type { Job } from "../state";
import { RunBudget, DEFAULT_RUN_BUDGET_MS } from "./budget";
import type { CompanyResult } from "./classify";
import {
  runPool,
  PLAYWRIGHT_ATS,
  API_CONCURRENCY,
  PLAYWRIGHT_CONCURRENCY,
} from "./pools";
import { getSupabaseClient } from "../storage/supabase";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OrchestratorProgress {
  done:          number;
  total:         number;
  company:       string;
  careersUrl:    string;
  status:        CompanyResult["status"];
  errors:        number;
  errorMessage?: string;
  pool:          "api" | "playwright" | "manual";
  scanned:       number;   // ok + suspicious so far
  failed:        number;   // error + timeout so far
  listingsFound: number;   // cumulative job count
}

export interface OrchestratorOptions {
  /** Override the default 9-min run budget. */
  budgetMs?:    number;
  /** Called after every company result (ok, error, skipped, …). */
  onProgress?:  (p: OrchestratorProgress) => void;
}

export interface OrchestratorStats {
  total:      number;   // all enabled companies
  scanned:    number;   // ok + suspicious
  errors:     number;   // error + timeout
  suspicious: number;
  skipped:    number;   // skipped + skipped-budget
  durationMs: number;
}

export interface OrchestratorResult {
  jobs:           Job[];
  companyResults: CompanyResult[];
  stats:          OrchestratorStats;
}

// ── Baseline loader ───────────────────────────────────────────────────────────

/**
 * Query Supabase for the count of active listings per company seen in the last
 * 30 days.  Used to flag companies that normally have listings but returned 0
 * as 'suspicious' rather than silently OK.
 *
 * Returns an empty map if Supabase is unavailable — suspicious detection is
 * gracefully disabled rather than crashing the run.
 */
async function loadCompanyBaselines(): Promise<Map<string, number>> {
  const baselines = new Map<string, number>();
  if (!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    return baselines;
  }
  try {
    const supabase = getSupabaseClient();
    const cutoff   = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();

    const { data, error } = await supabase
      .from("job_listings")
      .select("company_id")
      .gte("last_seen_at", cutoff);

    if (error) {
      console.warn(`[orchestrator] Baseline query failed: ${error.message}`);
      return baselines;
    }
    for (const row of data ?? []) {
      const id = row.company_id as string;
      baselines.set(id, (baselines.get(id) ?? 0) + 1);
    }
    console.log(`[orchestrator] Baselines loaded for ${baselines.size} companies`);
  } catch (e) {
    console.warn(
      `[orchestrator] Baseline load error: ${e instanceof Error ? e.message : e}`,
    );
  }
  return baselines;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Run a complete scan with two concurrent worker pools.
 *
 * Usage in scheduler.ts:
 *   const { jobs, companyResults, stats } = await orchestrateRun(config, {
 *     onProgress: (p) => { ... update appState ... },
 *   });
 */
export async function orchestrateRun(
  config:  TargetsConfig,
  opts?:   OrchestratorOptions,
): Promise<OrchestratorResult> {
  const budget         = new RunBudget(opts?.budgetMs ?? DEFAULT_RUN_BUDGET_MS);
  const companyResults: CompanyResult[] = [];
  let errorCount    = 0;
  let scannedCount  = 0;
  let failedCount   = 0;
  let jobsFound     = 0;

  // Load 30-day baselines for suspicious detection (best-effort)
  const baselines = await loadCompanyBaselines();

  const enabled = config.companies.filter((c) => c.enabled);

  // Guard: catch the 121-company regression immediately at run start.
  if (enabled.length === 0) {
    throw new Error(
      `[orchestrator] Loaded zero enabled companies — check TARGETS_CONFIG_PATH and targets.json`,
    );
  }
  console.log(`[orchestrator] companies_configured=${enabled.length}`);

  // Callback invoked by each pool worker after every company finishes
  const onResult = (r: CompanyResult): void => {
    companyResults.push(r);
    if (r.status === "error"   || r.status === "timeout")   { errorCount++; failedCount++; }
    if (r.status === "ok"      || r.status === "suspicious") { scannedCount++; }
    jobsFound += r.jobs.length;

    const pool: "api" | "playwright" | "manual" =
      (r.ats as string) === "manual" ? "manual"
      : PLAYWRIGHT_ATS.has(r.ats)   ? "playwright"
      : "api";

    opts?.onProgress?.({
      done:          companyResults.length,
      total:         enabled.length,
      company:       r.name,
      careersUrl:    r.careersUrl,
      status:        r.status,
      errors:        errorCount,
      errorMessage:  r.error?.message,
      pool,
      scanned:       scannedCount,
      failed:        failedCount,
      listingsFound: jobsFound,
    });
  };

  // Partition into the three buckets
  const manualCompanies    = enabled.filter((c) => (c.ats as string) === "manual");
  const apiCompanies       = enabled.filter(
    (c) => !PLAYWRIGHT_ATS.has(c.ats) && (c.ats as string) !== "manual",
  );
  const playwrightCompanies = enabled.filter((c) => PLAYWRIGHT_ATS.has(c.ats));

  // Deduplicate by careers URL — scrape each unique URL only once,
  // then report the same result for all companies sharing that URL.
  function dedup(companies: typeof enabled) {
    const seen = new Map<string, typeof enabled[0]>();
    const unique: typeof enabled = [];
    const dupeMap = new Map<string, typeof enabled>(); // url -> extra companies

    for (const c of companies) {
      const url = c.careersUrl.toLowerCase().replace(/\/$/, "");
      if (!seen.has(url)) {
        seen.set(url, c);
        unique.push(c);
        dupeMap.set(url, []);
      } else {
        dupeMap.get(url)!.push(c);
      }
    }

    const dupeCount = companies.length - unique.length;
    if (dupeCount > 0) {
      console.log(`[orchestrator] Deduped ${dupeCount} companies with shared careers URLs`);
    }
    return { unique, dupeMap };
  }

  const { unique: uniqueApi,   dupeMap: apiDupes }  = dedup(apiCompanies);
  const { unique: uniquePw,    dupeMap: pwDupes }    = dedup(playwrightCompanies);

  console.log(
    `[orchestrator] Starting scan — ` +
    `${uniqueApi.length} API (${apiCompanies.length - uniqueApi.length} deduped) | ` +
    `${uniquePw.length} Playwright (${playwrightCompanies.length - uniquePw.length} deduped) | ` +
    `${manualCompanies.length} manual (skipped)`,
  );

  // Mark manual companies as skipped immediately (no async work needed)
  for (const c of manualCompanies) {
    onResult({
      companyId:  c.id ?? "",
      slug:       c.slug ?? c.name,
      name:       c.name,
      careersUrl: c.careersUrl,
      ats:        c.ats,
      status:     "skipped",
      jobs:       [],
      durationMs: 0,
    });
  }

  // Wrap onResult to also report for duplicate companies sharing the same URL
  const allDupes = new Map([...apiDupes, ...pwDupes]);
  const onResultWithDupes = (r: CompanyResult): void => {
    onResult(r);
    const url = r.careersUrl.toLowerCase().replace(/\/$/, "");
    const extras = allDupes.get(url);
    if (extras) {
      for (const dup of extras) {
        onResult({
          ...r,
          companyId:  dup.id ?? "",
          slug:       dup.slug ?? dup.name,
          name:       dup.name,
          careersUrl: dup.careersUrl,
          ats:        dup.ats,
        });
      }
    }
  };

  // Run API and Playwright pools concurrently
  await Promise.all([
    runPool(uniqueApi,  API_CONCURRENCY,       budget, baselines, onResultWithDupes),
    runPool(uniquePw,   PLAYWRIGHT_CONCURRENCY, budget, baselines, onResultWithDupes),
  ]);

  const allJobs = companyResults.flatMap((r) => r.jobs);

  const stats: OrchestratorStats = {
    total:      enabled.length,
    scanned:    companyResults.filter((r) => r.status === "ok" || r.status === "suspicious").length,
    errors:     companyResults.filter((r) => r.status === "error" || r.status === "timeout").length,
    suspicious: companyResults.filter((r) => r.status === "suspicious").length,
    skipped:    companyResults.filter((r) => r.status === "skipped" || r.status === "skipped-budget").length,
    durationMs: budget.elapsedMs(),
  };

  console.log(
    `[orchestrator] Finished in ${budget.elapsedFormatted()} — ` +
    `${stats.scanned} ok, ${stats.errors} errors, ` +
    `${stats.suspicious} suspicious, ${stats.skipped} skipped, ` +
    `${allJobs.length} total jobs`,
  );

  // ── Diagnostic summary: 0-job companies by ATS type ────────────────────────
  const zeroJobCompanies = companyResults.filter(
    (r) => r.status === "ok" && r.jobs.length === 0,
  );
  if (zeroJobCompanies.length > 0) {
    const byAts = new Map<string, number>();
    for (const r of zeroJobCompanies) {
      byAts.set(r.ats, (byAts.get(r.ats) ?? 0) + 1);
    }
    const breakdown = [...byAts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([ats, count]) => `${ats}: ${count}`)
      .join(", ");
    console.log(
      `[orchestrator] ${zeroJobCompanies.length} companies returned 0 jobs (${breakdown})`,
    );
  }

  return { jobs: allJobs, companyResults, stats };
}
