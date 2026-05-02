/**
 * Phase 4 — Supabase parser_runs table CRUD
 *
 * One row per scan execution. Created at run start; finalized at completion.
 * Stale 'running' rows (> 15 min old) are swept on startup.
 */

import { getSupabaseClient } from "./supabase";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RunStatus = "running" | "completed" | "partial" | "failed";

export interface ParserRunSummary {
  status: "completed" | "partial" | "failed";
  companiesScanned: number;
  companiesFailed: number;
  listingsFound: number;
  listingsNew: number;
  listingsUpdated: number;
  listingsDeactivated: number;
  errorMessage?: string;
  notes?: string;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Insert a new parser_run with status='running' and return its UUID.
 * Call this at the very start of each scan before any scraping begins.
 */
export async function startParserRun(
  configVersion?: string,
  configHash?: string,
): Promise<string> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("parser_runs")
    .insert({
      status: "running",
      config_version: configVersion ?? null,
      config_hash: configHash ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`[parserRuns] Failed to start run: ${error?.message}`);
  }

  return data.id as string;
}

/**
 * Update a parser_run to its final state. Call this after all scraping,
 * filtering, and DB writes are complete.
 */
export async function finalizeParserRun(
  runId: string,
  summary: ParserRunSummary,
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from("parser_runs")
    .update({
      completed_at: new Date().toISOString(),
      status: summary.status,
      companies_scanned: summary.companiesScanned,
      companies_failed: summary.companiesFailed,
      listings_found: summary.listingsFound,
      listings_new: summary.listingsNew,
      listings_updated: summary.listingsUpdated,
      listings_deactivated: summary.listingsDeactivated,
      error_message: summary.errorMessage ?? null,
      notes: summary.notes ?? null,
    })
    .eq("id", runId);

  if (error) {
    // Non-fatal — the run data is already in the buffer; log and move on.
    console.error(`[parserRuns] Failed to finalize run ${runId}: ${error.message}`);
  }
}

/**
 * On startup, mark any 'running' parser_runs older than 15 minutes as 'failed'.
 * Guards against crash-interrupted runs leaving stale status.
 */
export async function sweepStaleRuns(): Promise<void> {
  const supabase = getSupabaseClient();
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();

  const { error } = await supabase
    .from("parser_runs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: "Run was still 'running' after 15 min — assumed crashed",
    })
    .eq("status", "running")
    .lt("started_at", cutoff);

  if (error) {
    console.warn(`[parserRuns] Stale-run sweep failed: ${error.message}`);
  }
}
