"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchKanbanCards, createApplication, updateApplication } from "@/lib/api";
import type { KanbanCard, KanbanColumnId } from "@/lib/types";

const DASHBOARD_TOKEN = process.env.NEXT_PUBLIC_DASHBOARD_TOKEN || "";

export function useKanbanCards() {
  return useQuery({
    queryKey: ["kanban-cards"],
    queryFn: () => fetchKanbanCards(DASHBOARD_TOKEN),
    select: (data) => data.cards,
    staleTime: 60_000,
  });
}

/** Map column IDs to application statuses for persistence */
function columnToStatus(columnId: KanbanColumnId): string | null {
  switch (columnId) {
    case "discovered":
    case "fit_reviewed":
      return null; // Virtual columns — no application status
    case "applied":
      return "applied";
    case "phone_screen":
      return "phone_screen";
    case "interviewing":
      return "interviewing";
    case "offer":
      return "offer";
    case "rejected":
      return "rejected";
    default:
      return null;
  }
}

export function useMoveCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      card,
      toColumn,
    }: {
      card: KanbanCard;
      toColumn: KanbanColumnId;
    }) => {
      const newStatus = columnToStatus(toColumn);

      if (!newStatus) {
        // Moving to a virtual column — can't persist (ignore for now)
        return;
      }

      if (card.applicationId) {
        // Existing application — update status
        await updateApplication(card.applicationId, { status: newStatus }, DASHBOARD_TOKEN);
      } else {
        // No application yet — create one
        await createApplication(card.id, newStatus, DASHBOARD_TOKEN);
      }
    },
    onMutate: async ({ card, toColumn }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["kanban-cards"] });

      // Snapshot previous value
      const previous = queryClient.getQueryData<{ cards: KanbanCard[] }>(["kanban-cards"]);

      // Optimistic update
      queryClient.setQueryData<{ cards: KanbanCard[] }>(["kanban-cards"], (old) => {
        if (!old) return old;
        return {
          cards: old.cards.map((c) =>
            c.id === card.id ? { ...c, columnId: toColumn } : c
          ),
        };
      });

      return { previous };
    },
    onError: (_err, _vars, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(["kanban-cards"], context.previous);
      }
      toast.error("Failed to update status. Please try again.");
    },
    onSuccess: () => {
      toast.success("Status updated");
    },
    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: ["kanban-cards"] });
    },
  });
}
