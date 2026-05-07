"use client";

import { Board } from "@/components/kanban/board";
import { Skeleton } from "@/components/ui/skeleton";
import { useKanbanCards, useMoveCard } from "@/hooks/use-kanban";
import type { KanbanCard, KanbanColumnId } from "@/lib/types";

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="w-[280px] shrink-0 rounded-2xl bg-white/[0.03] p-4">
          <Skeleton className="mb-4 h-4 w-20 bg-white/10" />
          {Array.from({ length: i < 2 ? 3 : 2 }).map((_, j) => (
            <Skeleton key={j} className="mb-2 h-20 w-full rounded-xl bg-white/[0.06]" />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function TrackerPage() {
  const { data: cards, isLoading, error } = useKanbanCards();
  const moveCard = useMoveCard();

  function handleMoveCard(card: KanbanCard, toColumn: KanbanColumnId) {
    moveCard.mutate({ card, toColumn });
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 dark:from-black dark:via-slate-950 dark:to-black">
      <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-white/90">
            Application Tracker
          </h1>
          <p className="mt-1 text-sm text-white/40">
            Drag cards between columns to update your application status.
          </p>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center backdrop-blur-sm">
            <p className="text-sm font-medium text-red-400">
              Failed to load board data
            </p>
            <p className="mt-1 text-xs text-white/40">
              {error instanceof Error ? error.message : "Unknown error"}.
              Make sure the Express server is running on :3847.
            </p>
          </div>
        ) : isLoading || !cards ? (
          <BoardSkeleton />
        ) : (
          <div className="h-[calc(100vh-180px)]">
            <Board cards={cards} onMoveCard={handleMoveCard} />
          </div>
        )}
      </div>
    </div>
  );
}
