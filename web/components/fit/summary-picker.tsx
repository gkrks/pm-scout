"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Pencil, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

const SUMMARY_CHAR_LIMIT = 340;

function charBadge(count: number) {
  return (
    <span className={cn(
      "text-[10px] font-mono px-1.5 py-0 rounded",
      count > SUMMARY_CHAR_LIMIT
        ? "bg-rose-100 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400"
        : count > 300
          ? "bg-amber-100 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"
          : "bg-teal-100 text-teal-600 dark:bg-teal-950/30 dark:text-teal-400"
    )}>
      {count}/{SUMMARY_CHAR_LIMIT}
    </span>
  );
}

interface SummaryPickerProps {
  candidates: { text: string; reasoning: string }[];
  recommended: number;
  jdAnalysis?: string;
  selected: number | "custom";
  customText: string;
  onSelect: (index: number | "custom") => void;
  onCustomChange: (text: string) => void;
  /** Called when user edits a candidate in-place; parent should update scoreData */
  onEditCandidate?: (index: number, text: string) => void;
}

export function SummaryPicker({
  candidates,
  recommended,
  jdAnalysis,
  selected,
  customText,
  onSelect,
  onCustomChange,
  onEditCandidate,
}: SummaryPickerProps) {
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");

  function startEdit(idx: number) {
    setEditingIdx(idx);
    setEditDraft(candidates[idx].text);
  }

  function commitEdit(idx: number) {
    if (onEditCandidate && editDraft.trim()) {
      onEditCandidate(idx, editDraft.trim());
    }
    setEditingIdx(null);
    setEditDraft("");
  }

  function cancelEdit() {
    setEditingIdx(null);
    setEditDraft("");
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Professional Summary</h3>
        {jdAnalysis && (
          <button
            onClick={() => setShowAnalysis(!showAnalysis)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showAnalysis ? "Hide" : "Show"} JD analysis
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Max {SUMMARY_CHAR_LIMIT} characters. No em dashes, no buzzwords, no first-person pronouns.
      </p>

      {showAnalysis && jdAnalysis && (
        <p className="text-xs text-muted-foreground rounded-md bg-muted p-3 leading-relaxed">
          {jdAnalysis}
        </p>
      )}

      <div className="grid gap-2">
        {candidates.map((c, i) => {
          const isEditing = editingIdx === i;
          const displayText = isEditing ? editDraft : c.text;

          return (
            <div
              key={i}
              className={cn(
                "w-full text-left rounded-lg border p-3 transition-colors",
                selected === i
                  ? "border-indigo-400 bg-indigo-50/30 dark:bg-indigo-950/20"
                  : "border-border hover:border-indigo-300 dark:hover:border-indigo-700"
              )}
            >
              {/* Header row */}
              <div className="flex items-center gap-2 mb-1.5">
                <button
                  onClick={() => onSelect(i)}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Option {i + 1}
                </button>
                {i === recommended && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-indigo-50 text-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-300">
                    Recommended
                  </Badge>
                )}
                {charBadge(displayText.length)}

                {/* Edit controls */}
                <div className="ml-auto flex items-center gap-1">
                  {isEditing ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0"
                        onClick={() => commitEdit(i)}
                        disabled={editDraft.length > SUMMARY_CHAR_LIMIT}
                      >
                        <Check className="h-3 w-3 text-teal-600" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0"
                        onClick={cancelEdit}
                      >
                        <X className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      onClick={(e) => { e.stopPropagation(); startEdit(i); }}
                    >
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Text or editor */}
              {isEditing ? (
                <div>
                  <Textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    className={cn(
                      "min-h-[80px] text-sm",
                      editDraft.length > SUMMARY_CHAR_LIMIT && "border-rose-300 focus-visible:ring-rose-400"
                    )}
                    autoFocus
                  />
                  {editDraft.length > SUMMARY_CHAR_LIMIT && (
                    <p className="mt-1 text-[10px] text-rose-500">
                      {editDraft.length - SUMMARY_CHAR_LIMIT} characters over limit
                    </p>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => onSelect(i)}
                  className="w-full text-left"
                >
                  <p className="text-sm leading-relaxed">{c.text}</p>
                </button>
              )}
            </div>
          );
        })}

        {/* Custom option */}
        <button
          onClick={() => onSelect("custom")}
          className={cn(
            "w-full text-left rounded-lg border p-3 transition-colors",
            selected === "custom"
              ? "border-indigo-400 bg-indigo-50/30 dark:bg-indigo-950/20"
              : "border-border hover:border-indigo-300 dark:hover:border-indigo-700"
          )}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Write your own
            </span>
            {selected === "custom" && charBadge(customText.length)}
          </div>
          {selected === "custom" && (
            <div className="mt-2">
              <Textarea
                value={customText}
                onChange={(e) => onCustomChange(e.target.value)}
                placeholder="Write a custom professional summary..."
                className={cn(
                  "min-h-[80px] text-sm",
                  customText.length > SUMMARY_CHAR_LIMIT && "border-rose-300 focus-visible:ring-rose-400"
                )}
                onClick={(e) => e.stopPropagation()}
              />
              {customText.length > SUMMARY_CHAR_LIMIT && (
                <p className="mt-1 text-[10px] text-rose-500">
                  {customText.length - SUMMARY_CHAR_LIMIT} characters over limit
                </p>
              )}
            </div>
          )}
        </button>
      </div>
    </div>
  );
}
