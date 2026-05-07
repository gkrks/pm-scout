"use client";

import { cn } from "@/lib/utils";
import type { AllocationEntry } from "@/lib/types";

interface AllocationTrackerProps {
  allocation: AllocationEntry[];
  totalAssigned: number;
  targetTotal: number;
}

export function AllocationTracker({
  allocation,
  totalAssigned,
  targetTotal,
}: AllocationTrackerProps) {
  const pct = Math.min(100, Math.round((totalAssigned / targetTotal) * 100));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Bullet Allocation</h3>
        <span className="text-xs font-mono text-muted-foreground">
          {totalAssigned}/{targetTotal}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            pct >= 100
              ? "bg-teal-500"
              : pct >= 75
                ? "bg-indigo-500"
                : "bg-slate-400"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Source table */}
      {allocation.length > 0 && (
        <div className="space-y-1.5">
          {allocation.map((entry) => (
            <div
              key={entry.sourceId}
              className={cn(
                "flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs border",
                entry.bulletCount >= entry.maxBullets
                  ? "border-amber-200 bg-amber-50/50 dark:border-amber-800/40 dark:bg-amber-950/10"
                  : "border-border bg-card"
              )}
            >
              <span className="text-foreground truncate max-w-[140px]" title={entry.sourceLabel}>
                {entry.sourceLabel}
              </span>
              <span
                className={cn(
                  "font-mono shrink-0",
                  entry.bulletCount >= entry.maxBullets
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
                )}
              >
                {entry.bulletCount}/{entry.maxBullets}
              </span>
            </div>
          ))}
        </div>
      )}

      {allocation.length === 0 && (
        <p className="text-xs text-muted-foreground">No bullets assigned yet</p>
      )}
    </div>
  );
}
