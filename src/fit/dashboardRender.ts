/**
 * Server-rendered HTML for the Analytics Dashboard.
 * Scrollable story layout — 5 narrative sections with Chart.js charts.
 * Supports dark/light theme toggle.
 */

import type { DashboardData } from "./dashboard";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderDashboardPage(data: DashboardData): string {
  const generatedFmt = new Date(data.generatedAt).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PM Scout Analytics</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-chart-treemap@2.3.1/dist/chartjs-chart-treemap.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Theme variables — VIBRANT palette ────────────────────────────── */
    :root {
      --accent: #00d4ff;
      --accent-light: #33e0ff;
      --coral: #ff4081;
      --sky: #00b0ff;
      --amber: #ffab00;
      --emerald: #00e676;
      --violet: #7c4dff;
      --rose: #ff4081;
      --lime: #76ff03;
      --cyan: #00e5ff;
      --orange: #ff6d00;
      --pink: #ff4081;
      --transition: 0.3s ease;
    }

    [data-theme="light"] {
      --bg-page: #f0f4f8;
      --bg-card: #ffffff;
      --bg-header: #0a0e27;
      --bg-filter: #ffffff;
      --text-primary: #0a0e27;
      --text-secondary: #4a5568;
      --text-muted: #8896ab;
      --border: #e2e8f0;
      --border-hover: #cbd5e1;
      --card-shadow: 0 2px 8px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04);
      --card-shadow-hover: 0 12px 32px rgba(0,0,0,0.12);
      --chart-grid: rgba(0,0,0,0.06);
      --chart-text: #64748b;
    }

    [data-theme="dark"] {
      --bg-page: #080c1a;
      --bg-card: #111827;
      --bg-header: #050816;
      --bg-filter: #111827;
      --text-primary: #f1f5f9;
      --text-secondary: #a0aec0;
      --text-muted: #64748b;
      --border: #1e293b;
      --border-hover: #334155;
      --card-shadow: 0 2px 8px rgba(0,0,0,0.4), 0 0 1px rgba(0,212,255,0.05);
      --card-shadow-hover: 0 12px 32px rgba(0,0,0,0.5), 0 0 20px rgba(0,212,255,0.08);
      --chart-grid: rgba(255,255,255,0.05);
      --chart-text: #a0aec0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg-page);
      color: var(--text-primary);
      line-height: 1.6;
      transition: background var(--transition), color var(--transition);
    }

    /* ── Header ───────────────────────────────────────────────────────── */
    .dash-header {
      background: var(--bg-header);
      padding: 20px 24px;
      display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
      border-bottom: 2px solid var(--accent);
    }
    .dash-header h1 {
      font-size: 1.25rem; font-weight: 800; color: #f1f5f9;
      letter-spacing: -0.02em;
    }
    .dash-header h1 span { color: var(--accent-light); }
    .header-right {
      margin-left: auto; display: flex; align-items: center; gap: 12px;
    }
    .header-nav-link {
      color: #a0aec0; text-decoration: none; font-size: 0.82rem; padding: 5px 14px;
      border: 1px solid #334155; border-radius: 6px; transition: all 0.2s;
    }
    .header-nav-link:hover { color: var(--accent); border-color: var(--accent); }
    .theme-toggle {
      background: none; border: 1px solid #475569; color: #f1f5f9;
      padding: 6px 12px; border-radius: 8px; cursor: pointer;
      font-size: 0.8rem; transition: all 0.2s;
    }
    .theme-toggle:hover { border-color: var(--accent); color: var(--accent); }

    /* Big CTA button */
    .cta-tracker {
      display: inline-flex; align-items: center; gap: 8px;
      background: linear-gradient(135deg, #ff4081, #ff6d00);
      color: #fff; text-decoration: none;
      padding: 12px 28px; border-radius: 12px;
      font-size: 0.95rem; font-weight: 800; letter-spacing: 0.01em;
      box-shadow: 0 4px 16px rgba(255,64,129,0.35);
      transition: all 0.25s ease; margin-left: 16px;
    }
    .cta-tracker:hover {
      transform: translateY(-2px) scale(1.02);
      box-shadow: 0 8px 28px rgba(255,64,129,0.5);
    }
    .cta-tracker svg { width: 18px; height: 18px; }
    .generated-at { font-size: 0.72rem; color: #64748b; }

    /* ── Filter bar ───────────────────────────────────────────────────── */
    .filter-bar {
      position: sticky; top: 0; z-index: 100;
      background: var(--bg-filter);
      border-bottom: 1px solid var(--border);
      padding: 10px 24px;
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      transition: background var(--transition);
    }
    .filter-bar label { font-size: 0.78rem; color: var(--text-muted); }
    .filter-bar input[type="date"] {
      padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px;
      font-size: 0.8rem; color: var(--text-primary);
      background: var(--bg-card); transition: all var(--transition);
    }
    .filter-btn {
      padding: 6px 14px; border-radius: 6px; font-size: 0.78rem; font-weight: 600;
      cursor: pointer; border: 1px solid var(--border); background: var(--bg-card);
      color: var(--text-primary); transition: all 0.2s;
    }
    .filter-btn:hover { border-color: var(--accent); }
    .filter-btn-primary {
      background: var(--accent); color: #fff; border-color: var(--accent);
    }
    .filter-btn-primary:hover { background: var(--accent-light); }

    /* ── Sections ─────────────────────────────────────────────────────── */
    .dashboard-section {
      max-width: 1280px; margin: 0 auto; padding: 48px 24px;
      opacity: 0; transform: translateY(20px);
      transition: opacity 0.6s ease, transform 0.6s ease;
    }
    .dashboard-section.visible { opacity: 1; transform: translateY(0); }
    .dashboard-section + .dashboard-section { border-top: 1px solid var(--border); }

    .section-header {
      display: flex; align-items: center; gap: 12px;
      font-size: 1.35rem; font-weight: 800; margin-bottom: 6px;
      letter-spacing: -0.02em;
    }
    .section-dot {
      width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
    }
    .section-subtitle {
      font-size: 0.88rem; color: var(--text-secondary); margin-bottom: 32px;
    }

    /* ── KPI cards ────────────────────────────────────────────────────── */
    .kpi-row {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px; margin-bottom: 36px;
    }
    .kpi-card {
      background: var(--bg-card); border-radius: 14px; padding: 22px 20px;
      box-shadow: var(--card-shadow); text-align: center;
      border: 1px solid var(--border); position: relative; overflow: hidden;
      transition: all 0.3s ease;
    }
    .kpi-card:hover {
      transform: translateY(-4px); box-shadow: var(--card-shadow-hover);
      border-color: var(--border-hover);
    }
    .kpi-accent {
      position: absolute; top: 0; left: 0; right: 0; height: 3px;
    }
    .kpi-number {
      font-size: 2.4rem; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums;
    }
    .kpi-label {
      font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase;
      letter-spacing: 0.6px; margin-top: 6px; font-weight: 600;
    }
    .kpi-sub { font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; }

    /* ── Chart containers ─────────────────────────────────────────────── */
    .chart-row { display: flex; flex-wrap: wrap; gap: 20px; margin-bottom: 20px; }
    .chart-container {
      flex: 1; min-width: 340px;
      background: var(--bg-card); border-radius: 14px; padding: 22px;
      box-shadow: var(--card-shadow); border: 1px solid var(--border);
      transition: all 0.3s ease;
    }
    .chart-container:hover {
      box-shadow: var(--card-shadow-hover); border-color: var(--border-hover);
    }
    .chart-container.full { flex-basis: 100%; }
    .chart-container.third { flex: 1; min-width: 260px; }
    .chart-title {
      font-size: 0.88rem; font-weight: 700; color: var(--text-primary);
      margin-bottom: 14px; display: flex; align-items: center; gap: 8px;
    }
    .chart-title-dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    }
    .chart-hint { font-size: 0.72rem; color: var(--text-muted); margin-top: 4px; }
    .empty-chart {
      text-align: center; padding: 40px 20px; color: var(--text-muted);
      font-size: 0.88rem;
    }

    /* ── Footer ───────────────────────────────────────────────────────── */
    .dashboard-footer {
      text-align: center; padding: 32px; color: var(--text-muted); font-size: 0.75rem;
      border-top: 1px solid var(--border);
    }

    @media (max-width: 768px) {
      .chart-container, .chart-container.third { min-width: 100%; }
      .kpi-row { grid-template-columns: repeat(2, 1fr); }
      .dash-header { padding: 16px; }
    }
  </style>
</head>
<body>

  <!-- Dark header -->
  <div class="dash-header">
    <h1><span>PM Scout</span> Analytics</h1>
    <div class="header-right">
      <a href="/tracker?token=${esc(data.token)}" class="header-nav-link">Tracker</a>
      <a href="/fit/new?token=${esc(data.token)}" class="header-nav-link">Check Any Job</a>
      <button class="theme-toggle" id="theme-toggle" title="Toggle theme">Light Mode</button>
      <span class="generated-at">Updated ${esc(generatedFmt)}</span>
    </div>
  </div>

  <!-- Sticky filter -->
  <div class="filter-bar">
    <label>From</label>
    <input type="date" id="from-date" value="${data.dateFrom || ""}">
    <label>To</label>
    <input type="date" id="to-date" value="${data.dateTo || ""}">
    <button class="filter-btn filter-btn-primary" id="apply-filter">Apply</button>
    <button class="filter-btn" id="clear-filter">Clear</button>
  </div>

  <!-- ═══════════ Section 1: Pipeline ═══════════ -->
  <div class="dashboard-section" id="s-pipeline">
    <div class="section-header" style="flex-wrap:wrap;">
      <div class="section-dot" style="background:var(--accent);"></div>
      Dashboard Analysis
      <a href="/tracker?token=${esc(data.token)}" class="cta-tracker">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        Applications Tracker
      </a>
    </div>
    <div class="section-subtitle">Track your journey from discovery to offer</div>

    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-accent" style="background:linear-gradient(90deg,var(--sky),var(--cyan));"></div>
        <div class="kpi-number" style="color:var(--sky);" data-countup="${data.totalDiscovered}">${data.totalDiscovered.toLocaleString()}</div>
        <div class="kpi-label">Discovered</div>
        <div class="kpi-sub">${data.totalActive.toLocaleString()} active</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-accent" style="background:linear-gradient(90deg,var(--emerald),var(--lime));"></div>
        <div class="kpi-number" style="color:var(--emerald);" data-countup="${data.appliedCount}">${data.appliedCount}</div>
        <div class="kpi-label">Applied</div>
        <div class="kpi-sub">${data.applicationRate}% rate</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-accent" style="background:linear-gradient(90deg,var(--amber),var(--orange));"></div>
        <div class="kpi-number" style="color:var(--amber);" data-countup="${data.interviewRate}">${data.interviewRate}%</div>
        <div class="kpi-label">Interview Rate</div>
        <div class="kpi-sub">interviews / applied</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-accent" style="background:linear-gradient(90deg,var(--violet),var(--pink));"></div>
        <div class="kpi-number" style="color:var(--violet);" data-countup="${data.avgFitScore}">${data.avgFitScore}</div>
        <div class="kpi-label">Avg Fit Score</div>
        <div class="kpi-sub">${data.avgFitScore >= 70 ? "Strong" : data.avgFitScore >= 45 ? "Moderate" : "Building"}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-accent" style="background:linear-gradient(90deg,var(--coral),var(--rose));"></div>
        <div class="kpi-number" style="color:var(--coral);" data-countup="${data.avgYoe}">${data.avgYoe}</div>
        <div class="kpi-label">Avg YOE Required</div>
        <div class="kpi-sub">years of experience</div>
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--accent);"></div>Application Funnel</div>
        ${data.statusCounts.length > 0 ? '<canvas id="chart-funnel"></canvas>' : '<div class="empty-chart">No applications tracked yet</div>'}
      </div>
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--sky);"></div>Applications per Week</div>
        ${data.applicationsPerWeek.length > 0 ? '<canvas id="chart-apps-over-time"></canvas>' : '<div class="empty-chart">No application dates recorded</div>'}
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--emerald);"></div>Applied vs Discovered</div>
        ${data.appliedVsDiscoveredPerWeek.length > 0 ? '<canvas id="chart-applied-vs-discovered"></canvas>' : '<div class="empty-chart">Not enough data yet</div>'}
      </div>
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--amber);"></div>Active vs Closed Jobs</div>
        ${data.activeVsClosed.length > 0 ? '<canvas id="chart-active-closed"></canvas>' : '<div class="empty-chart">No data</div>'}
      </div>
    </div>
  </div>

  <!-- ═══════════ Section 2: Market ═══════════ -->
  <div class="dashboard-section" id="s-market">
    <div class="section-header">
      <div class="section-dot" style="background:var(--coral);"></div>
      What the Market Wants
    </div>
    <div class="section-subtitle">Skills demand and gaps across all discovered jobs</div>

    <div class="chart-row">
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--coral);"></div>Most Demanded Skills (Top 25)</div>
        ${data.topSkills.length > 0 ? '<canvas id="chart-top-skills"></canvas>' : '<div class="empty-chart">No extracted skills data</div>'}
      </div>
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--rose);"></div>Skills Gap Treemap</div>
        <div class="chart-hint">Cell size = jobs requiring this skill you lack</div>
        ${data.skillsGapTreemap.length > 0 ? '<canvas id="chart-skills-gap"></canvas>' : '<div class="empty-chart">No fit scores computed</div>'}
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-container full">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--violet);"></div>Most Reused Resume Bullets</div>
        <div class="chart-hint">Hover for full bullet text</div>
        ${data.topReusedBullets.length > 0 ? '<canvas id="chart-reused-bullets"></canvas>' : '<div class="empty-chart">No generated resumes yet</div>'}
      </div>
    </div>
  </div>

  <!-- ═══════════ Section 3: Geography ═══════════ -->
  <div class="dashboard-section" id="s-geo">
    <div class="section-header">
      <div class="section-dot" style="background:var(--sky);"></div>
      Where the Jobs Are
    </div>
    <div class="section-subtitle">Geographic and structural breakdown</div>

    <div class="chart-row">
      <div class="chart-container third">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--sky);"></div>By Location</div>
        ${data.locationCounts.length > 0 ? '<canvas id="chart-location"></canvas>' : '<div class="empty-chart">No data</div>'}
      </div>
      <div class="chart-container third">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--emerald);"></div>Work Type</div>
        ${data.workTypeCounts.length > 0 ? '<canvas id="chart-work-type"></canvas>' : '<div class="empty-chart">No data</div>'}
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--violet);"></div>Company Categories</div>
        ${data.companyCategoryCounts.length > 0 ? '<canvas id="chart-company-categories"></canvas>' : '<div class="empty-chart">No data</div>'}
      </div>
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--orange);"></div>ATS Platforms</div>
        ${data.atsPlatformCounts.length > 0 ? '<canvas id="chart-ats-platforms"></canvas>' : '<div class="empty-chart">No data</div>'}
      </div>
    </div>
  </div>

  <!-- ═══════════ Section 4: Top Companies ═══════════ -->
  <div class="dashboard-section" id="s-companies">
    <div class="section-header">
      <div class="section-dot" style="background:var(--emerald);"></div>
      Who's Hiring
    </div>
    <div class="section-subtitle">Companies with the most open PM roles</div>

    <div class="chart-row">
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--emerald);"></div>Top 10 Hiring Companies</div>
        ${data.topHiringCompanies.length > 0 ? '<canvas id="chart-top-companies"></canvas>' : '<div class="empty-chart">No data</div>'}
      </div>
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--cyan);"></div>Company Coverage: Discovered vs Applied</div>
        <div class="chart-hint">Are you applying at the companies with the most roles?</div>
        ${data.companyCoverage.length > 0 ? '<canvas id="chart-company-coverage"></canvas>' : '<div class="empty-chart">No data</div>'}
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-container full">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--violet);"></div>Companies You've Applied To</div>
        ${data.appliedCompanies.length > 0 ? '<canvas id="chart-applied-companies"></canvas>' : '<div class="empty-chart">No applications yet</div>'}
      </div>
    </div>
  </div>

  <!-- ═══════════ Section 5: Application Timing ═══════════ -->
  <div class="dashboard-section" id="s-timing">
    <div class="section-header">
      <div class="section-dot" style="background:var(--orange);"></div>
      Application Timing
    </div>
    <div class="section-subtitle">How fast you act and when you're most productive</div>

    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-accent" style="background:linear-gradient(90deg,var(--orange),var(--amber));"></div>
        <div class="kpi-number" style="color:var(--orange);" data-countup="${data.avgTimeToApplyHours}">${data.avgTimeToApplyHours}</div>
        <div class="kpi-label">Avg Hours to Apply</div>
        <div class="kpi-sub">from discovery to application</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-accent" style="background:linear-gradient(90deg,var(--cyan),var(--sky));"></div>
        <div class="kpi-number" style="color:var(--cyan);" data-countup="${data.medianTimeToApplyHours}">${data.medianTimeToApplyHours}</div>
        <div class="kpi-label">Median Hours to Apply</div>
        <div class="kpi-sub">50th percentile</div>
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--orange);"></div>Time-to-Apply Distribution</div>
        <div class="chart-hint">How quickly do you apply after discovering a job?</div>
        ${data.timeToApplyBuckets.some((b: any) => b.count > 0) ? '<canvas id="chart-time-to-apply"></canvas>' : '<div class="empty-chart">No timing data</div>'}
      </div>
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--rose);"></div>Job Freshness at Application</div>
        <div class="chart-hint">How old were jobs when you applied?</div>
        ${data.freshnessAtApply.some((b: any) => b.count > 0) ? '<canvas id="chart-freshness"></canvas>' : '<div class="empty-chart">No timing data</div>'}
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--sky);"></div>Applications by Hour of Day</div>
        <div class="chart-hint">When are you most active applying? (Pacific Time)</div>
        ${data.applicationsByHour.some((h: any) => h.count > 0) ? '<canvas id="chart-apps-by-hour"></canvas>' : '<div class="empty-chart">No timing data</div>'}
      </div>
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--emerald);"></div>Applications by Day of Week</div>
        ${data.applicationsByDayOfWeek.some((d: any) => d.count > 0) ? '<canvas id="chart-apps-by-day"></canvas>' : '<div class="empty-chart">No timing data</div>'}
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-container full">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--pink);"></div>Weekly Activity Heatmap</div>
        <div class="chart-hint">Applications by day of week and hour (Pacific Time) — darker = more activity</div>
        ${data.appsByDayAndHour.length > 0 ? '<canvas id="chart-weekly-heatmap"></canvas>' : '<div class="empty-chart">No timing data</div>'}
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--violet);"></div>Daily Application Volume</div>
        ${data.applicationsPerDay.length > 0 ? '<canvas id="chart-apps-per-day"></canvas>' : '<div class="empty-chart">No timing data</div>'}
      </div>
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--lime);"></div>Peak Discovery Hours</div>
        <div class="chart-hint">When are new jobs being discovered/posted? (Pacific Time)</div>
        ${data.discoveryByHour.some((h: any) => h.count > 0) ? '<canvas id="chart-discovery-hours"></canvas>' : '<div class="empty-chart">No discovery data</div>'}
      </div>
    </div>
  </div>

  <!-- ═══════════ Section 6: Am I Wasting Time? ═══════════ -->
  <div class="dashboard-section" id="s-waste">
    <div class="section-header">
      <div class="section-dot" style="background:var(--rose);"></div>
      Am I Wasting Time?
    </div>
    <div class="section-subtitle">Validate whether your targeting and scoring predict real outcomes</div>

    <div class="chart-row">
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--rose);"></div>Fit Score vs Outcome</div>
        <div class="chart-hint">Each dot = one application. Higher score should correlate with better outcomes.</div>
        ${data.fitScoreVsOutcome.length > 0 ? '<canvas id="chart-fit-vs-outcome"></canvas>' : '<div class="empty-chart">Need scored applications to show this</div>'}
      </div>
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--coral);"></div>Rejection Rate by Category</div>
        <div class="chart-hint">Which industries reject you most?</div>
        ${data.rejectionByCategory.length > 0 ? '<canvas id="chart-rejection-by-cat"></canvas>' : '<div class="empty-chart">Need rejections to show this</div>'}
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-container full">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--amber);"></div>YOE Mismatch Tracker (Your YOE: ${data.userYoe})</div>
        <div class="chart-hint">Applied vs got interviews — grouped by how far the requirement exceeds your experience</div>
        ${data.yoeMismatch.some((y: any) => y.applied > 0) ? '<canvas id="chart-yoe-mismatch"></canvas>' : '<div class="empty-chart">Need applications with YOE data</div>'}
      </div>
    </div>
  </div>

  <!-- ═══════════ Section 7: What Should I Do Today? ═══════════ -->
  <div class="dashboard-section" id="s-action">
    <div class="section-header">
      <div class="section-dot" style="background:var(--lime);"></div>
      What Should I Do Today?
    </div>
    <div class="section-subtitle">Actionable opportunities you should act on now</div>

    <div class="chart-row">
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--lime);"></div>Hot Companies This Week</div>
        <div class="chart-hint">Companies with 2+ new roles in the last 7 days — they're actively hiring</div>
        ${data.hotCompanies.length > 0 ? '<canvas id="chart-hot-companies"></canvas>' : '<div class="empty-chart">No hot companies this week</div>'}
      </div>
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--orange);"></div>Stale Opportunities (${data.staleOpportunities.length})</div>
        <div class="chart-hint">Active jobs you discovered 3+ days ago but haven't applied to</div>
        <div id="stale-list" style="max-height:400px;overflow-y:auto;">
          ${data.staleOpportunities.length > 0 ? data.staleOpportunities.map((s: any) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.82rem;">
              <div style="flex:1;">
                <div style="font-weight:600;color:var(--text-primary);">${s.title}</div>
                <div style="color:var(--text-muted);font-size:0.75rem;">${s.company} · Tier ${s.tier} · ${s.daysAgo}d ago</div>
              </div>
              <a href="${s.roleUrl}" target="_blank" style="color:var(--accent);text-decoration:none;font-size:0.78rem;font-weight:600;padding:4px 10px;border:1px solid var(--accent);border-radius:6px;">View</a>
            </div>
          `).join("") : '<div class="empty-chart">No stale opportunities — you\'re on top of it!</div>'}
        </div>
      </div>
    </div>
  </div>

  <!-- ═══════════ Section 8: Pipeline Mechanics ═══════════ -->
  <div class="dashboard-section" id="s-pipeline-deep">
    <div class="section-header">
      <div class="section-dot" style="background:var(--cyan);"></div>
      Pipeline Mechanics
    </div>
    <div class="section-subtitle">How your application pipeline actually converts</div>

    <div class="kpi-row">
      ${data.funnelRates.map((f: any) => `
      <div class="kpi-card">
        <div class="kpi-accent" style="background:linear-gradient(90deg,var(--cyan),var(--sky));"></div>
        <div class="kpi-number" style="color:var(--cyan);">${f.rate}%</div>
        <div class="kpi-label">${f.from} → ${f.to}</div>
        <div class="kpi-sub">${f.count} converted</div>
      </div>`).join("")}
      <div class="kpi-card">
        <div class="kpi-accent" style="background:linear-gradient(90deg,var(--emerald),var(--lime));"></div>
        <div class="kpi-number" style="color:${data.respondedCount > data.ghostedCount ? 'var(--emerald)' : 'var(--rose)'};">${data.respondedCount + data.ghostedCount > 0 ? Math.round(data.respondedCount / (data.respondedCount + data.ghostedCount) * 100) : 0}%</div>
        <div class="kpi-label">Response Rate</div>
        <div class="kpi-sub">${data.ghostedCount} ghosted</div>
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--cyan);"></div>Response Breakdown</div>
        ${data.responseRate.length > 0 ? '<canvas id="chart-response-rate"></canvas>' : '<div class="empty-chart">No data</div>'}
      </div>
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--violet);"></div>Avg Days in Each Stage</div>
        <div class="chart-hint">How long until you hear back?</div>
        ${data.avgDaysPerStage.length > 0 ? '<canvas id="chart-days-per-stage"></canvas>' : '<div class="empty-chart">No stage data</div>'}
      </div>
    </div>
  </div>

  <!-- ═══════════ Section 9: Competition ═══════════ -->
  <div class="dashboard-section" id="s-competition">
    <div class="section-header">
      <div class="section-dot" style="background:var(--violet);"></div>
      What the Competition Tells You
    </div>
    <div class="section-subtitle">Market signals from listing behavior and compensation</div>

    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-accent" style="background:linear-gradient(90deg,var(--violet),var(--pink));"></div>
        <div class="kpi-number" style="color:var(--violet);" data-countup="${data.avgListingLifespanDays}">${data.avgListingLifespanDays}</div>
        <div class="kpi-label">Avg Listing Lifespan</div>
        <div class="kpi-sub">days before closing</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-accent" style="background:linear-gradient(90deg,var(--orange),var(--amber));"></div>
        <div class="kpi-number" style="color:var(--orange);" data-countup="${data.repostedJobs}">${data.repostedJobs}</div>
        <div class="kpi-label">Reposted Jobs</div>
        <div class="kpi-sub">closed then reopened</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-accent" style="background:linear-gradient(90deg,var(--emerald),var(--cyan));"></div>
        <div class="kpi-number" style="color:var(--emerald);" data-countup="${data.jobsWithSalary}">${data.jobsWithSalary}</div>
        <div class="kpi-label">Jobs with Salary</div>
        <div class="kpi-sub">${data.avgSalaryMin > 0 ? '$' + Math.round(data.avgSalaryMin/1000) + 'k - $' + Math.round(data.avgSalaryMax/1000) + 'k avg' : 'no salary data'}</div>
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--violet);"></div>Listing Lifespan Distribution</div>
        <div class="chart-hint">How long do jobs stay open before closing?</div>
        ${data.listingLifespanBuckets.some((b: any) => b.count > 0) ? '<canvas id="chart-lifespan"></canvas>' : '<div class="empty-chart">No closed listings yet</div>'}
      </div>
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--emerald);"></div>Salary Distribution</div>
        ${data.salaryBuckets.some((b: any) => b.count > 0) ? '<canvas id="chart-salary"></canvas>' : '<div class="empty-chart">No salary data available</div>'}
      </div>
    </div>

    ${data.repostedList.length > 0 ? `
    <div class="chart-row">
      <div class="chart-container full">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--orange);"></div>Reposted Jobs — Second Chance Opportunities</div>
        <div class="chart-hint">These jobs closed and reopened — the company didn't find someone. Your odds are better on round 2.</div>
        <canvas id="chart-reposted"></canvas>
      </div>
    </div>` : ""}
  </div>

  <!-- ═══════════ Section 10: Am I Getting Better? ═══════════ -->
  <div class="dashboard-section" id="s-progress">
    <div class="section-header">
      <div class="section-dot" style="background:var(--accent);"></div>
      Am I Getting Better?
    </div>
    <div class="section-subtitle">Track your improvement over time</div>

    <div class="chart-row">
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--accent);"></div>Weekly Fit Score Trend</div>
        <div class="chart-hint">Is your resume improving against job requirements?</div>
        ${data.weeklyFitScoreTrend.length > 0 ? '<canvas id="chart-fit-trend"></canvas>' : '<div class="empty-chart">Need more scored jobs over time</div>'}
      </div>
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--sky);"></div>Application Quality Trend</div>
        <div class="chart-hint">Are you applying to higher-tier jobs over time? (Lower = better)</div>
        ${data.applicationQualityTrend.length > 0 ? '<canvas id="chart-quality-trend"></canvas>' : '<div class="empty-chart">Need more applications over time</div>'}
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-container full">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--lime);"></div>Skills Gap Trend</div>
        <div class="chart-hint">Average number of skill gaps per scored job — trending down means improvement</div>
        ${data.weeklyGapTrend.length > 0 ? '<canvas id="chart-gap-trend"></canvas>' : '<div class="empty-chart">Need more scored jobs over time</div>'}
      </div>
    </div>
  </div>

  <!-- ═══════════ Section 11: Trends ═══════════ -->
  <div class="dashboard-section" id="s-trends">
    <div class="section-header">
      <div class="section-dot" style="background:var(--amber);"></div>
      Trends Over Time
    </div>
    <div class="section-subtitle">How the PM job market is evolving</div>

    <div class="chart-row">
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--emerald);"></div>New Jobs per Week</div>
        ${data.newJobsPerWeek.length > 0 ? '<canvas id="chart-new-per-week"></canvas>' : '<div class="empty-chart">No scan data</div>'}
      </div>
      <div class="chart-container">
        <div class="chart-title"><div class="chart-title-dot" style="background:var(--amber);"></div>Market Velocity</div>
        <div class="chart-hint">Above 1.0 = growing, below 1.0 = shrinking</div>
        ${data.marketVelocity.length > 0 ? '<canvas id="chart-velocity"></canvas>' : '<div class="empty-chart">No scan data</div>'}
      </div>
    </div>
  </div>

  <div class="dashboard-footer">
    PM Scout Analytics &middot; ${esc(generatedFmt)} &middot; ${data.totalDiscovered.toLocaleString()} jobs tracked
  </div>

  <script>
    window.__DASHBOARD_DATA__ = ${JSON.stringify(data)};
  </script>
  <script src="/dashboard/client.js"></script>
</body>
</html>`;
}
