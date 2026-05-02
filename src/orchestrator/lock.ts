/**
 * Phase 5 — Process-level run lock.
 *
 * Prevents two overlapping scans when a run exceeds the hourly cron interval.
 * Uses both an in-process boolean and a lock file so cross-restart detection
 * is possible (the file persists, the boolean resets on restart).
 */

import * as fs from "fs";

export const LOCK_FILE = "data/.scan-lock";

let _runInProgress = false;

/**
 * Attempt to acquire the lock.
 * Returns true if the lock was acquired; false if another run is in progress.
 */
export function acquireLock(runId: string): boolean {
  if (_runInProgress) return false;
  try {
    fs.mkdirSync("data", { recursive: true });
    // "wx" flag: create exclusively — fails if file already exists
    fs.writeFileSync(LOCK_FILE, `${process.pid}:${runId}`, { flag: "wx" });
  } catch {
    return false; // lock file already exists → another process holds it
  }
  _runInProgress = true;
  return true;
}

/** Release the lock. Always call in a finally block. */
export function releaseLock(): void {
  _runInProgress = false;
  try { fs.unlinkSync(LOCK_FILE); } catch { /* already gone — no-op */ }
}
