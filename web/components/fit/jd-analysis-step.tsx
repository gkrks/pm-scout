"use client";

import { useState } from "react";
import { CheckCircle, XCircle, MapPin, Building2, Briefcase, ChevronDown, ChevronRight, ListChecks, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PreResolvedResult } from "@/lib/types";
import type { FitListingData } from "@/lib/api";

interface JDAnalysisStepProps {
  listing: FitListingData;
  preResolved: PreResolvedResult[];
  onNext: () => void;
}

const categoryLabel: Record<string, string> = {
  education_check: "Education",
  experience_years: "Experience",
  skill_check: "Skill",
  values_statement: "Values",
};

export function JDAnalysisStep({ listing, preResolved, onNext }: JDAnalysisStepProps) {
  const [showResponsibilities, setShowResponsibilities] = useState(false);
  const [showRequired, setShowRequired] = useState(false);
  const [showPreferred, setShowPreferred] = useState(false);

  return (
    <div className="space-y-6">
      {/* Company & Role */}
      <div className="space-y-3">
        <h2 className="text-xl font-bold tracking-tight">JD Analysis</h2>
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold text-foreground">{listing.companyName}</span>
          </div>
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-muted-foreground" />
            <span className="text-foreground">{listing.title}</span>
          </div>
          {listing.location && (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {listing.location}
                {listing.isRemote && " (Remote)"}
                {listing.isHybrid && " (Hybrid)"}
              </span>
            </div>
          )}
          {listing.ats && (
            <Badge variant="secondary" className="text-xs">{listing.ats}</Badge>
          )}
        </Card>
      </div>

      {/* Role Context */}
      {listing.roleContext && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Role Context
          </h3>
          <Card className="p-3">
            <p className="text-sm text-muted-foreground leading-relaxed">{listing.roleContext}</p>
          </Card>
        </div>
      )}

      {/* Responsibilities */}
      {listing.responsibilities.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowResponsibilities(!showResponsibilities)}
            className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-foreground/80 transition-colors"
          >
            {showResponsibilities ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            Responsibilities
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
              {listing.responsibilities.length}
            </Badge>
          </button>
          {showResponsibilities && (
            <Card className="p-3">
              <ul className="space-y-2">
                {listing.responsibilities.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="text-[10px] font-mono text-muted-foreground/60 mt-0.5 shrink-0 w-4 text-right">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{r}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {/* Required Qualifications */}
      {listing.requiredQuals.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowRequired(!showRequired)}
            className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-foreground/80 transition-colors"
          >
            {showRequired ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Required Qualifications
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400 font-normal">
              {listing.requiredQuals.length}
            </Badge>
          </button>
          {showRequired && (
            <Card className="p-3">
              <ul className="space-y-2">
                {listing.requiredQuals.map((q, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="text-[10px] font-mono text-muted-foreground/60 mt-0.5 shrink-0 w-4 text-right">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{q}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {/* Preferred Qualifications */}
      {listing.preferredQuals.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowPreferred(!showPreferred)}
            className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-foreground/80 transition-colors"
          >
            {showPreferred ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Preferred Qualifications
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-zinc-300 text-zinc-600 dark:border-zinc-600 dark:text-zinc-400 font-normal">
              {listing.preferredQuals.length}
            </Badge>
          </button>
          {showPreferred && (
            <Card className="p-3">
              <ul className="space-y-2">
                {listing.preferredQuals.map((q, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="text-[10px] font-mono text-muted-foreground/60 mt-0.5 shrink-0 w-4 text-right">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{q}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {/* Pre-resolved checks */}
      {preResolved.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Quick Checks</h3>
          {preResolved.map((item) => (
            <div
              key={item.qualification_id}
              className="flex items-start gap-2 rounded-md border border-border bg-card p-3"
            >
              {item.met ? (
                <CheckCircle className="h-4 w-4 text-teal-500 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              )}
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
          ))}
        </div>
      )}

      {/* Qualification counts */}
      <div className={cn(
        "grid gap-3",
        listing.responsibilities.length > 0 ? "grid-cols-3" : "grid-cols-2"
      )}>
        <Card className="p-3 text-center">
          <div className="text-2xl font-bold text-foreground">
            {listing.requiredQuals.length}
          </div>
          <div className="text-xs text-muted-foreground">Required</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-2xl font-bold text-foreground">
            {listing.preferredQuals.length}
          </div>
          <div className="text-xs text-muted-foreground">Preferred</div>
        </Card>
        {listing.responsibilities.length > 0 && (
          <Card className="p-3 text-center">
            <div className="text-2xl font-bold text-foreground">
              {listing.responsibilities.length}
            </div>
            <div className="text-xs text-muted-foreground">Responsibilities</div>
          </Card>
        )}
      </div>

      <Button onClick={onNext} className="w-full">
        Start Matching
      </Button>
    </div>
  );
}
