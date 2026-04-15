"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENERIC_RESUME_PATH = void 0;
exports.startServer = startServer;
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const state_1 = require("./state");
const jobScraper_1 = require("./jobScraper");
const companies_1 = require("./companies");
const extractor_1 = require("./extractor");
const parser_1 = require("./parser");
const matcher_1 = require("./matcher");
const pdfUtil_1 = require("./pdfUtil");
const companyDetector_1 = require("./companyDetector");
const customCompanies_1 = require("./customCompanies");
// ── Config ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
exports.GENERIC_RESUME_PATH = process.env.GENERIC_RESUME_PATH || "";
// ── Semaphore for concurrent job scoring ──────────────────────────────────────
class Semaphore {
    constructor(n) {
        this.queue = [];
        this.count = n;
    }
    acquire() {
        if (this.count > 0) {
            this.count--;
            return Promise.resolve();
        }
        return new Promise((r) => this.queue.push(r));
    }
    release() {
        if (this.queue.length > 0)
            this.queue.shift()();
        else
            this.count++;
    }
}
// ── Scoring helpers ───────────────────────────────────────────────────────────
function resumeAction(score) {
    if (score >= 70)
        return "apply_as_is";
    if (score >= 40)
        return "tailor_then_apply";
    return "skip";
}
async function scoreOneJob(jobId, resumeData, label) {
    const job = state_1.appState.jobs.find((j) => j.id === jobId);
    if (!job)
        return;
    // Strip HTML tags before sending to Claude — Greenhouse descriptions are raw HTML
    // and the extractor prompt expects plain requirement text, not markup.
    const plainDesc = job.description
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    let requirements;
    try {
        requirements = await (0, extractor_1.extractRequirements)(plainDesc.slice(0, 6000));
    }
    catch (err) {
        console.error(`[scorer] ${jobId}: extractRequirements failed — ${err}`);
        requirements = [];
    }
    if (requirements.length === 0) {
        console.warn(`[scorer] ${jobId}: no requirements extracted — scoring skipped`);
        job.matchScore = 0;
        job.requirements = [];
        job.summary = { met: 0, partial: 0, missing: 0, score: 0 };
        job.resumeAction = "skip";
        job.scoredWith = label;
        return;
    }
    const results = await (0, matcher_1.matchRequirements)(requirements, resumeData);
    const met = results.filter((r) => r.status === "met").length;
    const partial = results.filter((r) => r.status === "partial").length;
    const missing = results.filter((r) => r.status === "missing").length;
    const score = Math.round(((met + partial * 0.5) / results.length) * 100);
    job.matchScore = score;
    job.requirements = results;
    job.summary = { met, partial, missing, score };
    job.resumeAction = resumeAction(score);
    job.scoredWith = label;
}
async function scoreAllJobs(label) {
    const resumeText = state_1.appState.activeResumeText();
    if (!resumeText) {
        state_1.appState.status.state = "done";
        return;
    }
    const jobs = [...state_1.appState.jobs];
    state_1.appState.status.state = "scoring";
    state_1.appState.status.scoreTotal = jobs.length;
    state_1.appState.status.scoreProgress = 0;
    state_1.appState.status.scoreLabel = label;
    // Write resume to a temp file so parseResume can read it
    const tmpPath = path.join("/tmp", "active-resume.txt");
    fs.writeFileSync(tmpPath, resumeText, "utf-8");
    const resumeData = await (0, parser_1.parseResume)(tmpPath);
    // Score one job at a time — matchRequirements already fans out up to 10
    // Claude calls in parallel per job, so this keeps total concurrency at ~10.
    const sem = new Semaphore(1);
    await Promise.all(jobs.map(async (job) => {
        await sem.acquire();
        try {
            state_1.appState.status.scoreCurrent = `${job.company} — ${job.title}`;
            await scoreOneJob(job.id, resumeData, label);
        }
        catch (err) {
            console.error(`[scorer] ${job.id}: ${err}`);
        }
        finally {
            state_1.appState.status.scoreProgress += 1;
            sem.release();
        }
    }));
    state_1.appState.status.state = "done";
    state_1.appState.status.scoreCurrent = "";
    state_1.appState.status.completedAt = new Date().toUTCString();
}
// ── Inline HTML ───────────────────────────────────────────────────────────────
const INDEX_HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Job Search Pipeline</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #1e293b; min-height: 100vh; }

    /* Header */
    header { background: #fff; border-bottom: 1px solid #e2e8f0; padding: 0 32px; height: 52px; display: flex; align-items: center; gap: 14px; position: sticky; top: 0; z-index: 10; }
    header h1 { font-size: 1rem; font-weight: 700; color: #0f172a; letter-spacing: -0.2px; }
    .phase-badge { font-size: 0.7rem; font-weight: 600; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; border-radius: 9999px; padding: 2px 9px; }

    /* Layout */
    .container { max-width: 1440px; margin: 0 auto; padding: 24px 32px 48px; }

    /* Toolbar */
    .toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
    .btn { border: none; padding: 7px 16px; border-radius: 7px; font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: background 0.15s; white-space: nowrap; }
    .btn-primary { background: #2563eb; color: #fff; }
    .btn-primary:hover:not(:disabled) { background: #1d4ed8; }
    .btn-secondary { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
    .btn-secondary:hover:not(:disabled) { background: #e2e8f0; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .filter-input { padding: 6px 12px; border: 1px solid #e2e8f0; border-radius: 7px; font-size: 0.85rem; color: #1e293b; background: #fff; outline: none; }
    .filter-input:focus { border-color: #93c5fd; }
    .resume-label { font-size: 0.78rem; color: #64748b; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Status bar */
    .status-bar { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 16px; margin-bottom: 14px; font-size: 0.82rem; color: #475569; display: flex; align-items: center; gap: 12px; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .dot-idle    { background: #94a3b8; }
    .dot-active  { background: #3b82f6; animation: pulse 1.2s infinite; }
    .dot-done    { background: #22c55e; }
    .progress-bar { flex: 1; height: 4px; background: #e2e8f0; border-radius: 2px; overflow: hidden; }
    .progress-fill { height: 100%; background: #3b82f6; transition: width 0.3s; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

    /* Table */
    .table-wrap { overflow-x: auto; border-radius: 10px; border: 1px solid #e2e8f0; background: #fff; }
    table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
    thead { background: #f8fafc; }
    th { padding: 10px 14px; text-align: left; font-weight: 600; font-size: 0.78rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #e2e8f0; white-space: nowrap; cursor: pointer; user-select: none; }
    th:hover { color: #334155; }
    th .sort-arrow { margin-left: 4px; opacity: 0.4; }
    th.sorted .sort-arrow { opacity: 1; color: #2563eb; }
    td { padding: 10px 14px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f8fafc; cursor: pointer; }

    /* Pills */
    .score-pill { display: inline-block; font-size: 0.75rem; font-weight: 700; border-radius: 9999px; padding: 2px 9px; }
    .pill-high   { background: #dcfce7; color: #15803d; }
    .pill-mid    { background: #fef9c3; color: #854d0e; }
    .pill-low    { background: #fee2e2; color: #b91c1c; }
    .pill-none   { background: #f1f5f9; color: #94a3b8; }

    /* Action badges */
    .action-badge { display: inline-block; font-size: 0.72rem; font-weight: 600; border-radius: 5px; padding: 2px 8px; }
    .badge-apply   { background: #dcfce7; color: #15803d; }
    .badge-tailor  { background: #fef9c3; color: #854d0e; }
    .badge-skip    { background: #fee2e2; color: #b91c1c; }
    .badge-pending { background: #f1f5f9; color: #94a3b8; }

    /* Work type */
    .wtype { font-size: 0.75rem; padding: 2px 8px; border-radius: 5px; font-weight: 500; }
    .wt-remote { background: #eff6ff; color: #1d4ed8; }
    .wt-hybrid { background: #faf5ff; color: #7e22ce; }
    .wt-onsite { background: #f0fdf4; color: #15803d; }
    .wt-na     { background: #f1f5f9; color: #94a3b8; }

    /* Score button */
    .btn-score { font-size: 0.72rem; padding: 3px 9px; border-radius: 5px; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; cursor: pointer; font-weight: 600; }
    .btn-score:hover { background: #dbeafe; }
    .scoring-spinner { font-size: 0.72rem; color: #94a3b8; }

    /* Per-job resume & match */
    .cell-resume { display: flex; flex-direction: column; gap: 3px; min-width: 110px; }
    .btn-job-upload { font-size: 0.7rem; padding: 3px 8px; border-radius: 5px; background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; cursor: pointer; font-weight: 600; white-space: nowrap; }
    .btn-job-upload:hover { background: #e2e8f0; }
    .job-resume-name { font-size: 0.68rem; color: #15803d; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .btn-job-match { font-size: 0.7rem; padding: 3px 8px; border-radius: 5px; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; cursor: pointer; font-weight: 600; white-space: nowrap; }
    .btn-job-match:hover:not(:disabled) { background: #dbeafe; }
    .btn-job-match:disabled { opacity: 0.45; cursor: not-allowed; }
    .job-scoring { font-size: 0.7rem; color: #94a3b8; white-space: nowrap; }

    /* Modal */
    #jobModal { display: none; position: fixed; inset: 0; background: rgba(15,23,42,0.5); z-index: 100; align-items: flex-start; justify-content: center; padding: 40px 16px; overflow-y: auto; }
    #jobModal.open { display: flex; }
    .modal-box { background: #fff; border-radius: 14px; width: 100%; max-width: 760px; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.18); flex-shrink: 0; }
    .modal-header { padding: 24px 28px 18px; border-bottom: 1px solid #f1f5f9; position: sticky; top: 0; background: #fff; z-index: 1; border-radius: 14px 14px 0 0; }
    .modal-company { font-size: 0.78rem; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
    .modal-title { font-size: 1.25rem; font-weight: 700; color: #0f172a; line-height: 1.3; }
    .modal-meta { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
    .modal-loc { font-size: 0.82rem; color: #64748b; }
    .modal-apply { margin-left: auto; font-size: 0.82rem; font-weight: 600; color: #fff; background: #2563eb; padding: 6px 16px; border-radius: 7px; text-decoration: none; }
    .modal-apply:hover { background: #1d4ed8; }
    .modal-close { position: absolute; right: 20px; top: 20px; background: none; border: none; font-size: 1.2rem; color: #94a3b8; cursor: pointer; line-height: 1; }
    .modal-close:hover { color: #475569; }
    .modal-body { padding: 24px 28px; }

    /* Score row inside modal */
    .modal-scores { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
    .score-block { display: flex; flex-direction: column; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 20px; }
    .score-block .score-num { font-size: 1.6rem; font-weight: 800; line-height: 1; }
    .score-block .score-lbl { font-size: 0.72rem; color: #64748b; margin-top: 3px; font-weight: 500; }
    .score-high { color: #15803d; }
    .score-mid  { color: #854d0e; }
    .score-low  { color: #b91c1c; }
    .score-none { color: #94a3b8; }

    /* Req map */
    .section-label { font-size: 0.72rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 10px; }
    .req-summary { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
    .req-summary-pill { font-size: 0.78rem; font-weight: 600; border-radius: 9999px; padding: 3px 12px; }
    .rsp-met     { background: #dcfce7; color: #15803d; }
    .rsp-partial { background: #fef9c3; color: #854d0e; }
    .rsp-missing { background: #fee2e2; color: #b91c1c; }

    .req-row { border-radius: 8px; padding: 12px 14px; margin-bottom: 8px; }
    .req-met     { background: #f0fdf4; border: 1px solid #bbf7d0; }
    .req-partial { background: #fefce8; border: 1px solid #fde68a; }
    .req-missing { background: #fff1f2; border: 1px solid #fecdd3; }

    .req-top { display: flex; align-items: flex-start; gap: 10px; }
    .req-icon { font-size: 1rem; flex-shrink: 0; margin-top: 1px; }
    .req-text { font-size: 0.85rem; font-weight: 600; color: #0f172a; line-height: 1.4; flex: 1; }
    .req-conf { font-size: 0.72rem; color: #94a3b8; margin-left: auto; flex-shrink: 0; }
    .req-proof { margin-top: 6px; margin-left: 26px; font-size: 0.8rem; color: #475569; font-style: italic; line-height: 1.5; }
    .req-proof::before { content: '"'; }
    .req-proof::after  { content: '"'; }
    .req-location { margin-top: 4px; margin-left: 26px; font-size: 0.75rem; color: #94a3b8; }

    /* Divider */
    .divider { border: none; border-top: 1px solid #f1f5f9; margin: 20px 0; }

    /* Empty state */
    .empty { padding: 60px 0; text-align: center; color: #94a3b8; font-size: 0.9rem; }
    .empty h3 { font-size: 1rem; color: #475569; margin-bottom: 8px; }

    /* Companies grid */
    .companies-section { margin-top: 36px; }
    .companies-section h2 { font-size: 0.9rem; font-weight: 700; color: #0f172a; margin-bottom: 14px; letter-spacing: -0.1px; }
    .companies-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
    .company-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 9px; padding: 12px 14px; text-decoration: none; color: #1e293b; font-size: 0.82rem; font-weight: 600; transition: border-color 0.15s, box-shadow 0.15s; display: flex; align-items: center; gap: 8px; }
    .company-card:hover { border-color: #93c5fd; box-shadow: 0 2px 8px rgba(37,99,235,0.08); color: #1d4ed8; }
    .company-card-icon { width: 28px; height: 28px; border-radius: 6px; background: #f1f5f9; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 800; color: #475569; flex-shrink: 0; }

    /* Applied status */
    tr.row-applied td { background: #f0fdf4; }
    .applied-cell { white-space: nowrap; }
    .apply-check-wrap { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; padding: 2px 0; }
    .apply-checkbox { width: 13px; height: 13px; accent-color: #16a34a; cursor: pointer; flex-shrink: 0; }
    .apply-checkbox:disabled { cursor: default; }
    .apply-label-text { font-size: 0.72rem; font-weight: 600; color: #94a3b8; }
    .apply-label-done { color: #15803d; }
    .btn-edit-apply { font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; cursor: pointer; font-weight: 600; margin-left: 6px; }
    .btn-edit-apply:hover { background: #dcfce7; }

    /* Applied jobs section */
    .applied-section { margin-top: 32px; }
    .applied-section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
    .applied-section-header h2 { font-size: 0.9rem; font-weight: 700; color: #0f172a; letter-spacing: -0.1px; margin: 0; }
    .applied-count-badge { font-size: 0.7rem; font-weight: 700; background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; border-radius: 9999px; padding: 2px 8px; }

    /* Status badges */
    .status-badge { display:inline-block; font-size:0.72rem; font-weight:600; border-radius:5px; padding:2px 9px; white-space:nowrap; }
    .status-applied           { background:#eff6ff; color:#2563eb;  border:1px solid #bfdbfe; }
    .status-recruiter         { background:#faf5ff; color:#7e22ce;  border:1px solid #e9d5ff; }
    .status-interview-sched   { background:#fef9c3; color:#854d0e;  border:1px solid #fde68a; }
    .status-interview-done    { background:#f0fdfa; color:#0f766e;  border:1px solid #99f6e4; }
    .status-offer             { background:#dcfce7; color:#15803d;  border:1px solid #bbf7d0; }
    .status-rejected          { background:#fee2e2; color:#b91c1c;  border:1px solid #fecdd3; }
    .status-withdrawn         { background:#f1f5f9; color:#64748b;  border:1px solid #e2e8f0; }
    .status-select-inline { font-size:0.72rem; font-weight:600; border-radius:5px; padding:2px 6px; border:1px solid #e2e8f0; background:#fff; cursor:pointer; color:#1e293b; }
    tr.row-overdue td { background:#fefce8 !important; }
    .followup-overdue { color:#b45309; font-weight:700; font-size:0.72rem; }
    .followup-soon    { color:#0369a1; font-weight:600; font-size:0.72rem; }
    .followup-ok      { color:#64748b; font-size:0.72rem; }
    .btn-details { font-size:0.65rem; padding:2px 7px; border-radius:4px; background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; cursor:pointer; font-weight:600; }
    .btn-details:hover { background:#dbeafe; }

    /* Application Details Modal */
    #appDetailsModal { display:none; position:fixed; inset:0; background:rgba(15,23,42,0.5); z-index:300; align-items:flex-start; justify-content:center; padding:40px 16px; overflow-y:auto; }
    #appDetailsModal.open { display:flex; }
    .app-details-box { background:#fff; border-radius:14px; width:100%; max-width:680px; box-shadow:0 20px 60px rgba(0,0,0,0.2); flex-shrink:0; overflow:hidden; }
    .app-details-header { padding:22px 28px 14px; border-bottom:1px solid #f1f5f9; position:sticky; top:0; background:#fff; z-index:1; }
    .app-details-company { font-size:0.75rem; font-weight:600; color:#64748b; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:3px; }
    .app-details-title { font-size:1.1rem; font-weight:700; color:#0f172a; }
    .app-details-meta { display:flex; align-items:center; gap:10px; margin-top:8px; flex-wrap:wrap; }
    .app-details-body { padding:20px 28px 32px; max-height:calc(90vh - 110px); overflow-y:auto; }
    .detail-section { margin-bottom:24px; border-bottom:1px solid #f1f5f9; padding-bottom:24px; }
    .detail-section:last-child { border-bottom:none; margin-bottom:0; padding-bottom:0; }
    .detail-section > .section-label { margin-bottom:10px; }
    .detail-status-select { font-size:0.85rem; padding:7px 12px; border:1px solid #e2e8f0; border-radius:7px; color:#1e293b; background:#fff; cursor:pointer; width:100%; }
    .detail-notes-area { width:100%; min-height:90px; padding:10px 12px; border:1px solid #e2e8f0; border-radius:7px; font-size:0.84rem; color:#1e293b; resize:vertical; font-family:inherit; line-height:1.5; box-sizing:border-box; }
    .detail-notes-area:focus { outline:none; border-color:#93c5fd; }
    .detail-save-btn { margin-top:8px; font-size:0.78rem; padding:5px 14px; border-radius:6px; background:#2563eb; color:#fff; border:none; cursor:pointer; font-weight:600; transition:background 0.15s; }
    .detail-save-btn:hover { background:#1d4ed8; }
    .detail-save-ok { background:#15803d !important; }
    .dates-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .date-field { display:flex; flex-direction:column; gap:4px; }
    .date-field label { font-size:0.75rem; font-weight:600; color:#475569; }
    .date-field input[type=date] { padding:6px 10px; border:1px solid #e2e8f0; border-radius:6px; font-size:0.82rem; color:#1e293b; width:100%; box-sizing:border-box; }
    .date-field input[type=date]:focus { outline:none; border-color:#93c5fd; }
    .interviews-list { display:flex; flex-direction:column; gap:6px; margin-bottom:6px; }
    .interview-row { display:flex; align-items:center; gap:6px; }
    .interview-row input[type=date] { padding:5px 8px; border:1px solid #e2e8f0; border-radius:6px; font-size:0.82rem; color:#1e293b; flex:1; box-sizing:border-box; }
    .btn-remove-interview { font-size:0.68rem; padding:2px 7px; border-radius:4px; background:#fee2e2; color:#b91c1c; border:1px solid #fecdd3; cursor:pointer; font-weight:600; flex-shrink:0; }
    .btn-add-interview { font-size:0.72rem; padding:3px 10px; border-radius:5px; background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; cursor:pointer; font-weight:600; }
    .notes-history { display:flex; flex-direction:column; gap:8px; margin-bottom:10px; max-height:200px; overflow-y:auto; }
    .note-entry { background:#f8fafc; border:1px solid #e2e8f0; border-radius:7px; padding:8px 12px; position:relative; }
    .note-ts { font-size:0.7rem; color:#94a3b8; margin-bottom:3px; display:flex; align-items:center; gap:6px; }
    .note-text { font-size:0.83rem; color:#1e293b; line-height:1.5; white-space:pre-wrap; }
    .btn-note-edit { font-size:0.65rem; padding:1px 6px; border-radius:4px; background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; cursor:pointer; font-weight:600; margin-left:auto; }
    .btn-note-edit:hover { background:#e2e8f0; }
    .note-edit-area { width:100%; min-height:60px; padding:6px 8px; border:1px solid #93c5fd; border-radius:6px; font-size:0.83rem; color:#1e293b; resize:vertical; font-family:inherit; line-height:1.5; box-sizing:border-box; margin-top:4px; }
    .note-edit-actions { display:flex; gap:6px; margin-top:6px; }
    .btn-note-save { font-size:0.72rem; padding:3px 10px; border-radius:5px; background:#2563eb; color:#fff; border:none; cursor:pointer; font-weight:600; }
    .btn-note-cancel { font-size:0.72rem; padding:3px 10px; border-radius:5px; background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; cursor:pointer; font-weight:600; }
    .notes-empty { font-size:0.82rem; color:#94a3b8; font-style:italic; margin-bottom:10px; }
    .btn-unapply { font-size:0.65rem; padding:2px 7px; border-radius:4px; background:#fff7ed; color:#c2410c; border:1px solid #fed7aa; cursor:pointer; font-weight:600; }
    .btn-unapply:hover { background:#ffedd5; }
    .timeline { position:relative; padding-left:22px; }
    .timeline::before { content:''; position:absolute; left:7px; top:8px; bottom:0; width:2px; background:#e2e8f0; border-radius:1px; }
    .tl-entry { position:relative; margin-bottom:14px; }
    .tl-entry::before { content:''; position:absolute; left:-18px; top:5px; width:8px; height:8px; border-radius:50%; background:#94a3b8; border:2px solid #fff; box-shadow:0 0 0 2px #cbd5e1; }
    .tl-action { font-size:0.82rem; color:#0f172a; font-weight:500; line-height:1.4; }
    .tl-ts { font-size:0.72rem; color:#94a3b8; margin-top:1px; }

    /* Apply modal */
    #applyModal { display:none; position:fixed; inset:0; background:rgba(15,23,42,0.5); z-index:200; align-items:center; justify-content:center; }
    #applyModal.open { display:flex; }
    .apply-modal-box { background:#fff; border-radius:12px; width:100%; max-width:420px; padding:28px; box-shadow:0 20px 60px rgba(0,0,0,0.2); }
    .apply-modal-title { font-size:1rem; font-weight:700; color:#0f172a; margin-bottom:4px; }
    .apply-modal-sub { font-size:0.82rem; color:#64748b; margin-bottom:16px; line-height:1.5; }
    .apply-email-input { width:100%; padding:8px 12px; border:1px solid #e2e8f0; border-radius:7px; font-size:0.85rem; color:#1e293b; outline:none; box-sizing:border-box; }
    .apply-email-input:focus { border-color:#93c5fd; box-shadow:0 0 0 3px rgba(147,197,253,0.2); }
    .apply-email-error { font-size:0.75rem; color:#b91c1c; margin-top:5px; min-height:18px; }
    .apply-modal-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:18px; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
  </style>
</head>
<body>

<header>
  <h1>Job Search Pipeline</h1>
  <span class="phase-badge">Phase 2</span>
</header>

<div class="container">

  <!-- Toolbar -->
  <div class="toolbar">
    <button class="btn btn-primary" id="btnScan">Scan Jobs</button>

    <label class="btn btn-secondary" style="cursor:pointer">
      Upload Resume
      <input type="file" id="resumeFile" accept=".pdf" style="display:none">
    </label>
    <button class="btn btn-secondary" id="btnUseGeneric">Use Generic</button>
    <button class="btn btn-primary" id="btnRunAts" disabled>Run ATS</button>

    <span class="resume-label" id="resumeLabel">No resume loaded</span>

    <input class="filter-input" id="filterText" placeholder="Filter jobs..." style="width:180px">
    <select class="filter-input" id="filterAction" style="width:150px">
      <option value="">All actions</option>
      <option value="apply_as_is">Apply as-is</option>
      <option value="tailor_then_apply">Tailor first</option>
      <option value="skip">Skip</option>
    </select>
    <button id="btnEarlyCareer" class="btn btn-secondary" title="Show only jobs from Early Careers / University portals or tagged as new-grad">🎓 Early Career Only</button>
  </div>

  <!-- Add Company panel -->
  <div id="addCompanyPanel" style="margin:8px 0 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
    <input id="addCompanyName" type="text" placeholder="Company name (e.g. Notion, Ramp...)"
      style="flex:1;min-width:200px;max-width:280px;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:0.875rem;outline:none;">
    <input id="addCompanyUrl" type="text" placeholder="Careers URL (optional)"
      style="flex:1;min-width:200px;max-width:280px;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:0.875rem;outline:none;">
    <button class="btn btn-secondary" id="btnAddCompany" style="white-space:nowrap;">+ Add Company</button>
    <span id="addCompanyStatus" style="font-size:0.82rem;color:#64748b;"></span>
  </div>

  <!-- Status bar -->
  <div class="status-bar" id="statusBar">
    <div class="status-dot dot-idle" id="statusDot"></div>
    <span id="statusText">Ready — click Scan Jobs to fetch job listings.</span>
    <div class="progress-bar" id="progressBarWrap" style="display:none">
      <div class="progress-fill" id="progressFill" style="width:0%"></div>
    </div>
  </div>

  <!-- Scan error panel — shown after scan if some companies failed -->
  <div id="scanErrorPanel" style="display:none;margin:6px 0 0;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:8px 12px;font-size:12px;color:#7c2d12;">
    <details>
      <summary id="scanErrorToggle" style="cursor:pointer;font-weight:600;color:#9a3412;list-style:none;display:flex;align-items:center;gap:6px;">
        <span style="font-size:14px;">&#9888;</span> 0 companies could not be scanned
      </summary>
      <ul id="scanErrorList" style="margin:6px 0 0 16px;padding:0;line-height:1.7;"></ul>
    </details>
  </div>

  <!-- Hidden file input reused for all per-job resume uploads -->
  <input type="file" id="jobResumeFile" accept=".pdf" style="display:none">

  <!-- Table -->
  <div class="table-wrap">
    <table id="jobTable">
      <thead>
        <tr>
          <th data-col="company">Company <span class="sort-arrow">↕</span></th>
          <th data-col="title">Title <span class="sort-arrow">↕</span></th>
          <th data-col="location">Location <span class="sort-arrow">↕</span></th>
          <th data-col="workType">Type <span class="sort-arrow">↕</span></th>
          <th data-col="datePosted">Posted <span class="sort-arrow">↕</span></th>
          <th data-col="matchScore">Match % <span class="sort-arrow">↕</span></th>
          <th data-col="resumeAction">Action <span class="sort-arrow">↕</span></th>
          <th>Resume</th>
          <th>Match</th>
          <th>Applied</th>
          <th>Apply</th>
        </tr>
      </thead>
      <tbody id="jobBody">
        <tr><td colspan="11" class="empty">No jobs yet — click Scan Jobs.</td></tr>
      </tbody>
    </table>
  </div>

  <!-- Applied Jobs section -->
  <div class="applied-section" id="appliedSection" style="display:none">
    <div class="applied-section-header">
      <h2>Applied Jobs</h2>
      <span class="applied-count-badge" id="appliedCountBadge">0</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Title</th>
            <th>Status</th>
            <th>Applied</th>
            <th>Follow-up</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="appliedBody"></tbody>
      </table>
    </div>
  </div>

  <!-- Companies grid -->
  <div class="companies-section">
    <h2>All Companies</h2>
    <div class="companies-grid" id="companiesGrid"></div>
  </div>

</div>

<!-- Modal -->
<div id="jobModal">
  <div class="modal-box">
    <div class="modal-header">
      <button class="modal-close" id="modalClose">✕</button>
      <div class="modal-company" id="mCompany"></div>
      <div class="modal-title" id="mTitle"></div>
      <div class="modal-meta">
        <span class="modal-loc" id="mLocation"></span>
        <span id="mWorkType"></span>
        <a class="modal-apply" id="mApply" href="#" target="_blank" rel="noopener">Apply</a>
      </div>
    </div>
    <div class="modal-body">

      <!-- Scores -->
      <div class="modal-scores" id="mScores">
        <div class="score-block">
          <span class="score-num score-none" id="mScoreNum">—</span>
          <span class="score-lbl">Match Score</span>
        </div>
        <div id="mActionBlock"></div>
      </div>

      <!-- Requirements Map -->
      <div id="mReqSection">
        <div class="section-label">Requirements Map</div>
        <div class="req-summary" id="mReqSummary"></div>
        <div id="mReqList"></div>
      </div>

    </div>
  </div>
</div>

<!-- Application Details Modal -->
<div id="appDetailsModal">
  <div class="app-details-box">
    <div class="app-details-header">
      <button class="modal-close" id="appDetailsClose">✕</button>
      <div class="app-details-company" id="adCompany"></div>
      <div class="app-details-title" id="adTitle"></div>
      <div class="app-details-meta">
        <span style="font-size:0.8rem;color:#64748b" id="adLocation"></span>
        <span id="adWorkType"></span>
        <a id="adApplyLink" href="#" target="_blank" rel="noopener" style="font-size:0.8rem;font-weight:600;color:#2563eb;margin-left:auto;text-decoration:none" hidden>Apply ↗</a>
      </div>
    </div>
    <div class="app-details-body">

      <!-- Status -->
      <div class="detail-section">
        <div class="section-label">Application Status</div>
        <select class="detail-status-select" id="adStatusSelect">
          <option value="applied">Applied</option>
          <option value="recruiter_reached_out">Recruiter Reached Out</option>
          <option value="interview_scheduled">Interview Scheduled</option>
          <option value="interview_completed">Interview Completed</option>
          <option value="offer_received">Offer Received</option>
          <option value="rejected">Rejected</option>
          <option value="withdrawn">Withdrawn</option>
        </select>
      </div>

      <!-- Notes -->
      <div class="detail-section">
        <div class="section-label">Notes</div>
        <div class="notes-history" id="adNotesHistory"></div>
        <textarea class="detail-notes-area" id="adNoteInput" placeholder="Add a note..." rows="3"></textarea>
        <button class="detail-save-btn" id="adAddNote">Add Note</button>
      </div>

      <!-- Key Dates -->
      <div class="detail-section">
        <div class="section-label">Key Dates</div>
        <div class="dates-grid">
          <div class="date-field">
            <label>Date Applied</label>
            <input type="date" id="adDateApplied">
          </div>
          <div class="date-field">
            <label>Recruiter Contact</label>
            <input type="date" id="adDateRecruiter">
          </div>
          <div class="date-field" style="grid-column:1/-1">
            <label>Interview Date(s)</label>
            <div class="interviews-list" id="adInterviewsList"></div>
            <button class="btn-add-interview" id="adAddInterview">+ Add Interview Date</button>
          </div>
          <div class="date-field">
            <label>Offer Date</label>
            <input type="date" id="adDateOffer">
          </div>
          <div class="date-field">
            <label>Follow-up Reminder</label>
            <input type="date" id="adDateFollowUp">
          </div>
        </div>
        <span class="dates-saved-msg" id="adDatesSavedMsg" style="display:none;font-size:0.75rem;color:#15803d;margin-top:10px;font-weight:600">&#10003; Dates saved</span>
      </div>

      <!-- Activity Timeline -->
      <div class="detail-section">
        <div class="section-label">Activity Timeline</div>
        <div class="timeline" id="adTimeline"></div>
      </div>

    </div>
  </div>
</div>

<!-- Apply modal -->
<div id="applyModal">
  <div class="apply-modal-box">
    <div class="apply-modal-title" id="applyModalTitle">Mark as Applied</div>
    <div class="apply-modal-sub" id="applyModalSub">Enter the email address you used to apply for this role.</div>
    <input type="text" class="apply-email-input" id="applyEmailInput" placeholder="you@example.com" autocomplete="email" inputmode="email">
    <div class="apply-email-error" id="applyEmailError"></div>
    <div class="apply-modal-actions">
      <button class="btn btn-secondary" id="applyModalCancel">Cancel</button>
      <button class="btn btn-primary" id="applyModalSave">Save</button>
    </div>
  </div>
</div>

<script>
  var allJobs = [];
  var sortCol = 'datePosted';
  var sortDir = 1; // 1 = desc (newest first)
  var earlyCareerOnly = false;
  var currentJobId = null;

  // Per-job resumes persisted in localStorage: { [jobId]: { name, base64 } }
  var jobResumes = JSON.parse(localStorage.getItem('jobResumes') || '{}');
  // Which jobs the server is currently scoring (from poll)
  var serverScoringJobIds = new Set();
  // Job currently awaiting file picker
  var pendingUploadJobId = null;

  // ── User identity + applied status ────────────────────────────────────────
  var userId = localStorage.getItem('pmScoutUserId');
  if (!userId) {
    userId = 'u-' + Math.random().toString(36).slice(2, 11) + '-' + Date.now().toString(36);
    localStorage.setItem('pmScoutUserId', userId);
  }
  // { [jobId]: { email, appliedAt } } — loaded from localStorage immediately
  var appliedJobs = {};
  try { appliedJobs = JSON.parse(localStorage.getItem('pmScoutApplied_' + userId) || '{}'); } catch(e) {}
  var pendingApplyJobId = null;
  var currentDetailsJobId = null;

  var STATUSES = [
    { value: 'applied',               label: 'Applied',               cls: 'status-applied',          color:'#1d4ed8', bg:'#eff6ff', border:'#bfdbfe' },
    { value: 'recruiter_reached_out', label: 'Recruiter Reached Out', cls: 'status-recruiter',         color:'#7e22ce', bg:'#faf5ff', border:'#e9d5ff' },
    { value: 'interview_scheduled',   label: 'Interview Scheduled',   cls: 'status-interview-sched',  color:'#854d0e', bg:'#fef9c3', border:'#fde68a' },
    { value: 'interview_completed',   label: 'Interview Completed',   cls: 'status-interview-done',   color:'#0f766e', bg:'#f0fdfa', border:'#99f6e4' },
    { value: 'offer_received',        label: 'Offer Received',        cls: 'status-offer',            color:'#15803d', bg:'#dcfce7', border:'#bbf7d0' },
    { value: 'rejected',              label: 'Rejected',              cls: 'status-rejected',         color:'#b91c1c', bg:'#fee2e2', border:'#fecdd3' },
    { value: 'withdrawn',             label: 'Withdrawn',             cls: 'status-withdrawn',        color:'#64748b', bg:'#f1f5f9', border:'#e2e8f0' }
  ];

  function statusInfo(val) {
    return STATUSES.find(function(s) { return s.value === val; }) || STATUSES[0];
  }

  function isOverdue(dateStr) {
    if (!dateStr) return false;
    var today = new Date(); today.setHours(0,0,0,0);
    return new Date(dateStr) < today;
  }

  function isSoon(dateStr) {
    if (!dateStr) return false;
    var today = new Date(); today.setHours(0,0,0,0);
    var soon = new Date(); soon.setDate(soon.getDate() + 3); soon.setHours(23,59,59,999);
    var d = new Date(dateStr);
    return d >= today && d <= soon;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
  }

  function persistApplied() {
    localStorage.setItem('pmScoutApplied_' + userId, JSON.stringify(appliedJobs));
  }

  function appendLog(jobId, action) {
    var r = appliedJobs[jobId];
    if (!r) return;
    if (!r.log) r.log = [];
    r.log.push({ action: action, ts: new Date().toISOString() });
    persistApplied();
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  function poll() {
    fetch('/api/status')
      .then(function(r){ return r.json(); })
      .then(function(d){
        allJobs = d.jobs || [];
        serverScoringJobIds = new Set(d.scoringJobIds || []);
        updateStatus(d);
        renderTable();
        renderAppliedSection();
        if (d.hasUploadedResume) {
          document.getElementById('resumeLabel').textContent =
            d.uploadedResumeName || 'Resume loaded';
          document.getElementById('btnRunAts').disabled = false;
        }
        // Reload modal if open
        if (currentJobId) {
          var j = allJobs.find(function(x){ return x.id === currentJobId; });
          if (j) populateModal(j);
        }
      })
      .catch(function(){});
  }

  setInterval(poll, 2000);
  poll();

  // ── Status bar ─────────────────────────────────────────────────────────────

  function updateStatus(d) {
    var dot  = document.getElementById('statusDot');
    var text = document.getElementById('statusText');
    var barW = document.getElementById('progressBarWrap');
    var fill = document.getElementById('progressFill');

    dot.className = 'status-dot';
    if (d.scanState === 'idle') {
      dot.classList.add('dot-idle');
      text.textContent = 'Ready.';
      barW.style.display = 'none';
    } else if (d.scanState === 'scanning') {
      dot.classList.add('dot-active');
      text.textContent = 'Scanning ' + (d.currentCompany || '...') +
        ' (' + d.progress + '/' + d.total + ' companies, ' + d.jobCount + ' jobs found)';
      barW.style.display = '';
      fill.style.width = (d.total ? Math.round(d.progress/d.total*100) : 0) + '%';
    } else if (d.scanState === 'scoring') {
      dot.classList.add('dot-active');
      text.textContent = 'Scoring (' + d.scoreProgress + '/' + d.scoreTotal + '): ' +
        (d.scoreCurrent || '...');
      barW.style.display = '';
      fill.style.width = (d.scoreTotal ? Math.round(d.scoreProgress/d.scoreTotal*100) : 0) + '%';
    } else if (d.scanState === 'done') {
      dot.classList.add('dot-done');
      var errSuffix = d.errors > 0 ? ', ' + d.errors + ' companies failed' : '';
      text.textContent = d.jobCount + ' jobs — completed ' + (d.completedAt || '') + errSuffix;
      barW.style.display = 'none';
    }

    // Show/hide company error panel
    var errPanel = document.getElementById('scanErrorPanel');
    if (errPanel) {
      var errs = d.companyErrors || [];
      if (errs.length > 0 && d.scanState === 'done') {
        errPanel.style.display = '';
        var errList = document.getElementById('scanErrorList');
        if (errList) {
          errList.innerHTML = errs.map(function(e) {
            var link = e.careersUrl
              ? ' &mdash; <a href="' + esc(e.careersUrl) + '" target="_blank" rel="noopener" style="color:#9a3412;">visit careers page</a>'
              : '';
            return '<li><strong>' + esc(e.name) + '</strong>: ' + esc(e.reason) + link + '</li>';
          }).join('');
        }
        var errToggle = document.getElementById('scanErrorToggle');
        if (errToggle) errToggle.textContent = errs.length + ' companies could not be scanned';
      } else {
        errPanel.style.display = 'none';
      }
    }
  }

  // ── Table rendering ─────────────────────────────────────────────────────────

  function workTypeClass(t) {
    if (t === 'Remote') return 'wt-remote';
    if (t === 'Hybrid') return 'wt-hybrid';
    if (t === 'Onsite') return 'wt-onsite';
    return 'wt-na';
  }

  function scoreClass(s) {
    if (s == null) return 'pill-none';
    if (s >= 70)   return 'pill-high';
    if (s >= 40)   return 'pill-mid';
    return 'pill-low';
  }

  function actionBadge(a) {
    if (a === 'apply_as_is')     return '<span class="action-badge badge-apply">Apply as-is</span>';
    if (a === 'tailor_then_apply') return '<span class="action-badge badge-tailor">Tailor first</span>';
    if (a === 'skip')            return '<span class="action-badge badge-skip">Skip</span>';
    return '<span class="action-badge badge-pending">—</span>';
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function filteredSortedJobs() {
    var text   = document.getElementById('filterText').value.toLowerCase();
    var action = document.getElementById('filterAction').value;
    var list = allJobs.filter(function(j) {
      if (appliedJobs[j.id]) return false; // applied jobs move to their own section
      if (text && !(j.company+j.title+j.location).toLowerCase().includes(text)) return false;
      if (action && j.resumeAction !== action) return false;
      if (earlyCareerOnly && !j.earlyCareer && j.sourceLabel !== 'Early Careers Portal') return false;
      return true;
    });
    list.sort(function(a, b) {
      var av = a[sortCol], bv = b[sortCol];
      // Always sink missing/placeholder values to the bottom
      var aMissing = (av == null || av === '—');
      var bMissing = (bv == null || bv === '—');
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      if (av < bv) return sortDir;
      if (av > bv) return -sortDir;
      return 0;
    });
    return list;
  }

  function renderTable() {
    var jobs = filteredSortedJobs();
    var tbody = document.getElementById('jobBody');
    if (jobs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" class="empty">' +
        (allJobs.length === 0 ? 'No jobs yet — click Scan Jobs.' : 'No jobs match the current filter.') +
        '</td></tr>';
      return;
    }
    tbody.innerHTML = jobs.map(function(j) {
      var sc = j.matchScore != null ? j.matchScore + '%' : '—';
      var ecBadge = j.earlyCareer
        ? ' <span style="font-size:0.68rem;background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;border-radius:4px;padding:1px 6px;font-weight:700;vertical-align:middle;">New Grad</span>'
        : '';
      var srcBadge = j.sourceLabel === 'Early Careers Portal'
        ? ' <span title="Sourced from the company&#39;s dedicated Early Careers / University portal" style="font-size:0.65rem;background:#fef9c3;color:#854d0e;border:1px solid #fde68a;border-radius:4px;padding:1px 5px;font-weight:700;vertical-align:middle;cursor:help;">🎓 Early Careers Portal</span>'
        : j.sourceLabel === 'LinkedIn'
          ? ' <span title="Sourced from LinkedIn — click Apply to view full listing" style="font-size:0.65rem;background:#e0f2fe;color:#075985;border:1px solid #bae6fd;border-radius:4px;padding:1px 5px;font-weight:700;vertical-align:middle;cursor:help;">via LinkedIn</span>'
          : '';
      var jr = jobResumes[j.id];
      var resumeCell = '<div class="cell-resume">' +
        '<button class="btn-job-upload" data-action="upload" data-id="' + esc(j.id) + '">' +
          (jr ? 'Change' : 'Upload') +
        '</button>' +
        (jr ? '<span class="job-resume-name" title="' + esc(jr.name) + '">' + esc(jr.name) + '</span>' : '') +
        '</div>';
      var isScoring = serverScoringJobIds.has(j.id);
      var matchCell = isScoring
        ? '<span class="job-scoring">&#8987; Scoring...</span>'
        : '<button class="btn-job-match" data-action="score" data-id="' + esc(j.id) + '">' +
            (j.matchScore != null ? 'Re-match' : 'Run Match') +
          '</button>';
      var appRecord = appliedJobs[j.id];
      var appliedCell = '<td class="applied-cell">';
      if (appRecord) {
        appliedCell +=
          '<div class="apply-check-wrap">' +
            '<input type="checkbox" class="apply-checkbox" checked disabled>' +
            '<span class="apply-label-text apply-label-done">Applied</span>' +
          '</div>' +
          '<button class="btn-edit-apply" data-action="edit-apply" data-id="' + esc(j.id) + '">Edit</button>';
      } else {
        appliedCell +=
          '<div class="apply-check-wrap" data-action="apply" data-id="' + esc(j.id) + '">' +
            '<input type="checkbox" class="apply-checkbox" style="pointer-events:none">' +
            '<span class="apply-label-text">Applied</span>' +
          '</div>';
      }
      appliedCell += '</td>';
      return '<tr data-id="' + esc(j.id) + '"' + (appRecord ? ' class="row-applied"' : '') + '>' +
        '<td><strong>' + esc(j.company) + '</strong>' + srcBadge + '</td>' +
        '<td>' + esc(j.title) + ecBadge + '</td>' +
        '<td>' + esc(j.location || '—') + '</td>' +
        '<td><span class="wtype ' + workTypeClass(j.workType) + '">' + esc(j.workType) + '</span></td>' +
        '<td>' + esc(j.datePosted || '—') + '</td>' +
        '<td><span class="score-pill ' + scoreClass(j.matchScore) + '">' + sc + '</span></td>' +
        '<td>' + actionBadge(j.resumeAction) + '</td>' +
        '<td>' + resumeCell + '</td>' +
        '<td>' + matchCell + '</td>' +
        appliedCell +
        '<td><a href="' + esc(j.applyUrl) + '" target="_blank" rel="noopener" style="font-size:0.8rem;color:#2563eb;font-weight:600;">Apply</a></td>' +
        '</tr>';
    }).join('');

    // Update sort arrow highlights
    document.querySelectorAll('th[data-col]').forEach(function(th) {
      th.classList.toggle('sorted', th.dataset.col === sortCol);
    });
  }

  // ── Applied jobs section rendering ──────────────────────────────────────────

  function renderAppliedSection() {
    var keys = Object.keys(appliedJobs);
    var section = document.getElementById('appliedSection');
    var tbody   = document.getElementById('appliedBody');
    var badge   = document.getElementById('appliedCountBadge');
    if (keys.length === 0) { section.style.display = 'none'; return; }
    section.style.display = '';
    badge.textContent = String(keys.length);
    tbody.innerHTML = keys.map(function(jobId) {
      var r   = appliedJobs[jobId];
      var si  = statusInfo(r.status || 'applied');
      var followUp = (r.dates && r.dates.followUp) ? r.dates.followUp : '';
      var fuHtml = '';
      if (followUp) {
        if (isOverdue(followUp))     fuHtml = '<span class="followup-overdue">&#9888; ' + esc(fmtDate(followUp)) + '</span>';
        else if (isSoon(followUp))   fuHtml = '<span class="followup-soon">Soon: ' + esc(fmtDate(followUp)) + '</span>';
        else                         fuHtml = '<span class="followup-ok">' + esc(fmtDate(followUp)) + '</span>';
      } else {
        fuHtml = '<span style="color:#cbd5e1;font-size:0.72rem">—</span>';
      }
      var rowCls = (followUp && isOverdue(followUp)) ? ' class="row-overdue"' : '';
      var titleCell = r.applyUrl
        ? '<a href="' + esc(r.applyUrl) + '" target="_blank" rel="noopener" style="color:#2563eb;font-weight:600;text-decoration:none;">' + esc(r.title || '—') + '</a>'
        : esc(r.title || '—');
      var statusOpts = STATUSES.map(function(s) {
        return '<option value="' + s.value + '"' + (s.value === (r.status || 'applied') ? ' selected' : '') + '>' + s.label + '</option>';
      }).join('');
      return '<tr' + rowCls + ' data-applied-id="' + esc(jobId) + '">' +
        '<td><strong>' + esc(r.company || '—') + '</strong></td>' +
        '<td>' + titleCell + '</td>' +
        '<td><select class="status-select-inline" style="color:' + si.color + ';background:' + si.bg + ';border-color:' + si.border + '" data-action="status-change" data-id="' + esc(jobId) + '">' + statusOpts + '</select></td>' +
        '<td style="font-size:0.78rem;color:#475569">' + esc(fmtDate(r.appliedAt) || '—') + '</td>' +
        '<td>' + fuHtml + '</td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn-edit-apply" data-action="edit-applied" data-id="' + esc(jobId) + '">Email</button> ' +
          '<button class="btn-details" data-action="open-details" data-id="' + esc(jobId) + '">Details</button> ' +
          '<button class="btn-unapply" data-action="unapply" data-id="' + esc(jobId) + '">Unapply</button>' +
        '</td>' +
        '</tr>';
    }).join('');
  }

  // Applied section click handler
  document.getElementById('appliedBody').addEventListener('click', function(e) {
    var editBtn = e.target.closest('[data-action="edit-applied"]');
    if (editBtn) { openApplyModal(editBtn.dataset.id, true); return; }

    var detailsBtn = e.target.closest('[data-action="open-details"]');
    if (detailsBtn) { openDetailsModal(detailsBtn.dataset.id); return; }

    var unapplyBtn = e.target.closest('[data-action="unapply"]');
    if (unapplyBtn) {
      var jobId = unapplyBtn.dataset.id;
      var r = appliedJobs[jobId];
      var name = (r && r.title) ? r.company + ' — ' + r.title : 'this job';
      if (!confirm('Move "' + name + '" back to Scanned Jobs?\\n\\nAll tracking data (notes, dates, status) will be removed.')) return;
      delete appliedJobs[jobId];
      persistApplied();
      // Also remove from server
      fetch('/api/apply/' + encodeURIComponent(userId) + '/' + encodeURIComponent(jobId), { method: 'DELETE' }).catch(function(){});
      renderTable();
      renderAppliedSection();
      return;
    }
  });

  // Applied section change handler — inline status dropdown
  document.getElementById('appliedBody').addEventListener('change', function(e) {
    var sel = e.target.closest('[data-action="status-change"]');
    if (!sel) return;
    var jobId  = sel.dataset.id;
    var r      = appliedJobs[jobId];
    if (!r) return;
    var newStatus = sel.value;
    var si        = statusInfo(newStatus);
    r.status      = newStatus;
    appendLog(jobId, 'Status changed to \u201c' + si.label + '\u201d');
    persistApplied();
    renderAppliedSection();
  });

  // ── Application Details Modal ──────────────────────────────────────────────

  function renderInterviewsList(interviews) {
    var list = document.getElementById('adInterviewsList');
    list.innerHTML = (interviews || []).map(function(d, i) {
      return '<div class="interview-row">' +
        '<input type="date" value="' + esc(d) + '" data-interview-idx="' + i + '">' +
        '<button class="btn-remove-interview" data-remove-interview="' + i + '">Remove</button>' +
        '</div>';
    }).join('');
  }

  function renderTimeline(log) {
    var el = document.getElementById('adTimeline');
    if (!log || log.length === 0) {
      el.innerHTML = '<span style="font-size:0.82rem;color:#94a3b8;font-style:italic">No activity recorded yet.</span>';
      return;
    }
    el.innerHTML = log.slice().reverse().map(function(entry) {
      var when = entry.ts ? new Date(entry.ts).toLocaleString(undefined, { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' }) : '';
      return '<div class="tl-entry">' +
        '<div class="tl-action">' + esc(entry.action) + '</div>' +
        '<div class="tl-ts">' + esc(when) + '</div>' +
        '</div>';
    }).join('');
  }

  function openDetailsModal(jobId) {
    var r = appliedJobs[jobId];
    if (!r) return;
    currentDetailsJobId = jobId;

    document.getElementById('adCompany').textContent = r.company || '';
    var titleEl = document.getElementById('adTitle');
    titleEl.textContent = r.title || '';
    document.getElementById('adLocation').textContent = [r.location, r.workType].filter(Boolean).join(' · ');
    var linkEl = document.getElementById('adApplyLink');
    if (r.applyUrl) { linkEl.href = r.applyUrl; linkEl.hidden = false; }
    else            { linkEl.hidden = true; }

    document.getElementById('adStatusSelect').value = r.status || 'applied';
    // Migrate legacy string notes to array format
    if (typeof r.notes === 'string' && r.notes) {
      r.notes = [{ text: r.notes, ts: r.appliedAt || new Date().toISOString() }];
      persistApplied();
    } else if (!Array.isArray(r.notes)) {
      r.notes = [];
    }
    renderNotesHistory(r.notes);
    document.getElementById('adNoteInput').value = '';

    var dates = r.dates || {};
    document.getElementById('adDateApplied').value   = dates.applied           || (r.appliedAt ? r.appliedAt.slice(0,10) : '');
    document.getElementById('adDateRecruiter').value = dates.recruiterContact  || '';
    document.getElementById('adDateOffer').value     = dates.offer             || '';
    document.getElementById('adDateFollowUp').value  = dates.followUp          || '';
    renderInterviewsList(dates.interviews || []);
    renderTimeline(r.log);

    document.getElementById('appDetailsModal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeDetailsModal() {
    document.getElementById('appDetailsModal').classList.remove('open');
    document.body.style.overflow = '';
    currentDetailsJobId = null;
  }

  document.getElementById('appDetailsClose').addEventListener('click', closeDetailsModal);
  document.getElementById('appDetailsModal').addEventListener('click', function(e) {
    if (e.target === this) closeDetailsModal();
  });

  // Status change inside details modal — auto-saves immediately
  document.getElementById('adStatusSelect').addEventListener('change', function() {
    var jobId = currentDetailsJobId;
    if (!jobId || !appliedJobs[jobId]) return;
    var newStatus = this.value;
    var si = statusInfo(newStatus);
    appliedJobs[jobId].status = newStatus;
    appendLog(jobId, 'Status changed to \u201c' + si.label + '\u201d');
    persistApplied();
    renderAppliedSection();
    renderTimeline(appliedJobs[jobId].log);
  });

  // Render notes history list
  function renderNotesHistory(notes) {
    var el = document.getElementById('adNotesHistory');
    if (!notes || notes.length === 0) {
      el.innerHTML = '<div class="notes-empty">No notes yet.</div>';
      return;
    }
    el.innerHTML = notes.map(function(n, i) {
      var when = n.ts ? new Date(n.ts).toLocaleString(undefined, { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' }) : '';
      return '<div class="note-entry" data-note-idx="' + i + '">' +
        '<div class="note-ts">' + esc(when) + '<button class="btn-note-edit" data-action="edit-note" data-idx="' + i + '">Edit</button></div>' +
        '<div class="note-text">' + esc(n.text) + '</div>' +
        '</div>';
    }).join('');
    el.scrollTop = el.scrollHeight;
  }

  // Add Note — appends to list
  document.getElementById('adAddNote').addEventListener('click', function() {
    var jobId = currentDetailsJobId;
    if (!jobId || !appliedJobs[jobId]) return;
    var text = document.getElementById('adNoteInput').value.trim();
    if (!text) return;
    var r = appliedJobs[jobId];
    if (!Array.isArray(r.notes)) r.notes = [];
    var entry = { text: text, ts: new Date().toISOString() };
    r.notes.push(entry);
    appendLog(jobId, 'Note added');
    persistApplied();
    document.getElementById('adNoteInput').value = '';
    renderNotesHistory(r.notes);
    renderTimeline(r.log);
    var btn = this;
    btn.textContent = 'Added \u2713';
    btn.classList.add('detail-save-ok');
    setTimeout(function() { btn.textContent = 'Add Note'; btn.classList.remove('detail-save-ok'); }, 1200);
  });

  // Notes history — inline edit / save / cancel
  document.getElementById('adNotesHistory').addEventListener('click', function(e) {
    var jobId = currentDetailsJobId;
    if (!jobId || !appliedJobs[jobId]) return;

    // Edit button → swap text div for textarea
    var editBtn = e.target.closest('[data-action="edit-note"]');
    if (editBtn) {
      var entry = editBtn.closest('.note-entry');
      var idx   = parseInt(editBtn.dataset.idx, 10);
      var text  = appliedJobs[jobId].notes[idx].text;
      entry.querySelector('.note-text').style.display = 'none';
      editBtn.style.display = 'none';
      entry.insertAdjacentHTML('beforeend',
        '<textarea class="note-edit-area" data-edit-idx="' + idx + '">' + esc(text) + '</textarea>' +
        '<div class="note-edit-actions">' +
          '<button class="btn-note-save" data-action="save-note" data-idx="' + idx + '">Save</button>' +
          '<button class="btn-note-cancel" data-action="cancel-note">Cancel</button>' +
        '</div>'
      );
      entry.querySelector('.note-edit-area').focus();
      return;
    }

    // Save button → persist updated text
    var saveBtn = e.target.closest('[data-action="save-note"]');
    if (saveBtn) {
      var idx      = parseInt(saveBtn.dataset.idx, 10);
      var entry    = saveBtn.closest('.note-entry');
      var newText  = entry.querySelector('.note-edit-area').value.trim();
      if (newText) {
        appliedJobs[jobId].notes[idx].text = newText;
        appendLog(jobId, 'Note edited');
        persistApplied();
      }
      renderNotesHistory(appliedJobs[jobId].notes);
      return;
    }

    // Cancel button → just re-render
    var cancelBtn = e.target.closest('[data-action="cancel-note"]');
    if (cancelBtn) { renderNotesHistory(appliedJobs[jobId].notes); return; }
  });

  // Dates auto-save on change — no button needed
  function autoSaveDates() {
    var jobId = currentDetailsJobId;
    if (!jobId || !appliedJobs[jobId]) return;
    var r = appliedJobs[jobId];
    if (!r.dates) r.dates = {};

    var applied   = document.getElementById('adDateApplied').value;
    var recruiter = document.getElementById('adDateRecruiter').value;
    var offer     = document.getElementById('adDateOffer').value;
    var followUp  = document.getElementById('adDateFollowUp').value;
    var interviews = liveInterviews().filter(Boolean);

    var changed = [];
    if (applied   !== (r.dates.applied           || '')) changed.push('Date Applied');
    if (recruiter !== (r.dates.recruiterContact   || '')) changed.push('Recruiter Contact');
    if (offer     !== (r.dates.offer             || '')) changed.push('Offer Date');
    if (followUp  !== (r.dates.followUp          || '')) changed.push('Follow-up Date');
    if (JSON.stringify(interviews) !== JSON.stringify(r.dates.interviews || [])) changed.push('Interview Date(s)');

    r.dates.applied          = applied;
    r.dates.recruiterContact = recruiter;
    r.dates.offer            = offer;
    r.dates.followUp         = followUp;
    r.dates.interviews       = interviews;

    if (changed.length) appendLog(jobId, 'Dates updated: ' + changed.join(', '));
    persistApplied();
    renderAppliedSection();
    renderTimeline(r.log);

    var msg = document.getElementById('adDatesSavedMsg');
    msg.style.display = 'inline';
    setTimeout(function() { msg.style.display = 'none'; }, 1500);
  }

  ['adDateApplied','adDateRecruiter','adDateOffer','adDateFollowUp'].forEach(function(id) {
    document.getElementById(id).addEventListener('change', autoSaveDates);
  });
  document.getElementById('adInterviewsList').addEventListener('change', function(e) {
    if (e.target.matches('input[type=date]')) autoSaveDates();
  });

  // Snapshot current live interview inputs (typed-but-not-saved values)
  function liveInterviews() {
    var inputs = document.querySelectorAll('#adInterviewsList input[type=date]');
    var vals = [];
    inputs.forEach(function(inp) { vals.push(inp.value); });
    return vals;
  }

  // Add interview date row — preserve any unsaved typed values first
  document.getElementById('adAddInterview').addEventListener('click', function() {
    var jobId = currentDetailsJobId;
    if (!jobId || !appliedJobs[jobId]) return;
    var r = appliedJobs[jobId];
    if (!r.dates) r.dates = {};
    var current = liveInterviews(); // capture what's in the DOM right now
    current.push('');
    r.dates.interviews = current;
    renderInterviewsList(r.dates.interviews);
  });

  // Remove interview row — preserve unsaved values, then splice
  document.getElementById('adInterviewsList').addEventListener('click', function(e) {
    var btn = e.target.closest('[data-remove-interview]');
    if (!btn) return;
    var jobId = currentDetailsJobId;
    if (!jobId || !appliedJobs[jobId]) return;
    var current = liveInterviews();
    var idx = parseInt(btn.dataset.removeInterview, 10);
    current.splice(idx, 1);
    appliedJobs[jobId].dates.interviews = current;
    renderInterviewsList(appliedJobs[jobId].dates.interviews);
  });


  // Row click → open modal (delegated)
  // Upload / score buttons handle their own actions; <a> clicks pass through
  document.getElementById('jobBody').addEventListener('click', function(e) {
    if (e.target.closest('a')) return;

    // Applied checkbox (unchecked → open email modal)
    var applyWrap = e.target.closest('[data-action="apply"]');
    if (applyWrap) { openApplyModal(applyWrap.dataset.id, false); return; }

    // Edit applied record
    var editApplyBtn = e.target.closest('[data-action="edit-apply"]');
    if (editApplyBtn) { openApplyModal(editApplyBtn.dataset.id, true); return; }

    // Per-job upload button
    var uploadBtn = e.target.closest('[data-action="upload"]');
    if (uploadBtn) {
      pendingUploadJobId = uploadBtn.dataset.id;
      document.getElementById('jobResumeFile').value = '';
      document.getElementById('jobResumeFile').click();
      return;
    }

    // Per-job score button
    var scoreBtn = e.target.closest('[data-action="score"]');
    if (scoreBtn) {
      var jobId = scoreBtn.dataset.id;
      scoreBtn.disabled = true;
      fetch('/api/jobs/' + jobId + '/score', { method: 'POST' })
        .then(function(r){ return r.json(); })
        .then(function(d){ if (d.error) { alert(d.error); renderTable(); } })
        .catch(function(){ renderTable(); });
      return;
    }

    var tr = e.target.closest('tr[data-id]');
    if (tr) openModal(tr.dataset.id);
  });

  // Per-job file picker → upload to server + persist in localStorage
  document.getElementById('jobResumeFile').addEventListener('change', function(e) {
    var jobId = pendingUploadJobId;
    if (!jobId) return;
    pendingUploadJobId = null;
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      var b64 = ev.target.result.split(',')[1];
      // Persist so resume survives page reload
      jobResumes[jobId] = { name: file.name, base64: b64 };
      localStorage.setItem('jobResumes', JSON.stringify(jobResumes));
      fetch('/api/jobs/' + jobId + '/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: b64, file_name: file.name })
      })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d.error) { alert(d.error); return; }
        renderTable();
      });
    };
    reader.readAsDataURL(file);
  });

  // On page load: silently re-upload any per-job resumes stored in localStorage
  // so the server has the text ready without the user needing to re-upload.
  (function restoreJobResumes() {
    Object.keys(jobResumes).forEach(function(jobId) {
      var r = jobResumes[jobId];
      fetch('/api/jobs/' + jobId + '/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: r.base64, file_name: r.name })
      }).catch(function(){});
    });
  })();

  // On page load: push locally-stored applied records back to server.
  // This re-populates in-memory state after a server restart so the data
  // is always consistent regardless of server uptime.
  (function restoreApplied() {
    Object.keys(appliedJobs).forEach(function(jobId) {
      var r = appliedJobs[jobId];
      fetch('/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId, jobId: jobId, email: r.email, appliedAt: r.appliedAt })
      }).catch(function(){});
    });
  })();

  // Render applied section immediately from localStorage (before first poll returns)
  renderAppliedSection();

  // ── Apply modal ────────────────────────────────────────────────────────────

  function openApplyModal(jobId, editMode) {
    pendingApplyJobId = jobId;
    var existing = appliedJobs[jobId];
    document.getElementById('applyModalTitle').textContent =
      editMode ? 'Update Application' : 'Mark as Applied';
    document.getElementById('applyModalSub').textContent =
      editMode
        ? 'Update the email address you used to apply for this role.'
        : 'Enter the email address you used to apply for this role.';
    document.getElementById('applyEmailInput').value = existing ? existing.email : '';
    document.getElementById('applyEmailError').textContent = '';
    document.getElementById('applyModal').classList.add('open');
    setTimeout(function() { document.getElementById('applyEmailInput').focus(); }, 50);
  }

  function closeApplyModal() {
    document.getElementById('applyModal').classList.remove('open');
    pendingApplyJobId = null;
  }

  document.getElementById('applyModalCancel').addEventListener('click', closeApplyModal);
  document.getElementById('applyModal').addEventListener('click', function(e) {
    if (e.target === this) closeApplyModal();
  });
  document.getElementById('applyEmailInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('applyModalSave').click();
    if (e.key === 'Escape') closeApplyModal();
  });

  document.getElementById('applyModalSave').addEventListener('click', function() {
    var emailInput = document.getElementById('applyEmailInput');
    var raw = emailInput.value.trim();
    // Handle browser autofill "Name <email@example.com>" format
    var angleMatch = raw.match(/<([^\s>@]+@[^\s>]+)>/);
    var email = angleMatch ? angleMatch[1].trim() : raw;
    emailInput.value = email;
    var errorEl = document.getElementById('applyEmailError');
    if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
      errorEl.textContent = 'Please enter a valid email address.';
      return;
    }
    errorEl.textContent = '';
    fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userId, jobId: pendingApplyJobId, email: email })
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.error) { alert(d.error); return; }
      var job      = allJobs.find(function(j) { return j.id === pendingApplyJobId; });
      var existing = appliedJobs[pendingApplyJobId] || {};
      var isNew    = !existing.appliedAt;
      var nowIso   = d.record.appliedAt || new Date().toISOString();
      var log      = existing.log ? existing.log.slice() : [];
      if (isNew) {
        log.push({ action: 'Marked as applied with ' + email, ts: nowIso });
      } else if (existing.email !== email) {
        log.push({ action: 'Email updated to ' + email, ts: new Date().toISOString() });
      }
      appliedJobs[pendingApplyJobId] = {
        email:    email,
        appliedAt: nowIso,
        company:  job ? job.company  : (existing.company  || ''),
        title:    job ? job.title    : (existing.title    || ''),
        location: job ? job.location : (existing.location || ''),
        workType: job ? job.workType : (existing.workType || ''),
        applyUrl: job ? job.applyUrl : (existing.applyUrl || ''),
        status:   existing.status || 'applied',
        notes:    Array.isArray(existing.notes) ? existing.notes : (existing.notes ? [{ text: existing.notes, ts: nowIso }] : []),
        dates:    existing.dates  || { applied: nowIso.slice(0,10), recruiterContact: '', interviews: [], offer: '', followUp: '' },
        log:      log
      };
      persistApplied();
      closeApplyModal();
      renderTable();
      renderAppliedSection();
    });
  });

  // Column sort
  document.querySelectorAll('th[data-col]').forEach(function(th) {
    th.addEventListener('click', function() {
      var col = th.dataset.col;
      if (sortCol === col) { sortDir *= -1; }
      else { sortCol = col; sortDir = -1; }
      renderTable();
    });
  });

  document.getElementById('filterText').addEventListener('input', renderTable);
  document.getElementById('filterAction').addEventListener('change', renderTable);
  document.getElementById('btnEarlyCareer').addEventListener('click', function() {
    earlyCareerOnly = !earlyCareerOnly;
    this.style.background = earlyCareerOnly ? '#fef9c3' : '';
    this.style.borderColor = earlyCareerOnly ? '#f59e0b' : '';
    this.style.color = earlyCareerOnly ? '#854d0e' : '';
    this.style.fontWeight = earlyCareerOnly ? '700' : '';
    renderTable();
  });

  // ── Modal ──────────────────────────────────────────────────────────────────

  function scoreColor(s) {
    if (s == null) return 'score-none';
    if (s >= 70) return 'score-high';
    if (s >= 40) return 'score-mid';
    return 'score-low';
  }

  function populateModal(j) {
    document.getElementById('mCompany').textContent = j.company;
    var titleHtml = esc(j.title);
    if (j.earlyCareer) titleHtml += ' <span style="font-size:0.7rem;background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;border-radius:4px;padding:2px 7px;font-weight:700;vertical-align:middle;">New Grad</span>';
    if (j.sourceLabel === 'Early Careers Portal') titleHtml += ' <span title="Sourced from the company&#39;s dedicated Early Careers / University portal" style="font-size:0.7rem;background:#fef9c3;color:#854d0e;border:1px solid #fde68a;border-radius:4px;padding:2px 7px;font-weight:700;vertical-align:middle;">🎓 Early Careers Portal</span>';
    else if (j.sourceLabel === 'LinkedIn') titleHtml += ' <span title="Listing sourced from LinkedIn" style="font-size:0.7rem;background:#e0f2fe;color:#075985;border:1px solid #bae6fd;border-radius:4px;padding:2px 7px;font-weight:700;vertical-align:middle;">via LinkedIn</span>';
    document.getElementById('mTitle').innerHTML = titleHtml;
    document.getElementById('mLocation').textContent  = j.location || '—';

    var wt = document.getElementById('mWorkType');
    wt.innerHTML = '<span class="wtype ' + workTypeClass(j.workType) + '">' + esc(j.workType) + '</span>';

    var applyBtn = document.getElementById('mApply');
    if (j.applyUrl) {
      applyBtn.href = j.applyUrl;
      applyBtn.style.display = '';
      applyBtn.textContent = j.sourceLabel === 'LinkedIn' ? 'View on LinkedIn \u2192' : 'Apply';
    } else {
      applyBtn.style.display = 'none';
    }

    // Score block
    var num = document.getElementById('mScoreNum');
    num.textContent = j.matchScore != null ? j.matchScore + '%' : '—';
    num.className = 'score-num ' + scoreColor(j.matchScore);

    var ab = document.getElementById('mActionBlock');
    ab.innerHTML = j.resumeAction ? actionBadge(j.resumeAction) : '';

    // Requirements map
    var reqSection = document.getElementById('mReqSection');
    var summary = j.summary;
    var reqs = j.requirements || [];

    if (!summary && reqs.length === 0) {
      reqSection.style.display = 'none';
      // For LinkedIn-sourced jobs show a notice instead of hiding the section
      if (j.sourceLabel === 'LinkedIn') {
        reqSection.style.display = '';
        reqSection.innerHTML =
          '<div style="padding:12px 16px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;color:#0369a1;font-size:0.85rem;">' +
          '<strong>Full job details on LinkedIn</strong><br>' +
          'This listing was sourced from LinkedIn because ' + esc(j.company) + '\\'s careers site requires browser rendering. ' +
          '<a href="' + esc(j.applyUrl) + '" target="_blank" rel="noopener" style="color:#0369a1;font-weight:600;">Open on LinkedIn &rarr;</a> ' +
          'to see the full description and apply via the company\\'s official site.' +
          '</div>';
      }
      return;
    }
    reqSection.style.display = '';

    if (summary) {
      document.getElementById('mReqSummary').innerHTML =
        '<span class="req-summary-pill rsp-met">Met: ' + summary.met + '</span>' +
        '<span class="req-summary-pill rsp-partial">Partial: ' + summary.partial + '</span>' +
        '<span class="req-summary-pill rsp-missing">Missing: ' + summary.missing + '</span>';
    }

    document.getElementById('mReqList').innerHTML = reqs.map(function(r) {
      var cls  = r.status === 'met' ? 'req-met' : r.status === 'partial' ? 'req-partial' : 'req-missing';
      var icon = r.status === 'met' ? '&#10003;' : r.status === 'partial' ? '&#9651;' : '&#10007;';
      var conf = r.confidence != null ? Math.round(r.confidence * 100) + '%' : '';
      var proof = r.proof
        ? '<div class="req-proof">' + esc(r.proof) + '</div>' : '';
      var loc = r.location
        ? '<div class="req-location">' + esc(r.location) + '</div>' : '';
      return '<div class="req-row ' + cls + '">' +
        '<div class="req-top">' +
          '<span class="req-icon">' + icon + '</span>' +
          '<span class="req-text">' + esc(r.requirement) + '</span>' +
          (conf ? '<span class="req-conf">' + conf + '</span>' : '') +
        '</div>' +
        proof + loc +
        '</div>';
    }).join('');
  }

  function openModal(jobId) {
    var j = allJobs.find(function(x){ return x.id === jobId; });
    if (!j) return;
    currentJobId = jobId;
    populateModal(j);
    document.getElementById('jobModal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    document.getElementById('jobModal').classList.remove('open');
    document.body.style.overflow = '';
    currentJobId = null;
  }

  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('jobModal').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { closeModal(); closeDetailsModal(); }
  });

  // ── Actions ────────────────────────────────────────────────────────────────

  document.getElementById('btnScan').addEventListener('click', function() {
    fetch('/api/scan', { method: 'POST' })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d.error) alert(d.error);
      });
  });

  document.getElementById('resumeFile').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      var b64 = ev.target.result.split(',')[1];
      fetch('/api/resume/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: b64, file_name: file.name })
      })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d.error) alert(d.error);
        else {
          document.getElementById('resumeLabel').textContent = file.name;
          document.getElementById('btnRunAts').disabled = false;
        }
      });
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('btnUseGeneric').addEventListener('click', function() {
    fetch('/api/resume/use-generic', { method: 'POST' })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d.error) alert(d.error);
        else {
          document.getElementById('resumeLabel').textContent = 'Generic resume';
          document.getElementById('btnRunAts').disabled = false;
        }
      });
  });

  document.getElementById('btnRunAts').addEventListener('click', function() {
    fetch('/api/run-ats', { method: 'POST' })
      .then(function(r){ return r.json(); })
      .then(function(d){ if (d.error) alert(d.error); });
  });

  // ── Add Company ───────────────────────────────────────────────────────────
  function setAddStatus(msg, color) {
    var el = document.getElementById('addCompanyStatus');
    el.textContent = msg;
    el.style.color = color || '#64748b';
  }

  document.getElementById('btnAddCompany').addEventListener('click', function() {
    var nameEl = document.getElementById('addCompanyName');
    var urlEl  = document.getElementById('addCompanyUrl');
    var name   = nameEl.value.trim();
    var url    = urlEl.value.trim();

    if (!name) { setAddStatus('Enter a company name.', '#dc2626'); return; }

    var btn = document.getElementById('btnAddCompany');
    btn.disabled = true;
    btn.textContent = 'Detecting\u2026';
    setAddStatus('Searching for ' + name + '\\u2019s job feed\u2026', '#2563eb');

    fetch('/api/companies/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, careersUrl: url || undefined }),
    })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
    .then(function(res) {
      btn.disabled = false;
      btn.textContent = '+ Add Company';
      if (!res.ok) {
        setAddStatus(res.d.error || 'Failed.', '#dc2626');
        return;
      }
      setAddStatus(res.d.message, '#15803d');
      nameEl.value = '';
      urlEl.value  = '';
      renderTable();
    })
    .catch(function(e) {
      btn.disabled = false;
      btn.textContent = '+ Add Company';
      setAddStatus('Network error: ' + e.message, '#dc2626');
    });
  });

  // Allow pressing Enter in the name field to submit
  document.getElementById('addCompanyName').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('btnAddCompany').click();
  });

  // ── Companies grid ────────────────────────────────────────────────────────
  fetch('/api/companies')
    .then(function(r){ return r.json(); })
    .then(function(d){
      var grid = document.getElementById('companiesGrid');
      grid.innerHTML = (d.companies || []).map(function(c) {
        var initials = c.name.split(' ').map(function(w){ return w[0]; }).join('').slice(0,2).toUpperCase();
        return '<a class="company-card" href="' + esc(c.careersUrl) + '" target="_blank" rel="noopener">' +
          '<div class="company-card-icon">' + initials + '</div>' +
          esc(c.name) +
          '</a>';
      }).join('');
    });
</script>

</body>
</html>`;
// ── Express app ───────────────────────────────────────────────────────────────
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: "50mb" }));
// GET /
app.get("/", (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.send(INDEX_HTML);
});
// GET /api/status
app.get("/api/status", (_req, res) => {
    res.json(state_1.appState.statusForClient());
});
// GET /api/companies
app.get("/api/companies", (_req, res) => {
    res.json({ companies: (0, companies_1.allCompanies)() });
});
// POST /api/scan
app.post("/api/scan", (req, res) => {
    if (state_1.appState.status.state === "scanning") {
        return res.status(409).json({ error: "Scan already in progress." });
    }
    state_1.appState.jobs = [];
    (0, jobScraper_1.scrapeAll)().catch((err) => console.error("[scan]", err));
    res.json({ status: "started" });
});
// POST /api/resume/upload — base64 PDF
app.post("/api/resume/upload", async (req, res) => {
    const { pdf_base64, file_name } = req.body;
    if (!pdf_base64)
        return res.status(400).json({ error: "No PDF data" });
    try {
        const bytes = Buffer.from(pdf_base64, "base64");
        const text = await (0, pdfUtil_1.extract_text_from_bytes)(bytes);
        if (!text.trim()) {
            return res
                .status(400)
                .json({ error: "PDF appears to be empty or image-only" });
        }
        state_1.appState.resume.uploadedText = text;
        state_1.appState.resume.uploadedName = file_name || "resume.pdf";
        res.json({ status: "uploaded" });
    }
    catch (err) {
        res.status(500).json({ error: `Could not read PDF: ${err}` });
    }
});
// POST /api/resume/use-generic
app.post("/api/resume/use-generic", (_req, res) => {
    if (!state_1.appState.resume.genericText) {
        return res
            .status(400)
            .json({ error: "Generic resume not loaded on server" });
    }
    // Clear uploaded so generic takes effect
    state_1.appState.resume.uploadedText = "";
    state_1.appState.resume.uploadedName = "";
    res.json({ status: "ok" });
});
// POST /api/run-ats
app.post("/api/run-ats", (req, res) => {
    if (!state_1.appState.hasResume()) {
        return res
            .status(400)
            .json({ error: "No resume loaded — upload a resume first" });
    }
    if (state_1.appState.status.state === "scanning") {
        return res
            .status(409)
            .json({ error: "Scan in progress — run ATS after scan completes" });
    }
    if (state_1.appState.status.state === "scoring") {
        return res.status(409).json({ error: "ATS scoring already in progress" });
    }
    const label = state_1.appState.resume.uploadedText ? "uploaded" : "generic";
    scoreAllJobs(label).catch((err) => console.error("[ats]", err));
    res.json({ status: "scoring" });
});
// POST /api/apply — save or update an application record
app.post("/api/apply", (req, res) => {
    const { userId, jobId, email, appliedAt } = req.body;
    if (!userId || !jobId || !email) {
        return res.status(400).json({ error: "userId, jobId, and email are required" });
    }
    const key = `${userId}::${jobId}`;
    const record = {
        userId,
        jobId,
        email,
        appliedAt: appliedAt || new Date().toISOString(),
    };
    state_1.appState.applications[key] = record;
    res.json({ status: "saved", record });
});
// GET /api/applications?userId=xxx — fetch all applications for a user
app.get("/api/applications", (req, res) => {
    const userId = String(req.query.userId || "");
    if (!userId)
        return res.status(400).json({ error: "userId query param required" });
    const records = Object.values(state_1.appState.applications).filter((r) => r.userId === userId);
    res.json({ applications: records });
});
// DELETE /api/apply/:userId/:jobId — remove an application record
app.delete("/api/apply/:userId/:jobId", (req, res) => {
    const userId = String(req.params.userId);
    const jobId = String(req.params.jobId);
    const key = `${userId}::${jobId}`;
    delete state_1.appState.applications[key];
    res.json({ status: "deleted" });
});
// POST /api/jobs/:id/resume — upload a per-job resume (base64 PDF)
app.post("/api/jobs/:id/resume", async (req, res) => {
    const jobId = String(req.params.id);
    const job = state_1.appState.jobs.find((j) => j.id === jobId);
    if (!job)
        return res.status(404).json({ error: "Job not found" });
    const { pdf_base64, file_name } = req.body;
    if (!pdf_base64)
        return res.status(400).json({ error: "No PDF data" });
    try {
        const bytes = Buffer.from(pdf_base64, "base64");
        const text = await (0, pdfUtil_1.extract_text_from_bytes)(bytes);
        if (!text.trim())
            return res.status(400).json({ error: "PDF appears to be empty or image-only" });
        state_1.appState.jobResumes[jobId] = { text, name: file_name || "resume.pdf" };
        res.json({ status: "uploaded" });
    }
    catch (err) {
        res.status(500).json({ error: `Could not read PDF: ${err}` });
    }
});
// POST /api/jobs/:id/score — score a single job with its per-job (or global) resume
app.post("/api/jobs/:id/score", (req, res) => {
    const jobId = String(req.params.id);
    const job = state_1.appState.jobs.find((j) => j.id === jobId);
    if (!job)
        return res.status(404).json({ error: "Job not found" });
    if (state_1.appState.scoringJobIds.has(jobId))
        return res.status(409).json({ error: "Already scoring this job" });
    const jobResume = state_1.appState.jobResumes[jobId];
    const resumeText = jobResume?.text || state_1.appState.activeResumeText();
    if (!resumeText)
        return res.status(400).json({ error: "No resume available — upload one first" });
    state_1.appState.scoringJobIds.add(jobId);
    res.json({ status: "scoring" });
    const label = jobResume
        ? "job-specific"
        : state_1.appState.resume.uploadedText
            ? "uploaded"
            : "generic";
    const tmpPath = path.join("/tmp", `resume-job-${jobId}.txt`);
    fs.writeFileSync(tmpPath, resumeText, "utf-8");
    (0, parser_1.parseResume)(tmpPath)
        .then((resumeData) => scoreOneJob(jobId, resumeData, label))
        .catch((err) => console.error(`[scorer] ${jobId}: ${err}`))
        .finally(() => state_1.appState.scoringJobIds.delete(jobId));
});
// ── Add company endpoint ──────────────────────────────────────────────────────
// POST /api/companies/add
// Body: { name: string, careersUrl?: string }
// Detects ATS, runs an initial scrape, persists the company, returns results.
app.post("/api/companies/add", async (req, res) => {
    const { name, careersUrl } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Company name is required." });
    }
    const trimmedName = name.trim();
    // Reject obviously invalid input
    if (trimmedName.length < 2 || trimmedName.length > 120) {
        return res.status(400).json({ error: "Company name must be between 2 and 120 characters." });
    }
    // Check if already tracked
    const existing = (0, companies_1.allCompanies)().find((c) => c.name.toLowerCase() === trimmedName.toLowerCase());
    if (existing) {
        return res.status(409).json({
            error: `"${trimmedName}" is already being tracked (${existing.platform}).`,
        });
    }
    try {
        // Step 1: detect ATS
        const detection = await (0, companyDetector_1.detectCompany)(trimmedName, careersUrl?.trim() || undefined);
        // Step 2: scrape initial jobs
        let initialJobs = [];
        try {
            initialJobs = await (0, jobScraper_1.scrapeCompany)(detection.platform, detection.slug, trimmedName, detection.careersUrl, detection.linkedInId);
        }
        catch (scrapeErr) {
            console.warn(`[add-company] Initial scrape failed for ${trimmedName}: ${scrapeErr}`);
            // Non-fatal — company is still saved, jobs will appear on next full scan
        }
        // Step 3: persist
        const saved = (0, customCompanies_1.saveCustomCompany)({
            name: trimmedName,
            slug: detection.slug,
            platform: detection.platform,
            careersUrl: detection.careersUrl,
            linkedInId: detection.linkedInId,
        });
        // Step 4: merge initial jobs into live state (deduped by id)
        const existingIds = new Set(state_1.appState.jobs.map((j) => j.id));
        const newJobs = initialJobs.filter((j) => !existingIds.has(j.id));
        state_1.appState.jobs.push(...newJobs);
        state_1.appState.status.jobCount = state_1.appState.jobs.length;
        res.json({
            status: "added",
            company: saved,
            platform: detection.platform,
            source: detection.source,
            jobsFound: newJobs.length,
            message: newJobs.length > 0
                ? `Found ${newJobs.length} PM role(s) at ${trimmedName} via ${detection.source}.`
                : `${trimmedName} added — no current PM openings found. Will check on next scan.`,
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(422).json({ error: msg });
    }
});
// GET /api/companies/custom — list user-added companies
app.get("/api/companies/custom", (_req, res) => {
    res.json({ companies: (0, customCompanies_1.loadCustomCompanies)() });
});
// DELETE /api/companies/custom/:slug — remove a user-added company
app.delete("/api/companies/custom/:slug", (req, res) => {
    const slug = String(req.params.slug);
    const removed = (0, customCompanies_1.removeCustomCompany)(slug);
    if (!removed)
        return res.status(404).json({ error: "Company not found in custom list." });
    res.json({ status: "removed" });
});
// ── Start ──────────────────────────────────────────────────────────────────────
async function startServer() {
    // Load generic resume at startup
    if (fs.existsSync(exports.GENERIC_RESUME_PATH)) {
        try {
            const buf = fs.readFileSync(exports.GENERIC_RESUME_PATH);
            const text = await (0, pdfUtil_1.extract_text_from_bytes)(buf);
            if (text.trim()) {
                state_1.appState.resume.genericText = text;
                console.log(`[resume] Generic resume loaded (${text.length} chars)`);
            }
        }
        catch (err) {
            console.error("[resume] Could not load generic resume:", err);
        }
    }
    else {
        console.warn(`[resume] Generic resume not found at ${exports.GENERIC_RESUME_PATH} — upload via UI`);
    }
    app.listen(PORT, () => {
        console.log(`Listening on http://localhost:${PORT}`);
    });
}
//# sourceMappingURL=server.js.map