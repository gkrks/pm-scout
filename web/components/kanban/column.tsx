"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "@/components/shared/empty-state";
import { JobCard } from "./job-card";
import { cn } from "@/lib/utils";
import type { KanbanCard, KanbanColumnDef } from "@/lib/types";
import { useState } from "react";

interface ColumnProps {
  column: KanbanColumnDef;
  cards: KanbanCard[];
}

export function Column({ column, cards }: ColumnProps) {
  const [collapsed, setCollapsed] = useState(column.collapsed ?? false);
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const cardIds = cards.map((c) => c.id);

  if (collapsed) {
    return (
      <div className="flex h-full w-11 shrink-0 flex-col items-center rounded-2xl bg-white/5 dark:bg-white/[0.03] backdrop-blur-md py-4 border border-white/10">
        <button
          onClick={() => setCollapsed(false)}
          className="flex flex-col items-center gap-3"
          aria-label={`Expand ${column.label} column`}
        >
          <ChevronRight className="h-4 w-4 text-white/40" />
          <span className="text-[11px] font-medium text-white/50 [writing-mode:vertical-lr]">
            {column.label}
          </span>
          <span className={cn("text-[10px] font-bold rounded-full px-1.5 py-0.5", column.countBg)}>
            {cards.length}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full w-[280px] shrink-0 flex-col rounded-2xl transition-all duration-200 overflow-hidden",
        "bg-white/[0.04] dark:bg-white/[0.03] backdrop-blur-md border border-white/[0.08]",
        isOver && "border-white/20 bg-white/[0.08]"
      )}
    >
      {/* Column header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={cn("h-2 w-2 rounded-full shadow-lg", column.dot)} />
            <h3 className="text-[13px] font-semibold text-foreground/90 tracking-tight">
              {column.label}
            </h3>
            <span className="text-[11px] font-medium text-muted-foreground/60 tabular-nums">
              {cards.length}
            </span>
          </div>
          {column.collapsed !== undefined && (
            <button
              onClick={() => setCollapsed(true)}
              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              aria-label={`Collapse ${column.label}`}
            >
              <ChevronRight className="h-3.5 w-3.5 rotate-180" />
            </button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 px-2 pb-2">
        <SortableContext
          id={column.id}
          items={cardIds}
          strategy={verticalListSortingStrategy}
        >
          <div ref={setNodeRef} className="flex min-h-[60px] flex-col gap-1.5">
            {cards.length === 0 ? (
              <EmptyState
                title="No jobs here"
                description="Drag a card to this column"
              />
            ) : (
              cards.map((card) => (
                <JobCard key={card.id} card={card} stageGradient={column.gradient} />
              ))
            )}
          </div>
        </SortableContext>
      </ScrollArea>
    </div>
  );
}
