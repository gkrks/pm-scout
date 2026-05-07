"use client";

import { useState, useMemo, useEffect } from "react";
import { Check, ArrowRight, Briefcase, FolderGit2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  ScoreResponse,
  LockedBullet,
  AllocationEntry,
} from "@/lib/types";
import { matchRequirement, type MatchedCandidate } from "@/lib/api";
import { GLOBAL_BULLET_CAP, flatLockedBullets } from "@/lib/wizard-state";

const TARGET_EXP = 8;    // 8 experience bullets (4 experiences × 2 bullets)
const TARGET_PROJ = 4;    // 4 project bullets (2 projects × 2 bullets)
const MAX_PROJECTS = 2;   // max 2 distinct projects on resume

interface FillRemainingStepProps {
  scoreData: ScoreResponse;
  lockedBullets: Map<string, LockedBullet[]>;
  allocation: AllocationEntry[];
  remainingSlots: number;
  jobId: string;
  token: string;
  onLockBullet: (qualId: string, bullet: LockedBullet) => void;
  onNext: () => void;
}

interface Suggestion {
  qualId: string;
  qualText: string;
  bulletId: string;
  sourceId: string;
  sourceLabel: string;
  sourceType: "experience" | "project";
  text: string;
  matchScore: number;
  accepted: boolean;
}

/** Build experience suggestions from pre-scored candidates */
function buildExpSuggestions(
  scoreData: ScoreResponse,
  usedBulletIds: Set<string>,
  count: number
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const picked = new Set<string>();

  const allOptions: {
    qualId: string;
    qualText: string;
    candidate: ScoreResponse["ranked_candidates"][0]["candidates"][0];
  }[] = [];

  for (const qc of scoreData.ranked_candidates) {
    for (const c of qc.candidates) {
      if (usedBulletIds.has(c.bullet_id)) continue;
      allOptions.push({ qualId: qc.qualification.id, qualText: qc.qualification.text, candidate: c });
    }
  }
  allOptions.sort((a, b) => b.candidate.match_score - a.candidate.match_score);

  for (const opt of allOptions) {
    if (suggestions.length >= count) break;
    if (picked.has(opt.candidate.bullet_id)) continue;
    suggestions.push({
      qualId: opt.qualId,
      qualText: opt.qualText,
      bulletId: opt.candidate.bullet_id,
      sourceId: opt.candidate.source_id,
      sourceLabel: opt.candidate.source_label,
      sourceType: "experience",
      text: opt.candidate.text,
      matchScore: opt.candidate.match_score,
      accepted: false,
    });
    picked.add(opt.candidate.bullet_id);
  }
  return suggestions;
}

export function FillRemainingStep({
  scoreData,
  lockedBullets,
  allocation,
  remainingSlots,
  jobId,
  token,
  onLockBullet,
  onNext,
}: FillRemainingStepProps) {
  const allLocked = useMemo(() => flatLockedBullets(lockedBullets), [lockedBullets]);
  const usedBulletIds = useMemo(() => {
    const ids = new Set<string>();
    for (const lb of allLocked) { if (!lb.isTraitSkip) ids.add(lb.bulletId); }
    return ids;
  }, [allLocked]);

  const { expCount, projCount } = useMemo(() => {
    let exp = 0, proj = 0;
    for (const lb of allLocked) {
      if (lb.isTraitSkip) continue;
      if (lb.sourceId.startsWith("proj_")) proj++; else exp++;
    }
    return { expCount: exp, projCount: proj };
  }, [allLocked]);

  const expNeeded = Math.max(0, TARGET_EXP - expCount);
  const projNeeded = Math.max(0, TARGET_PROJ - projCount);

  // Experience suggestions from scorer
  const [expSuggestions, setExpSuggestions] = useState<Suggestion[]>(() =>
    buildExpSuggestions(scoreData, usedBulletIds, expNeeded || 2)
  );

  // Project suggestions via Voyage — fetch on mount
  const [projSuggestions, setProjSuggestions] = useState<Suggestion[]>([]);
  const [projLoading, setProjLoading] = useState(true);

  useEffect(() => {
    if (projNeeded <= 0 && projCount >= TARGET_PROJ) {
      setProjLoading(false);
      return;
    }

    // Fetch project candidates for top unmatched quals
    const unmatchedQuals = scoreData.ranked_candidates
      .filter((qc) => !lockedBullets.has(qc.qualification.id))
      .slice(0, 3);

    // Also include matched quals for broader project coverage
    const matchedQuals = scoreData.ranked_candidates
      .filter((qc) => lockedBullets.has(qc.qualification.id))
      .slice(0, 2);

    const qualsToSearch = [...unmatchedQuals, ...matchedQuals];
    if (qualsToSearch.length === 0) {
      setProjLoading(false);
      return;
    }

    const lockedIds = [...usedBulletIds];

    // Search each qual for project matches
    Promise.all(
      qualsToSearch.map((qc) =>
        matchRequirement(jobId, token, {
          qualification_text: qc.qualification.text,
          locked_bullet_ids: lockedIds,
          source_type_filter: "project",
        }).then((res) => ({
          qualId: qc.qualification.id,
          qualText: qc.qualification.text,
          candidates: res.candidates,
        })).catch(() => ({
          qualId: qc.qualification.id,
          qualText: qc.qualification.text,
          candidates: [] as MatchedCandidate[],
        }))
      )
    ).then((results) => {
      const projOptions: Suggestion[] = [];
      const picked = new Set<string>();

      // Track which project sources are already locked
      const lockedProjSources = new Set<string>();
      for (const lb of allLocked) {
        if (!lb.isTraitSkip && lb.sourceId.startsWith("proj_")) lockedProjSources.add(lb.sourceId);
      }
      const projSources = new Set(lockedProjSources);

      // Flatten and sort by similarity
      const all: { qualId: string; qualText: string; c: MatchedCandidate }[] = [];
      for (const r of results) {
        for (const c of r.candidates) {
          if (usedBulletIds.has(c.bullet_id)) continue;
          all.push({ qualId: r.qualId, qualText: r.qualText, c });
        }
      }
      all.sort((a, b) => b.c.similarity_score - a.c.similarity_score);

      const needed = Math.max(projNeeded, TARGET_PROJ);
      for (const opt of all) {
        if (projOptions.length >= needed) break;
        if (picked.has(opt.c.bullet_id)) continue;
        // Enforce max 2 distinct projects
        if (!projSources.has(opt.c.source_id) && projSources.size >= MAX_PROJECTS) continue;
        projSources.add(opt.c.source_id);
        projOptions.push({
          qualId: opt.qualId,
          qualText: opt.qualText,
          bulletId: opt.c.bullet_id,
          sourceId: opt.c.source_id,
          sourceLabel: opt.c.source,
          sourceType: "project",
          text: opt.c.original_text,
          matchScore: Math.round(opt.c.similarity_score * 100),
          accepted: false,
        });
        picked.add(opt.c.bullet_id);
      }

      setProjSuggestions(projOptions);
      setProjLoading(false);
    });
  }, []); // Run once on mount

  const totalLocked = allLocked.filter((lb) => !lb.isTraitSkip).length;

  function handleAccept(type: "exp" | "proj", idx: number) {
    const setter = type === "exp" ? setExpSuggestions : setProjSuggestions;
    const list = type === "exp" ? expSuggestions : projSuggestions;
    const s = list[idx];
    onLockBullet(s.qualId, {
      qualificationId: s.qualId,
      bulletId: s.bulletId,
      sourceId: s.sourceId,
      sourceLabel: s.sourceLabel,
      originalText: s.text,
      rewrittenText: null,
      whyItMaps: null,
      keywordsEmbedded: [],
      formatUsed: null,
      similarityScore: null,
      isTraitSkip: false,
    });
    setter((prev) => prev.map((item, i) => (i === idx ? { ...item, accepted: true } : item)));
  }

  function renderSuggestion(s: Suggestion, type: "exp" | "proj", idx: number) {
    return (
      <Card
        key={`${s.qualId}-${s.bulletId}`}
        className={cn(
          "p-3",
          s.accepted && "border-teal-200 bg-teal-50/30 dark:border-teal-800/40 dark:bg-teal-950/10"
        )}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-xs text-muted-foreground">{s.qualText.slice(0, 100)}</p>
          <span className={cn(
            "text-xs font-semibold shrink-0",
            s.matchScore >= 50 ? "text-teal-600 dark:text-teal-400"
              : s.matchScore >= 30 ? "text-amber-600 dark:text-amber-400"
              : "text-slate-500"
          )}>
            {s.matchScore}%
          </span>
        </div>
        <div className="flex items-center gap-1.5 mb-1">
          {s.sourceType === "experience"
            ? <Briefcase className="h-3 w-3 text-muted-foreground" />
            : <FolderGit2 className="h-3 w-3 text-muted-foreground" />
          }
          <Badge variant="secondary" className="text-[10px]">{s.sourceLabel}</Badge>
        </div>
        <p className="text-sm text-foreground">{s.text}</p>
        {!s.accepted && (
          <Button size="sm" variant="outline" className="mt-2" onClick={() => handleAccept(type, idx)}>
            <Check className="mr-1 h-3 w-3" /> Accept
          </Button>
        )}
        {s.accepted && (
          <p className="mt-2 text-xs text-teal-600 dark:text-teal-400 font-medium">Accepted</p>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight">Fill Remaining Bullets</h2>
        <Badge variant="outline" className="font-mono text-xs">
          {totalLocked}/{GLOBAL_BULLET_CAP} assigned
        </Badge>
      </div>

      {/* Allocation split */}
      <div className="flex gap-3">
        <Card className={cn("flex-1 p-2 text-center", expCount < TARGET_EXP && "border-amber-300 dark:border-amber-700")}>
          <div className="flex items-center justify-center gap-1.5">
            <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-lg font-bold">{expCount}</span>
            <span className="text-xs text-muted-foreground">/ {TARGET_EXP}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">Experience</p>
        </Card>
        <Card className={cn("flex-1 p-2 text-center", projCount < TARGET_PROJ && "border-amber-300 dark:border-amber-700")}>
          <div className="flex items-center justify-center gap-1.5">
            <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-lg font-bold">{projCount}</span>
            <span className="text-xs text-muted-foreground">/ {TARGET_PROJ}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">Projects (max {MAX_PROJECTS})</p>
        </Card>
      </div>

      {remainingSlots <= 0 ? (
        <Card className="p-6 text-center">
          <Check className="h-8 w-8 text-teal-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground">All {GLOBAL_BULLET_CAP} bullet slots filled.</p>
          <Button onClick={onNext} className="mt-4">
            Continue to Skills <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </Card>
      ) : (
        <>
          {/* Project suggestions */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground" />
              Project Bullets
              {projNeeded > 0 && (
                <span className="text-xs font-normal text-amber-600 dark:text-amber-400">
                  (need {projNeeded} more)
                </span>
              )}
            </h3>
            {projLoading ? (
              <div className="flex items-center gap-2 py-4 justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                <span className="text-xs text-muted-foreground">Finding project matches via Voyage...</span>
              </div>
            ) : projSuggestions.length > 0 ? (
              <div className="space-y-2">
                {projSuggestions.map((s, idx) => renderSuggestion(s, "proj", idx))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground py-2">No project matches found.</p>
            )}
          </div>

          {/* Experience suggestions */}
          {expSuggestions.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                Experience Bullets
                {expNeeded > 0 && (
                  <span className="text-xs font-normal text-amber-600 dark:text-amber-400">
                    (need {expNeeded} more)
                  </span>
                )}
              </h3>
              <div className="space-y-2">
                {expSuggestions.map((s, idx) => renderSuggestion(s, "exp", idx))}
              </div>
            </div>
          )}

          <Button onClick={onNext} className="w-full">
            Continue to Skills <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}
