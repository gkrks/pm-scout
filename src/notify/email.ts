/**
 * Phase 5 — Rich email digest sender.
 *
 * Subject: [New PM/APM Roles] N new jobs found — May 1, 2026 · 2:00 PM PT
 *
 * Body: tier-grouped job cards with company type, location, experience,
 * posted age, APM program badge, tier label.
 *
 * Env vars:
 *   NOTIFY_EMAIL_DIGEST=true
 *   SMTP_HOST   (default: smtp.gmail.com)
 *   SMTP_PORT   (default: 465)
 *   SMTP_USER, SMTP_PASS
 *   EMAIL_FROM  (default: SMTP_USER)
 *   EMAIL_TO
 *   DISPLAY_TIMEZONE  (default: America/Los_Angeles)
 */

import * as nodemailer from "nodemailer";
import type { Job } from "../state";
import type { RunStats } from "./telegram";
import { fmtDuration, newestFirst, isPostedToday } from "./digest";
import {
  loadCompanyMetaMap,
  type CompanyMetaMap,
  formatCompanyType,
  activeApmProgram,
  formatPostedAgo,
  formatLocation,
  formatExperience,
} from "./labels";

// ── Subject ───────────────────────────────────────────────────────────────────

function formatSubject(newJobs: Job[], runStartedAt: Date): string {
  const tz      = process.env.DISPLAY_TIMEZONE || "America/Los_Angeles";
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, month: "long", day: "numeric", year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
  });
  const count        = newJobs.length;
  const priorityApm  = newJobs.filter((j) => j.apmSignal === "priority_apm").length;
  const noun         = count === 1 ? "new job found" : "new jobs found";
  let subject        = `[New PM/APM Roles] ${count} ${noun}`;
  if (priorityApm > 0) {
    subject += ` · 🎯 ${priorityApm} APM Program${priorityApm === 1 ? "" : "s"}`;
  }
  return `${subject} — ${dateFmt.format(runStartedAt)} · ${timeFmt.format(runStartedAt)}`;
}

// ── Per-job tier helper ───────────────────────────────────────────────────────

function jobPmTier(j: Job): 1 | 2 | 3 {
  if (j.pmTier !== undefined) return j.pmTier;
  return j.earlyCareer ? 1 : 2;
}

// ── HTML builder ──────────────────────────────────────────────────────────────

export function buildEmailHtml(newJobs: Job[], stats: RunStats, metaMap?: CompanyMetaMap): string {
  const map    = metaMap ?? new Map();
  const now    = stats.completedAt;
  const tz     = process.env.DISPLAY_TIMEZONE || "America/Los_Angeles";
  const runFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
  });

  // Sort: newest-first as primary, then tier as tiebreak.
  // APM programs get their own section at the top but are also sorted newest-first.
  const sorted = [...newJobs].sort((a, b) => {
    const dateDiff = newestFirst(a, b);
    if (dateDiff !== 0) return dateDiff;
    return jobPmTier(a) - jobPmTier(b);
  });

  // APM-signal buckets — sorted newest-first independently.
  const priorityApm = sorted.filter((j) => j.apmSignal === "priority_apm");
  const apmCompany  = sorted.filter((j) => j.apmSignal === "apm_company");
  const standard    = sorted.filter((j) => !j.apmSignal || j.apmSignal === "none");
  const tier1 = standard.filter((j) => jobPmTier(j) === 1);
  const tier2 = standard.filter((j) => jobPmTier(j) === 2);
  const tier3 = standard.filter((j) => jobPmTier(j) === 3);

  const duration  = fmtDuration(stats.startedAt, stats.completedAt);
  const runLine   = `${runFmt.format(now)} · ${stats.companiesScanned} companies scanned · ${stats.errors} error${stats.errors === 1 ? "" : "s"} · ${duration}`;

  function card(j: Job, accentColor: string, isApm: boolean): string {
    const meta        = map.get(j.company);
    const companyType = formatCompanyType(meta);
    const apm         = activeApmProgram(meta);
    const loc         = formatLocation(j.location, j.workType);
    const exp         = formatExperience(j.earlyCareer);
    const posted      = formatPostedAgo(j.datePosted, now);
    const tier        = jobPmTier(j);
    const tierLabel   = tier === 1 ? "🥇 Apply today" : tier === 2 ? "🥈 Apply this week" : "🥉 Review when convenient";

    // Label styling — muted for standard, themed for APM rows
    const labelStyle = isApm
      ? "padding:3px 14px 3px 0;color:#6d28d9;white-space:nowrap;font-weight:500;"
      : "padding:3px 14px 3px 0;color:#6b7280;white-space:nowrap;";

    const rows: string[] = [
      `<tr><td style="${labelStyle}">📍 Location</td><td>${esc(loc)}</td></tr>`,
      `<tr><td style="${labelStyle}">💼 Experience</td><td>${esc(exp)}</td></tr>`,
      `<tr><td style="${labelStyle}">📅 Posted</td><td>${esc(posted)}</td></tr>`,
    ];

    if (apm) {
      const apmBadge = `<span style="background:#7c3aed;color:white;font-size:11px;font-weight:700;padding:2px 8px;border-radius:3px;vertical-align:middle;">${esc(apm)}</span>`;
      rows.push(`<tr><td style="${labelStyle}">🎓 Program</td><td>${apmBadge}</td></tr>`);
    }

    rows.push(`<tr><td style="${labelStyle}">🏷 Tier</td><td>${tierLabel}</td></tr>`);

    const subtitle = [
      `@ ${j.company}`,
      companyType ? `· ${companyType}` : "",
    ].filter(Boolean).join(" ");

    const newBadge = isPostedToday(j.datePosted) ? `<span style="background:#22c55e;color:white;font-size:11px;font-weight:700;padding:1px 6px;border-radius:3px;margin-right:6px;vertical-align:middle;">NEW</span>` : "";

    // APM cards: gradient background, thicker border, gold star accent
    if (isApm) {
      const apmType = j.apmSignal === "priority_apm" ? "priority_apm" : "apm_company";
      const apmTag = apmType === "priority_apm"
        ? `<span style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:white;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:8px;vertical-align:middle;letter-spacing:0.3px;">APM PROGRAM</span>`
        : `<span style="background:linear-gradient(135deg,#0891b2,#22d3ee);color:white;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:8px;vertical-align:middle;letter-spacing:0.3px;">APM COMPANY</span>`;
      const bgColor    = apmType === "priority_apm" ? "#faf5ff" : "#ecfeff";
      const borderColor = apmType === "priority_apm" ? "#7c3aed" : "#0891b2";
      const btnColor    = apmType === "priority_apm" ? "#7c3aed" : "#0891b2";
      return `
<div style="border-left:5px solid ${borderColor};padding:14px 18px;margin:12px 0;background:${bgColor};border-radius:0 8px 8px 0;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
  <div style="font-size:16px;font-weight:700;margin-bottom:4px;line-height:1.3;">
    ${newBadge}<a href="${j.applyUrl}" style="color:#1f2937;text-decoration:none;">${esc(j.title)}</a>${apmTag}
  </div>
  <div style="color:#6b7280;font-size:13px;margin-bottom:10px;">${esc(subtitle)}</div>
  <table style="font-size:13px;color:#374151;border-collapse:collapse;">${rows.join("")}</table>
  <div style="margin-top:12px;">
    <a href="${j.applyUrl}" style="background:${btnColor};color:white;padding:8px 20px;border-radius:5px;text-decoration:none;font-size:13px;font-weight:600;display:inline-block;">Apply →</a>
  </div>
</div>`;
    }

    // Standard card
    return `
<div style="border-left:4px solid ${accentColor};padding:12px 16px;margin:12px 0;background:#f9fafb;border-radius:0 6px 6px 0;">
  <div style="font-size:16px;font-weight:600;margin-bottom:4px;line-height:1.3;">
    ${newBadge}<a href="${j.applyUrl}" style="color:#1f2937;text-decoration:none;">${esc(j.title)}</a>
  </div>
  <div style="color:#6b7280;font-size:13px;margin-bottom:10px;">${esc(subtitle)}</div>
  <table style="font-size:13px;color:#374151;border-collapse:collapse;">${rows.join("")}</table>
  <div style="margin-top:12px;">
    <a href="${j.applyUrl}" style="background:${accentColor};color:white;padding:7px 16px;border-radius:5px;text-decoration:none;font-size:13px;font-weight:500;display:inline-block;">Apply →</a>
  </div>
</div>`;
  }

  function section(jobs: Job[], header: string, accentColor: string, isApm = false): string {
    if (jobs.length === 0) return "";
    const headerBg = isApm
      ? `background:linear-gradient(90deg,${accentColor}18,transparent);padding:6px 10px;border-radius:4px;`
      : "";
    return `
<h3 style="border-bottom:2px solid ${accentColor};padding-bottom:4px;margin-top:32px;color:#1f2937;font-size:1rem;${headerBg}">${header} (${jobs.length})</h3>
${jobs.map((j) => card(j, accentColor, isApm)).join("")}`;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#333;background:#fff;">
  <h2 style="margin:0 0 6px 0;font-size:1.2rem;color:#1f2937;">
    ${newJobs.length} new PM/APM role${newJobs.length === 1 ? "" : "s"} found
  </h2>
  <p style="color:#6b7280;margin:0 0 24px 0;font-size:13px;">${esc(runLine)}</p>
  ${section(priorityApm, "🎯 APM Programs — your highest-priority targets", "#7c3aed", true)}
  ${section(apmCompany,  "⭐ APM Companies — these companies run APM programs", "#0891b2", true)}
  ${section(tier1, "🥇 Apply today — newest first",              "#22c55e")}
  ${section(tier2, "🥈 Apply this week — newest first",           "#3b82f6")}
  ${section(tier3, "🥉 Review when convenient — newest first",    "#9ca3af")}
  <hr style="margin-top:32px;border:none;border-top:1px solid #e5e7eb;">
  <p style="color:#6b7280;font-size:12px;margin-top:8px;">
    Configured to scan companies hourly.
    Reply STOP to mute alerts for 24h.
  </p>
</body>
</html>`;
}

// ── Plaintext builder ─────────────────────────────────────────────────────────

export function buildEmailText(newJobs: Job[], stats: RunStats, metaMap?: CompanyMetaMap): string {
  const map    = metaMap ?? new Map();
  const now    = stats.completedAt;
  const tz     = process.env.DISPLAY_TIMEZONE || "America/Los_Angeles";
  const subj   = formatSubject(newJobs, stats.startedAt);
  const runFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
  });

  // Newest-first primary sort, tier as tiebreak.
  const sorted = [...newJobs].sort((a, b) => {
    const dateDiff = newestFirst(a, b);
    if (dateDiff !== 0) return dateDiff;
    return jobPmTier(a) - jobPmTier(b);
  });
  const priorityApm = sorted.filter((j) => j.apmSignal === "priority_apm");
  const apmCompany  = sorted.filter((j) => j.apmSignal === "apm_company");
  const standard    = sorted.filter((j) => !j.apmSignal || j.apmSignal === "none");
  const tier1 = standard.filter((j) => jobPmTier(j) === 1);
  const tier2 = standard.filter((j) => jobPmTier(j) === 2);
  const tier3 = standard.filter((j) => jobPmTier(j) === 3);

  const duration = fmtDuration(stats.startedAt, stats.completedAt);
  const runLine  = `Run: ${runFmt.format(now)} · ${stats.companiesScanned} companies · ${stats.errors} errors · ${duration}`;

  const lines: string[] = [subj, runLine, ""];

  function jobBlock(j: Job): string {
    const meta        = map.get(j.company);
    const companyType = formatCompanyType(meta);
    const apm         = activeApmProgram(meta);
    const loc         = formatLocation(j.location, j.workType);
    const exp         = formatExperience(j.earlyCareer);
    const posted      = formatPostedAgo(j.datePosted, now);

    const parts = [
      `${j.title}`,
      `@ ${j.company}${companyType ? ` · ${companyType}` : ""}`,
      `- Location:   ${loc}`,
      `- Experience: ${exp}`,
      `- Posted:     ${posted}`,
    ];
    if (apm) parts.push(`- APM Program: ${apm}`);
    parts.push(`- Apply:       ${j.applyUrl}`);
    return parts.join("\n");
  }

  function appendSection(jobs: Job[], header: string): void {
    if (jobs.length === 0) return;
    lines.push(`== ${header} (${jobs.length}) ==`, "");
    for (const j of jobs) {
      lines.push(jobBlock(j), "");
    }
  }

  appendSection(priorityApm, "APM Programs — your highest-priority targets");
  appendSection(apmCompany,  "APM Companies — these companies run APM programs");
  appendSection(tier1, "Apply today");
  appendSection(tier2, "Apply this week");
  appendSection(tier3, "Review when convenient");
  return lines.join("\n");
}

// ── Escape helper (HTML only) ─────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Sender ────────────────────────────────────────────────────────────────────

export async function sendEmailDigest(newJobs: Job[], stats: RunStats): Promise<void> {
  if (process.env.NOTIFY_EMAIL_DIGEST !== "true") return;

  const host = process.env.SMTP_HOST ?? "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT ?? "465", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM ?? user;
  const to   = process.env.EMAIL_TO;

  if (!user || !pass || !to) {
    console.warn("[email] SMTP_USER, SMTP_PASS, or EMAIL_TO not set — skipping");
    return;
  }
  if (newJobs.length === 0) {
    console.log("[email] No new jobs — digest skipped");
    return;
  }

  const metaMap = loadCompanyMetaMap();
  const subject = formatSubject(newJobs, stats.startedAt);

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  try {
    await transport.sendMail({
      from,
      to,
      subject,
      html: buildEmailHtml(newJobs, stats, metaMap),
      text: buildEmailText(newJobs, stats, metaMap),
    });
    console.log(`[email] Digest sent → ${to}`);
  } catch (err) {
    console.error(`[email] Send failed: ${err instanceof Error ? err.message : err}`);
  }
}
