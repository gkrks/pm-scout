/**
 * Phase 5 — Per-company status classification and retry policy.
 *
 * Status values (from the build spec):
 *   ok           — scrape succeeded (may have 0 results legitimately)
 *   suspicious   — ok AND jobs === 0 AND baseline_30d >= 3
 *   timeout      — scrape threw a timeout error
 *   error        — any other scrape error
 *   skipped      — ats: 'manual' or unmapped; not alerted on every run
 *   skipped-budget — run budget exhausted before this company was attempted
 */

import type { Job } from "../state";

export type CompanyStatus =
  | "ok"
  | "suspicious"
  | "timeout"
  | "error"
  | "skipped"
  | "skipped-budget";

export interface ErrorInfo {
  /** Broad error category used for health-alert dedup. */
  type: "timeout" | "http-4xx" | "http-429" | "network" | "error";
  message: string;
  httpStatus?: number;
}

export interface CompanyResult {
  companyId:  string;
  slug:       string;
  name:       string;
  careersUrl: string;
  ats:        string;
  status:     CompanyStatus;
  jobs:       Job[];
  error?:     ErrorInfo;
  durationMs: number;
}

// ── Error classification ──────────────────────────────────────────────────────

/** Turn a caught error into a structured ErrorInfo. */
export function classifyError(err: unknown): ErrorInfo {
  const msg = err instanceof Error ? err.message : String(err);

  if (/timeout \d+ms/i.test(msg)) {
    return { type: "timeout", message: msg };
  }
  if (msg.includes("429") || /rate.?limit/i.test(msg)) {
    return { type: "http-429", message: msg, httpStatus: 429 };
  }
  const http4xx = msg.match(/HTTP (4\d{2})/);
  if (http4xx) {
    return { type: "http-4xx", message: msg, httpStatus: parseInt(http4xx[1], 10) };
  }
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network/i.test(msg)) {
    return { type: "network", message: msg };
  }
  return { type: "error", message: msg };
}

// ── Retry policy ──────────────────────────────────────────────────────────────

/** Returns true when a retry should be attempted (max 1 retry per company). */
export function shouldRetry(errInfo: ErrorInfo, attempt: number): boolean {
  if (attempt >= 1) return false;              // already retried once
  if (errInfo.type === "http-4xx") return false; // 401/403/404 — no point retrying
  return true; // timeout, 429, network, 5xx, browser crash → retry once
}

/** Backoff in ms before the retry attempt. */
export function retryDelayMs(errInfo: ErrorInfo): number {
  if (errInfo.type === "http-429") return 10_000;
  if (errInfo.type === "timeout")  return  5_000;
  return 2_000;
}
