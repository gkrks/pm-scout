"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fetchDashboard } from "@/lib/api";

const DASHBOARD_TOKEN = process.env.NEXT_PUBLIC_DASHBOARD_TOKEN || "";

const CHART_COLORS = [
  "#6366f1", "#94a3b8", "#0d9488", "#a78bfa", "#64748b",
  "#818cf8", "#5eead4", "#cbd5e1",
];

function KPICard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </Card>
  );
}

function ChartCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("p-4", className)}>
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {children}
    </Card>
  );
}

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => fetchDashboard(DASHBOARD_TOKEN),
    staleTime: 120_000,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-screen-2xl px-4 py-12 sm:px-6 text-center">
        <p className="text-sm text-destructive">Failed to load dashboard data</p>
        <p className="text-xs text-muted-foreground mt-1">
          {error instanceof Error ? error.message : "Make sure Express is running"}
        </p>
      </div>
    );
  }

  const d = data as any;

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Job search analytics and insights
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <KPICard label="Discovered" value={d.totalDiscovered} sub={`${d.totalActive} active`} />
        <KPICard label="Applied" value={d.appliedCount} />
        <KPICard label="Interview Rate" value={`${d.interviewRate}%`} />
        <KPICard label="Avg Fit Score" value={d.avgFitScore || "-"} />
        <KPICard label="Apply Rate" value={`${d.applicationRate}%`} />
        <KPICard label="Avg YOE Required" value={d.avgYoe} />
        <KPICard label="Response Rate" value={d.respondedCount > 0 ? `${Math.round((d.respondedCount / (d.respondedCount + d.ghostedCount)) * 100)}%` : "-"} sub={`${d.ghostedCount} ghosted`} />
      </div>

      {/* Row 1: Funnel + Applied vs Discovered */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard title="Application Funnel">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={d.statusCounts} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="label" width={90} tick={{ fontSize: 11 }} />
              <ReTooltip />
              <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Applied vs Discovered per Week">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={(d.appliedVsDiscoveredPerWeek || []).slice(-12)}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="week" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <ReTooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="discovered" stroke="#6366f1" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="applied" stroke="#0d9488" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 2: Location + Tier + Work Type */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ChartCard title="Top Locations">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={(d.locationCounts || []).slice(0, 8)}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11 }} />
              <ReTooltip />
              <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Tier Distribution">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={d.tierCounts}
                dataKey="count"
                nameKey="label"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, value }: any) => `${name}: ${value}`}
              >
                {(d.tierCounts || []).map((_: any, i: number) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <ReTooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Work Type">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={d.workTypeCounts}
                dataKey="count"
                nameKey="label"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, value }: any) => `${name}: ${value}`}
              >
                {(d.workTypeCounts || []).map((_: any, i: number) => (
                  <Cell key={i} fill={CHART_COLORS[i + 3]} />
                ))}
              </Pie>
              <ReTooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 3: Top Skills + Fit Score Trend */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard title="Top Skills in Demand">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={(d.topSkills || []).slice(0, 12)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="skill" width={120} tick={{ fontSize: 10 }} />
              <ReTooltip />
              <Bar dataKey="count" fill="#0d9488" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Weekly Fit Score Trend">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={(d.weeklyFitScoreTrend || []).slice(-12)}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="week" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
              <ReTooltip />
              <Line type="monotone" dataKey="avgScore" stroke="#0d9488" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 4: Time to Apply + Stale Opportunities */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard title="Time to Apply">
          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground text-xs mb-2">
              Avg: {d.avgTimeToApplyHours}h · Median: {d.medianTimeToApplyHours}h
            </p>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={d.timeToApplyBuckets}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11 }} />
              <ReTooltip />
              <Bar dataKey="count" fill="#94a3b8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Stale Opportunities (act now)">
          <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
            {(d.staleOpportunities || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No stale opportunities</p>
            ) : (
              (d.staleOpportunities || []).slice(0, 10).map((opp: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-md border border-border p-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{opp.title}</p>
                    <p className="text-xs text-muted-foreground">{opp.company}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {opp.daysAgo}d ago
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </ChartCard>
      </div>

      {/* Row 5: Top Hiring Companies + Hot Companies */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard title="Top Hiring Companies">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={(d.topHiringCompanies || []).slice(0, 8)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="label" width={100} tick={{ fontSize: 10 }} />
              <ReTooltip />
              <Bar dataKey="count" fill="#a78bfa" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Hot Companies (2+ roles in 7 days)">
          <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
            {(d.hotCompanies || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No hot companies this week</p>
            ) : (
              (d.hotCompanies || []).map((hc: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-md border border-border p-2"
                >
                  <span className="text-sm font-medium">{hc.company}</span>
                  <Badge variant="secondary" className="text-xs">
                    {hc.newRoles} new
                  </Badge>
                </div>
              ))
            )}
          </div>
        </ChartCard>
      </div>

      <p className="text-xs text-muted-foreground text-center pt-4">
        Generated at {d.generatedAt ? new Date(d.generatedAt).toLocaleString() : "unknown"}
      </p>
    </div>
  );
}
