"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Search, ExternalLink, MapPin, ArrowUpDown, Filter,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fetchJobs } from "@/lib/api";

const DASHBOARD_TOKEN = process.env.NEXT_PUBLIC_DASHBOARD_TOKEN || "";

type SortKey = "firstSeenAt" | "title" | "companyName";
type SortDir = "asc" | "desc";

function daysAgo(dateStr: string | null): string {
  if (!dateStr) return "-";
  const diff = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diff === 0) return "Today";
  if (diff === 1) return "1d";
  return `${diff}d`;
}

export default function JobsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["jobs-list"],
    queryFn: () => fetchJobs(DASHBOARD_TOKEN),
    staleTime: 60_000,
  });

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("firstSeenAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterApm, setFilterApm] = useState(false);
  const [filterActive, setFilterActive] = useState(true);

  const jobs = data?.jobs || [];

  const filtered = useMemo(() => {
    let result = jobs;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (j) =>
          j.title.toLowerCase().includes(q) ||
          j.companyName.toLowerCase().includes(q)
      );
    }

    if (filterApm) result = result.filter((j) => j.hasApmProgram);
    if (filterActive) result = result.filter((j) => j.isActive);

    result.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "firstSeenAt") {
        cmp = new Date(a.firstSeenAt).getTime() - new Date(b.firstSeenAt).getTime();
      } else if (sortKey === "title") {
        cmp = a.title.localeCompare(b.title);
      } else if (sortKey === "companyName") {
        cmp = a.companyName.localeCompare(b.companyName);
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return result;
  }, [jobs, search, sortKey, sortDir, filterApm, filterActive]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">All Jobs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {filtered.length} of {jobs.length} listings
        </p>
      </div>

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <button
            onClick={() => setFilterApm(!filterApm)}
            className={cn(
              "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
              filterApm
                ? "border-indigo-400 bg-indigo-50 text-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-400"
                : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            APM
          </button>
          <button
            onClick={() => setFilterActive(!filterActive)}
            className={cn(
              "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
              filterActive
                ? "border-indigo-400 bg-indigo-50 text-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-400"
                : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            Active Only
          </button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                {([
                  ["title", "Title"],
                  ["companyName", "Company"],
                  ["firstSeenAt", "Discovered"],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <th
                    key={key}
                    className="px-3 py-2 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                    onClick={() => toggleSort(key)}
                  >
                    <span className="flex items-center gap-1">
                      {label}
                      {sortKey === key && (
                        <ArrowUpDown className="h-3 w-3" />
                      )}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  Location
                </th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  Links
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((job) => (
                <tr
                  key={job.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-3 py-2.5 max-w-[300px]">
                    <p className="truncate font-medium">{job.title}</p>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {job.companyName}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {daysAgo(job.firstSeenAt)}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      {job.hasApmProgram && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1 py-0 border-teal-300/60 text-teal-600 dark:border-teal-700/50 dark:text-teal-400"
                        >
                          APM
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    <span className="flex items-center gap-1 truncate max-w-[150px]">
                      {job.isRemote ? "Remote" : job.locationCity || "-"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <a
                        href={job.roleUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                        title="View JD"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      <Link
                        href={`/fit/${job.id}`}
                        className="text-xs text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 font-medium"
                      >
                        Check Fit
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 200 && (
            <p className="px-3 py-2 text-xs text-muted-foreground text-center border-t border-border">
              Showing first 200 of {filtered.length} results
            </p>
          )}
        </div>
      )}
    </div>
  );
}
