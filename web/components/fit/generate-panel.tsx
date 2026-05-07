"use client";

import { Download, FileText, Loader2, CheckCircle, AlertTriangle, Eye, ShieldCheck, XCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LockedBullet } from "@/lib/types";
import { GLOBAL_BULLET_CAP, flatLockedBullets } from "@/lib/wizard-state";
import { useMemo, useState } from "react";
import { validateResumeRules, type RuleWarning } from "@/lib/resume-rules";

const BULLET_CHAR_WARN = 200;
const BULLET_CHAR_LIMIT = 225;

interface GeneratePanelProps {
  isGenerating: boolean;
  isGenerated: boolean;
  basename: string | null;
  summaryWarning: string | null;
  lockedBullets: Map<string, LockedBullet[]>;
  summaryText: string;
  jdTitle: string;
  jdRequiredQuals: string[];
  jdPreferredQuals: string[];
  jdResponsibilities: string[];
  skills: { category: string; items: string[] }[];
  addedSkills: Map<string, string[]>;
  newSkillSections: { name: string; list: string }[];
  previewPdfUrl: string;
  onGenerate: () => void;
  downloadPdfUrl: string;
  downloadDocxUrl: string;
}

function bulletCharBadge(count: number) {
  return (
    <span className={cn(
      "text-[10px] font-mono px-1 py-0 rounded",
      count > BULLET_CHAR_LIMIT
        ? "bg-rose-100 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400"
        : count > BULLET_CHAR_WARN
          ? "bg-amber-100 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"
          : "bg-teal-100 text-teal-600 dark:bg-teal-950/30 dark:text-teal-400"
    )}>
      {count}
    </span>
  );
}

function severityIcon(severity: RuleWarning["severity"]) {
  switch (severity) {
    case "error": return <XCircle className="h-3.5 w-3.5 text-rose-500 shrink-0" />;
    case "warning": return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
    case "info": return <Info className="h-3.5 w-3.5 text-sky-500 shrink-0" />;
  }
}

function severityBg(severity: RuleWarning["severity"]) {
  switch (severity) {
    case "error": return "bg-rose-50/50 dark:bg-rose-950/10";
    case "warning": return "bg-amber-50/50 dark:bg-amber-950/10";
    case "info": return "bg-sky-50/50 dark:bg-sky-950/10";
  }
}

export function GeneratePanel({
  isGenerating,
  isGenerated,
  basename,
  summaryWarning,
  lockedBullets,
  summaryText,
  jdRequiredQuals,
  jdPreferredQuals,
  jdResponsibilities,
  skills,
  addedSkills,
  newSkillSections,
  previewPdfUrl,
  onGenerate,
  downloadPdfUrl,
  downloadDocxUrl,
}: GeneratePanelProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [showAudit, setShowAudit] = useState(true);
  const [showRules, setShowRules] = useState(true);

  // Build bullet audit
  const bullets: { text: string; charCount: number; source: string; isRewritten: boolean }[] = [];
  for (const lb of flatLockedBullets(lockedBullets)) {
    if (lb.isTraitSkip) continue;
    const text = lb.rewrittenText || lb.originalText;
    bullets.push({
      text,
      charCount: text.length,
      source: lb.sourceLabel,
      isRewritten: !!lb.rewrittenText,
    });
  }

  const bulletTexts = bullets.map((b) => b.text);
  const overLimitCount = bullets.filter((b) => b.charCount > BULLET_CHAR_LIMIT).length;
  const warningCount = bullets.filter((b) => b.charCount > BULLET_CHAR_WARN && b.charCount <= BULLET_CHAR_LIMIT).length;

  // Collect bullet source labels for headline/poison checks
  const bulletSources = useMemo(() => {
    const sources: string[] = [];
    for (const lb of flatLockedBullets(lockedBullets)) {
      if (!lb.isTraitSkip && lb.sourceLabel && !sources.includes(lb.sourceLabel)) {
        sources.push(lb.sourceLabel);
      }
    }
    return sources;
  }, [lockedBullets]);

  // Run resume rules validation
  const ruleWarnings = useMemo(() => {
    if (bulletTexts.length === 0 && !summaryText) return [];
    return validateResumeRules({
      bulletTexts,
      bulletSources,
      summaryText,
      jdTitle,
      jdRequiredQuals,
      jdPreferredQuals,
      jdResponsibilities,
      skills,
      addedSkills,
      newSkillSections,
    });
  }, [bulletTexts, bulletSources, summaryText, jdTitle, jdRequiredQuals, jdPreferredQuals, jdResponsibilities, skills, addedSkills, newSkillSections]);

  const errorCount = ruleWarnings.filter((w) => w.severity === "error").length;
  const warnCount = ruleWarnings.filter((w) => w.severity === "warning").length;
  const infoCount = ruleWarnings.filter((w) => w.severity === "info").length;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Generate Resume</h3>

      {/* Resume Rules Check */}
      {ruleWarnings.length > 0 && (
        <Card className="p-3 space-y-2">
          <button
            onClick={() => setShowRules(!showRules)}
            className="flex items-center justify-between w-full text-left"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground">Resume Rules Check</span>
              {errorCount > 0 && (
                <Badge className="text-[10px] px-1.5 py-0 bg-rose-100 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400">
                  {errorCount} error{errorCount !== 1 ? "s" : ""}
                </Badge>
              )}
              {warnCount > 0 && (
                <Badge className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
                  {warnCount} warning{warnCount !== 1 ? "s" : ""}
                </Badge>
              )}
              {infoCount > 0 && (
                <Badge className="text-[10px] px-1.5 py-0 bg-sky-100 text-sky-600 dark:bg-sky-950/30 dark:text-sky-400">
                  {infoCount} info
                </Badge>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground">{showRules ? "hide" : "show"}</span>
          </button>

          {showRules && (
            <div className="space-y-1.5 mt-1">
              {ruleWarnings.map((w, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-start gap-2 rounded-md px-2 py-1.5 text-xs",
                    severityBg(w.severity)
                  )}
                >
                  {severityIcon(w.severity)}
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-foreground">{w.ruleLabel}</span>
                    <span className="text-muted-foreground ml-1.5">{w.message}</span>
                    {w.detail && (
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{w.detail}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {ruleWarnings.length === 0 && bulletTexts.length > 0 && (
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-teal-500" />
            <span className="text-xs font-semibold text-teal-600 dark:text-teal-400">All resume rules pass</span>
          </div>
        </Card>
      )}

      {/* Bullet Audit */}
      <Card className="p-3 space-y-2">
        <button
          onClick={() => setShowAudit(!showAudit)}
          className="flex items-center justify-between w-full text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">Bullet Audit</span>
            <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
              {bullets.length}/{GLOBAL_BULLET_CAP}
            </Badge>
            {overLimitCount > 0 && (
              <Badge className="text-[10px] px-1.5 py-0 bg-rose-100 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400">
                {overLimitCount} over {BULLET_CHAR_LIMIT}
              </Badge>
            )}
            {warningCount > 0 && (
              <Badge className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
                {warningCount} over {BULLET_CHAR_WARN}
              </Badge>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground">{showAudit ? "hide" : "show"}</span>
        </button>

        {showAudit && (
          <div className="space-y-1.5 mt-1">
            {bullets.map((b, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-2 rounded-md px-2 py-1.5 text-xs",
                  b.charCount > BULLET_CHAR_LIMIT
                    ? "bg-rose-50/50 dark:bg-rose-950/10"
                    : b.charCount > BULLET_CHAR_WARN
                      ? "bg-amber-50/50 dark:bg-amber-950/10"
                      : "bg-muted/30"
                )}
              >
                <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                  {bulletCharBadge(b.charCount)}
                  {b.charCount > BULLET_CHAR_LIMIT && (
                    <AlertTriangle className="h-3 w-3 text-rose-500" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-muted-foreground">{b.source}</span>
                  {b.isRewritten && (
                    <span className="ml-1 text-[10px] text-teal-600 dark:text-teal-400">(rewritten)</span>
                  )}
                  <p className="text-foreground mt-0.5 line-clamp-2">{b.text}</p>
                </div>
              </div>
            ))}
            {bullets.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                No bullets locked yet
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Generate button */}
      <Button
        onClick={onGenerate}
        disabled={isGenerating}
        className="w-full bg-indigo-500 hover:bg-indigo-600 text-white"
      >
        {isGenerating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Generating...
          </>
        ) : isGenerated ? (
          <>
            <CheckCircle className="mr-2 h-4 w-4" />
            Regenerate Resume
          </>
        ) : (
          <>
            <FileText className="mr-2 h-4 w-4" />
            Generate Resume
          </>
        )}
      </Button>

      {summaryWarning && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {summaryWarning}
        </p>
      )}

      {isGenerated && basename && (
        <>
          {/* Download buttons */}
          <div className="flex gap-2">
            <a href={downloadPdfUrl} className="flex-1">
              <Button variant="outline" className="w-full" size="sm">
                <Download className="mr-1.5 h-3.5 w-3.5" />
                PDF
              </Button>
            </a>
            <a href={downloadDocxUrl} className="flex-1">
              <Button variant="outline" className="w-full" size="sm">
                <Download className="mr-1.5 h-3.5 w-3.5" />
                DOCX
              </Button>
            </a>
          </div>

          {/* PDF Preview toggle */}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setShowPreview(!showPreview)}
          >
            <Eye className="mr-1.5 h-3.5 w-3.5" />
            {showPreview ? "Hide Preview" : "Preview PDF"}
          </Button>

          {/* PDF Preview Modal */}
          {showPreview && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowPreview(false)}>
              <div className="relative w-[90vw] max-w-4xl h-[90vh] rounded-lg overflow-hidden shadow-2xl bg-white" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setShowPreview(false)}
                  className="absolute top-3 right-3 z-10 rounded-full bg-black/70 text-white p-1.5 hover:bg-black/90"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
                <iframe
                  src={previewPdfUrl}
                  className="w-full h-full"
                  title="Resume PDF Preview"
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
