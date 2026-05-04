/**
 * Server-rendered HTML for the Applications Tracker page.
 * Clean table with editable status, search, dark/light theme.
 */

interface TrackerApp {
  id: string;
  listingId: string;
  status: string;
  appliedDate: string;
  email: string;
  referralContact: string;
  notes: string;
  title: string;
  roleUrl: string;
  company: string;
  location: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export function renderTrackerPage(applications: TrackerApp[], token: string): string {
  const count = applications.length;

  const statusCounts: Record<string, number> = {};
  for (const a of applications) {
    statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
  }

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Applications Tracker</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --accent: #0d9488;
      --accent-light: #14b8a6;
      --transition: 0.3s ease;
    }

    [data-theme="light"] {
      --bg-page: #f8fafc;
      --bg-card: #ffffff;
      --bg-header: #0f172a;
      --bg-row: #ffffff;
      --bg-row-alt: #f8fafc;
      --bg-row-hover: #f1f5f9;
      --bg-input: #ffffff;
      --text-primary: #0f172a;
      --text-secondary: #475569;
      --text-muted: #94a3b8;
      --border: #e2e8f0;
      --border-hover: #cbd5e1;
      --shadow: 0 1px 3px rgba(0,0,0,0.08);
    }

    [data-theme="dark"] {
      --bg-page: #0f172a;
      --bg-card: #1e293b;
      --bg-header: #020617;
      --bg-row: #1e293b;
      --bg-row-alt: #1a2536;
      --bg-row-hover: #253348;
      --bg-input: #1e293b;
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --border: #334155;
      --border-hover: #475569;
      --shadow: 0 1px 3px rgba(0,0,0,0.3);
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg-page); color: var(--text-primary);
      transition: background var(--transition), color var(--transition);
    }

    /* Header */
    .trk-header {
      background: var(--bg-header); padding: 20px 24px;
      display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
      border-bottom: 2px solid var(--accent);
    }
    .trk-header h1 { font-size: 1.25rem; font-weight: 800; color: #f1f5f9; }
    .trk-header h1 span { color: var(--accent-light); }
    .header-links { display: flex; gap: 10px; }
    .header-links a {
      color: #94a3b8; text-decoration: none; font-size: 0.82rem; padding: 5px 12px;
      border: 1px solid #475569; border-radius: 6px; transition: all 0.2s;
    }
    .header-links a:hover { color: var(--accent-light); border-color: var(--accent-light); }
    .header-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }
    .theme-toggle {
      background: none; border: 1px solid #475569; color: #f1f5f9;
      padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 0.8rem;
      transition: all 0.2s;
    }
    .theme-toggle:hover { border-color: var(--accent-light); color: var(--accent-light); }

    /* Stats bar */
    .stats-bar {
      max-width: 1400px; margin: 0 auto; padding: 20px 24px;
      display: flex; gap: 12px; flex-wrap: wrap; align-items: center;
    }
    .stat-chip {
      padding: 5px 14px; border-radius: 20px; font-size: 0.78rem; font-weight: 600;
      border: 1px solid var(--border);
    }
    .stat-total { background: var(--bg-card); color: var(--text-primary); }

    /* Search */
    .search-bar {
      max-width: 1400px; margin: 0 auto; padding: 0 24px 20px;
    }
    .search-input {
      width: 100%; max-width: 480px; padding: 10px 16px; border-radius: 10px;
      border: 1px solid var(--border); background: var(--bg-input);
      color: var(--text-primary); font-size: 0.88rem;
      transition: border-color 0.2s, background var(--transition);
      outline: none;
    }
    .search-input:focus { border-color: var(--accent); }
    .search-input::placeholder { color: var(--text-muted); }

    /* Table */
    .table-wrap {
      max-width: 1400px; margin: 0 auto; padding: 0 24px 60px;
      overflow-x: auto;
    }
    table { width: 100%; border-collapse: collapse; border-spacing: 0; }
    thead th {
      text-align: left; padding: 10px 14px; font-size: 0.72rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.6px; color: var(--text-muted);
      border-bottom: 2px solid var(--border); white-space: nowrap;
      position: sticky; top: 0; background: var(--bg-page); z-index: 10;
    }
    tbody tr {
      border-bottom: 1px solid var(--border);
      transition: background 0.15s;
    }
    tbody tr:nth-child(even) { background: var(--bg-row-alt); }
    tbody tr:hover { background: var(--bg-row-hover); }
    tbody td {
      padding: 12px 14px; font-size: 0.84rem; color: var(--text-primary);
      vertical-align: middle;
    }

    /* Company + title cell */
    .job-title { font-weight: 600; color: var(--text-primary); margin-bottom: 2px; }
    .job-company { font-size: 0.75rem; color: var(--text-secondary); }
    .job-link {
      color: var(--accent); text-decoration: none; font-size: 0.75rem;
    }
    .job-link:hover { text-decoration: underline; }

    /* Status select */
    .status-select {
      padding: 5px 10px; border-radius: 20px; border: none;
      font-size: 0.75rem; font-weight: 700; cursor: pointer;
      outline: none; appearance: none; -webkit-appearance: none;
      text-align: center; min-width: 110px;
    }
    .status-applied { background: #dbeafe; color: #1e40af; }
    .status-phone_screen { background: #cffafe; color: #0e7490; }
    .status-interviewing { background: #fef3c7; color: #92400e; }
    .status-offer { background: #d1fae5; color: #065f46; }
    .status-rejected { background: #fee2e2; color: #991b1b; }
    .status-not_started { background: #f1f5f9; color: #64748b; }
    .status-researching { background: #e0e7ff; color: #3730a3; }
    .status-withdrawn { background: #f1f5f9; color: #94a3b8; }

    [data-theme="dark"] .status-applied { background: #1e3a5f; color: #60a5fa; }
    [data-theme="dark"] .status-phone_screen { background: #164e63; color: #22d3ee; }
    [data-theme="dark"] .status-interviewing { background: #451a03; color: #fbbf24; }
    [data-theme="dark"] .status-offer { background: #064e3b; color: #34d399; }
    [data-theme="dark"] .status-rejected { background: #4c0519; color: #fb7185; }
    [data-theme="dark"] .status-not_started { background: #334155; color: #94a3b8; }
    [data-theme="dark"] .status-researching { background: #312e81; color: #a5b4fc; }
    [data-theme="dark"] .status-withdrawn { background: #334155; color: #64748b; }

    /* Referral */
    .ref-check { width: 16px; height: 16px; cursor: pointer; accent-color: var(--accent); }
    .ref-input {
      padding: 4px 8px; border: 1px solid var(--border); border-radius: 6px;
      font-size: 0.78rem; background: var(--bg-input); color: var(--text-primary);
      width: 120px; transition: border-color 0.2s;
    }
    .ref-input:focus { border-color: var(--accent); outline: none; }

    /* Saved indicator */
    .save-flash {
      display: inline-block; font-size: 0.7rem; color: var(--accent);
      opacity: 0; transition: opacity 0.3s; margin-left: 6px;
    }
    .save-flash.show { opacity: 1; }

    /* Empty state */
    .empty-state {
      text-align: center; padding: 80px 20px; color: var(--text-muted); font-size: 1rem;
    }

    @media (max-width: 900px) {
      .table-wrap { font-size: 0.8rem; }
      td, th { padding: 8px 10px; }
    }
  </style>
</head>
<body>

  <div class="trk-header">
    <h1><span>Applications</span> Tracker</h1>
    <div class="header-links">
      <a href="/dashboard?token=${esc(token)}">Dashboard</a>
    </div>
    <div class="header-right">
      <button class="theme-toggle" id="theme-toggle">Light Mode</button>
    </div>
  </div>

  <div class="stats-bar">
    <div class="stat-chip stat-total">${count} Total</div>
    ${Object.entries(statusCounts).map(([s, c]) => `<div class="stat-chip status-${esc(s)}">${c} ${esc(s.replace("_", " "))}</div>`).join("")}
  </div>

  <div class="search-bar">
    <input class="search-input" id="search" type="text" placeholder="Search by company, title, or location...">
  </div>

  <div class="table-wrap">
    ${count === 0 ? '<div class="empty-state">No applications yet. Apply to jobs through Check Fit to see them here.</div>' : `
    <table>
      <thead>
        <tr>
          <th>Company / Role</th>
          <th>Location</th>
          <th>Applied</th>
          <th>Status</th>
          <th>Email</th>
          <th>Referral</th>
          <th>Referrer</th>
          <th>Link</th>
        </tr>
      </thead>
      <tbody id="app-tbody">
        ${applications.map((a) => `
        <tr data-id="${esc(a.id)}" data-search="${esc((a.company + " " + a.title + " " + a.location).toLowerCase())}">
          <td>
            <div class="job-title">${esc(a.title)}</div>
            <div class="job-company">${esc(a.company)}</div>
          </td>
          <td style="white-space:nowrap;">${esc(a.location)}</td>
          <td style="white-space:nowrap;">${esc(a.appliedDate)}</td>
          <td>
            <select class="status-select status-${esc(a.status)}" data-field="status" data-id="${esc(a.id)}">
              <option value="applied"${a.status === "applied" ? " selected" : ""}>Applied</option>
              <option value="phone_screen"${a.status === "phone_screen" ? " selected" : ""}>Phone Screen</option>
              <option value="interviewing"${a.status === "interviewing" ? " selected" : ""}>Interview</option>
              <option value="offer"${a.status === "offer" ? " selected" : ""}>Offer</option>
              <option value="rejected"${a.status === "rejected" ? " selected" : ""}>Reject</option>
            </select>
            <span class="save-flash" id="flash-${esc(a.id)}">Saved</span>
          </td>
          <td style="font-size:0.75rem;color:var(--text-secondary);max-width:160px;overflow:hidden;text-overflow:ellipsis;">${esc(a.email)}</td>
          <td style="text-align:center;">
            <input type="checkbox" class="ref-check" data-id="${esc(a.id)}"${a.referralContact ? " checked" : ""}>
          </td>
          <td>
            <input type="text" class="ref-input" data-id="${esc(a.id)}" value="${esc(a.referralContact)}" placeholder="Name...">
          </td>
          <td>
            ${a.roleUrl ? `<a href="${esc(a.roleUrl)}" target="_blank" class="job-link">View</a>` : "—"}
          </td>
        </tr>
        `).join("")}
      </tbody>
    </table>`}
  </div>

  <script>
    window.__TRACKER__ = { token: "${esc(token)}" };
  </script>
  <script src="/tracker/client.js"></script>
</body>
</html>`;
}
