/**
 * Phase 5 — Health alert dedup state.
 *
 * Tracks per-company consecutive failure counts so that the health alert is
 * suppressed after 3 consecutive identical errors and auto-unmuted after 24 h.
 *
 * State file: data/health_state.json
 */

import * as fs from "fs";

const HEALTH_STATE_FILE    = "data/health_state.json";
const MUTE_AFTER_COUNT     = 3;   // suppress from the 3rd consecutive occurrence onward
const MUTE_DURATION_MS     = 24 * 60 * 60 * 1_000; // 24 hours

export interface CompanyHealthEntry {
  lastErrorType:    string;
  consecutiveCount: number;
  mutedUntil?:      string; // ISO timestamp; absent when not muted
}

export type HealthState = Record<string, CompanyHealthEntry>;

// ── Internal I/O ──────────────────────────────────────────────────────────────

function readState(): HealthState {
  try {
    return JSON.parse(fs.readFileSync(HEALTH_STATE_FILE, "utf-8")) as HealthState;
  } catch {
    return {};
  }
}

function writeState(state: HealthState): void {
  try {
    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync(HEALTH_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn(
      `[healthState] Failed to persist state: ${e instanceof Error ? e.message : e}`,
    );
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record a health event for a company and decide whether to send an alert.
 *
 * Returns true  → caller should send an alert.
 * Returns false → alert is muted; suppress it.
 *
 * Muting behaviour:
 *   - Alert on the 1st and 2nd consecutive occurrence.
 *   - From the 3rd occurrence onward: set mutedUntil = now + 24 h, suppress.
 *   - Auto-unmute after 24 h.
 *   - A different errorType resets the counter and always alerts.
 */
export function recordHealthEvent(slug: string, errorType: string): boolean {
  const state = readState();
  const prev  = state[slug] ?? { lastErrorType: "", consecutiveCount: 0 };
  const now   = Date.now();

  // Still within mute window with the same error type → suppress
  if (
    prev.mutedUntil &&
    new Date(prev.mutedUntil).getTime() > now &&
    prev.lastErrorType === errorType
  ) {
    state[slug] = { ...prev, consecutiveCount: prev.consecutiveCount + 1 };
    writeState(state);
    return false;
  }

  // Reset count if error type changed; otherwise increment
  const newCount =
    prev.lastErrorType === errorType ? prev.consecutiveCount + 1 : 1;

  // Mute from the Nth occurrence onward
  const mutedUntil: string | undefined =
    newCount >= MUTE_AFTER_COUNT
      ? new Date(now + MUTE_DURATION_MS).toISOString()
      : undefined;

  state[slug] = { lastErrorType: errorType, consecutiveCount: newCount, mutedUntil };
  writeState(state);

  // Alert on occurrences 1 and 2; suppress from 3 onward
  return newCount < MUTE_AFTER_COUNT;
}

/**
 * Clear health tracking for a company that has recovered (status = 'ok').
 */
export function clearHealthEvent(slug: string): void {
  const state = readState();
  if (slug in state) {
    delete state[slug];
    writeState(state);
  }
}
