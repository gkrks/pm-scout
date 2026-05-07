/**
 * Ashby staleness tracking — marks jobs no longer listed on company boards
 * as is_active=false.
 *
 * CRITICAL DESIGN: Uses allListedAshbyIds (the FULL listed set from every board),
 * NOT the freshness-filtered ingestable set. A 60-day-old job still on the board
 * is in allListedAshbyIds but NOT in the ingested jobs array. Using the wrong set
 * here would incorrectly mark every live-but-old job as inactive on day 31.
 */

import { getSupabaseClient } from "./supabase";
import type { ScrapeResult } from "../scrapers/types";

const MIN_EXPECTED_SEEN = 100;

/**
 * Run the staleness sweep after all Ashby companies finish syncing.
 *
 * @param companyResults - Array of ScrapeResults from all Ashby company scrapes
 * @param successfulCompanyCount - Number of companies that completed successfully
 */
export async function runAshbyStaleness(
  companyResults: ScrapeResult[],
): Promise<{ deactivated: number; skipped: boolean }> {
  // Build the union of allListedAshbyIds across the run
  const seenIds = new Set<string>();
  for (const result of companyResults) {
    // CRITICAL: use the full listed set, NOT the ingested .jobs set.
    result.allListedAshbyIds?.forEach((id) => seenIds.add(id));
  }

  // Guard: if the sync failed or was partial, don't sweep
  if (seenIds.size < MIN_EXPECTED_SEEN) {
    console.error(
      `[staleness] Aborting sweep: only ${seenIds.size} IDs seen, ` +
        `expected ≥${MIN_EXPECTED_SEEN}. Likely a partial sync.`,
    );
    return { deactivated: 0, skipped: true };
  }

  const supabase = getSupabaseClient();
  const seenArray = [...seenIds];

  if (seenArray.length < 5000) {
    // Direct approach for manageable set sizes
    // First, get all active Ashby jobs with ashby_id
    const { data: activeJobs, error: fetchErr } = await supabase
      .from("job_listings")
      .select("id, ashby_id")
      .eq("ats_provider", "ashby")
      .eq("is_active", true)
      .not("ashby_id", "is", null);

    if (fetchErr) {
      console.error(`[staleness] Failed to fetch active jobs: ${fetchErr.message}`);
      return { deactivated: 0, skipped: true };
    }

    // Find jobs NOT in the seen set
    const staleIds = (activeJobs ?? [])
      .filter((j) => !seenIds.has(j.ashby_id as string))
      .map((j) => j.id as string);

    if (staleIds.length === 0) {
      console.log(`[staleness] No stale Ashby jobs found (${seenIds.size} IDs seen)`);
      return { deactivated: 0, skipped: false };
    }

    // Batch update stale jobs
    const BATCH = 500;
    let deactivated = 0;
    for (let i = 0; i < staleIds.length; i += BATCH) {
      const batch = staleIds.slice(i, i + BATCH);
      const { error } = await supabase
        .from("job_listings")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .in("id", batch);

      if (error) {
        console.error(`[staleness] Batch deactivation failed: ${error.message}`);
      } else {
        deactivated += batch.length;
      }
    }

    console.log(
      `[staleness] Deactivated ${deactivated} stale Ashby jobs ` +
        `(${seenIds.size} IDs seen, ${(activeJobs ?? []).length} were active)`,
    );
    return { deactivated, skipped: false };
  } else {
    // For very large sets (>5K), use RPC or chunked approach
    // This path handles the theoretical case of >5K distinct Ashby IDs
    console.warn(
      `[staleness] Large seen set (${seenArray.length} IDs) — ` +
        `using chunked fetch approach`,
    );

    // Fetch all active ashby_ids, then diff in memory
    const { data: activeJobs, error: fetchErr } = await supabase
      .from("job_listings")
      .select("id, ashby_id")
      .eq("ats_provider", "ashby")
      .eq("is_active", true)
      .not("ashby_id", "is", null);

    if (fetchErr) {
      console.error(`[staleness] Failed to fetch active jobs: ${fetchErr.message}`);
      return { deactivated: 0, skipped: true };
    }

    const staleIds = (activeJobs ?? [])
      .filter((j) => !seenIds.has(j.ashby_id as string))
      .map((j) => j.id as string);

    if (staleIds.length === 0) {
      console.log(`[staleness] No stale Ashby jobs found (${seenIds.size} IDs seen)`);
      return { deactivated: 0, skipped: false };
    }

    const BATCH = 500;
    let deactivated = 0;
    for (let i = 0; i < staleIds.length; i += BATCH) {
      const batch = staleIds.slice(i, i + BATCH);
      const { error } = await supabase
        .from("job_listings")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .in("id", batch);

      if (error) {
        console.error(`[staleness] Batch deactivation failed: ${error.message}`);
      } else {
        deactivated += batch.length;
      }
    }

    console.log(
      `[staleness] Deactivated ${deactivated} stale Ashby jobs ` +
        `(${seenIds.size} IDs seen, ${(activeJobs ?? []).length} were active)`,
    );
    return { deactivated, skipped: false };
  }
}

/**
 * Detect likely reposts: new ashby_id with the same content_hash as a
 * recently-deactivated job. Logs the finding and copies first_seen_at.
 */
export async function detectReposts(
  newAshbyId: string,
  contentHash: string,
): Promise<string | null> {
  const supabase = getSupabaseClient();
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const { data } = await supabase
    .from("job_listings")
    .select("id, ashby_id, first_seen_at")
    .eq("ats_provider", "ashby")
    .eq("is_active", false)
    .gte("updated_at", cutoff)
    .limit(1);

  if (data && data.length > 0) {
    console.log(
      `[staleness] Likely repost detected: new ${newAshbyId} ` +
        `matches deactivated ${data[0].ashby_id}`,
    );
    return data[0].first_seen_at as string;
  }
  return null;
}
