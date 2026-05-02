/**
 * Phase 4 — Pending-run buffer for Supabase outages.
 *
 * When Supabase is unreachable during a scan, the run's results are serialized
 * to data/pending-supabase.json. On the next run, if Supabase is back, pending
 * buffers are replayed in order and then deleted.
 *
 * Buffer format: one JSON file; entries are appended as an array so multiple
 * failed runs accumulate and are replayed in chronological order.
 *
 * The notification system uses in-memory results and is unaffected by buffering.
 */

import * as fs from "fs";
import * as path from "path";
import { getSupabaseClient } from "./supabase";
import { upsertCompanyListings, type ListingToUpsert } from "./upsertListing";
import { deactivateUnseen } from "./deactivateUnseen";
import { startParserRun, finalizeParserRun, type ParserRunSummary } from "./parserRuns";
import { normalizeRoleUrl } from "../lib/normalizeUrl";

// ── Constants ─────────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve("data");
const BUFFER_PATH = path.join(DATA_DIR, "pending-supabase.json");

// ── Buffer types ──────────────────────────────────────────────────────────────

/** Serializable form of a ListingToUpsert (drops non-serializable method refs). */
export interface BufferedListing {
  companyId: string;
  companySlug: string;
  companyName: string;
  companyDomainTags: string[];
  companyTargetRoles: string[];
  companyHasApmProgram: boolean;
  job: {
    title: string;
    role_url: string;
    location_raw: string;
    posted_date: string | null;
    description?: string;
  };
  enrichment: {
    location_city: string | null;
    is_remote: boolean;
    is_hybrid: boolean;
    yoe_min: number | null;
    yoe_max: number | null;
    yoe_raw: string | null;
    experience_confidence: "extracted" | "inferred-junior";
    is_new_grad_language: boolean;
    freshness_confidence: "known" | "unknown";
    posted_within_7_days: boolean;
    posted_within_30_days: boolean;
    sponsorship_offered: boolean | null;
    requires_sponsorship_unclear: boolean;
    salary_min: number | null;
    salary_max: number | null;
    salary_currency: string | null;
  };
  tier: 1 | 2 | 3;
}

export interface PendingRunBuffer {
  runId: string;
  bufferedAt: string;
  runStartedAt: string;
  configVersion: string | undefined;
  configHash: string | undefined;
  /** company IDs successfully scraped this run (used for deactivation on replay). */
  successfulCompanyIds: string[];
  listings: BufferedListing[];
  summary: ParserRunSummary;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Append a failed run to the pending buffer file.
 * Creates the file (or appends to the array) atomically via write + rename.
 */
export function bufferRun(run: PendingRunBuffer): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  let existing: PendingRunBuffer[] = [];
  if (fs.existsSync(BUFFER_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(BUFFER_PATH, "utf8")) as PendingRunBuffer[];
    } catch {
      console.warn("[pendingBuffer] Could not parse existing buffer; starting fresh.");
    }
  }

  existing.push(run);

  const tmp = `${BUFFER_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(existing, null, 2), "utf8");
  fs.renameSync(tmp, BUFFER_PATH);

  console.log(`[pendingBuffer] Buffered run ${run.runId} → ${BUFFER_PATH}`);
}

/**
 * Check if Supabase is reachable (lightweight ping).
 * Returns true on success, false on any error.
 */
export async function isSupabaseReachable(): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("parser_runs")
      .select("id")
      .limit(1);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Replay all buffered runs in order.
 * On success, clears the buffer file.
 * On partial failure, leaves the file intact (the next run will retry).
 */
export async function replayPendingBuffer(): Promise<void> {
  if (!fs.existsSync(BUFFER_PATH)) return;

  let pending: PendingRunBuffer[] = [];
  try {
    pending = JSON.parse(fs.readFileSync(BUFFER_PATH, "utf8")) as PendingRunBuffer[];
  } catch {
    console.warn("[pendingBuffer] Could not parse pending buffer — skipping replay.");
    return;
  }

  if (pending.length === 0) {
    fs.unlinkSync(BUFFER_PATH);
    return;
  }

  console.log(`[pendingBuffer] Replaying ${pending.length} buffered run(s)…`);

  const replayed: string[] = [];

  for (const buffered of pending) {
    try {
      await replayOne(buffered);
      replayed.push(buffered.runId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[pendingBuffer] Replay of run ${buffered.runId} failed: ${msg}`);
      // Leave remaining entries in the buffer for the next run.
      break;
    }
  }

  if (replayed.length === 0) return;

  // Remove successfully replayed entries.
  const remaining = pending.filter((r) => !replayed.includes(r.runId));
  if (remaining.length === 0) {
    fs.unlinkSync(BUFFER_PATH);
    console.log("[pendingBuffer] All pending runs replayed — buffer cleared.");
  } else {
    fs.writeFileSync(BUFFER_PATH, JSON.stringify(remaining, null, 2), "utf8");
    console.log(
      `[pendingBuffer] ${replayed.length} replayed; ${remaining.length} still pending.`,
    );
  }
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function replayOne(buffered: PendingRunBuffer): Promise<void> {
  const runId = await startParserRun(buffered.configVersion, buffered.configHash);

  // Group listings by company.
  const byCompany = new Map<string, BufferedListing[]>();
  for (const bl of buffered.listings) {
    if (!byCompany.has(bl.companyId)) byCompany.set(bl.companyId, []);
    byCompany.get(bl.companyId)!.push(bl);
  }

  let totalNew = 0;
  let totalUpdated = 0;
  let totalDeactivated = 0;

  const runStartedAt = new Date(buffered.runStartedAt);

  for (const [companyId, bls] of byCompany) {
    // Deduplicate by normalized role_url within each company — first occurrence wins.
    const seenUrls = new Set<string>();
    const dedupedBls = bls.filter((bl) => {
      const normalized = normalizeRoleUrl(bl.job.role_url);
      if (seenUrls.has(normalized)) return false;
      seenUrls.add(normalized);
      return true;
    });

    const listingsToUpsert: ListingToUpsert[] = dedupedBls.map((bl) => ({
      job: bl.job,
      company: {
        id: bl.companyId,
        slug: bl.companySlug,
        name: bl.companyName,
        careers_url: "",
        domain_tags: bl.companyDomainTags,
        target_roles: bl.companyTargetRoles,
        has_apm_program: bl.companyHasApmProgram,
      },
      enrichment: bl.enrichment,
      tier: bl.tier,
    }));

    const upserted = await upsertCompanyListings(companyId, listingsToUpsert, runId);

    for (const r of upserted) {
      if (r.seenState === "new") totalNew++;
      else totalUpdated++;
    }

    if (buffered.successfulCompanyIds.includes(companyId)) {
      totalDeactivated += await deactivateUnseen(companyId, runStartedAt);
    }
  }

  await finalizeParserRun(runId, {
    ...buffered.summary,
    listingsNew: totalNew,
    listingsUpdated: totalUpdated,
    listingsDeactivated: totalDeactivated,
    notes: `Replayed from buffer (original run: ${buffered.runId})`,
  });

  console.log(`[pendingBuffer] Replayed run ${buffered.runId} as new run ${runId}`);
}
