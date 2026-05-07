"use client";

import { CheckCircle, XCircle, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useState } from "react";
import type { QualCandidates, PreResolvedResult, FinalSelection } from "@/lib/types";

interface ScoreViewProps {
  rankedCandidates: QualCandidates[];
  preResolved: PreResolvedResult[];
  finalSelection: FinalSelection;
  selectedBullets: Map<string, string>; // qualId → bulletId
  onSelectBullet: (qualId: string, bulletId: string) => void;
}

function matchColor(score: number) {
  if (score >= 70) return "text-teal-600 dark:text-teal-400";
  if (score >= 40) return "text-slate-500 dark:text-slate-400";
  return "text-rose-400 dark:text-rose-400";
}

function matchBg(score: number) {
  if (score >= 70) return "bg-teal-50/60 border-teal-200/60 dark:bg-teal-950/10 dark:border-teal-800/40";
  if (score >= 40) return "bg-slate-50 border-slate-200 dark:bg-slate-900/20 dark:border-slate-700/40";
  return "bg-rose-50/60 border-rose-200/60 dark:bg-rose-950/10 dark:border-rose-800/40";
}

function PreResolvedCard({ item }: { item: PreResolvedResult }) {
  const icon = item.met
    ? <CheckCircle className="h-4 w-4 text-teal-500 dark:text-teal-400 shrink-0" />
    : <XCircle className="h-4 w-4 text-rose-400 dark:text-rose-400 shrink-0" />;

  const categoryLabel: Record<string, string> = {
    education_check: "Education",
    experience_years: "Experience",
    skill_check: "Skill",
    values_statement: "Values",
  };

  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-card p-3">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {categoryLabel[item.category] || item.category}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {Math.round(item.confidence)}% confidence
          </span>
        </div>
        <p className="mt-1 text-sm text-foreground">{item.evidence}</p>
      </div>
    </div>
  );
}

function QualCard({
  qual,
  selectedBulletId,
  onSelectBullet,
}: {
  qual: QualCandidates;
  selectedBulletId: string | undefined;
  onSelectBullet: (qualId: string, bulletId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const topCandidate = qual.candidates[0];
  const selected = selectedBulletId || topCandidate?.bullet_id;

  return (
    <Card className="overflow-hidden">
      <div className="p-3">
        <div className="flex items-start gap-2">
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 mt-0.5 text-[10px] px-1.5 py-0",
              qual.qualification.kind === "basic"
                ? "border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400"
                : "border-zinc-300 text-zinc-600 dark:border-zinc-600 dark:text-zinc-400"
            )}
          >
            {qual.qualification.kind === "basic" ? "Required" : "Preferred"}
          </Badge>
          <p className="text-sm text-foreground leading-snug">
            {qual.qualification.text}
          </p>
        </div>

        {topCandidate && (
          <div
            className={cn(
              "mt-2 rounded-md border p-2",
              matchBg(topCandidate.match_score)
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {topCandidate.source_label}
              </span>
              <span className={cn("text-xs font-semibold", matchColor(topCandidate.match_score))}>
                {Math.round(topCandidate.match_score)}%
              </span>
            </div>
            <p className="mt-1 text-sm text-foreground">{topCandidate.text}</p>
          </div>
        )}

        {qual.candidates.length > 1 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {qual.candidates.length - 1} more candidate{qual.candidates.length > 2 ? "s" : ""}
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-border bg-muted/30 p-3 space-y-2">
          {qual.candidates.map((c) => (
            <button
              key={c.bullet_id}
              onClick={() => onSelectBullet(qual.qualification.id, c.bullet_id)}
              className={cn(
                "w-full text-left rounded-md border p-2 transition-colors",
                selected === c.bullet_id
                  ? "border-indigo-400 bg-indigo-50/30 dark:bg-indigo-950/20"
                  : "border-border hover:border-indigo-300 dark:hover:border-indigo-700"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{c.source_label}</span>
                <span className={cn("text-xs font-semibold", matchColor(c.match_score))}>
                  {Math.round(c.match_score)}%
                </span>
              </div>
              <p className="mt-1 text-sm">{c.text}</p>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

export function ScoreView({
  rankedCandidates,
  preResolved,
  finalSelection,
  selectedBullets,
  onSelectBullet,
}: ScoreViewProps) {
  const numQuals = rankedCandidates.length + preResolved.length;
  const totalScore = numQuals > 0
    ? Math.round(finalSelection.total_score / numQuals)
    : 0;
  const uncovered = finalSelection.uncovered_qualifications;

  return (
    <div className="space-y-4">
      {/* Score summary */}
      <div className="flex items-center gap-4">
        <div className={cn(
          "text-3xl font-bold",
          totalScore >= 70 ? "text-teal-600 dark:text-teal-400"
            : totalScore >= 40 ? "text-slate-500 dark:text-slate-400"
            : "text-rose-400 dark:text-rose-400"
        )}>
          {Math.round(totalScore)}%
        </div>
        <div>
          <p className="text-sm font-medium">Overall Fit Score</p>
          <p className="text-xs text-muted-foreground">
            {finalSelection.selected_bullets.length} bullets selected
            {uncovered.length > 0 && ` · ${uncovered.length} uncovered`}
          </p>
        </div>
      </div>

      {/* Pre-resolved checks */}
      {preResolved.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Quick Checks</h3>
          {preResolved.map((item) => (
            <PreResolvedCard key={item.qualification_id} item={item} />
          ))}
        </div>
      )}

      {/* Qualification matches */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">
          Qualification Matches ({rankedCandidates.length})
        </h3>
        {rankedCandidates.map((qc) => (
          <QualCard
            key={qc.qualification.id}
            qual={qc}
            selectedBulletId={selectedBullets.get(qc.qualification.id)}
            onSelectBullet={onSelectBullet}
          />
        ))}
      </div>

      {/* Uncovered qualifications */}
      {uncovered.length > 0 && (
        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 text-slate-400" />
            Uncovered ({uncovered.length})
          </h3>
          <div className="rounded-md border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-900/20">
            <ul className="space-y-1 text-sm text-muted-foreground">
              {uncovered.map((q, i) => (
                <li key={i}>- {q}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
