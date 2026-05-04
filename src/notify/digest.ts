/**
 * Phase 5 — Tier-aware digest builder.
 *
 * Groups new jobs into Tier 1 (apply today), Tier 2 (apply this week),
 * and Tier 3 (review when convenient). Tier is a label — all three groups
 * are surfaced. Tier 1 always appears first.
 *
 * Used by both the Telegram sender and the email sender.
 */

import type { Job } from "../state";
import type { RunStats } from "./telegram";
import {
  type CompanyMetaMap,
  formatCompanyType,
  activeApmProgram,
  formatPostedAgo,
  formatLocation,
  formatExperience,
} from "./labels";

// ── Helpers ───────────────────────────────────────────────────────────────────

export function fmtDate(datePosted: string): string {
  if (datePosted === "—" || !datePosted) return "unknown";
  try {
    return new Date(datePosted).toLocaleDateString("en-US", {
      month: "short",
      day:   "numeric",
    });
  } catch {
    return datePosted;
  }
}

export function fmtDuration(start: Date, end: Date): string {
  const secs = Math.round((end.getTime() - start.getTime()) / 1_000);
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/** Escape Telegram MarkdownV2 special characters. */
export function esc(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

/** Resolve a job's PM tier. Falls back to earlyCareer heuristic for legacy jobs. */
function jobPmTier(j: Job): 1 | 2 | 3 {
  if (j.pmTier !== undefined) return j.pmTier;
  return j.earlyCareer ? 1 : 2;
}

/** Returns true when a job was posted within the last 24 hours. */
export function isPostedToday(datePosted: string): boolean {
  if (!datePosted || datePosted === "—") return false;
  const ageMs = Date.now() - new Date(datePosted).getTime();
  return ageMs < 24 * 60 * 60 * 1_000;
}

/**
 * Sort comparator: newest posted date first, with firstSeenAt as tiebreak,
 * and unknown dates (datePosted === "—") pushed to the bottom.
 * Mirrors the SQL: ORDER BY coalesce(posted_date, first_seen_at::date) DESC,
 *   first_seen_at DESC.
 */
export function newestFirst(a: Job, b: Job): number {
  const aDate = a.datePosted !== "—" ? a.datePosted : (a.firstSeenAt?.slice(0, 10) ?? "");
  const bDate = b.datePosted !== "—" ? b.datePosted : (b.firstSeenAt?.slice(0, 10) ?? "");
  if (!aDate && !bDate) return 0;
  if (!aDate) return 1;
  if (!bDate) return -1;
  if (bDate !== aDate) return bDate.localeCompare(aDate);
  // Tiebreak: firstSeenAt desc
  return (b.firstSeenAt ?? "").localeCompare(a.firstSeenAt ?? "");
}

/**
 * Group jobs by company while preserving the overall sort order.
 * The first company encountered (with the most-recently-posted job overall)
 * appears first; within each company, jobs are already sorted by newestFirst.
 */
function groupByCompany(jobs: Job[]): Map<string, Job[]> {
  const map = new Map<string, Job[]>();
  // jobs is already sorted newestFirst — Map preserves insertion order,
  // so the first job of each company determines company ordering.
  for (const j of jobs) {
    if (!map.has(j.company)) map.set(j.company, []);
    map.get(j.company)!.push(j);
  }
  return map;
}

// ── Telegram (MarkdownV2) ─────────────────────────────────────────────────────

/**
 * Build tier-grouped MarkdownV2 messages split at 4 000 chars.
 * Tier 1 (apply today) always appears first so it fits in the first message.
 * All three tiers are surfaced — Tier 3 is not hidden.
 *
 * Per-job format (spec 4i):
 *   *Company* · Category · Tag1, Tag2
 *   • [Title](url)
 *      📍 Location · 💼 Experience · 📅 Xd ago
 *      🎓 APM Program (if active)
 */
export function buildTierTelegramMessages(
  newJobs:  Job[],
  stats:    RunStats,
  metaMap?: CompanyMetaMap,
): string[] {
  const map = metaMap ?? new Map();
  // Sort all jobs: newest-first primary, tier as tiebreak.
  // APM programs still get their own section at the top.
  const sorted = [...newJobs].sort((a, b) => {
    const dateDiff = newestFirst(a, b);
    if (dateDiff !== 0) return dateDiff;
    return jobPmTier(a) - jobPmTier(b);
  });

  // APM-signal buckets (Bug Fix 15e)
  const priorityApm = sorted.filter((j) => j.apmSignal === "priority_apm");
  const apmCompany  = sorted.filter((j) => j.apmSignal === "apm_company");
  const standard    = sorted.filter((j) => !j.apmSignal || j.apmSignal === "none");
  const tier1 = standard.filter((j) => jobPmTier(j) === 1);
  const tier2 = standard.filter((j) => jobPmTier(j) === 2);
  const tier3 = standard.filter((j) => jobPmTier(j) === 3);

  const runDate  = stats.completedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const duration = fmtDuration(stats.startedAt, stats.completedAt);
  const now      = stats.completedAt;

  const apmLine = priorityApm.length > 0
    ? ` · 🎯 ${esc(String(priorityApm.length))} APM Program${priorityApm.length === 1 ? "" : "s"}`
    : "";
  const lines: string[] = [
    `🆕 *${esc(String(newJobs.length))} new PM/APM roles* — ${esc(runDate)}${apmLine}`,
    `🥇 Tier 1: ${esc(String(tier1.length + priorityApm.length + apmCompany.length))} · 🥈 Tier 2: ${esc(String(tier2.length))} · 🥉 Tier 3: ${esc(String(tier3.length))}`,
    "",
  ];

  function appendGroup(jobs: Job[], header: string): void {
    if (jobs.length === 0) return;
    lines.push(header, "");
    const grouped = groupByCompany(jobs);
    for (const [company, cJobs] of grouped) {
      const meta        = map.get(company);
      const companyType = formatCompanyType(meta);
      const companyLine = companyType
        ? `*${esc(company)}* · ${esc(companyType)}`
        : `*${esc(company)}*`;
      lines.push(companyLine);

      for (const j of cJobs) {
        const loc    = formatLocation(j.location, j.workType);
        const exp    = formatExperience(j.earlyCareer, j.yoeMin, j.yoeMax);
        const posted = formatPostedAgo(j.datePosted, now);
        const apm    = activeApmProgram(meta);

        // Keep posted display short for Telegram: "2d ago" not "2d ago (Apr 29)"
        const postedShort = posted.replace(/\s+\([^)]+\)$/, "");

        const newBadge = isPostedToday(j.datePosted) ? "🆕 " : "";
        lines.push(`• ${newBadge}[${esc(j.title)}](${j.applyUrl})`);
        lines.push(`   📍 ${esc(loc)} · 💼 ${esc(exp)} · 📅 ${esc(postedShort)}`);
        if (apm) {
          lines.push(`   🎓 ${esc(apm)}`);
        }
      }
      lines.push("");
    }
  }

  // APM priority sections always appear first (Bug Fix 15e)
  appendGroup(priorityApm, "*🎯 APM Programs* — your highest\\-priority targets");
  appendGroup(apmCompany,  "*⭐ APM Companies* — these companies run APM programs");
  // Standard tier sections for non-APM-signal jobs
  appendGroup(tier1, "*🥇 Apply today* — newest first");
  appendGroup(tier2, "*🥈 Apply this week* — newest first");
  appendGroup(tier3, "*🥉 Review when convenient* — newest first");

  lines.push(
    `_Run took ${esc(duration)} · ` +
    `${esc(String(stats.companiesScanned))} companies · ` +
    `${esc(String(stats.errors))} errors_`,
  );

  // Split into ≤ 4 000-char chunks
  const messages: string[] = [];
  let current = "";
  for (const line of lines) {
    const addition = (current ? "\n" : "") + line;
    if (current.length + addition.length > 4_000) {
      messages.push(current);
      current = line;
    } else {
      current += addition;
    }
  }
  if (current) messages.push(current);
  return messages;
}

// ── Email (HTML) ──────────────────────────────────────────────────────────────

export function buildTierEmailHtml(newJobs: Job[], stats: RunStats): string {
  const sorted = [...newJobs].sort(newestFirst);
  const tier1 = sorted.filter((j) => jobPmTier(j) === 1);
  const tier2 = sorted.filter((j) => jobPmTier(j) === 2);
  const tier3 = sorted.filter((j) => jobPmTier(j) === 3);

  const runDate  = stats.completedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const duration = fmtDuration(stats.startedAt, stats.completedAt);

  function renderGroup(jobs: Job[], header: string, color: string): string {
    if (jobs.length === 0) return "";
    const grouped = groupByCompany(jobs);
    const sections = [...grouped].map(([company, cJobs]) => {
      const items = cJobs.map((j) => {
        const posted = fmtDate(j.datePosted);
        const badge  = j.earlyCareer ? " · early-career" : "";
        return `
          <li style="margin-bottom:10px;">
            <a href="${j.applyUrl}" style="font-weight:600;color:#1a73e8;text-decoration:none;">${j.title}</a><br>
            <small style="color:#666;">${j.location || "?"} · Posted ${posted}${badge}</small>
          </li>`;
      }).join("");
      return `
        <h3 style="margin:20px 0 6px;color:#333;font-size:.95rem;">${company} (${cJobs.length})</h3>
        <ul style="margin:0;padding-left:20px;line-height:1.7;">${items}</ul>`;
    }).join("\n");

    return `
      <h2 style="color:${color};font-size:1rem;margin:28px 0 4px;">${header}</h2>
      ${sections}`;
  }

  const tier1Html = renderGroup(tier1, `🥇 Tier 1 — Apply today (${tier1.length}) — newest first`,             "#22c55e");
  const tier2Html = renderGroup(tier2, `🥈 Tier 2 — Apply this week (${tier2.length}) — newest first`,         "#3b82f6");
  const tier3Html = renderGroup(tier3, `🥉 Tier 3 — Review when convenient (${tier3.length}) — newest first`, "#9ca3af");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#333;background:#fff;">
  <h1 style="font-size:1.25rem;margin-top:0;color:#333;">
    ${newJobs.length} new PM/APM role${newJobs.length === 1 ? "" : "s"}
  </h1>
  <p style="color:#666;margin-top:-8px;">
    ${runDate} · ${stats.companiesScanned} companies · ${stats.errors} error${stats.errors === 1 ? "" : "s"}
  </p>
  ${tier1Html}
  ${tier2Html}
  ${tier3Html}
  <hr style="border:none;border-top:1px solid #e0e0e0;margin:28px 0;">
  <p style="color:#888;font-size:12px;">Run duration: ${duration}</p>
</body>
</html>`;
}

export function buildTierEmailText(newJobs: Job[], stats: RunStats): string {
  const sorted = [...newJobs].sort(newestFirst);
  const tier1 = sorted.filter((j) => jobPmTier(j) === 1);
  const tier2 = sorted.filter((j) => jobPmTier(j) === 2);
  const tier3 = sorted.filter((j) => jobPmTier(j) === 3);
  const runDate = stats.completedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC";

  const lines: string[] = [
    `${newJobs.length} new PM/APM roles — ${runDate}`,
    `${stats.companiesScanned} companies · ${stats.errors} errors`,
    "",
  ];

  function appendGroup(jobs: Job[], header: string): void {
    if (jobs.length === 0) return;
    lines.push(header);
    const grouped = groupByCompany(jobs);
    for (const [company, cJobs] of grouped) {
      lines.push(`\n${company} (${cJobs.length})`);
      for (const j of cJobs) {
        lines.push(`  • ${j.title} — ${j.location || "?"}`);
        lines.push(`    ${j.applyUrl}`);
      }
    }
    lines.push("");
  }

  appendGroup(tier1, "── 🥇 Tier 1 — Apply today — newest first ──");
  appendGroup(tier2, "── 🥈 Tier 2 — Apply this week — newest first ──");
  appendGroup(tier3, "── 🥉 Tier 3 — Review when convenient — newest first ──");
  return lines.join("\n");
}
