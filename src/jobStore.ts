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

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Job } from "./state";

const STORE_PATH = path.join(process.cwd(), "data", "jobStore.json");
const NEW_JOB_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

interface JobRecord {
  firstSeenAt: string; // ISO timestamp
  lastSeenAt: string;  // ISO timestamp
}

type Store = Record<string, JobRecord>; // key = fingerprint hex

// ── Fingerprint ───────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, " ").trim();
}

export function jobFingerprint(company: string, title: string, location: string): string {
  const raw = `${normalize(company)}|${normalize(title)}|${normalize(location)}`;
  return crypto.createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

// ── Store I/O ─────────────────────────────────────────────────────────────────

function loadStore(): Store {
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(STORE_PATH)) return {};
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as Store;
  } catch {
    return {};
  }
}

function saveStore(store: Store): void {
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch (e) {
    console.warn("[jobStore] failed to save:", e instanceof Error ? e.message : e);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function isRecentlyPosted(job: Job, firstSeenAt: string, nowMs: number): boolean {
  // If the company provides a real posted date, trust it over firstSeenAt.
  // A job posted 3 weeks ago is not "new" even if we just discovered it.
  if (job.datePosted && job.datePosted !== "—") {
    const postedMs = new Date(job.datePosted).getTime();
    return !isNaN(postedMs) && (nowMs - postedMs) < NEW_JOB_TTL_MS;
  }
  // No posted date (Google, Meta) — fall back to when we first saw it
  return (nowMs - new Date(firstSeenAt).getTime()) < NEW_JOB_TTL_MS;
}

/**
 * Diff incoming jobs against the stored snapshot.
 * Returns jobs with firstSeenAt and isNew populated.
 * Persists updated store to disk.
 */
export function applyJobDiff(jobs: Job[]): Job[] {
  const store = loadStore();
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const updated: Store = {};

  const result = jobs.map((job): Job => {
    const fp = jobFingerprint(job.company, job.title, job.location);
    const existing = store[fp];

    if (!existing) {
      updated[fp] = { firstSeenAt: now, lastSeenAt: now };
      return { ...job, firstSeenAt: now, isNew: isRecentlyPosted(job, now, nowMs) };
    }

    updated[fp] = { firstSeenAt: existing.firstSeenAt, lastSeenAt: now };
    return { ...job, firstSeenAt: existing.firstSeenAt, isNew: isRecentlyPosted(job, existing.firstSeenAt, nowMs) };
  });

  // Merge: preserve records for jobs not in this scan (they may come back)
  saveStore({ ...store, ...updated });

  const newCount = result.filter((j) => j.isNew).length;
  console.log(`[jobStore] ${newCount} new / ${result.length} total jobs this scan`);

  return result;
}
