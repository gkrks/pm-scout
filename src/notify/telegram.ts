/**
 * Telegram digest sender.
 *
 * Uses the tier-aware message builder from digest.ts.
 * `buildTelegramMessages` is kept as a named export so existing callers
 * (tests, scripts) continue to work unchanged.
 */

import { Job } from "../state";
import { buildTierTelegramMessages } from "./digest";
import { loadCompanyMetaMap } from "./labels";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunStats {
  runId:            string;
  startedAt:        Date;
  completedAt:      Date;
  companiesScanned: number;
  errors:           number;
}

// ── Public message builder (delegates to tier-aware implementation) ────────────

/**
 * Build a list of MarkdownV2 message strings split at 4 000 chars.
 * Tier 1 (early-career / APM) appears before Tier 2.
 */
export function buildTelegramMessages(newJobs: Job[], stats: RunStats): string[] {
  return buildTierTelegramMessages(newJobs, stats);
}

/**
 * Build Telegram messages with company metadata (category, domain tags, APM).
 * Used by sendTelegramDigest — loads config at send time.
 */
export function buildTelegramMessagesRich(newJobs: Job[], stats: RunStats): string[] {
  return buildTierTelegramMessages(newJobs, stats, loadCompanyMetaMap());
}

// ── Sender ────────────────────────────────────────────────────────────────────

/**
 * Send a Telegram digest for the current scan run.
 *
 * Env vars:
 *   NOTIFY_TELEGRAM_DIGEST=true
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_DIGEST_CHAT_ID  (falls back to TELEGRAM_CHAT_ID)
 *
 * No-ops if credentials are missing or there are no new jobs.
 * Errors are logged but do not throw — each notification channel is independent.
 */
export async function sendTelegramDigest(newJobs: Job[], stats: RunStats): Promise<void> {
  if (process.env.NOTIFY_TELEGRAM_DIGEST !== "true") return;

  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId =
    process.env.TELEGRAM_DIGEST_CHAT_ID ?? process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping");
    return;
  }
  if (newJobs.length === 0) {
    console.log("[telegram] No new jobs — digest skipped");
    return;
  }

  const messages = buildTelegramMessagesRich(newJobs, stats);

  for (const text of messages) {
    try {
      const resp = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            chat_id:                  chatId,
            text,
            parse_mode:               "MarkdownV2",
            disable_web_page_preview: false,
          }),
        },
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        console.error(`[telegram] sendMessage HTTP ${resp.status}: ${body}`);
      } else {
        console.log("[telegram] Digest message sent");
      }
    } catch (err) {
      console.error(
        `[telegram] sendMessage error: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
