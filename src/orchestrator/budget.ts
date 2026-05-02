/**
 * Phase 5 — Run budget enforcement.
 *
 * Each scan has a hard ceiling (default 9 min). Before handing a company to a
 * worker pool, check whether there is enough runway left for that company's
 * per-platform timeout. If not, mark the remainder as 'skipped-budget'.
 */

export const DEFAULT_RUN_BUDGET_MS = 9 * 60_000; // 9 minutes

export class RunBudget {
  private readonly startMs: number;
  private readonly budgetMs: number;

  constructor(budgetMs = DEFAULT_RUN_BUDGET_MS) {
    this.startMs  = Date.now();
    this.budgetMs = budgetMs;
  }

  /** True when the elapsed time + perCompanyTimeoutMs fits within the budget. */
  hasRoomFor(perCompanyTimeoutMs: number): boolean {
    return this.elapsedMs() + perCompanyTimeoutMs < this.budgetMs;
  }

  elapsedMs(): number {
    return Date.now() - this.startMs;
  }

  elapsedFormatted(): string {
    const s = Math.round(this.elapsedMs() / 1_000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }
}
