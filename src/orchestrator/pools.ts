/**
 * Phase 5 — Two-pool concurrent executor.
 *
 * API pool  (concurrency 12) — Greenhouse, Lever, Ashby, Amazon, Workday
 * PW pool   (concurrency  3) — Google, Meta, custom-playwright
 *
 * Each pool uses a shared-queue worker pattern so workers pull companies as
 * they finish rather than all being scheduled upfront.  Budget is checked
 * before each dequeue: if the remaining runway is shorter than the per-company
 * timeout, the company and all remaining ones are marked 'skipped-budget'.
 *
 * Retry rules (from the build spec):
 *   Network error / ECONNRESET / 5xx  → 1 retry, 2 s backoff
 *   HTTP 429                          → 1 retry, 10 s backoff
 *   Playwright timeout / browser crash → 1 retry, 5 s backoff
 *   HTTP 4xx (401/403/404)            → no retry
 *   Parse error / selector miss       → no retry
 */

import type { CompanyConfig } from "../config/targets";
import type { Job } from "../state";
import { withTimeout } from "../lib/timeout";
import { RunBudget } from "./budget";
import {
  CompanyResult,
  classifyError,
  shouldRetry,
  retryDelayMs,
} from "./classify";
import { scrapeCompanyByConfig } from "../jobScraper";

// ── Pool constants ────────────────────────────────────────────────────────────

export const PLAYWRIGHT_ATS = new Set([
  "google-playwright",
  "meta-playwright",
  "custom-playwright",
]);

/** Per-platform timeout budget in ms. */
export const PER_COMPANY_TIMEOUT_MS: Record<string, number> = {
  greenhouse:          15_000,
  lever:               15_000,
  ashby:               15_000,
  smartrecruiters:     15_000,
  workable:            15_000,
  bamboohr:            15_000,
  amazon:              15_000,
  workday:             25_000,
  "google-playwright": 60_000,
  "meta-playwright":   60_000,
  "custom-playwright": 60_000,
};

export const API_CONCURRENCY       = 12;
export const PLAYWRIGHT_CONCURRENCY =  3;

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getTimeoutMs(ats: string): number {
  return PER_COMPANY_TIMEOUT_MS[ats] ?? 15_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Per-company scrape with retry ─────────────────────────────────────────────

async function scrapeWithRetry(
  company:   CompanyConfig,
  baselines: Map<string, number>,
): Promise<{ jobs: Job[]; status: "ok" | "suspicious" }> {
  const timeoutMs = getTimeoutMs(company.ats);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const jobs = await withTimeout(
        scrapeCompanyByConfig(company),
        timeoutMs,
        company.name,
      );
      // Cap at 200 results to guard against misconfigured queries
      const capped = jobs.length > 200 ? jobs.slice(0, 200) : jobs;
      if (jobs.length > 200) {
        console.warn(
          `[pools] ${company.name}: capped ${jobs.length} → 200 results (check query config)`,
        );
      }
      const baseline = baselines.get(company.id ?? "") ?? 0;
      const status   = capped.length === 0 && baseline >= 3 ? "suspicious" : "ok";
      return { jobs: capped, status };
    } catch (err) {
      const errInfo = classifyError(err);
      if (!shouldRetry(errInfo, attempt)) throw err;
      const delay = retryDelayMs(errInfo);
      console.warn(
        `[pools] ${company.name}: ${errInfo.message} — retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
  // Unreachable — last attempt always throws
  throw new Error(`${company.name}: all retry attempts exhausted`);
}

// ── Pool runner ───────────────────────────────────────────────────────────────

/**
 * Run a pool of companies using N concurrent workers sharing a queue.
 * Each worker checks the run budget before dequeuing the next company.
 */
export async function runPool(
  companies:   CompanyConfig[],
  concurrency: number,
  budget:      RunBudget,
  baselines:   Map<string, number>,
  onResult:    (r: CompanyResult) => void,
): Promise<void> {
  if (companies.length === 0) return;

  // Shared mutable queue — safe because JS is single-threaded
  const queue = [...companies];

  const worker = async (): Promise<void> => {
    while (true) {
      const company = queue.shift();
      if (!company) break;

      const timeoutMs = getTimeoutMs(company.ats);

      // Budget exhausted — mark this company and drain the rest
      if (!budget.hasRoomFor(timeoutMs)) {
        const skipped: CompanyResult = {
          companyId:  company.id ?? "",
          slug:       company.slug ?? company.name,
          name:       company.name,
          careersUrl: company.careersUrl,
          ats:        company.ats,
          status:     "skipped-budget",
          jobs:       [],
          error:      { type: "error", message: "Run budget exhausted" },
          durationMs: 0,
        };
        onResult(skipped);

        // Drain remaining queue as skipped-budget
        let remaining: CompanyConfig | undefined;
        while ((remaining = queue.shift()) !== undefined) {
          onResult({
            companyId:  remaining.id ?? "",
            slug:       remaining.slug ?? remaining.name,
            name:       remaining.name,
            careersUrl: remaining.careersUrl,
            ats:        remaining.ats,
            status:     "skipped-budget",
            jobs:       [],
            error:      { type: "error", message: "Run budget exhausted" },
            durationMs: 0,
          });
        }
        break;
      }

      const t0 = Date.now();
      try {
        const { jobs, status } = await scrapeWithRetry(company, baselines);
        const durationMs = Date.now() - t0;
        onResult({
          companyId:  company.id ?? "",
          slug:       company.slug ?? company.name,
          name:       company.name,
          careersUrl: company.careersUrl,
          ats:        company.ats,
          status,
          jobs,
          durationMs,
        });
        if (jobs.length > 0) {
          console.log(
            `[pools] ${company.name}: ${jobs.length} job(s) [${company.ats}, ${Math.round(durationMs / 100) / 10}s]`,
          );
        } else if (status === "suspicious") {
          console.warn(`[pools] ${company.name}: 0 jobs (suspicious — baseline ≥ 3)`);
        }
      } catch (err) {
        const errInfo    = classifyError(err);
        const durationMs = Date.now() - t0;
        const status     = errInfo.type === "timeout" ? "timeout" : "error";
        console.error(
          `[pools] ${company.name}: ${status} — ${errInfo.message}`,
        );
        onResult({
          companyId:  company.id ?? "",
          slug:       company.slug ?? company.name,
          name:       company.name,
          careersUrl: company.careersUrl,
          ats:        company.ats,
          status,
          jobs:       [],
          error:      errInfo,
          durationMs,
        });
      }
    }
  };

  // Spin up min(concurrency, companies.length) workers
  await Promise.all(
    Array.from({ length: Math.min(concurrency, companies.length) }, worker),
  );
}
