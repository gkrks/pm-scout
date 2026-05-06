/**
 * Server-rendered HTML for the Fit page.
 * Clean two-column layout: qualification left, recommendations right.
 * Auto-scores on load. Summary + skills sections. Strength modal.
 */

export interface FitPageData {
  jobId: string;
  token: string;
  companyName: string;
  title: string;
  location: string;
  isRemote: boolean;
  isHybrid: boolean;
  ats: string;
  postedDate: string | null;
  firstSeenAt: string | null;
  roleUrl: string;
  requiredQuals: string[];
  preferredQuals: string[];
  emails: string[];
  applicationStatus: {
    applied: boolean;
    appliedBy: string;
    appliedDate: string;
    status: string;
  } | null;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function workTypeBadge(isRemote: boolean, isHybrid: boolean): string {
  if (isRemote) return '<span class="badge badge-remote">Remote</span>';
  if (isHybrid) return '<span class="badge badge-hybrid">Hybrid</span>';
  return '<span class="badge badge-onsite">Onsite</span>';
}

function formatPostedDate(postedDate: string | null, firstSeenAt: string | null): string {
  const raw = postedDate || firstSeenAt;
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  const formatted = d.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(firstSeenAt && !postedDate ? { hour: "numeric", minute: "2-digit", hour12: true } : {}),
  });
  const label = postedDate ? "Posted" : "First seen";
  return `<span class="posted-date">${label}: ${esc(formatted)} PDT</span>`;
}

function atsBadge(ats: string): string {
  if (!ats) return "";
  const label = ats.replace(/-playwright$/, "").replace(/-/g, " ");
  return `<span class="badge badge-ats">${esc(label)}</span>`;
}

function qualRow(id: string, text: string, kind: string): string {
  return `
    <div class="qual-row" data-qual-id="${esc(id)}" data-qual-kind="${esc(kind)}">
      <div class="qual-left">
        <span class="qual-kind ${kind}">${kind === "basic" ? "Required" : "Preferred"}</span>
        <span class="qual-text">${esc(text)}</span>
      </div>
      <div class="qual-right" id="candidates-${esc(id)}">
        <div class="loading-placeholder"><span class="spinner-icon"></span></div>
      </div>
    </div>`;
}

export function renderFitPage(data: FitPageData): string {
  const requiredRows = data.requiredQuals
    .map((text, i) => qualRow(`q_basic_${i}`, text, "basic"))
    .join("\n");

  const preferredRows = data.preferredQuals
    .map((text, i) => qualRow(`q_preferred_${i}`, text, "preferred"))
    .join("\n");

  const totalQuals = data.requiredQuals.length + data.preferredQuals.length;
  const emptyState = totalQuals === 0
    ? `<div class="empty-state">
         <p>No qualifications extracted for this job.</p>
         <a href="${esc(data.roleUrl)}" target="_blank">View original posting</a>
       </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Check Fit - ${esc(data.companyName)} - ${esc(data.title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f9fafb;
      color: #111827;
      line-height: 1.6;
      padding-bottom: 80px;
    }

    .container { max-width: 1100px; margin: 0 auto; padding: 0 20px; }

    /* Header */
    .header {
      background: #fff;
      border-bottom: 1px solid #e5e7eb;
      padding: 24px 0;
      margin-bottom: 28px;
    }
    .header-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .header h1 { font-size: 1.4rem; font-weight: 700; color: #111827; }
    .header .company { font-size: 1rem; color: #6b7280; margin-top: 2px; }
    .header .meta {
      display: flex; gap: 10px; flex-wrap: wrap;
      margin-top: 10px; align-items: center;
    }
    .header .meta a { color: #6366f1; text-decoration: none; font-size: 0.85rem; }
    .header .meta a:hover { text-decoration: underline; }

    /* Badges */
    .badge {
      display: inline-block; padding: 2px 8px; border-radius: 4px;
      font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;
    }
    .badge-remote { background: #d1fae5; color: #065f46; }
    .badge-hybrid { background: #dbeafe; color: #1e40af; }
    .badge-onsite { background: #fef3c7; color: #92400e; }
    .badge-ats { background: #ede9fe; color: #5b21b6; }

    /* Posted date */
    .posted-date {
      font-size: 0.78rem; color: #6b7280; font-weight: 500;
    }

    /* Strength score (top right) */
    .strength-trigger {
      position: fixed; top: 20px; right: 20px; z-index: 200;
      background: #fff; border: 2px solid #e5e7eb; border-radius: 12px;
      padding: 12px 18px; cursor: pointer; text-align: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08); transition: border-color 0.2s;
      display: none;
    }
    .strength-trigger:hover { border-color: #6366f1; }
    .strength-number { font-size: 2rem; font-weight: 800; line-height: 1; }
    .strength-label { font-size: 0.7rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
    .strength-green { color: #059669; }
    .strength-yellow { color: #d97706; }
    .strength-red { color: #dc2626; }

    /* Modal */
    .modal-overlay {
      display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.4);
      z-index: 300; align-items: center; justify-content: center;
    }
    .modal-overlay.open { display: flex; }
    .modal {
      background: #fff; border-radius: 12px; padding: 28px; width: 480px;
      max-width: 90vw; max-height: 80vh; overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0,0,0,0.15);
    }
    .modal h2 { font-size: 1.2rem; margin-bottom: 16px; }
    .modal-close {
      float: right; background: none; border: none; font-size: 1.5rem;
      cursor: pointer; color: #9ca3af; line-height: 1;
    }
    .modal-close:hover { color: #111; }
    .score-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 0; border-bottom: 1px solid #f3f4f6;
    }
    .score-row:last-child { border-bottom: none; }
    .score-row-label { font-size: 0.9rem; color: #374151; }
    .score-row-value { font-size: 0.95rem; font-weight: 700; }
    .score-bar-track { flex: 1; height: 8px; background: #f3f4f6; border-radius: 4px; margin: 0 12px; }
    .score-bar-fill { height: 8px; border-radius: 4px; transition: width 0.5s; }

    /* Section headings */
    .section-title {
      font-size: 0.85rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.8px; margin: 28px 0 14px; padding-bottom: 8px;
      border-bottom: 2px solid #e5e7eb; color: #374151;
    }
    .section-title.required { border-color: #ef4444; color: #991b1b; }
    .section-title.preferred { border-color: #f59e0b; color: #92400e; }
    .section-title.summary-title { border-color: #6366f1; color: #4338ca; }
    .section-title.skills-title { border-color: #10b981; color: #065f46; }

    /* Two-column qual rows */
    .qual-row {
      display: grid; grid-template-columns: 1fr 1.4fr; gap: 16px;
      background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
      padding: 14px 16px; margin-bottom: 10px;
      transition: border-color 0.15s;
    }
    .qual-row.selected { border-color: #6366f1; border-left: 3px solid #6366f1; }
    .qual-left { display: flex; flex-direction: column; gap: 4px; }
    .qual-kind {
      display: inline-block; font-size: 0.65rem; font-weight: 700;
      text-transform: uppercase; padding: 1px 5px; border-radius: 3px;
      width: fit-content; letter-spacing: 0.3px;
    }
    .qual-kind.basic { background: #fee2e2; color: #991b1b; }
    .qual-kind.preferred { background: #fef3c7; color: #92400e; }
    .qual-text { font-size: 0.85rem; color: #374151; }
    .qual-right { min-height: 40px; }

    /* Candidate options */
    .candidate {
      border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px;
      margin-bottom: 6px; cursor: pointer; transition: all 0.15s;
      font-size: 0.84rem;
    }
    .candidate:hover { border-color: #a5b4fc; background: #fafafe; }
    .candidate.active { border-color: #6366f1; background: #f5f3ff; }
    .candidate-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 4px;
    }
    .candidate-source { font-size: 0.72rem; color: #9ca3af; }
    .score-badge {
      font-size: 0.72rem; font-weight: 700; padding: 1px 6px; border-radius: 3px;
    }
    .score-high { background: #d1fae5; color: #065f46; }
    .score-mid { background: #fef3c7; color: #92400e; }
    .score-low { background: #fee2e2; color: #991b1b; }
    .badge-recommended {
      background: #d1fae5; color: #065f46;
      font-size: 0.65rem; padding: 1px 5px; border-radius: 3px; margin-right: 4px;
    }
    .candidate-text { font-size: 0.82rem; color: #1f2937; line-height: 1.4; }

    /* Pre-resolved */
    .pre-resolved {
      border-left: 3px solid #22c55e; background: #f0fdf4;
      padding: 10px 12px; border-radius: 6px; font-size: 0.84rem;
    }
    .pre-resolved.not-met { border-color: #ef4444; background: #fef2f2; }
    .pre-resolved-status { font-weight: 700; margin-bottom: 2px; }
    .pre-resolved-evidence { color: #374151; }
    .pre-resolved-meta { font-size: 0.72rem; color: #9ca3af; margin-top: 4px; }

    /* Summary section */
    .summary-box {
      background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
      padding: 16px; margin-bottom: 10px;
    }
    .summary-text { font-size: 0.88rem; color: #1f2937; line-height: 1.5; }
    .summary-loading { color: #9ca3af; font-style: italic; font-size: 0.85rem; }
    .summary-candidate {
      border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px;
      margin-bottom: 8px; cursor: pointer; transition: all 0.15s;
    }
    .summary-candidate:hover { border-color: #a5b4fc; background: #fafafe; }
    .summary-candidate.active { border-color: #6366f1; background: #f5f3ff; border-left: 3px solid #6366f1; }

    /* Edit textarea inline */
    .edit-textarea {
      width: 100%; margin-top: 6px; padding: 8px;
      border: 1px solid #a5b4fc; border-radius: 4px;
      font-size: 0.82rem; resize: vertical; min-height: 60px;
    }

    /* Skills section */
    .skills-box {
      background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
      padding: 14px 16px; margin-bottom: 10px;
    }
    .skill-line { font-size: 0.85rem; margin-bottom: 4px; }
    .skill-line-name { font-weight: 700; color: #111827; }
    .skill-line-list { color: #4b5563; }
    .skill-edit-btn {
      background: none; border: 1px solid #d1d5db; color: #6366f1;
      padding: 1px 8px; border-radius: 4px; font-size: 0.7rem;
      cursor: pointer; margin-left: 8px; transition: all 0.15s;
    }
    .skill-edit-btn:hover { background: #f5f3ff; border-color: #6366f1; }
    .skill-edit-input {
      width: 100%; padding: 6px 8px; border: 1px solid #a5b4fc;
      border-radius: 4px; font-size: 0.82rem; margin-top: 4px;
    }
    .skill-edit-actions { margin-top: 4px; display: flex; gap: 6px; }
    .skills-loading { color: #9ca3af; font-style: italic; font-size: 0.85rem; }
    .skill-delete-btn {
      background: none; border: 1px solid #fca5a5; color: #dc2626;
      padding: 1px 6px; border-radius: 4px; font-size: 0.7rem;
      cursor: pointer; margin-left: 4px; transition: all 0.15s;
    }
    .skill-delete-btn:hover { background: #fef2f2; border-color: #dc2626; }

    /* Summary edit */
    .summary-edit-btn {
      background: none; border: 1px solid #d1d5db; color: #6366f1;
      padding: 2px 8px; border-radius: 4px; font-size: 0.7rem;
      cursor: pointer; margin-top: 6px; transition: all 0.15s;
    }
    .summary-edit-btn:hover { background: #f5f3ff; border-color: #6366f1; }
    .summary-edit-area { margin-top: 8px; }
    .summary-edit-textarea {
      width: 100%; padding: 8px; border: 1px solid #a5b4fc; border-radius: 4px;
      font-size: 0.84rem; resize: vertical; min-height: 70px; line-height: 1.5;
      font-family: inherit;
    }
    .summary-edit-actions { margin-top: 4px; display: flex; gap: 6px; align-items: center; }
    .summary-char-count { font-size: 0.7rem; color: #9ca3af; margin-left: auto; }

    /* Preview modal */
    .preview-modal .modal {
      width: 95vw; max-width: 900px; height: 90vh; padding: 12px;
      display: flex; flex-direction: column;
    }
    .preview-modal .modal h2 { margin-bottom: 8px; flex-shrink: 0; }
    #preview-iframe {
      flex: 1; width: 100%; border: 1px solid #e5e7eb; border-radius: 4px;
    }

    /* Footer */
    .sticky-footer {
      position: fixed; bottom: 0; left: 0; right: 0;
      background: #fff; border-top: 1px solid #e5e7eb;
      padding: 10px 20px;
      display: flex; justify-content: center; gap: 12px; align-items: center;
      z-index: 100;
    }
    .footer-status { font-size: 0.8rem; color: #6b7280; }

    /* Buttons */
    .btn {
      display: inline-block; padding: 9px 18px; border-radius: 6px;
      font-size: 0.85rem; font-weight: 600; border: none;
      cursor: pointer; transition: all 0.15s; text-decoration: none;
    }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-pdf { background: #dc2626; color: #fff; }
    .btn-pdf:hover:not(:disabled) { background: #b91c1c; }
    .btn-docx { background: #2563eb; color: #fff; }
    .btn-docx:hover:not(:disabled) { background: #1d4ed8; }
    .btn-sm { padding: 4px 10px; font-size: 0.75rem; }
    .btn-link { background: none; color: #6366f1; padding: 2px 0; font-size: 0.75rem; }
    .btn-link:hover { text-decoration: underline; }

    /* Loading */
    .loading-placeholder { text-align: center; padding: 8px; }
    .spinner-icon {
      display: inline-block; width: 16px; height: 16px;
      border: 2px solid #e5e7eb; border-top-color: #6366f1;
      border-radius: 50%; animation: spin 0.6s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .page-loading {
      text-align: center; padding: 60px 20px; color: #6b7280; font-size: 0.95rem;
    }

    /* Empty state */
    .empty-state { text-align: center; padding: 40px; color: #6b7280; }
    .empty-state a { color: #6366f1; }

    /* Responsive */
    @media (max-width: 768px) {
      .qual-row { grid-template-columns: 1fr; }
      .strength-trigger { position: static; margin: 0 auto 20px; display: block !important; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="container">
      <div class="header-top">
        <div>
          <h1>${esc(data.title)}</h1>
          <div class="company">${esc(data.companyName)}</div>
        </div>
        ${formatPostedDate(data.postedDate, data.firstSeenAt)}
      </div>
      <div class="meta">
        ${data.location ? `<span>${esc(data.location)}</span>` : ""}
        ${workTypeBadge(data.isRemote, data.isHybrid)}
        ${atsBadge(data.ats)}
        <a href="${esc(data.roleUrl)}" target="_blank">View posting</a>${process.env.DASHBOARD_TOKEN ? `
        <a href="/dashboard?token=${esc(process.env.DASHBOARD_TOKEN)}" style="margin-left:auto;background:#0d9488;color:#fff;padding:4px 12px;border-radius:5px;text-decoration:none;font-size:0.78rem;font-weight:600;">Dashboard</a>
        <a href="/tracker?token=${esc(process.env.DASHBOARD_TOKEN)}" style="background:#0ea5e9;color:#fff;padding:4px 12px;border-radius:5px;text-decoration:none;font-size:0.78rem;font-weight:600;">Tracker</a>
        <a href="/fit/new?token=${esc(process.env.DASHBOARD_TOKEN)}" style="background:#8b5cf6;color:#fff;padding:4px 12px;border-radius:5px;text-decoration:none;font-size:0.78rem;font-weight:600;">Check Any Job</a>` : ""}
      </div>
      <div class="email-selector" style="margin-top:10px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:0.8rem;color:#6b7280;">Resume email:</span>
        <select id="email-select" style="padding:4px 8px;border:1px solid #e5e7eb;border-radius:4px;font-size:0.82rem;">
          ${data.emails.map((e, i) => `<option value="${esc(e)}"${i === 0 ? " selected" : ""}>${esc(e)}</option>`).join("")}
          <option value="__custom__">+ Custom email</option>
        </select>
        <input type="email" id="email-custom-input" placeholder="your@email.com" style="display:none;padding:4px 8px;border:1px solid #e5e7eb;border-radius:4px;font-size:0.82rem;width:220px;">
      </div>
    </div>
  </div>

  <!-- Application status banner -->
  <div class="container" style="margin-bottom:16px;">
    <div id="apply-banner" style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:8px;font-size:0.88rem;${
      data.applicationStatus?.applied
        ? 'background:#d1fae5;border:1px solid #22c55e;color:#065f46;'
        : 'background:#f0f9ff;border:1px solid #93c5fd;color:#1e40af;'
    }">
      ${data.applicationStatus?.applied
        ? `<span style="font-weight:700;">Applied</span> by ${esc(data.applicationStatus.appliedBy)} on ${esc(data.applicationStatus.appliedDate)}`
        : `<button class="btn" id="apply-btn" style="background:#2563eb;color:#fff;padding:6px 14px;font-size:0.82rem;">Mark as Applied</button>
           <span style="color:#6b7280;">No one has applied to this role yet</span>`
      }
    </div>
  </div>

  <!-- Strength score badge (top-right, shown after scoring) -->
  <div class="strength-trigger" id="strength-trigger" onclick="document.getElementById('strength-modal').classList.add('open')">
    <div class="strength-number" id="strength-number">--</div>
    <div class="strength-label">Fit Score</div>
  </div>

  <!-- Strength modal -->
  <div class="modal-overlay" id="strength-modal">
    <div class="modal">
      <button class="modal-close" onclick="this.closest('.modal-overlay').classList.remove('open')">&times;</button>
      <h2>Resume Strength</h2>
      <div id="strength-breakdown"></div>
    </div>
  </div>

  <!-- Preview modal -->
  <div class="modal-overlay preview-modal" id="preview-modal">
    <div class="modal">
      <button class="modal-close" onclick="document.getElementById('preview-modal').classList.remove('open');document.getElementById('preview-iframe').src=''">&times;</button>
      <h2>Resume Preview</h2>
      <iframe id="preview-iframe" src=""></iframe>
    </div>
  </div>

  <!-- Cover letter modal (legacy) -->
  <div class="modal-overlay" id="cover-letter-modal">
    <div class="modal" style="width:640px;">
      <button class="modal-close" onclick="this.closest('.modal-overlay').classList.remove('open')">&times;</button>
      <h2>Cover Letter</h2>
      <div id="cover-letter-content" style="white-space:pre-wrap;font-size:0.88rem;line-height:1.6;color:#1f2937;"></div>
      <div id="cover-letter-meta" style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:0.78rem;color:#6b7280;"></div>
      <div style="margin-top:12px;display:flex;gap:8px;">
        <button class="btn" style="background:#6366f1;color:#fff;" onclick="
          var text = document.getElementById('cover-letter-content').textContent;
          navigator.clipboard.writeText(text).then(function(){alert('Copied to clipboard!')});
        ">Copy to Clipboard</button>
      </div>
    </div>
  </div>

  <!-- Outreach modal -->
  <div class="modal-overlay" id="outreach-modal">
    <div class="modal" style="width:680px;">
      <button class="modal-close" onclick="this.closest('.modal-overlay').classList.remove('open')">&times;</button>
      <h2>Generate Outreach</h2>

      <div style="margin-bottom:12px;">
        <label style="font-size:0.8rem;font-weight:600;color:#374151;">Mode</label>
        <select id="outreach-mode" style="display:block;margin-top:4px;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:0.85rem;width:100%;">
          <option value="cover_letter">Cover Letter</option>
          <option value="linkedin_referral_peer">LinkedIn — Referral (Peer)</option>
          <option value="linkedin_referral_open_to_connect">LinkedIn — Open to Connect</option>
          <option value="linkedin_hiring_manager">LinkedIn — Hiring Manager</option>
        </select>
      </div>

      <div id="person-intel-section" style="display:none;margin-bottom:12px;">
        <label style="font-size:0.8rem;font-weight:600;color:#374151;">Person Intel (paste anything you know about the recipient)</label>
        <textarea id="person-intel-text" rows="3" placeholder="e.g. Senior PM on Search, posted about BM25 vs neural retrieval tradeoffs last week..." style="display:block;margin-top:4px;width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:0.85rem;resize:vertical;"></textarea>
        <div style="display:flex;gap:8px;margin-top:6px;">
          <input id="person-intel-name" placeholder="Name (optional)" style="flex:1;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:0.82rem;">
          <input id="person-intel-title" placeholder="Title (optional)" style="flex:1;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:0.82rem;">
        </div>
      </div>

      <button id="outreach-generate-btn" class="btn" style="background:#7c3aed;color:#fff;width:100%;padding:10px;">Generate Outreach</button>

      <!-- Skip callout -->
      <div id="outreach-skip" style="display:none;margin-top:12px;padding:12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;color:#6b7280;font-size:0.82rem;"></div>

      <!-- Result panel -->
      <div id="outreach-result" style="display:none;margin-top:16px;">
        <div id="outreach-hook" style="padding:10px;background:#ede9fe;border-radius:6px;font-size:0.78rem;color:#5b21b6;margin-bottom:8px;"></div>
        <textarea id="outreach-text" rows="12" style="width:100%;font-size:0.88rem;line-height:1.6;color:#1f2937;padding:12px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;resize:vertical;font-family:inherit;"></textarea>
        <div id="outreach-meta" style="margin-top:8px;font-size:0.75rem;color:#9ca3af;"></div>
        <div style="margin-top:12px;display:flex;gap:8px;">
          <button class="btn" style="background:#6366f1;color:#fff;" onclick="
            var text = document.getElementById('outreach-text').value;
            navigator.clipboard.writeText(text).then(function(){alert('Copied!')});
          ">Copy</button>
          <button id="outreach-download" class="btn" style="background:#2563eb;color:#fff;display:none;" onclick="downloadOutreachDocx()">Download DOCX</button>
        </div>
      </div>

      <!-- Refresh intel button -->
      <div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb;">
        <button id="refresh-intel-btn" class="btn" style="background:#f3f4f6;color:#374151;font-size:0.78rem;border:1px solid #d1d5db;" onclick="refreshCompanyIntel()">Refresh Company Intel</button>
        <span id="refresh-intel-status" style="font-size:0.75rem;color:#6b7280;margin-left:8px;"></span>
      </div>
    </div>
  </div>

  <div class="container">
    ${emptyState}

    <!-- Summary -->
    <h2 class="section-title summary-title">Professional Summary</h2>
    <div class="summary-box" id="summary-box">
      <div class="summary-loading"><span class="spinner-icon"></span> Generating tailored summary...</div>
    </div>

    ${data.requiredQuals.length > 0 ? `
      <h2 class="section-title required">Required Qualifications (${data.requiredQuals.length})</h2>
      ${requiredRows}
    ` : ""}

    ${data.preferredQuals.length > 0 ? `
      <h2 class="section-title preferred">Preferred Qualifications (${data.preferredQuals.length})</h2>
      ${preferredRows}
    ` : ""}

    <!-- Skills -->
    <h2 class="section-title skills-title">Optimized Skills</h2>
    <div class="skills-box" id="skills-box">
      <div class="skills-loading"><span class="spinner-icon"></span> Analyzing skill gaps...</div>
    </div>
  </div>

  <div class="sticky-footer" id="footer">
    <span class="footer-status" id="footer-status"><span class="spinner-icon"></span> Scoring resume fit...</span>
    <button class="btn" id="preview-btn" style="background:#0ea5e9;color:#fff;" disabled>Preview</button>
    <button class="btn btn-pdf" id="gen-pdf-btn" disabled>Generate PDF</button>
    <button class="btn btn-docx" id="gen-docx-btn" disabled>Generate DOCX</button>
    <button class="btn" id="gen-cover-btn" style="background:#7c3aed;color:#fff;" disabled>Cover Letter</button>
    <button class="btn" id="outreach-btn" style="background:#7c3aed;color:#fff;" onclick="document.getElementById('outreach-modal').classList.add('open')">Outreach</button>
  </div>

  <script>
    window.__FIT_DATA__ = {
      jobId: "${esc(data.jobId)}",
      token: "${esc(data.token)}",
      totalQuals: ${totalQuals},
      requiredCount: ${data.requiredQuals.length},
      preferredCount: ${data.preferredQuals.length},
      emails: ${JSON.stringify(data.emails)},
      applicationStatus: ${JSON.stringify(data.applicationStatus)},
    };
  </script>
  <script src="/fit/client.js"></script>
</body>
</html>`;
}
