/**
 * Server-rendered HTML for the Fit page.
 * Plain CSS, mobile-friendly, no framework.
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
  roleUrl: string;
  requiredQuals: string[];
  preferredQuals: string[];
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

function atsBadge(ats: string): string {
  if (!ats) return "";
  const label = ats.replace(/-playwright$/, "").replace(/-/g, " ");
  return `<span class="badge badge-ats">${esc(label)}</span>`;
}

function qualCard(id: string, text: string, kind: string, index: number): string {
  return `
    <div class="qual-card" data-qual-id="${esc(id)}" data-qual-kind="${esc(kind)}">
      <div class="qual-header">
        <span class="qual-kind ${kind}">${kind === "basic" ? "Required" : "Preferred"}</span>
        <span class="qual-text">${esc(text)}</span>
      </div>
      <div class="candidates-container" id="candidates-${esc(id)}">
        <div class="loading-spinner">Loading candidates...</div>
      </div>
      <div class="custom-bullet-section" style="display:none;" id="custom-${esc(id)}">
        <textarea class="custom-textarea" placeholder="Write your own bullet (max 155 chars)" maxlength="155"></textarea>
        <button class="btn btn-sm btn-secondary use-custom-btn" data-qual-id="${esc(id)}">Use this bullet</button>
      </div>
      <button class="btn btn-sm btn-link write-own-btn" data-qual-id="${esc(id)}">+ Write my own bullet</button>
    </div>`;
}

export function renderFitPage(data: FitPageData): string {
  const requiredCards = data.requiredQuals
    .map((text, i) => qualCard(`q_basic_${i}`, text, "basic", i))
    .join("\n");

  const preferredCards = data.preferredQuals
    .map((text, i) => qualCard(`q_preferred_${i}`, text, "preferred", i))
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
      background: #f8f9fa;
      color: #1a1a2e;
      line-height: 1.5;
      padding-bottom: 100px;
    }

    .container { max-width: 960px; margin: 0 auto; padding: 0 16px; }

    /* Header */
    .header {
      background: #fff;
      border-bottom: 1px solid #e2e8f0;
      padding: 20px 0;
      margin-bottom: 24px;
    }
    .header h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 4px; }
    .header .company { font-size: 1.1rem; color: #4a5568; }
    .header .meta { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; align-items: center; }
    .header .meta a { color: #6366f1; text-decoration: none; font-size: 0.875rem; }
    .header .meta a:hover { text-decoration: underline; }

    /* Badges */
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-remote { background: #d1fae5; color: #065f46; }
    .badge-hybrid { background: #dbeafe; color: #1e40af; }
    .badge-onsite { background: #fef3c7; color: #92400e; }
    .badge-ats { background: #ede9fe; color: #5b21b6; }
    .badge-recommended {
      background: #d1fae5; color: #065f46;
      font-size: 0.7rem; padding: 1px 6px;
    }
    .badge-cap-forced {
      background: #fef3c7; color: #92400e;
      font-size: 0.7rem; padding: 1px 6px;
    }

    /* Sections */
    .section-title {
      font-size: 1.1rem; font-weight: 700;
      margin: 24px 0 12px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e2e8f0;
    }
    .section-title.required { border-color: #ef4444; }
    .section-title.preferred { border-color: #f59e0b; }

    /* Qual cards */
    .qual-card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .qual-card.selected { border-color: #6366f1; }
    .qual-header { margin-bottom: 12px; }
    .qual-kind {
      display: inline-block;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      padding: 1px 6px;
      border-radius: 3px;
      margin-right: 8px;
    }
    .qual-kind.basic { background: #fee2e2; color: #991b1b; }
    .qual-kind.preferred { background: #fef3c7; color: #92400e; }
    .qual-text { font-size: 0.95rem; }

    /* Candidate bullets */
    .candidate {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .candidate:hover { border-color: #a5b4fc; }
    .candidate.active { border-color: #6366f1; background: #f5f3ff; }
    .candidate-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .candidate-source { font-size: 0.8rem; color: #6b7280; }
    .candidate-scores {
      display: flex; gap: 6px; align-items: center;
    }
    .score-badge {
      font-size: 0.8rem; font-weight: 600;
      padding: 1px 6px; border-radius: 4px;
    }
    .score-high { background: #d1fae5; color: #065f46; }
    .score-mid { background: #fef3c7; color: #92400e; }
    .score-low { background: #fee2e2; color: #991b1b; }
    .candidate-text { font-size: 0.9rem; margin-bottom: 6px; }
    .candidate-rationale { font-size: 0.8rem; color: #6b7280; font-style: italic; }

    /* Sub-scores expandable */
    .sub-scores-toggle {
      font-size: 0.75rem; color: #6366f1; cursor: pointer;
      border: none; background: none; padding: 0; margin-top: 4px;
    }
    .sub-scores-toggle:hover { text-decoration: underline; }
    .sub-scores-detail {
      display: none;
      margin-top: 6px;
      font-size: 0.8rem;
      color: #4a5568;
    }
    .sub-scores-detail.open { display: block; }
    .sub-score-bar {
      display: flex; align-items: center; gap: 8px; margin-bottom: 2px;
    }
    .sub-score-label { width: 100px; text-align: right; }
    .sub-score-fill {
      height: 6px; border-radius: 3px; background: #6366f1;
      transition: width 0.3s;
    }
    .sub-score-track {
      flex: 1; height: 6px; border-radius: 3px; background: #e2e8f0;
    }
    .sub-score-value { width: 30px; font-size: 0.75rem; }

    /* Inline edit */
    .edit-btn {
      font-size: 0.75rem; color: #6366f1; cursor: pointer;
      border: none; background: none; padding: 0; margin-left: 8px;
    }
    .edit-textarea {
      width: 100%; margin-top: 6px; padding: 8px;
      border: 1px solid #a5b4fc; border-radius: 4px;
      font-size: 0.9rem; resize: vertical;
    }

    /* Custom bullet */
    .custom-textarea {
      width: 100%; padding: 8px; margin-top: 8px;
      border: 1px solid #e2e8f0; border-radius: 4px;
      font-size: 0.9rem;
    }

    /* Buttons */
    .btn {
      display: inline-block;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 600;
      border: none;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: #6366f1; color: #fff; }
    .btn-primary:hover:not(:disabled) { background: #4f46e5; }
    .btn-secondary { background: #e2e8f0; color: #1a1a2e; }
    .btn-sm { padding: 4px 10px; font-size: 0.8rem; }
    .btn-link {
      background: none; color: #6366f1; padding: 4px 0;
      font-size: 0.8rem;
    }
    .btn-link:hover { text-decoration: underline; }
    .btn-download {
      padding: 10px 20px;
      font-size: 0.95rem;
    }
    .btn-download-pdf { background: #ef4444; color: #fff; }
    .btn-download-pdf:hover { background: #dc2626; }
    .btn-download-docx { background: #3b82f6; color: #fff; }
    .btn-download-docx:hover { background: #2563eb; }

    /* Warnings */
    .cap-warnings {
      background: #fef3c7;
      border: 1px solid #f59e0b;
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 12px;
      font-size: 0.85rem;
      display: none;
    }
    .cap-warnings.visible { display: block; }
    .cap-warnings ul { margin: 4px 0 0 16px; }

    .summary-warning {
      background: #fee2e2;
      border: 1px solid #ef4444;
      border-radius: 6px;
      padding: 10px 14px;
      margin-top: 12px;
      font-size: 0.85rem;
      display: none;
    }

    /* Footer */
    .sticky-footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #fff;
      border-top: 1px solid #e2e8f0;
      padding: 12px 16px;
      display: flex;
      justify-content: center;
      gap: 12px;
      align-items: center;
      z-index: 100;
    }
    .footer-status {
      font-size: 0.85rem;
      color: #6b7280;
    }

    /* Spinner */
    .loading-spinner {
      text-align: center;
      padding: 20px;
      color: #6b7280;
      font-size: 0.9rem;
    }
    .spinner-icon {
      display: inline-block;
      width: 20px; height: 20px;
      border: 2px solid #e2e8f0;
      border-top-color: #6366f1;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      margin-right: 8px;
      vertical-align: middle;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Empty state */
    .empty-state {
      text-align: center;
      padding: 40px;
      color: #6b7280;
    }
    .empty-state a { color: #6366f1; }

    /* Responsive */
    @media (max-width: 640px) {
      .header h1 { font-size: 1.2rem; }
      .candidate { padding: 10px; }
      .sticky-footer { flex-wrap: wrap; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="container">
      <h1>${esc(data.title)}</h1>
      <div class="company">${esc(data.companyName)}</div>
      <div class="meta">
        ${data.location ? `<span>${esc(data.location)}</span>` : ""}
        ${workTypeBadge(data.isRemote, data.isHybrid)}
        ${atsBadge(data.ats)}
        <a href="${esc(data.roleUrl)}" target="_blank">View posting</a>
      </div>
    </div>
  </div>

  <div class="container">
    ${emptyState}

    ${data.requiredQuals.length > 0 ? `
      <h2 class="section-title required">Required Qualifications (${data.requiredQuals.length})</h2>
      ${requiredCards}
    ` : ""}

    ${data.preferredQuals.length > 0 ? `
      <h2 class="section-title preferred">Preferred Qualifications (${data.preferredQuals.length})</h2>
      ${preferredCards}
    ` : ""}

    <div class="cap-warnings" id="cap-warnings">
      <strong>Cap warnings:</strong>
      <ul id="cap-warnings-list"></ul>
    </div>
  </div>

  <div class="sticky-footer" id="footer">
    <span class="footer-status" id="footer-status">Select bullets for all ${totalQuals} qualifications</span>
    <button class="btn btn-primary" id="score-btn">Score Candidates</button>
    <button class="btn btn-primary" id="generate-btn" disabled style="display:none;">Generate Resume</button>
    <a class="btn btn-download btn-download-pdf" id="download-pdf" style="display:none;" download>Download PDF</a>
    <a class="btn btn-download btn-download-docx" id="download-docx" style="display:none;" download>Download DOCX</a>
  </div>

  <script>
    window.__FIT_DATA__ = {
      jobId: "${esc(data.jobId)}",
      token: "${esc(data.token)}",
      totalQuals: ${totalQuals},
    };
  </script>
  <script src="/fit/client.js"></script>
</body>
</html>`;
}
