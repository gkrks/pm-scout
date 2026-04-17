"use strict";
/**
 * jobStore — scan-to-scan job diffing with stable fingerprints.
 *
 * Fingerprint = SHA-1( normalized(company) | normalized(title) | normalized(location) )
 * Does NOT include the URL — Google/Meta URLs are session-specific and change.
 *
 * Persistence: data/jobStore.json (excluded from git).
 * On Render free (ephemeral FS), store survives within a deployment session.
 * On server restart all jobs appear "new" for the first scan, then diffs work.
 *
 * isNew TTL: 3 days — job stays flagged "new" for 3 days after firstSeenAt.
 */
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobFingerprint = jobFingerprint;
exports.applyJobDiff = applyJobDiff;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const STORE_PATH = path.join(process.cwd(), "data", "jobStore.json");
const NEW_JOB_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
// ── Fingerprint ───────────────────────────────────────────────────────────────
function normalize(s) {
    return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, " ").trim();
}
function jobFingerprint(company, title, location) {
    const raw = `${normalize(company)}|${normalize(title)}|${normalize(location)}`;
    return crypto.createHash("sha1").update(raw).digest("hex").slice(0, 16);
}
// ── Store I/O ─────────────────────────────────────────────────────────────────
function loadStore() {
    try {
        const dir = path.dirname(STORE_PATH);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(STORE_PATH))
            return {};
        return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    }
    catch {
        return {};
    }
}
function saveStore(store) {
    try {
        const dir = path.dirname(STORE_PATH);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
    }
    catch (e) {
        console.warn("[jobStore] failed to save:", e instanceof Error ? e.message : e);
    }
}
// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Diff incoming jobs against the stored snapshot.
 * Returns jobs with firstSeenAt and isNew populated.
 * Persists updated store to disk.
 */
function applyJobDiff(jobs) {
    const store = loadStore();
    const now = new Date().toISOString();
    const nowMs = Date.now();
    const updated = {};
    const result = jobs.map((job) => {
        const fp = jobFingerprint(job.company, job.title, job.location);
        const existing = store[fp];
        if (!existing) {
            // First time we've seen this job
            updated[fp] = { firstSeenAt: now, lastSeenAt: now };
            return { ...job, firstSeenAt: now, isNew: true };
        }
        // Seen before — update lastSeenAt, keep firstSeenAt
        updated[fp] = { firstSeenAt: existing.firstSeenAt, lastSeenAt: now };
        const ageMs = nowMs - new Date(existing.firstSeenAt).getTime();
        return { ...job, firstSeenAt: existing.firstSeenAt, isNew: ageMs < NEW_JOB_TTL_MS };
    });
    // Merge: preserve records for jobs not in this scan (they may come back)
    saveStore({ ...store, ...updated });
    const newCount = result.filter((j) => j.isNew).length;
    console.log(`[jobStore] ${newCount} new / ${result.length} total jobs this scan`);
    return result;
}
//# sourceMappingURL=jobStore.js.map