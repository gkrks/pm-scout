/**
 * Phase 4 — Deactivate job listings not seen in the current run.
 *
 * After all listings for a company have been upserted (last_seen_at = now()),
 * any listing whose last_seen_at is still before run.started_at was NOT seen
 * this run and should be marked inactive.
 *
 * CRITICAL: Only call this for companies that were SUCCESSFULLY scraped.
 * Do NOT call for timed-out or errored companies — their listings would vanish
 * from the active set incorrectly.
 *
 * The closed_at timestamp is set automatically by the DB trigger
 * trg_listings_closed_at when is_active flips from true → false.
 */

import { getSupabaseClient } from "./supabase";

/**
 * Mark as inactive all job_listings for the given company whose
 * last_seen_at is before runStartedAt.
 *
 * @returns Number of rows deactivated.
 */
export async function deactivateUnseen(
  companyId: string,
  runStartedAt: Date,
): Promise<number> {
  const supabase = getSupabaseClient();

  // Fetch IDs of stale active listings first so we can return a count.
  // (Supabase REST doesn't return affected row count directly from UPDATE.)
  const { data: stale, error: fetchErr } = await supabase
    .from("job_listings")
    .select("id")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .lt("last_seen_at", runStartedAt.toISOString());

  if (fetchErr) {
    console.warn(
      `[deactivateUnseen] Could not fetch stale listings for ${companyId}: ${fetchErr.message}`,
    );
    return 0;
  }

  if (!stale || stale.length === 0) return 0;

  const ids = stale.map((r) => r.id as string);

  const { error: updateErr } = await supabase
    .from("job_listings")
    .update({ is_active: false })
    .in("id", ids);

  if (updateErr) {
    console.warn(
      `[deactivateUnseen] Failed to deactivate ${ids.length} listings for ${companyId}: ${updateErr.message}`,
    );
    return 0;
  }

  return ids.length;
}

/**
 * Bulk version: deactivate unseen listings for multiple companies in sequence.
 * Returns the total count of deactivated listings across all companies.
 */
export async function deactivateUnseenBulk(
  companyIds: string[],
  runStartedAt: Date,
): Promise<number> {
  let total = 0;
  for (const companyId of companyIds) {
    total += await deactivateUnseen(companyId, runStartedAt);
  }
  return total;
}
