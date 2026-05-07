"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ExternalLink, MapPin, Calendar, ArrowLeft, FileSearch,
  CheckCircle, Loader2, Save,
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fetchApplication, updateApplication } from "@/lib/api";

const DASHBOARD_TOKEN = process.env.NEXT_PUBLIC_DASHBOARD_TOKEN || "";

const STATUS_OPTIONS = [
  { value: "applied", label: "Applied" },
  { value: "phone_screen", label: "Phone Screen" },
  { value: "interviewing", label: "Interviewing" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
];

function statusColor(status: string) {
  switch (status) {
    case "applied": return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
    case "phone_screen": return "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300";
    case "interviewing": return "bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300";
    case "offer": return "bg-teal-50 text-teal-700 dark:bg-teal-950/20 dark:text-teal-300";
    case "rejected": return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
    case "withdrawn": return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
    default: return "";
  }
}

function daysAgo(dateStr: string | null): string {
  if (!dateStr) return "-";
  const diff = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return `${diff} days ago`;
}

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["application", id],
    queryFn: () => fetchApplication(id, DASHBOARD_TOKEN),
    staleTime: 30_000,
  });

  const [notes, setNotes] = useState("");
  const [referralContact, setReferralContact] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);

  const app = data as any;
  const listing = app?.listing;

  useEffect(() => {
    if (app) {
      setNotes(app.notes || "");
      setReferralContact(app.referral_contact || "");
    }
  }, [app]);

  const updateMutation = useMutation({
    mutationFn: (updates: { status?: string; notes?: string; referral_contact?: string }) =>
      updateApplication(id, updates, DASHBOARD_TOKEN),
    onSuccess: () => {
      toast.success("Updated");
      queryClient.invalidateQueries({ queryKey: ["application", id] });
      setNotesDirty(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-screen-lg px-4 py-6 sm:px-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !app) {
    return (
      <div className="mx-auto max-w-screen-lg px-4 py-12 sm:px-6 text-center">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Application not found"}
        </p>
        <Link href="/" className="mt-4 inline-flex items-center gap-1 text-sm text-indigo-500 hover:text-indigo-600">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Tracker
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-screen-lg px-4 py-6 sm:px-6 space-y-6">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Tracker
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {listing?.jd_job_title || listing?.title || "Unknown Role"}
          </h1>
          <p className="text-base text-muted-foreground">
            {listing?.companyName || "Unknown Company"}
          </p>
        </div>
        <Badge className={cn("text-sm px-3 py-1", statusColor(app.status))}>
          {STATUS_OPTIONS.find((s) => s.value === app.status)?.label || app.status}
        </Badge>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        {listing?.location_city && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {listing.location_city}
          </span>
        )}
        {app.applied_date && (
          <span className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            Applied {app.applied_date}
          </span>
        )}
        {app.fitScore !== null && (
          <span className={cn(
            "font-semibold",
            app.fitScore >= 70 ? "text-teal-600" : app.fitScore >= 40 ? "text-slate-500" : "text-rose-400"
          )}>
            Fit: {Math.round(app.fitScore)}%
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <a href={listing?.role_url} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="sm">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              View JD
            </Button>
          </a>
          <Link href={`/fit/${app.listing_id}`}>
            <Button variant="ghost" size="sm">
              <FileSearch className="mr-1.5 h-3.5 w-3.5" />
              Check Fit
            </Button>
          </Link>
        </div>
      </div>

      <Separator />

      {/* Status + Details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left: Status + Timeline */}
        <Card className="p-4 space-y-4">
          <h3 className="text-sm font-semibold">Status</h3>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => updateMutation.mutate({ status: opt.value })}
                disabled={updateMutation.isPending}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                  app.status === opt.value
                    ? "border-indigo-400 bg-indigo-50 text-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-400"
                    : "border-border text-muted-foreground hover:bg-accent"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <Separator />

          <h3 className="text-sm font-semibold">Timeline</h3>
          <div className="space-y-2 text-xs text-muted-foreground">
            {app.applied_date && (
              <div className="flex items-center gap-2">
                <CheckCircle className="h-3 w-3 text-teal-500" />
                <span>Applied on {app.applied_date}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-muted" />
              <span>Created {new Date(app.created_at).toLocaleDateString()}</span>
            </div>
            {app.updated_at !== app.created_at && (
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-muted" />
                <span>Updated {daysAgo(app.updated_at)}</span>
              </div>
            )}
          </div>

          {app.applied_by && (
            <>
              <Separator />
              <div>
                <p className="text-xs text-muted-foreground">Applied via</p>
                <p className="text-sm">{app.applied_by}</p>
              </div>
            </>
          )}
        </Card>

        {/* Right: Notes + Referral */}
        <Card className="p-4 space-y-4 md:col-span-2">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Notes</h3>
              {notesDirty && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => updateMutation.mutate({ notes })}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="mr-1 h-3 w-3" />
                  )}
                  Save
                </Button>
              )}
            </div>
            <Textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setNotesDirty(true);
              }}
              placeholder="Add notes about this application..."
              className="min-h-[200px] text-sm"
            />
          </div>

          <Separator />

          <div>
            <h3 className="text-sm font-semibold mb-2">Referral Contact</h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={referralContact}
                onChange={(e) => setReferralContact(e.target.value)}
                placeholder="Name or email of referral..."
                className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  updateMutation.mutate({ referral_contact: referralContact })
                }
                disabled={updateMutation.isPending}
              >
                Save
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
