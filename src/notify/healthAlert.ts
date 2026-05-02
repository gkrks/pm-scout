/**
 * Phase 5 — Telegram health alert.
 *
 * Sent after each scan when any company has status 'error', 'timeout', or
 * 'suspicious'. Skipped-budget and manual-skipped companies are shown for
 * context but do not trigger the alert by themselves.
 *
 * Env vars:
 *   NOTIFY_TELEGRAM_HEALTH=true
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_HEALTH_CHAT_ID   (falls back to TELEGRAM_CHAT_ID)
 */

import type { CompanyResult } from "../orchestrator/classify";
import { recordHealthEvent, clearHealthEvent } from "./healthState";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  const s = Math.round(ms / 1_000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ── Alert predicate ───────────────────────────────────────────────────────────

/** True when any company result warrants a health alert. */
export function hasHealthIssues(results: CompanyResult[]): boolean {
  return results.some(
    (r) => r.status === "error" || r.status === "timeout" || r.status === "suspicious",
  );
}

// ── Dedup filter ──────────────────────────────────────────────────────────────

/**
 * Process all results through the health-state dedup layer.
 * Returns the subset that should actually be included in the alert.
 */
export function filterAlertableResults(results: CompanyResult[]): {
  alertable:  CompanyResult[];
  suppressed: number;
} {
  const alertable: CompanyResult[] = [];
  let suppressed = 0;

  for (const r of results) {
    if (r.status === "ok") {
      clearHealthEvent(r.slug);
      continue;
    }
    // skipped/skipped-budget are shown for context but never trigger dedup
    if (r.status === "skipped" || r.status === "skipped-budget") continue;

    const shouldAlert = recordHealthEvent(r.slug, r.status);
    if (shouldAlert) {
      alertable.push(r);
    } else {
      suppressed++;
    }
  }

  return { alertable, suppressed };
}

// ── Message builder ───────────────────────────────────────────────────────────

export function buildHealthAlertText(
  alertable:  CompanyResult[],
  allResults: CompanyResult[],
  runDurationMs: number,
): string {
  const errors    = alertable.filter((r) => r.status === "error");
  const timeouts  = alertable.filter((r) => r.status === "timeout");
  const suspicious = alertable.filter((r) => r.status === "suspicious");
  const skipped   = allResults.filter(
    (r) => r.status === "skipped" || r.status === "skipped-budget",
  );

  const total  = allResults.length;
  const issues = errors.length + timeouts.length + suspicious.length;
  const runAt  = new Date().toISOString().slice(11, 16) + " UTC";

  const lines: string[] = [
    `⚠️ Scraper health: ${issues}/${total} issues — run ${runAt}, ${fmtMs(runDurationMs)}`,
    "",
  ];

  if (errors.length > 0) {
    lines.push(`❌ Errors (${errors.length})`);
    for (const r of errors) {
      lines.push(`• ${r.name} — ${r.error?.message ?? "unknown error"}`);
    }
    lines.push("");
  }

  if (timeouts.length > 0) {
    lines.push(`⏱ Timeouts (${timeouts.length})`);
    for (const r of timeouts) {
      lines.push(`• ${r.name} — ${r.error?.message ?? "timeout"} (after 1 retry)`);
    }
    lines.push("");
  }

  if (suspicious.length > 0) {
    lines.push(`🟡 Suspicious — zero jobs but baseline ≥ 3 (${suspicious.length})`);
    for (const r of suspicious) {
      lines.push(`• ${r.name} — 0 found, selector may be broken`);
    }
    lines.push("");
  }

  if (skipped.length > 0) {
    lines.push(
      `⏭ Skipped (${skipped.length}) — ats: 'manual' or unmapped, see ats_routing.json`,
    );
  }

  return lines.join("\n").trimEnd();
}

// ── Sender ────────────────────────────────────────────────────────────────────

/**
 * Send a Telegram health alert.
 * No-ops if NOTIFY_TELEGRAM_HEALTH !== 'true' or no issues to report.
 * Errors are logged but do not throw.
 */
export async function sendHealthAlert(
  results:      CompanyResult[],
  runDurationMs: number,
): Promise<void> {
  if (process.env.NOTIFY_TELEGRAM_HEALTH !== "true") return;
  if (!hasHealthIssues(results)) return;

  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId =
    process.env.TELEGRAM_HEALTH_CHAT_ID ?? process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn(
      "[healthAlert] TELEGRAM_BOT_TOKEN or TELEGRAM_HEALTH_CHAT_ID not set — skipping",
    );
    return;
  }

  const { alertable, suppressed } = filterAlertableResults(results);

  if (alertable.length === 0) {
    if (suppressed > 0) {
      console.log(
        `[healthAlert] All ${suppressed} issue(s) muted by dedup — no alert sent`,
      );
    }
    return;
  }

  const text = buildHealthAlertText(alertable, results, runDurationMs);

  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          chat_id:                  chatId,
          text,
          disable_web_page_preview: true,
        }),
      },
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(`[healthAlert] sendMessage HTTP ${resp.status}: ${body}`);
    } else {
      console.log(
        `[healthAlert] Sent (${alertable.length} issue(s), ${suppressed} suppressed)`,
      );
    }
  } catch (err) {
    console.error(
      `[healthAlert] Send error: ${err instanceof Error ? err.message : err}`,
    );
  }
}
