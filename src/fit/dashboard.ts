/**
 * Analytics Dashboard — Route handler + data aggregation.
 *
 * GET /dashboard?token=xxx&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Fetches all historical data from Supabase (5 parallel queries),
 * aggregates server-side, and renders a Chart.js-powered dashboard.
 */

import fs from "fs";
import path from "path";
import { Request, Response } from "express";
import { getSupabaseClient, loadMasterResume } from "../storage/supabase";
import {
  TECHNICAL_SKILLS,
  TOOLS,
  METHODOLOGIES,
  SOFT_SKILLS,
  DOMAIN_EXPERTISE,
  CERTIFICATIONS,
} from "../lib/skillsList";
import { renderDashboardPage } from "./dashboardRender";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DashboardData {
  // KPIs
  totalDiscovered: number;
  totalActive: number;
  appliedCount: number;
  interviewRate: number;
  avgFitScore: number;
  applicationRate: number;
  avgYoe: number;

  // Funnel
  statusCounts: { label: string; count: number }[];

  // Time series (weekly buckets)
  applicationsPerWeek: { week: string; count: number }[];
  discoveredPerWeek: { week: string; count: number }[];
  appliedVsDiscoveredPerWeek: { week: string; applied: number; discovered: number }[];

  // Skills
  topSkills: { skill: string; count: number }[];
  skillsGapTreemap: { skill: string; count: number; category: string }[];
  topReusedBullets: { text: string; count: number }[];

  // Geography / work type
  locationCounts: { label: string; count: number }[];
  workTypeCounts: { label: string; count: number }[];
  tierCounts: { label: string; count: number }[];
  companyCategoryCounts: { label: string; count: number }[];

  // New metrics
  topHiringCompanies: { label: string; count: number }[];
  atsPlatformCounts: { label: string; count: number }[];
  activeVsClosed: { label: string; count: number }[];

  // Application timing
  timeToApplyBuckets: { label: string; count: number }[];
  applicationsByHour: { hour: number; count: number }[];
  applicationsByDayOfWeek: { day: string; count: number }[];
  appsByDayAndHour: { day: string; hour: number; count: number }[];
  applicationsPerDay: { date: string; count: number }[];
  appliedCompanies: { label: string; count: number }[];
  companyCoverage: { company: string; discovered: number; applied: number }[];
  freshnessAtApply: { label: string; count: number }[];
  discoveryByHour: { hour: number; count: number }[];
  avgTimeToApplyHours: number;
  medianTimeToApplyHours: number;

  // "Am I wasting time?"
  fitScoreVsOutcome: { score: number; status: string; title: string; company: string }[];
  rejectionByCategory: { category: string; applied: number; rejected: number; rate: number }[];
  yoeMismatch: { label: string; applied: number; interviewed: number }[];
  userYoe: number;

  // "What should I do today?"
  staleOpportunities: { title: string; company: string; tier: number; daysAgo: number; roleUrl: string; jobId: string }[];
  hotCompanies: { company: string; newRoles: number }[];

  // "Pipeline mechanics"
  funnelRates: { from: string; to: string; rate: number; count: number }[];
  avgDaysPerStage: { stage: string; avgDays: number }[];
  responseRate: { label: string; count: number }[];
  ghostedCount: number;
  respondedCount: number;

  // "Competition"
  listingLifespanBuckets: { label: string; count: number }[];
  avgListingLifespanDays: number;
  repostedJobs: number;
  repostedList: { title: string; company: string; times: number }[];
  salaryBuckets: { label: string; count: number }[];
  avgSalaryMin: number;
  avgSalaryMax: number;
  jobsWithSalary: number;

  // "Getting better?"
  weeklyFitScoreTrend: { week: string; avgScore: number; count: number }[];
  applicationQualityTrend: { week: string; avgTier: number }[];
  weeklyGapTrend: { week: string; avgGaps: number }[];

  // Trends
  newJobsPerWeek: { week: string; count: number }[];
  marketVelocity: { week: string; ratio: number }[];

  // Meta
  dateFrom: string | null;
  dateTo: string | null;
  generatedAt: string;
  token: string;
}

// ── Skill categorization ─────────────────────────────────────────────────────

const CATEGORY_LISTS: [string, string[]][] = [
  ["Technical", TECHNICAL_SKILLS],
  ["Tools", TOOLS],
  ["Methodologies", METHODOLOGIES],
  ["Soft Skills", SOFT_SKILLS],
  ["Domain", DOMAIN_EXPERTISE],
  ["Certifications", CERTIFICATIONS],
];

function classifySkill(skill: string): string {
  const lower = skill.toLowerCase();
  for (const [category, keywords] of CATEGORY_LISTS) {
    for (const kw of keywords) {
      const kwLower = kw.replace(/\\\+/g, "+").toLowerCase();
      if (lower === kwLower || lower.includes(kwLower) || kwLower.includes(lower)) {
        return category;
      }
    }
  }
  return "Other";
}

// ── Week bucketing ───────────────────────────────────────────────────────────

function isoWeek(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "unknown";
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return monday.toISOString().split("T")[0];
}

// ── LA timezone helper ───────────────────────────────────────────────────────

function toLADate(dateStr: string): Date | null {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  // Convert to LA timezone by formatting and reparsing
  const laStr = d.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  return new Date(laStr);
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function handleDashboard(req: Request, res: Response): Promise<void> {
  // Auth
  const dashToken = process.env.DASHBOARD_TOKEN || "";
  if (!dashToken) {
    res.status(500).send("DASHBOARD_TOKEN not configured");
    return;
  }
  const token = (req.query.token as string) || "";
  if (token !== dashToken) {
    res.status(401).json({ error: "Invalid dashboard token" });
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const dateFrom = (req.query.from as string) || null;
    const dateTo = (req.query.to as string) || null;

    // ── 5 parallel queries ───────────────────────────────────────────────

    let listingsQuery = supabase
      .from("job_listings")
      .select("id, title, location_city, is_remote, is_hybrid, tier, first_seen_at, last_seen_at, is_active, closed_at, jd_extracted_skills, company_id, ats_platform, yoe_min, yoe_max, salary_min, salary_max, role_url")
      .order("first_seen_at", { ascending: false })
      .limit(10000);
    if (dateFrom) listingsQuery = listingsQuery.gte("first_seen_at", dateFrom);
    if (dateTo) listingsQuery = listingsQuery.lte("first_seen_at", dateTo + "T23:59:59Z");

    const [listingsRes, applicationsRes, companiesRes, fitCacheRes, runsRes, reactivationsRes] = await Promise.all([
      listingsQuery,
      supabase.from("applications").select("listing_id, status, applied_date, created_at, updated_at"),
      supabase.from("companies").select("id, name, category, has_apm_program"),
      supabase.from("fit_score_cache").select("listing_id, score_response, skills_gap_remaining"),
      supabase
        .from("parser_runs")
        .select("started_at, listings_new, listings_deactivated, listings_found")
        .eq("status", "completed")
        .order("started_at", { ascending: true })
        .limit(5000),
      supabase
        .from("listing_runs")
        .select("listing_id, seen_state")
        .eq("seen_state", "reactivated")
        .limit(5000),
    ]);

    const listings = listingsRes.data || [];
    const applications = applicationsRes.data || [];
    const companies = companiesRes.data || [];
    const fitCache = fitCacheRes.data || [];
    const runs = runsRes.data || [];
    const reactivatedEntries = reactivationsRes.data || [];

    // ── Build lookup maps ────────────────────────────────────────────────

    const companyMap = new Map<string, any>();
    for (const c of companies) companyMap.set(c.id, c);

    // ── KPIs ─────────────────────────────────────────────────────────────

    const totalDiscovered = listings.length;
    const totalActive = listings.filter((l: any) => l.is_active).length;

    const appliedStatuses = new Set(["applied", "interviewing", "offer", "rejected", "withdrawn"]);
    const appliedApps = applications.filter((a: any) => appliedStatuses.has(a.status));
    const appliedCount = appliedApps.length;

    const interviewingCount = applications.filter((a: any) => a.status === "interviewing" || a.status === "offer").length;
    const interviewRate = appliedCount > 0 ? Math.round((interviewingCount / appliedCount) * 100) : 0;

    const applicationRate = totalDiscovered > 0 ? Math.round((appliedCount / totalDiscovered) * 1000) / 10 : 0;

    // Avg fit score
    let totalScore = 0;
    let scoreCount = 0;
    for (const fc of fitCache) {
      const resp = fc.score_response as any;
      const score = resp?.final_selection?.total_score;
      if (typeof score === "number" && score > 0) {
        totalScore += score;
        scoreCount++;
      }
    }
    const avgFitScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;

    // Avg YOE required
    let totalYoe = 0;
    let yoeCount = 0;
    for (const l of listings) {
      const yMin = l.yoe_min as number | null;
      const yMax = l.yoe_max as number | null;
      if (typeof yMin === "number" && yMin >= 0) {
        totalYoe += typeof yMax === "number" ? (yMin + yMax) / 2 : yMin;
        yoeCount++;
      } else if (typeof yMax === "number" && yMax >= 0) {
        totalYoe += yMax;
        yoeCount++;
      }
    }
    const avgYoe = yoeCount > 0 ? Math.round(totalYoe / yoeCount * 10) / 10 : 0;

    // ── Application funnel ───────────────────────────────────────────────

    const statusOrder = ["not_started", "researching", "applied", "interviewing", "offer", "rejected", "withdrawn"];
    const statusLabels: Record<string, string> = {
      not_started: "Not Started",
      researching: "Researching",
      applied: "Applied",
      interviewing: "Interviewing",
      offer: "Offer",
      rejected: "Rejected",
      withdrawn: "Withdrawn",
    };
    const statusCountMap = new Map<string, number>();
    for (const a of applications) {
      statusCountMap.set(a.status, (statusCountMap.get(a.status) || 0) + 1);
    }
    const statusCounts = statusOrder
      .filter((s) => statusCountMap.has(s))
      .map((s) => ({ label: statusLabels[s] || s, count: statusCountMap.get(s) || 0 }));

    // ── Applications per week ────────────────────────────────────────────

    const appWeekMap = new Map<string, number>();
    for (const a of appliedApps) {
      if (!a.applied_date) continue;
      const week = isoWeek(a.applied_date);
      appWeekMap.set(week, (appWeekMap.get(week) || 0) + 1);
    }
    const applicationsPerWeek = [...appWeekMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week, count]) => ({ week, count }));

    // ── Discovered per week ──────────────────────────────────────────────

    const discWeekMap = new Map<string, number>();
    for (const l of listings) {
      if (!l.first_seen_at) continue;
      const week = isoWeek(l.first_seen_at);
      discWeekMap.set(week, (discWeekMap.get(week) || 0) + 1);
    }
    const discoveredPerWeek = [...discWeekMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week, count]) => ({ week, count }));

    // ── Applied vs Discovered per week ───────────────────────────────────

    const allWeeks = new Set([...discWeekMap.keys(), ...appWeekMap.keys()]);
    const appliedVsDiscoveredPerWeek = [...allWeeks]
      .sort()
      .map((week) => ({
        week,
        applied: appWeekMap.get(week) || 0,
        discovered: discWeekMap.get(week) || 0,
      }));

    // ── Top skills (from jd_extracted_skills) ────────────────────────────

    const skillFreq = new Map<string, number>();
    for (const l of listings) {
      const skills = (l.jd_extracted_skills as string[]) || [];
      for (const skill of skills) {
        const normalized = skill.trim().toLowerCase();
        if (!normalized) continue;
        skillFreq.set(normalized, (skillFreq.get(normalized) || 0) + 1);
      }
    }
    const topSkills = [...skillFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([skill, count]) => ({ skill, count }));

    // ── Skills gap treemap ───────────────────────────────────────────────

    const gapFreq = new Map<string, number>();
    for (const fc of fitCache) {
      const gaps = (fc.skills_gap_remaining as string[]) || [];
      for (const gap of gaps) {
        const normalized = gap.trim().toLowerCase();
        if (!normalized) continue;
        gapFreq.set(normalized, (gapFreq.get(normalized) || 0) + 1);
      }
    }
    const skillsGapTreemap = [...gapFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([skill, count]) => ({
        skill,
        count,
        category: classifySkill(skill),
      }));

    // ── Most reused resume bullets ───────────────────────────────────────

    const bulletFreq = new Map<string, number>();
    for (const fc of fitCache) {
      const resp = fc.score_response as any;
      const bullets = resp?.final_selection?.selected_bullets || [];
      for (const b of bullets) {
        if (b.bullet_id) {
          bulletFreq.set(b.bullet_id, (bulletFreq.get(b.bullet_id) || 0) + 1);
        }
      }
    }

    // Load master resume for bullet text
    const bulletMap = new Map<string, string>();
    try {
      const masterResume = await loadMasterResume();
      for (const exp of masterResume.experiences || []) {
        for (const b of exp.bullets || []) bulletMap.set(b.id, b.text);
      }
      for (const proj of masterResume.projects || []) {
        for (const b of proj.bullets || []) bulletMap.set(b.id, b.text);
      }
    } catch (e: any) {
      console.warn("[dashboard] Failed to load master resume:", e.message);
    }

    const topReusedBullets = [...bulletFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([id, count]) => ({ text: bulletMap.get(id) || id, count }));

    // ── Location distribution ────────────────────────────────────────────

    const locFreq = new Map<string, number>();
    for (const l of listings) {
      const city = (l.location_city as string) || "Unknown";
      locFreq.set(city, (locFreq.get(city) || 0) + 1);
    }
    const sortedLocs = [...locFreq.entries()].sort((a, b) => b[1] - a[1]);
    const topLocs = sortedLocs.slice(0, 12);
    const otherLocCount = sortedLocs.slice(12).reduce((sum, [, c]) => sum + c, 0);
    const locationCounts = topLocs.map(([label, count]) => ({ label, count }));
    if (otherLocCount > 0) locationCounts.push({ label: "Other", count: otherLocCount });

    // ── Work type distribution ───────────────────────────────────────────

    let remoteCount = 0, hybridCount = 0, onsiteCount = 0;
    for (const l of listings) {
      if (l.is_remote) remoteCount++;
      else if (l.is_hybrid) hybridCount++;
      else onsiteCount++;
    }
    const workTypeCounts = [
      { label: "Remote", count: remoteCount },
      { label: "Hybrid", count: hybridCount },
      { label: "Onsite", count: onsiteCount },
    ].filter((w) => w.count > 0);

    // ── Tier distribution ────────────────────────────────────────────────

    const tierFreq = new Map<number, number>();
    for (const l of listings) {
      const tier = l.tier as number;
      if (tier) tierFreq.set(tier, (tierFreq.get(tier) || 0) + 1);
    }
    const tierCounts = [1, 2, 3]
      .filter((t) => tierFreq.has(t))
      .map((t) => ({ label: `Tier ${t}`, count: tierFreq.get(t) || 0 }));

    // ── Company category distribution ────────────────────────────────────

    const catFreq = new Map<string, number>();
    for (const l of listings) {
      const company = companyMap.get(l.company_id);
      const category = company?.category || "Unknown";
      catFreq.set(category, (catFreq.get(category) || 0) + 1);
    }
    const companyCategoryCounts = [...catFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([label, count]) => ({ label, count }));

    // ── Top hiring companies ─────────────────────────────────────────────

    const companyJobFreq = new Map<string, number>();
    for (const l of listings) {
      const company = companyMap.get(l.company_id);
      const name = company?.name || "Unknown";
      companyJobFreq.set(name, (companyJobFreq.get(name) || 0) + 1);
    }
    const topHiringCompanies = [...companyJobFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label, count]) => ({ label, count }));

    // ── ATS platform breakdown ───────────────────────────────────────────

    const atsFreq = new Map<string, number>();
    for (const l of listings) {
      const platform = (l.ats_platform as string) || "unknown";
      const label = platform.replace(/-playwright$/, "").replace(/-/g, " ");
      atsFreq.set(label, (atsFreq.get(label) || 0) + 1);
    }
    const atsPlatformCounts = [...atsFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }));

    // ── Active vs Closed ─────────────────────────────────────────────────

    const activeVsClosed = [
      { label: "Active", count: totalActive },
      { label: "Closed", count: totalDiscovered - totalActive },
    ].filter((d) => d.count > 0);

    // ── New jobs per week (from parser_runs) ─────────────────────────────

    const newWeekMap = new Map<string, number>();
    const deactWeekMap = new Map<string, number>();
    for (const r of runs) {
      if (!r.started_at) continue;
      const week = isoWeek(r.started_at);
      newWeekMap.set(week, (newWeekMap.get(week) || 0) + (r.listings_new || 0));
      deactWeekMap.set(week, (deactWeekMap.get(week) || 0) + (r.listings_deactivated || 0));
    }
    const newJobsPerWeek = [...newWeekMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week, count]) => ({ week, count }));

    // ── Market velocity ──────────────────────────────────────────────────

    const allRunWeeks = new Set([...newWeekMap.keys(), ...deactWeekMap.keys()]);
    const marketVelocity = [...allRunWeeks]
      .sort()
      .map((week) => {
        const newCount = newWeekMap.get(week) || 0;
        const deactCount = deactWeekMap.get(week) || 0;
        const ratio = deactCount > 0 ? Math.round((newCount / deactCount) * 100) / 100 : newCount > 0 ? newCount : 0;
        return { week, ratio };
      });

    // ── Application timing analytics ─────────────────────────────────────

    // Build listing lookup: id → { posted_date, first_seen_at, company_id }
    const listingLookup = new Map<string, any>();
    for (const l of listings) listingLookup.set(l.id, l);

    // Time-to-apply: hours between discovery/posting and application
    const timeToApplyHours: number[] = [];
    for (const a of appliedApps) {
      const listing = listingLookup.get(a.listing_id);
      if (!listing) continue;
      const jobTime = listing.posted_date
        ? new Date(listing.posted_date).getTime()
        : new Date(listing.first_seen_at).getTime();
      const applyTime = a.created_at
        ? new Date(a.created_at).getTime()
        : a.applied_date ? new Date(a.applied_date).getTime() : 0;
      if (!applyTime || !jobTime || isNaN(jobTime) || isNaN(applyTime)) continue;
      const diffHours = (applyTime - jobTime) / (1000 * 60 * 60);
      if (diffHours >= 0) timeToApplyHours.push(diffHours);
    }

    // Bucket time-to-apply
    const ttaBuckets = [
      { label: "< 1 hour", max: 1 },
      { label: "1-6 hours", max: 6 },
      { label: "6-24 hours", max: 24 },
      { label: "1-3 days", max: 72 },
      { label: "3-7 days", max: 168 },
      { label: "1-2 weeks", max: 336 },
      { label: "2+ weeks", max: Infinity },
    ];
    const timeToApplyBuckets = ttaBuckets.map((b) => ({ label: b.label, count: 0 }));
    for (const h of timeToApplyHours) {
      for (let i = 0; i < ttaBuckets.length; i++) {
        if (h < ttaBuckets[i].max) { timeToApplyBuckets[i].count++; break; }
      }
    }

    // Avg and median time to apply
    const sortedTta = [...timeToApplyHours].sort((a, b) => a - b);
    const avgTimeToApplyHours = sortedTta.length > 0
      ? Math.round(sortedTta.reduce((s, v) => s + v, 0) / sortedTta.length * 10) / 10
      : 0;
    const medianTimeToApplyHours = sortedTta.length > 0
      ? Math.round(sortedTta[Math.floor(sortedTta.length / 2)] * 10) / 10
      : 0;

    // Applications by hour of day (Los Angeles timezone)
    const hourCounts = new Array(24).fill(0);
    for (const a of appliedApps) {
      if (!a.created_at) continue;
      const la = toLADate(a.created_at);
      if (la) hourCounts[la.getHours()]++;
    }
    const applicationsByHour = hourCounts.map((count, hour) => ({ hour, count }));

    // Applications by day of week (Los Angeles timezone)
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayCounts = new Array(7).fill(0);
    for (const a of appliedApps) {
      const dateStr = a.created_at || a.applied_date;
      if (!dateStr) continue;
      const la = toLADate(dateStr);
      if (la) dayCounts[la.getDay()]++;
    }
    const applicationsByDayOfWeek = dayNames.map((day, i) => ({ day, count: dayCounts[i] }));

    // Applications by day-of-week × hour (weekly heatmap, LA timezone)
    const dayHourGrid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const a of appliedApps) {
      if (!a.created_at) continue;
      const la = toLADate(a.created_at);
      if (la) dayHourGrid[la.getDay()][la.getHours()]++;
    }
    const appsByDayAndHour: DashboardData["appsByDayAndHour"] = [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        if (dayHourGrid[d][h] > 0) {
          appsByDayAndHour.push({ day: dayNames[d], hour: h, count: dayHourGrid[d][h] });
        }
      }
    }

    // Applications per day (granular daily)
    const dailyMap = new Map<string, number>();
    for (const a of appliedApps) {
      const dateStr = a.applied_date || (a.created_at ? a.created_at.split("T")[0] : null);
      if (!dateStr) continue;
      const dayKey = dateStr.split("T")[0];
      dailyMap.set(dayKey, (dailyMap.get(dayKey) || 0) + 1);
    }
    const applicationsPerDay = [...dailyMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, count }));

    // Applied companies
    const appliedCompanyFreq = new Map<string, number>();
    for (const a of appliedApps) {
      const listing = listingLookup.get(a.listing_id);
      if (!listing) continue;
      const company = companyMap.get(listing.company_id);
      const name = company?.name || "Unknown";
      appliedCompanyFreq.set(name, (appliedCompanyFreq.get(name) || 0) + 1);
    }
    const appliedCompanies = [...appliedCompanyFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([label, count]) => ({ label, count }));

    // Company coverage: discovered vs applied for top companies
    const appliedListingIds = new Set(appliedApps.map((a: any) => a.listing_id));
    const coverageMap = new Map<string, { discovered: number; applied: number }>();
    for (const l of listings) {
      const company = companyMap.get(l.company_id);
      const name = company?.name || "Unknown";
      if (!coverageMap.has(name)) coverageMap.set(name, { discovered: 0, applied: 0 });
      const entry = coverageMap.get(name)!;
      entry.discovered++;
      if (appliedListingIds.has(l.id)) entry.applied++;
    }
    const companyCoverage = [...coverageMap.entries()]
      .sort((a, b) => b[1].discovered - a[1].discovered)
      .slice(0, 10)
      .map(([company, counts]) => ({ company, ...counts }));

    // Freshness at apply time (how old was the job when applied)
    const freshBuckets = [
      { label: "Same day", max: 24 },
      { label: "1-2 days", max: 48 },
      { label: "3-7 days", max: 168 },
      { label: "1-2 weeks", max: 336 },
      { label: "2-4 weeks", max: 672 },
      { label: "1+ month", max: Infinity },
    ];
    const freshnessAtApply = freshBuckets.map((b) => ({ label: b.label, count: 0 }));
    for (const h of timeToApplyHours) {
      for (let i = 0; i < freshBuckets.length; i++) {
        if (h < freshBuckets[i].max) { freshnessAtApply[i].count++; break; }
      }
    }

    // Discovery by hour (LA timezone)
    const discHourCounts = new Array(24).fill(0);
    for (const l of listings) {
      const ts = l.first_seen_at;
      if (!ts) continue;
      const la = toLADate(ts);
      if (la) discHourCounts[la.getHours()]++;
    }
    const discoveryByHour = discHourCounts.map((count, hour) => ({ hour, count }));

    // ── "Am I wasting time?" ─────────────────────────────────────────────

    // Fit score vs outcome — scatter data
    const fitScoreByListing = new Map<string, number>();
    for (const fc of fitCache) {
      const resp = fc.score_response as any;
      const score = resp?.final_selection?.total_score;
      if (typeof score === "number") fitScoreByListing.set(fc.listing_id, score);
    }
    const fitScoreVsOutcome: DashboardData["fitScoreVsOutcome"] = [];
    for (const a of applications) {
      const score = fitScoreByListing.get(a.listing_id);
      if (score === undefined) continue;
      const listing = listingLookup.get(a.listing_id);
      const company = listing ? companyMap.get(listing.company_id) : null;
      fitScoreVsOutcome.push({
        score,
        status: a.status,
        title: listing?.title || "",
        company: company?.name || "",
      });
    }

    // Rejection rate by company category
    const catApplied = new Map<string, number>();
    const catRejected = new Map<string, number>();
    for (const a of applications) {
      if (!appliedStatuses.has(a.status)) continue;
      const listing = listingLookup.get(a.listing_id);
      if (!listing) continue;
      const company = companyMap.get(listing.company_id);
      const cat = company?.category || "Unknown";
      catApplied.set(cat, (catApplied.get(cat) || 0) + 1);
      if (a.status === "rejected") catRejected.set(cat, (catRejected.get(cat) || 0) + 1);
    }
    const rejectionByCategory = [...catApplied.entries()]
      .filter(([, count]) => count >= 1)
      .map(([category, applied]) => {
        const rejected = catRejected.get(category) || 0;
        return { category, applied, rejected, rate: Math.round((rejected / applied) * 100) };
      })
      .sort((a, b) => b.rate - a.rate);

    // YOE mismatch tracker — user's YOE from master_resume
    let userYoe = 0;
    try {
      const mr = await loadMasterResume();
      if (mr.total_months) {
        userYoe = Math.round(mr.total_months / 12 * 10) / 10;
      } else {
        let totalMonths = 0;
        for (const exp of mr.experiences || []) {
          if (exp.duration_months) totalMonths += exp.duration_months;
        }
        userYoe = Math.round(totalMonths / 12 * 10) / 10;
      }
    } catch { /* already loaded above, shouldn't fail */ }

    const yoeBuckets = [
      { label: "At/below your YOE", min: 0, max: userYoe + 0.5 },
      { label: "1-2 yrs above", min: userYoe + 0.5, max: userYoe + 2.5 },
      { label: "3-5 yrs above", min: userYoe + 2.5, max: userYoe + 5.5 },
      { label: "5+ yrs above", min: userYoe + 5.5, max: Infinity },
    ];
    const yoeMismatch = yoeBuckets.map((b) => ({ label: b.label, applied: 0, interviewed: 0 }));
    for (const a of applications) {
      if (!appliedStatuses.has(a.status)) continue;
      const listing = listingLookup.get(a.listing_id);
      if (!listing) continue;
      const reqYoe = (listing.yoe_min as number) ?? (listing.yoe_max as number) ?? null;
      if (reqYoe === null) continue;
      for (let i = 0; i < yoeBuckets.length; i++) {
        if (reqYoe >= yoeBuckets[i].min && reqYoe < yoeBuckets[i].max) {
          yoeMismatch[i].applied++;
          if (a.status === "interviewing" || a.status === "offer") yoeMismatch[i].interviewed++;
          break;
        }
      }
    }

    // ── "What should I do today?" ────────────────────────────────────────

    // Stale opportunities: active jobs, not applied, discovered 3+ days ago
    const now = Date.now();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const appliedListingSet = new Set(applications.map((a: any) => a.listing_id));
    const staleOpportunities: DashboardData["staleOpportunities"] = [];
    for (const l of listings) {
      if (!l.is_active) continue;
      if (appliedListingSet.has(l.id)) continue;
      const firstSeen = new Date(l.first_seen_at).getTime();
      if (isNaN(firstSeen)) continue;
      const daysAgo = Math.round((now - firstSeen) / (24 * 60 * 60 * 1000));
      if (daysAgo < 3) continue;
      const company = companyMap.get(l.company_id);
      staleOpportunities.push({
        title: l.title,
        company: company?.name || "Unknown",
        tier: l.tier as number || 3,
        daysAgo,
        roleUrl: l.role_url || "",
        jobId: l.id,
      });
    }
    staleOpportunities.sort((a, b) => a.tier - b.tier || b.daysAgo - a.daysAgo);
    const staleTop = staleOpportunities.slice(0, 20);

    // Hot companies: 2+ new listings in last 7 days
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const recentCompanyFreq = new Map<string, number>();
    for (const l of listings) {
      const firstSeen = new Date(l.first_seen_at).getTime();
      if (isNaN(firstSeen) || now - firstSeen > sevenDaysMs) continue;
      const company = companyMap.get(l.company_id);
      const name = company?.name || "Unknown";
      recentCompanyFreq.set(name, (recentCompanyFreq.get(name) || 0) + 1);
    }
    const hotCompanies = [...recentCompanyFreq.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([company, newRoles]) => ({ company, newRoles }));

    // ── "Pipeline mechanics" ─────────────────────────────────────────────

    // Funnel conversion rates
    const funnelStages = ["applied", "interviewing", "offer"];
    const funnelCounts: Record<string, number> = {};
    for (const s of funnelStages) {
      funnelCounts[s] = applications.filter((a: any) => {
        const idx = funnelStages.indexOf(a.status);
        return idx >= funnelStages.indexOf(s);
      }).length;
    }
    const funnelRates: DashboardData["funnelRates"] = [];
    for (let i = 0; i < funnelStages.length - 1; i++) {
      const from = funnelStages[i];
      const to = funnelStages[i + 1];
      const fromCount = funnelCounts[from] || 0;
      const toCount = funnelCounts[to] || 0;
      funnelRates.push({
        from: from.charAt(0).toUpperCase() + from.slice(1),
        to: to.charAt(0).toUpperCase() + to.slice(1),
        rate: fromCount > 0 ? Math.round((toCount / fromCount) * 100) : 0,
        count: toCount,
      });
    }

    // Average days per stage
    const stageDays: Record<string, number[]> = {};
    for (const a of applications) {
      if (!a.applied_date) continue;
      const applyDate = new Date(a.applied_date).getTime();
      const updateDate = a.updated_at ? new Date(a.updated_at).getTime() : now;
      if (isNaN(applyDate)) continue;
      const days = Math.round((updateDate - applyDate) / (24 * 60 * 60 * 1000));
      const stage = a.status as string;
      if (!stageDays[stage]) stageDays[stage] = [];
      stageDays[stage].push(days);
    }
    const stageLabels: Record<string, string> = { applied: "Applied", interviewing: "Interviewing", offer: "Offer", rejected: "Rejected" };
    const avgDaysPerStage = Object.entries(stageDays)
      .filter(([stage]) => ["applied", "interviewing", "offer", "rejected"].includes(stage))
      .map(([stage, days]) => ({
        stage: stageLabels[stage] || stage,
        avgDays: Math.round(days.reduce((s, d) => s + d, 0) / days.length),
      }))
      .sort((a, b) => b.avgDays - a.avgDays);

    // Response rate: responded (interviewing/offer/rejected) vs ghosted (still "applied")
    const respondedCount = applications.filter((a: any) =>
      a.status === "interviewing" || a.status === "offer" || a.status === "rejected"
    ).length;
    const ghostedCount = applications.filter((a: any) => a.status === "applied").length;
    const responseRate = [
      { label: "Responded", count: respondedCount },
      { label: "No Response", count: ghostedCount },
    ].filter((d) => d.count > 0);

    // ── "Competition" ────────────────────────────────────────────────────

    // Listing lifespan (closed jobs: closed_at - first_seen_at)
    const lifespanDays: number[] = [];
    for (const l of listings) {
      if (l.is_active || !l.closed_at) continue;
      const first = new Date(l.first_seen_at).getTime();
      const closed = new Date(l.closed_at).getTime();
      if (isNaN(first) || isNaN(closed)) continue;
      const days = Math.round((closed - first) / (24 * 60 * 60 * 1000));
      if (days >= 0) lifespanDays.push(days);
    }

    const lifespanBucketDefs = [
      { label: "< 1 day", max: 1 },
      { label: "1-3 days", max: 3 },
      { label: "3-7 days", max: 7 },
      { label: "1-2 weeks", max: 14 },
      { label: "2-4 weeks", max: 28 },
      { label: "1-2 months", max: 60 },
      { label: "2+ months", max: Infinity },
    ];
    const listingLifespanBuckets = lifespanBucketDefs.map((b) => ({ label: b.label, count: 0 }));
    for (const d of lifespanDays) {
      for (let i = 0; i < lifespanBucketDefs.length; i++) {
        if (d < lifespanBucketDefs[i].max) { listingLifespanBuckets[i].count++; break; }
      }
    }
    const avgListingLifespanDays = lifespanDays.length > 0
      ? Math.round(lifespanDays.reduce((s, v) => s + v, 0) / lifespanDays.length)
      : 0;

    // Reposted jobs (from listing_runs with seen_state='reactivated')
    const reactivatedFreq = new Map<string, number>();
    for (const r of reactivatedEntries) {
      reactivatedFreq.set(r.listing_id, (reactivatedFreq.get(r.listing_id) || 0) + 1);
    }
    const repostedJobs = reactivatedFreq.size;
    const repostedList: DashboardData["repostedList"] = [...reactivatedFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([listingId, times]) => {
        const listing = listingLookup.get(listingId);
        const company = listing ? companyMap.get(listing.company_id) : null;
        return {
          title: listing?.title || "Unknown",
          company: company?.name || "Unknown",
          times,
        };
      });

    // Salary distribution
    const salaries: number[] = [];
    let salMinSum = 0, salMaxSum = 0, salCount = 0;
    for (const l of listings) {
      const sMin = l.salary_min as number | null;
      const sMax = l.salary_max as number | null;
      if (typeof sMin === "number" && sMin > 0) {
        salaries.push(sMin);
        salMinSum += sMin;
        salCount++;
      }
      if (typeof sMax === "number" && sMax > 0) {
        salaries.push(sMax);
        salMaxSum += sMax;
      }
    }
    const salaryBucketDefs = [
      { label: "< $80k", max: 80000 },
      { label: "$80-100k", max: 100000 },
      { label: "$100-120k", max: 120000 },
      { label: "$120-150k", max: 150000 },
      { label: "$150-180k", max: 180000 },
      { label: "$180-220k", max: 220000 },
      { label: "$220k+", max: Infinity },
    ];
    const salaryBuckets = salaryBucketDefs.map((b) => ({ label: b.label, count: 0 }));
    for (const s of salaries) {
      for (let i = 0; i < salaryBucketDefs.length; i++) {
        if (s < salaryBucketDefs[i].max) { salaryBuckets[i].count++; break; }
      }
    }
    const avgSalaryMin = salCount > 0 ? Math.round(salMinSum / salCount) : 0;
    const avgSalaryMax = salCount > 0 ? Math.round(salMaxSum / salCount) : 0;
    const jobsWithSalary = salCount;

    // ── "Getting better?" ────────────────────────────────────────────────

    // Weekly fit score trend
    const weekScores = new Map<string, { sum: number; count: number }>();
    for (const fc of fitCache) {
      const listing = listingLookup.get(fc.listing_id);
      if (!listing) continue;
      const resp = fc.score_response as any;
      const score = resp?.final_selection?.total_score;
      if (typeof score !== "number") continue;
      const week = isoWeek(listing.first_seen_at);
      const entry = weekScores.get(week) || { sum: 0, count: 0 };
      entry.sum += score;
      entry.count++;
      weekScores.set(week, entry);
    }
    const weeklyFitScoreTrend = [...weekScores.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week, { sum, count }]) => ({ week, avgScore: Math.round(sum / count), count }));

    // Application quality trend (avg tier by week)
    const weekTiers = new Map<string, { sum: number; count: number }>();
    for (const a of appliedApps) {
      const listing = listingLookup.get(a.listing_id);
      if (!listing || !listing.tier) continue;
      const dateStr = a.applied_date || (a.created_at ? a.created_at.split("T")[0] : null);
      if (!dateStr) continue;
      const week = isoWeek(dateStr);
      const entry = weekTiers.get(week) || { sum: 0, count: 0 };
      entry.sum += listing.tier as number;
      entry.count++;
      weekTiers.set(week, entry);
    }
    const applicationQualityTrend = [...weekTiers.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week, { sum, count }]) => ({ week, avgTier: Math.round(sum / count * 10) / 10 }));

    // Weekly gap trend (avg number of gaps per scored job)
    const weekGaps = new Map<string, { sum: number; count: number }>();
    for (const fc of fitCache) {
      const listing = listingLookup.get(fc.listing_id);
      if (!listing) continue;
      const gaps = (fc.skills_gap_remaining as string[]) || [];
      const week = isoWeek(listing.first_seen_at);
      const entry = weekGaps.get(week) || { sum: 0, count: 0 };
      entry.sum += gaps.length;
      entry.count++;
      weekGaps.set(week, entry);
    }
    const weeklyGapTrend = [...weekGaps.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week, { sum, count }]) => ({ week, avgGaps: Math.round(sum / count * 10) / 10 }));

    // ── Assemble + render ────────────────────────────────────────────────

    const data: DashboardData = {
      totalDiscovered,
      totalActive,
      appliedCount,
      interviewRate,
      avgFitScore,
      applicationRate,
      avgYoe,
      statusCounts,
      applicationsPerWeek,
      discoveredPerWeek,
      appliedVsDiscoveredPerWeek,
      topSkills,
      skillsGapTreemap,
      topReusedBullets,
      locationCounts,
      workTypeCounts,
      tierCounts,
      companyCategoryCounts,
      topHiringCompanies,
      atsPlatformCounts,
      activeVsClosed,
      timeToApplyBuckets,
      applicationsByHour,
      applicationsByDayOfWeek,
      appsByDayAndHour,
      applicationsPerDay,
      appliedCompanies,
      companyCoverage,
      freshnessAtApply,
      discoveryByHour,
      avgTimeToApplyHours,
      medianTimeToApplyHours,
      fitScoreVsOutcome,
      rejectionByCategory,
      yoeMismatch,
      userYoe,
      staleOpportunities: staleTop,
      hotCompanies,
      funnelRates,
      avgDaysPerStage,
      responseRate,
      ghostedCount,
      respondedCount,
      listingLifespanBuckets,
      avgListingLifespanDays,
      repostedJobs,
      repostedList,
      salaryBuckets,
      avgSalaryMin,
      avgSalaryMax,
      jobsWithSalary,
      weeklyFitScoreTrend,
      applicationQualityTrend,
      weeklyGapTrend,
      newJobsPerWeek,
      marketVelocity,
      dateFrom,
      dateTo,
      generatedAt: new Date().toISOString(),
      token,
    };

    const html = renderDashboardPage(data);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err: any) {
    console.error("[dashboard] Error:", err.message);
    res.status(500).send("Dashboard error: " + err.message);
  }
}
