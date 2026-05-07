"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ExternalLink, MapPin, Calendar, Loader2, RefreshCw, CheckCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { WizardClient } from "./wizard-client";
import { cn } from "@/lib/utils";
import {
  scoreFit,
  markApplied,
  type FitListingData,
} from "@/lib/api";

interface FitClientProps {
  listing: FitListingData;
  token: string;
}

function formatPostedDate(dateStr: string | null): { relative: string; absolute: string } | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;

  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  let relative: string;
  if (diffHours < 1) relative = "Just now";
  else if (diffHours < 24) relative = `${diffHours}h ago`;
  else if (diffDays === 1) relative = "Yesterday";
  else if (diffDays < 7) relative = `${diffDays} days ago`;
  else if (diffDays < 30) relative = `${Math.floor(diffDays / 7)}w ago`;
  else relative = `${Math.floor(diffDays / 30)}mo ago`;

  const absolute = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return { relative, absolute };
}

export function FitClient({ listing, token }: FitClientProps) {
  const jobId = listing.jobId;

  // ── Score state ────────────────────────────────────────────────
  const [forceRefresh, setForceRefresh] = useState(false);

  const scoreQuery = useQuery({
    queryKey: ["fit-score", jobId, forceRefresh],
    queryFn: () => scoreFit(jobId, token, forceRefresh),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const scoreData = scoreQuery.data;

  // ── Apply state ────────────────────────────────────────────────
  const applyMutation = useMutation({
    mutationFn: () => markApplied(jobId, token, listing.emails[0]),
    onSuccess: (data) => {
      toast.success(
        data.already_applied
          ? `Already applied on ${data.applied_date}`
          : `Marked as applied`
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      {/* Job header */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{listing.title}</h1>
            <p className="text-base text-muted-foreground">{listing.companyName}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {listing.applicationStatus?.applied ? (
              <Badge className="bg-teal-50 text-teal-700 dark:bg-teal-950/20 dark:text-teal-300">
                <CheckCircle className="mr-1 h-3 w-3" />
                Applied {listing.applicationStatus.appliedDate}
              </Badge>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => applyMutation.mutate()}
                disabled={applyMutation.isPending}
              >
                {applyMutation.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                )}
                Mark Applied
              </Button>
            )}
            <a href={listing.roleUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="sm">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                View JD
              </Button>
            </a>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {listing.location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {listing.location}
            </span>
          )}
          {listing.isRemote && <Badge variant="outline" className="text-xs">Remote</Badge>}
          {listing.isHybrid && <Badge variant="outline" className="text-xs">Hybrid</Badge>}
          {(() => {
            const posted = formatPostedDate(listing.postedDate);
            const firstSeen = formatPostedDate(listing.firstSeenAt);
            return (
              <>
                {posted && (
                  <span className="flex items-center gap-1" title={`Posted: ${posted.absolute}`}>
                    <Calendar className="h-3.5 w-3.5" />
                    Posted {posted.absolute} ({posted.relative})
                  </span>
                )}
                {!posted && firstSeen && (
                  <span className="flex items-center gap-1" title={`First seen: ${firstSeen.absolute}`}>
                    <Calendar className="h-3.5 w-3.5" />
                    First seen {firstSeen.absolute} ({firstSeen.relative})
                  </span>
                )}
              </>
            );
          })()}
          {listing.ats && (
            <Badge variant="secondary" className="text-xs">{listing.ats}</Badge>
          )}
        </div>
      </div>

      <Separator />

      {/* Wizard flow */}
      {scoreQuery.isLoading ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
            <p className="text-sm text-muted-foreground">
              Scoring resume against qualifications...
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-lg" />
              ))}
            </div>
            <div className="space-y-3">
              <Skeleton className="h-32 w-full rounded-lg" />
              <Skeleton className="h-48 w-full rounded-lg" />
            </div>
          </div>
        </div>
      ) : scoreQuery.isError ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-center">
          <p className="text-sm font-medium text-destructive">Scoring failed</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {scoreQuery.error instanceof Error ? scoreQuery.error.message : "Unknown error"}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              setForceRefresh(true);
              scoreQuery.refetch();
            }}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      ) : scoreData ? (
        <WizardClient
          scoreData={scoreData}
          listing={listing}
          token={token}
        />
      ) : null}
    </div>
  );
}
