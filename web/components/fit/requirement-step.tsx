"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ChevronLeft, ChevronRight, Lock, SkipForward, Loader2, Sparkles,
  Briefcase, FolderGit2, Star, CheckCircle2, ArrowRight, X, AlertCircle,
  ListChecks, Check,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { matchRequirement, rewriteBullet, type MatchedCandidate } from "@/lib/api";
import type { QualCandidates, LockedBullet, AllocationEntry } from "@/lib/types";
import { flatLockedBullets } from "@/lib/wizard-state";

const CHAR_LIMIT = 225;
const AUTO_ADVANCE_MS = 800;

interface RequirementStepProps {
  qualification: QualCandidates;
  reqIndex: number;
  totalReqs: number;
  lockedBulletsForQual: LockedBullet[] | undefined;
  lockedBullets: Map<string, LockedBullet[]>;
  allocation: AllocationEntry[];
  lockedBulletIds: string[];
  jobId: string;
  token: string;
  responsibilities: string[];
  onLock: (bullet: LockedBullet) => void;
  onSkipTrait: () => void;
  onUnlockSingle: (bulletId: string) => void;
  onNext: () => void;
  onPrev: () => void;
}

function charBadge(count: number) {
  return (
    <span className={cn(
      "text-[10px] font-mono px-1.5 py-0 rounded",
      count > CHAR_LIMIT
        ? "bg-rose-100 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400"
        : count > 200
          ? "bg-amber-100 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"
          : "bg-teal-100 text-teal-600 dark:bg-teal-950/30 dark:text-teal-400"
    )}>
      {count}/{CHAR_LIMIT}
    </span>
  );
}

function findCoveringBullets(
  qualText: string,
  lockedBullets: Map<string, LockedBullet[]>,
  currentQualId: string
): { qualId: string; bullet: LockedBullet; overlapTerms: string[] }[] {
  const qualWords = new Set(
    qualText.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w.length > 3)
  );
  const stop = new Set(["with", "that", "this", "from", "have", "been", "your", "will", "more", "years", "experience", "strong", "ability"]);
  stop.forEach((w) => qualWords.delete(w));

  const results: { qualId: string; bullet: LockedBullet; overlapTerms: string[] }[] = [];
  for (const [qualId, bullets] of lockedBullets) {
    if (qualId === currentQualId) continue;
    for (const lb of bullets) {
      if (lb.isTraitSkip) continue;
      const text = (lb.rewrittenText || lb.originalText).toLowerCase();
      const overlap = [...qualWords].filter((w) => text.includes(w));
      if (overlap.length >= 3) results.push({ qualId, bullet: lb, overlapTerms: overlap });
    }
  }
  return results;
}

function findRelatedResponsibilities(qualText: string, responsibilities: string[]): string[] {
  const qualWords = new Set(
    qualText.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w.length > 3)
  );
  return responsibilities.filter((resp) => {
    const respWords = resp.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/);
    return respWords.filter((w) => qualWords.has(w)).length >= 2;
  });
}

function findBulletsCoveringResponsibility(respText: string, allLocked: LockedBullet[]): LockedBullet[] {
  const respWords = new Set(
    respText.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w.length > 3)
  );
  const stop = new Set(["with", "that", "this", "from", "have", "been", "your", "will", "more"]);
  stop.forEach((w) => respWords.delete(w));
  return allLocked.filter((lb) => {
    if (lb.isTraitSkip) return false;
    const text = (lb.rewrittenText || lb.originalText).toLowerCase();
    return [...respWords].filter((w) => text.includes(w)).length >= 2;
  });
}

export function RequirementStep({
  qualification, reqIndex, totalReqs, lockedBulletsForQual, lockedBullets, allocation,
  lockedBulletIds, jobId, token, responsibilities, onLock, onSkipTrait, onUnlockSingle, onNext, onPrev,
}: RequirementStepProps) {
  const qual = qualification.qualification;
  const locked = lockedBulletsForQual || [];
  const realLocked = locked.filter((lb) => !lb.isTraitSkip);
  const isSkipped = locked.length === 1 && locked[0].isTraitSkip;
  const hasLocked = realLocked.length > 0;

  const [rewriteTarget, setRewriteTarget] = useState<string | null>(null);
  const [rewriteText, setRewriteText] = useState("");
  const [editText, setEditText] = useState("");
  const [rewriteFailed, setRewriteFailed] = useState(false);
  const [justLocked, setJustLocked] = useState(false);

  const allLockedFlat = useMemo(() => flatLockedBullets(lockedBullets), [lockedBullets]);
  const coveringBullets = useMemo(() => findCoveringBullets(qual.text, lockedBullets, qual.id), [qual.text, qual.id, lockedBullets]);
  const relatedResps = useMemo(() => findRelatedResponsibilities(qual.text, responsibilities), [qual.text, responsibilities]);

  // Reset justLocked when navigating to a new requirement
  useEffect(() => { setJustLocked(false); setRewriteTarget(null); setRewriteText(""); setRewriteFailed(false); }, [qual.id]);

  // Auto-advance after locking
  useEffect(() => {
    if (!justLocked) return;
    const timer = setTimeout(() => {
      setJustLocked(false);
      onNext();
    }, AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [justLocked, onNext]);

  const matchQuery = useQuery({
    queryKey: ["match-requirement", jobId, qual.id, lockedBulletIds.join(",")],
    queryFn: () => matchRequirement(jobId, token, {
      qualification_text: qual.text,
      locked_bullet_ids: lockedBulletIds,
    }),
    staleTime: 10 * 60_000,
    enabled: !hasLocked && !isSkipped,
  });

  const rewriteMutation = useMutation({
    mutationFn: (candidate: MatchedCandidate) =>
      rewriteBullet(jobId, token, {
        bullet_id: candidate.bullet_id,
        bullet_text: candidate.original_text,
        target_qualification: qual.text,
      }),
    onSuccess: (data, candidate) => {
      if (data.suggestions.length > 0 && data.suggestions[0].was_rewritten) {
        setRewriteText(data.suggestions[0].text);
        setEditText(data.suggestions[0].text);
        setRewriteFailed(false);
      } else {
        setRewriteText("");
        setEditText("");
        setRewriteFailed(true);
      }
    },
  });

  const candidates = matchQuery.data?.candidates || [];
  const expCandidates = candidates.filter((c) => c.source_type === "experience");
  const projCandidates = candidates.filter((c) => c.source_type === "project");
  const recommended = candidates.length > 0 ? candidates[0] : null;

  // Lock + auto-advance
  const lockAndAdvance = useCallback((bullet: LockedBullet) => {
    onLock(bullet);
    setJustLocked(true);
  }, [onLock]);

  function handleLockOriginal(c: MatchedCandidate) {
    lockAndAdvance({
      qualificationId: qual.id, bulletId: c.bullet_id, sourceId: c.source_id,
      sourceLabel: c.source, originalText: c.original_text, rewrittenText: null,
      whyItMaps: null, keywordsEmbedded: c.matched_keywords, formatUsed: null,
      similarityScore: c.similarity_score, isTraitSkip: false,
    });
  }

  function handleLockRewrite(c: MatchedCandidate, text: string) {
    lockAndAdvance({
      qualificationId: qual.id, bulletId: c.bullet_id, sourceId: c.source_id,
      sourceLabel: c.source, originalText: c.original_text, rewrittenText: text,
      whyItMaps: null, keywordsEmbedded: c.matched_keywords, formatUsed: null,
      similarityScore: c.similarity_score, isTraitSkip: false,
    });
    setRewriteTarget(null);
    setRewriteText("");
    setRewriteFailed(false);
  }

  function handleSkip() {
    onSkipTrait();
    setTimeout(onNext, 300);
  }

  function renderCandidate(c: MatchedCandidate) {
    const isRewriting = rewriteTarget === c.bullet_id;
    const isRec = recommended?.bullet_id === c.bullet_id;
    const isAlreadyLocked = realLocked.some((lb) => lb.bulletId === c.bullet_id);
    const sourceIcon = c.source_type === "experience"
      ? <Briefcase className="h-3 w-3" />
      : <FolderGit2 className="h-3 w-3" />;

    return (
      <Card key={c.bullet_id} className={cn(
        "p-4 space-y-3 transition-all",
        isRewriting && "ring-2 ring-indigo-400",
        isRec && !isAlreadyLocked && "border-indigo-400 bg-indigo-50/10 dark:border-indigo-600 dark:bg-indigo-950/10",
        isAlreadyLocked && "opacity-50"
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isRec && !isAlreadyLocked && (
              <Badge className="text-[10px] px-1.5 py-0 bg-indigo-100 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300">
                <Star className="mr-0.5 h-2.5 w-2.5" /> Best Match
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">{c.bullet_id}</Badge>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {sourceIcon} {c.source}
            </span>
          </div>
          <span className={cn(
            "text-xs font-semibold",
            c.similarity_score >= 0.5 ? "text-teal-600 dark:text-teal-400"
              : c.similarity_score >= 0.35 ? "text-amber-600 dark:text-amber-400"
              : "text-slate-500"
          )}>
            {(c.similarity_score * 100).toFixed(0)}%
          </span>
        </div>

        <p className="text-sm text-foreground">{c.original_text}</p>

        {/* Keywords */}
        <div className="flex flex-wrap gap-1">
          {c.matched_keywords.map((kw) => (
            <Badge key={kw} variant="outline" className="text-[10px] px-1.5 py-0 border-teal-300 text-teal-700 bg-teal-50/50 dark:border-teal-700 dark:text-teal-400 dark:bg-teal-950/20">{kw}</Badge>
          ))}
          {c.unmatched_keywords.slice(0, 3).map((kw) => (
            <Badge key={kw} variant="outline" className="text-[10px] px-1.5 py-0 border-rose-200 text-rose-500 dark:border-rose-800 dark:text-rose-400 line-through">{kw}</Badge>
          ))}
        </div>

        {/* Rewrite section */}
        {isRewriting && (
          <div className="space-y-2 border-t border-border pt-3">
            {rewriteMutation.isPending && (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                <span className="text-xs text-muted-foreground">Rewriting...</span>
              </div>
            )}
            {rewriteFailed && !rewriteMutation.isPending && (
              <Card className="p-3 border-amber-200 bg-amber-50/30 dark:border-amber-800/40 dark:bg-amber-950/10">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Rewrite unchanged — edit manually or lock the original.
                  </p>
                </div>
                <Textarea
                  value={editText || c.original_text}
                  onChange={(e) => { setEditText(e.target.value); setRewriteFailed(false); setRewriteText(e.target.value); }}
                  rows={3} className="text-sm mt-2"
                />
                <div className="flex gap-2 mt-2">
                  <Button size="sm" onClick={() => handleLockRewrite(c, editText || c.original_text)}
                    disabled={(editText || c.original_text).length > CHAR_LIMIT}>
                    <Lock className="mr-1 h-3 w-3" /> Lock
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setRewriteTarget(null); setRewriteText(""); setRewriteFailed(false); }}>Cancel</Button>
                </div>
              </Card>
            )}
            {rewriteText && !rewriteFailed && (
              <>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-medium text-teal-600 dark:text-teal-400 uppercase tracking-wider">Rewritten</span>
                    {charBadge(editText.length)}
                  </div>
                  <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} className="text-sm" />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleLockRewrite(c, editText)} disabled={editText.length > CHAR_LIMIT}>
                    <Lock className="mr-1 h-3 w-3" /> Lock Rewrite
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setRewriteTarget(null); setRewriteText(""); setRewriteFailed(false); }}>Cancel</Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Action row — single line */}
        {!isRewriting && !isAlreadyLocked && (
          <div className="flex gap-2">
            {isRec ? (
              // Recommended bullet gets a prominent green button
              <Button size="sm" className="bg-teal-600 hover:bg-teal-700 text-white" onClick={() => handleLockOriginal(c)}>
                <Check className="mr-1.5 h-3.5 w-3.5" /> Use This Bullet
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => handleLockOriginal(c)}>
                <Lock className="mr-1.5 h-3.5 w-3.5" /> Lock
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => {
              setRewriteTarget(c.bullet_id); setRewriteText(""); setEditText(""); setRewriteFailed(false);
              rewriteMutation.mutate(c);
            }}>
              <Sparkles className="mr-1 h-3 w-3" /> Rewrite
            </Button>
          </div>
        )}
      </Card>
    );
  }

  // ── Auto-advance confirmation ──────────────────────────────────
  if (justLocked) {
    return (
      <div className="space-y-4">
        <Card className="p-6 text-center border-teal-300 bg-teal-50/30 dark:border-teal-700 dark:bg-teal-950/10">
          <Check className="h-8 w-8 text-teal-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-teal-700 dark:text-teal-300">
            Bullet locked for requirement {reqIndex + 1}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Advancing to next requirement...
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header + nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onPrev} disabled={reqIndex === 0}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <h2 className="text-lg font-bold tracking-tight">
            {reqIndex + 1} / {totalReqs}
          </h2>
          <Button variant="outline" size="sm" onClick={onNext}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
        {hasLocked && (
          <Badge className="bg-teal-50 text-teal-700 dark:bg-teal-950/20 dark:text-teal-300">
            <Lock className="mr-1 h-3 w-3" /> {realLocked.length} locked
          </Badge>
        )}
      </div>

      {/* ── REQUIREMENT TEXT — sticky, dominant ─────────────────── */}
      <div className="sticky top-16 z-10">
        <div className={cn(
          "rounded-lg p-5 shadow-lg border-2",
          qual.kind === "basic"
            ? "border-indigo-500 bg-indigo-600 dark:bg-indigo-700"
            : "border-violet-400 bg-violet-500 dark:bg-violet-600"
        )}>
          <div className="flex items-start gap-3">
            <Badge className={cn(
              "shrink-0 mt-1 text-xs px-2 py-0.5 font-bold",
              qual.kind === "basic"
                ? "bg-white/20 text-white"
                : "bg-white/20 text-white"
            )}>
              {qual.kind === "basic" ? "REQUIRED" : "PREFERRED"}
            </Badge>
            <p className="text-lg font-bold text-white leading-snug">{qual.text}</p>
          </div>
        </div>
      </div>

      {/* Related responsibilities */}
      {relatedResps.length > 0 && (
        <Card className="p-3 border-sky-200 bg-sky-50/30 dark:border-sky-800/40 dark:bg-sky-950/10 space-y-2">
          <p className="text-[10px] font-medium text-sky-600 dark:text-sky-400 uppercase tracking-wider flex items-center gap-1">
            <ListChecks className="h-3 w-3" /> Related Responsibilities
          </p>
          {relatedResps.map((r, i) => {
            const covering = findBulletsCoveringResponsibility(r, allLockedFlat);
            return (
              <div key={i} className="space-y-0.5">
                <p className="text-xs text-foreground">{r}</p>
                {covering.length > 0 && (
                  <div className="flex items-center gap-1 ml-3">
                    <CheckCircle2 className="h-3 w-3 text-teal-500 shrink-0" />
                    <span className="text-[10px] text-teal-600 dark:text-teal-400">
                      Covered by: {covering.map((lb) => lb.sourceLabel).join(", ")}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {/* Already covered */}
      {coveringBullets.length > 0 && (
        <Card className="p-3 border-amber-200 bg-amber-50/30 dark:border-amber-800/40 dark:bg-amber-950/10">
          <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-1">
            Partially covered by locked bullets
          </p>
          {coveringBullets.map(({ qualId, bullet, overlapTerms }) => (
            <div key={`${qualId}-${bullet.bulletId}`} className="flex items-start gap-2 mb-1 last:mb-0">
              <CheckCircle2 className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
              <span className="text-xs">
                <span className="font-medium text-foreground">{bullet.sourceLabel}</span>
                <span className="text-muted-foreground ml-1">— {overlapTerms.slice(0, 4).join(", ")}</span>
              </span>
            </div>
          ))}
        </Card>
      )}

      {/* ── LOCKED BULLETS ────────────────────────────────────────── */}
      {realLocked.length > 0 && (
        <div className="space-y-2">
          {realLocked.map((lb) => (
            <Card key={lb.bulletId} className="p-3 border-teal-200 bg-teal-50/30 dark:border-teal-800/40 dark:bg-teal-950/10">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">{lb.bulletId}</Badge>
                  <span className="text-xs text-muted-foreground">{lb.sourceLabel}</span>
                </div>
                <Button variant="ghost" size="sm" className="text-xs h-6 text-muted-foreground hover:text-destructive"
                  onClick={() => onUnlockSingle(lb.bulletId)}>
                  <X className="h-3 w-3 mr-1" /> Remove
                </Button>
              </div>
              <p className="text-sm text-foreground">{lb.rewrittenText || lb.originalText}</p>
            </Card>
          ))}
        </div>
      )}

      {isSkipped && (
        <Card className="p-3 border-slate-200 bg-slate-50/30 dark:border-slate-700 dark:bg-slate-900/10">
          <p className="text-sm text-muted-foreground italic">Skipped — covered by other bullets</p>
        </Card>
      )}

      {/* ── LOADING ───────────────────────────────────────────────── */}
      {!hasLocked && !isSkipped && matchQuery.isLoading && (
        <div className="flex items-center gap-3 py-6 justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
          <span className="text-sm text-muted-foreground">Finding matches...</span>
        </div>
      )}

      {!hasLocked && !isSkipped && matchQuery.isError && (
        <Card className="p-4 border-destructive/50 bg-destructive/5 text-center">
          <p className="text-sm text-destructive">
            {matchQuery.error instanceof Error ? matchQuery.error.message : "Failed to match"}
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => matchQuery.refetch()}>Retry</Button>
        </Card>
      )}

      {/* ── CANDIDATES ────────────────────────────────────────────── */}
      {!hasLocked && !isSkipped && candidates.length > 0 && (
        <div className="space-y-3">
          {expCandidates.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                <Briefcase className="h-3 w-3" /> Experiences
              </h3>
              {expCandidates.map(renderCandidate)}
            </div>
          )}
          {projCandidates.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                <FolderGit2 className="h-3 w-3" /> Projects
              </h3>
              {projCandidates.map(renderCandidate)}
            </div>
          )}
        </div>
      )}

      {!hasLocked && !isSkipped && !matchQuery.isLoading && candidates.length === 0 && !matchQuery.isError && (
        <Card className="p-4 text-center">
          <p className="text-sm text-muted-foreground">No matching bullets found.</p>
        </Card>
      )}

      {/* Skip */}
      {!hasLocked && !isSkipped && !matchQuery.isLoading && (
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={handleSkip}>
          <SkipForward className="mr-1.5 h-3.5 w-3.5" /> Skip — already covered
        </Button>
      )}
    </div>
  );
}
