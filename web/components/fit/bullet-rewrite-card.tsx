"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { rewriteBullet } from "@/lib/api";
import type { ScoredCandidate, Qualification, RewriteSuggestion } from "@/lib/types";

const CHAR_LIMIT = 225;

interface BulletRewriteCardProps {
  candidate: ScoredCandidate;
  qualification: Qualification;
  jobId: string;
  token: string;
  onAcceptRewrite: (rewrittenText: string) => void;
  onKeepOriginal: () => void;
}

export function BulletRewriteCard({
  candidate,
  qualification,
  jobId,
  token,
  onAcceptRewrite,
  onKeepOriginal,
}: BulletRewriteCardProps) {
  const [editText, setEditText] = useState(candidate.text);
  const [isEditing, setIsEditing] = useState(false);
  const [suggestions, setSuggestions] = useState<RewriteSuggestion[]>([]);

  const rewriteMutation = useMutation({
    mutationFn: () =>
      rewriteBullet(jobId, token, {
        bullet_id: candidate.bullet_id,
        bullet_text: candidate.text,
        target_qualification: qualification.text,
      }),
    onSuccess: (data) => {
      setSuggestions(data.suggestions);
      if (data.suggestions.length > 0 && data.suggestions[0].was_rewritten) {
        setEditText(data.suggestions[0].text);
      }
    },
  });

  const charCount = editText.length;
  const isOverLimit = charCount > CHAR_LIMIT;

  return (
    <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/30 p-4 dark:border-indigo-800/40 dark:bg-indigo-950/10">
      {/* Original bullet */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-muted-foreground">
            Original ({candidate.text.length} chars)
          </span>
          <Badge variant="outline" className="text-[10px]">
            {candidate.source_label}
          </Badge>
        </div>
        <p className="text-sm text-foreground">{candidate.text}</p>
      </div>

      {/* Rewrite controls */}
      {suggestions.length === 0 && !isEditing && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => rewriteMutation.mutate()}
            disabled={rewriteMutation.isPending}
          >
            {rewriteMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
            )}
            Rewrite with JD keywords
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsEditing(true)}
          >
            Edit manually
          </Button>
        </div>
      )}

      {/* Suggestions from API */}
      {suggestions.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">Suggestion</span>
          {suggestions.map((s, i) => (
            <div
              key={i}
              className={cn(
                "rounded-md border p-2.5",
                s.was_rewritten
                  ? "border-teal-200 bg-teal-50/50 dark:border-teal-800/40 dark:bg-teal-950/10"
                  : "border-border bg-card"
              )}
            >
              <p className="text-sm text-foreground">{s.text}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <span
                  className={cn(
                    "text-xs font-mono",
                    s.char_count > CHAR_LIMIT ? "text-rose-500" : "text-muted-foreground"
                  )}
                >
                  {s.char_count}/{CHAR_LIMIT} chars
                </span>
                {s.keywords_embedded.length > 0 && (
                  <span className="text-xs text-teal-600 dark:text-teal-400">
                    +{s.keywords_embedded.join(", ")}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit area */}
      {(isEditing || suggestions.length > 0) && (
        <div className="space-y-2">
          <Textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={3}
            className="text-sm"
            placeholder="Edit the bullet text..."
          />
          <div className="flex items-center justify-between">
            <span
              className={cn(
                "text-xs font-mono",
                isOverLimit ? "text-rose-500 font-semibold" : "text-muted-foreground"
              )}
            >
              {charCount}/{CHAR_LIMIT} chars
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsEditing(false);
                  setSuggestions([]);
                  setEditText(candidate.text);
                }}
              >
                <X className="mr-1 h-3 w-3" />
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => onAcceptRewrite(editText)}
                disabled={isOverLimit}
              >
                <Check className="mr-1 h-3 w-3" />
                Accept Rewrite
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Keep original */}
      {!isEditing && suggestions.length === 0 && (
        <Button variant="ghost" size="sm" onClick={onKeepOriginal}>
          Keep Original
        </Button>
      )}
    </div>
  );
}
