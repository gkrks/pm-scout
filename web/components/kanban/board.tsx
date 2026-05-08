"use client";

import { useState, useCallback, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Search, Filter } from "lucide-react";
import { Column } from "./column";
import { JobCardOverlay } from "./job-card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { KANBAN_COLUMNS, type KanbanCard, type KanbanColumnId } from "@/lib/types";

interface BoardProps {
  cards: KanbanCard[];
  onMoveCard: (card: KanbanCard, toColumn: KanbanColumnId) => void;
}

type FilterChip = "apm" | "scored" | "remote" | "recent";

const FILTER_LABELS: Record<FilterChip, string> = {
  apm: "APM",
  scored: "Has Score",
  remote: "Remote",
  recent: "< 7 days",
};

export function Board({ cards, onMoveCard }: BoardProps) {
  const [activeCard, setActiveCard] = useState<KanbanCard | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<FilterChip>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Filter cards
  const filteredCards = useMemo(() => {
    let result = cards;

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.listing.title.toLowerCase().includes(q) ||
          c.listing.companyName.toLowerCase().includes(q)
      );
    }

    // Filter chips
    if (activeFilters.size > 0) {
      result = result.filter((c) => {
        if (activeFilters.has("apm") && !c.listing.hasApmProgram) return false;
        if (activeFilters.has("scored") && c.fitScore === null) return false;
        if (activeFilters.has("remote") && !c.listing.isRemote) return false;
        if (activeFilters.has("recent")) {
          const posted = c.listing.postedDate || c.listing.firstSeenAt;
          const daysDiff = Math.floor(
            (Date.now() - new Date(posted).getTime()) / (1000 * 60 * 60 * 24)
          );
          if (daysDiff > 7) return false;
        }
        return true;
      });
    }

    return result;
  }, [cards, searchQuery, activeFilters]);

  const cardsByColumn = useCallback(
    (columnId: KanbanColumnId) =>
      filteredCards.filter((c) => c.columnId === columnId),
    [filteredCards]
  );

  function toggleFilter(chip: FilterChip) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      return next;
    });
  }

  function handleDragStart(event: DragStartEvent) {
    const card = cards.find((c) => c.id === event.active.id);
    if (card) setActiveCard(card);
  }

  function handleDragOver(event: DragOverEvent) {
    // Visual feedback handled by column isOver state
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveCard(null);

    if (!over) return;

    const cardId = active.id as string;
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;

    // Determine target column
    let targetColumnId: KanbanColumnId | null = null;
    if (KANBAN_COLUMNS.some((col) => col.id === over.id)) {
      targetColumnId = over.id as KanbanColumnId;
    } else {
      const overCard = cards.find((c) => c.id === over.id);
      if (overCard) targetColumnId = overCard.columnId;
    }

    if (!targetColumnId || targetColumnId === card.columnId) return;

    onMoveCard(card, targetColumnId);
  }

  // Keyboard shortcut: "/" to focus search
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "/" && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      document.getElementById("kanban-search")?.focus();
    }
  }

  return (
    <div onKeyDown={handleKeyDown} tabIndex={-1} className="outline-none">
      {/* Search & Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-white/30" />
          <Input
            id="kanban-search"
            type="text"
            placeholder='Search jobs... (press "/")'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm bg-white/[0.06] border-white/[0.08] text-white/80 placeholder:text-white/25 focus:border-white/20"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-white/30" />
          {(Object.entries(FILTER_LABELS) as [FilterChip, string][]).map(
            ([key, label]) => (
              <button
                key={key}
                onClick={() => toggleFilter(key)}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-xs font-medium transition-all",
                  activeFilters.has(key)
                    ? "border-white/20 bg-white/10 text-white/80"
                    : "border-white/[0.06] text-white/40 hover:bg-white/[0.06] hover:text-white/60"
                )}
              >
                {label}
              </button>
            )
          )}
        </div>

        {(searchQuery || activeFilters.size > 0) && (
          <span className="text-xs text-white/30 tabular-nums">
            {filteredCards.length} of {cards.length}
          </span>
        )}
      </div>

      {/* Kanban columns */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-4 snap-x snap-mandatory md:snap-none">
          {KANBAN_COLUMNS.map((col) => (
            <div key={col.id} className="snap-start">
              <Column
                column={col}
                cards={cardsByColumn(col.id)}
              />
            </div>
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 150, easing: "ease" }}>
          {activeCard ? <JobCardOverlay card={activeCard} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
