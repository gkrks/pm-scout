"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ExternalLink, MapPin, FileSearch } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { KanbanCard } from "@/lib/types";

interface JobCardProps {
  card: KanbanCard;
  overlay?: boolean;
  stageGradient?: string;
}

function scoreColor(score: number | null) {
  if (score === null) return "";
  if (score >= 70) return "text-teal-400";
  if (score >= 40) return "text-slate-400";
  return "text-rose-400";
}

function daysAgo(dateStr: string): string {
  const diff = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diff === 0) return "Today";
  if (diff === 1) return "1d";
  return `${diff}d`;
}

export function JobCard({ card, overlay, stageGradient }: JobCardProps) {
  const { listing, fitScore, fitToken } = card;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    data: { card },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "group relative cursor-grab select-none rounded-xl p-3 transition-all duration-150",
        "bg-white/[0.06] dark:bg-white/[0.04] backdrop-blur-sm",
        "border border-white/[0.06] hover:border-white/[0.12]",
        "hover:bg-white/[0.09] dark:hover:bg-white/[0.07]",
        "active:cursor-grabbing active:scale-[0.98]",
        isDragging && "opacity-30",
        overlay && "shadow-2xl bg-white/[0.1] border-white/[0.15]"
      )}
    >
      {/* Gradient glow at top edge */}
      <div className={cn(
        "absolute inset-x-0 top-0 h-[2px] rounded-t-xl bg-gradient-to-r opacity-40 group-hover:opacity-70 transition-opacity",
        stageGradient || "from-slate-400 to-slate-500"
      )} />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium leading-tight text-foreground/90">
            {listing.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
            {listing.companyName}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2 text-muted-foreground/50">
          {listing.locationCity && (
            <span className="flex items-center gap-0.5 truncate">
              <MapPin className="h-3 w-3 opacity-60" />
              {listing.locationCity}
            </span>
          )}
          {listing.isRemote && !listing.locationCity && (
            <span>Remote</span>
          )}
          <span>{daysAgo(listing.postedDate || listing.firstSeenAt)}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {fitScore !== null && (
            <span className={cn("font-semibold tabular-nums", scoreColor(fitScore))}>
              {Math.round(fitScore)}%
            </span>
          )}

          {/* Hover actions */}
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <a
              href={listing.roleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md p-1 text-muted-foreground/50 hover:text-foreground/80 hover:bg-white/10 transition-colors"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="View JD"
              title="View JD"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
            <Link
              href={`/fit/${listing.id}?token=${fitToken}`}
              className="rounded-md p-1 text-muted-foreground/50 hover:text-foreground/80 hover:bg-white/10 transition-colors"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Check Fit"
              title="Check Fit"
            >
              <FileSearch className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export function JobCardOverlay({ card }: { card: KanbanCard }) {
  return <JobCard card={card} overlay />;
}
