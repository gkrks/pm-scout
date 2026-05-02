import * as crypto from "crypto";
import * as fs from "fs";
import Airtable from "airtable";
import { Job } from "../state";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_ID    = process.env.AIRTABLE_BASE_ID    ?? "";
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME ?? "Jobs";
const PAT        = process.env.AIRTABLE_PAT        ?? "";

function isConfigured(): boolean {
  return Boolean(PAT && BASE_ID);
}

function getTable(): Airtable.Table<Airtable.FieldSet> {
  return new Airtable({ apiKey: PAT }).base(BASE_ID)(TABLE_NAME);
}

// ── Fingerprint ───────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildFingerprint(
  company: string,
  title: string,
  location: string,
  applyUrl: string,
): string {
  const raw = [normalize(company), normalize(title), normalize(location), applyUrl.trim()].join("::");
  return crypto.createHash("sha1").update(raw).digest("hex");
}

// ── Rate limiter (max 5 req/s per Airtable docs) ──────────────────────────────

let _lastReqAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function rateLimit(): Promise<void> {
  const elapsed = Date.now() - _lastReqAt;
  if (elapsed < 200) await sleep(200 - elapsed);
  _lastReqAt = Date.now();
}

// ── Retry wrapper (exponential backoff on 429) ────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const is429 = err?.statusCode === 429 || String(err?.message ?? "").includes("429");
      if (is429 && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1_000;
        console.warn(`[airtable] Rate limited — retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  /* istanbul ignore next */
  throw new Error("unreachable");
}

// ── Pending buffer (survives Airtable outages) ────────────────────────────────

const PENDING_FILE = "data/pending-airtable.json";

interface PendingBuffer {
  jobs: Job[];
  runTimestamp: string;
}

function savePending(data: PendingBuffer): void {
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(PENDING_FILE, JSON.stringify(data, null, 2), "utf-8");
  console.warn(`[airtable] Results buffered to ${PENDING_FILE} for retry on next run`);
}

function loadPending(): PendingBuffer | null {
  if (!fs.existsSync(PENDING_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(PENDING_FILE, "utf-8")) as PendingBuffer;
  } catch {
    return null;
  }
}

function clearPending(): void {
  if (fs.existsSync(PENDING_FILE)) fs.unlinkSync(PENDING_FILE);
}

// ── Field mapping ─────────────────────────────────────────────────────────────

function postedDateSource(job: Job): string {
  if (job.datePosted === "—" || !job.datePosted) return "unknown";
  // Playwright scrapers (Google/Meta) never have real dates — check for it
  return job.sourceLabel ? "dom" : "api";
}

function sourceAts(job: Job): string {
  // Map internal company names to canonical ATS labels
  const n = job.company.toLowerCase();
  if (n === "google")   return "google";
  if (n === "meta")     return "meta";
  if (n === "amazon")   return "amazon";
  if (job.sourceLabel)  return "custom";
  // Inspect applyUrl domain for known ATS
  const u = job.applyUrl.toLowerCase();
  if (u.includes("greenhouse.io") || u.includes("boards.greenhouse")) return "greenhouse";
  if (u.includes("lever.co"))    return "lever";
  if (u.includes("ashbyhq.com")) return "ashby";
  return "unknown";
}

function jobFields(job: Job, fingerprint: string, runTimestamp: string): Record<string, unknown> {
  return {
    "Fingerprint":           fingerprint,
    "Company":               job.company,
    "Title":                 job.title,
    "Location":              job.location,
    "Apply URL":             job.applyUrl,
    "Posted Date":           job.datePosted !== "—" ? job.datePosted : null,
    "Posted Date Source":    postedDateSource(job),
    "First Seen At":         runTimestamp,
    "Last Seen At":          runTimestamp,
    "Scraped At":            runTimestamp,
    "Source ATS":            sourceAts(job),
    "Years Required":        null,           // extracted asynchronously if needed
    "Experience Confidence": "unknown",
    "Early Career":          job.earlyCareer,
    "Status":                "New",
    "Description Snippet":   job.description
      ? job.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500)
      : "",
    "Notes": "",
  };
}

// ── Query existing fingerprints ───────────────────────────────────────────────

type ExistingRecord = { airtableId: string; lastSeenAt: string };

async function queryExisting(
  fingerprints: string[],
): Promise<Map<string, ExistingRecord>> {
  const result = new Map<string, ExistingRecord>();
  const table  = getTable();

  // Airtable formula supports up to ~2 KB, so batch in groups of 50
  for (let i = 0; i < fingerprints.length; i += 50) {
    const batch = fingerprints.slice(i, i + 50);
    const formula =
      batch.length === 1
        ? `{Fingerprint} = "${batch[0]}"`
        : `OR(${batch.map((f) => `{Fingerprint} = "${f}"`).join(",")})`;

    await rateLimit();
    await withRetry(() =>
      table
        .select({ filterByFormula: formula, fields: ["Fingerprint", "Last Seen At"] })
        .eachPage((records, next) => {
          for (const rec of records) {
            const fp  = rec.get("Fingerprint") as string | undefined;
            const lsa = rec.get("Last Seen At") as string | undefined;
            if (fp) result.set(fp, { airtableId: rec.id, lastSeenAt: lsa ?? "" });
          }
          next();
        }),
    );
  }

  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface UpsertResult {
  inserted: number;
  updated:  number;
  errors:   number;
  buffered: boolean;
}

/**
 * Upsert a batch of jobs into Airtable.
 * - New jobs (fingerprint absent) are inserted with Status=New.
 * - Existing jobs (fingerprint present) get lastSeenAt + scrapedAt updated.
 * - On Airtable failure the batch is buffered to data/pending-airtable.json.
 *
 * Returns counts for logging.
 */
export async function upsertJobs(jobs: Job[], runId: string): Promise<UpsertResult> {
  const result: UpsertResult = { inserted: 0, updated: 0, errors: 0, buffered: false };

  if (!isConfigured()) {
    console.warn("[airtable] AIRTABLE_PAT / AIRTABLE_BASE_ID not set — upsert skipped");
    return result;
  }

  const runTimestamp = new Date().toISOString();
  const table        = getTable();

  // Within this run, keep the job with the longest description for each fingerprint
  const fpMap = new Map<string, Job>();
  for (const job of jobs) {
    const fp  = buildFingerprint(job.company, job.title, job.location, job.applyUrl);
    const cur = fpMap.get(fp);
    if (!cur || job.description.length > cur.description.length) fpMap.set(fp, job);
  }

  const allFps = [...fpMap.keys()];

  // Query Airtable for which fingerprints already exist
  let existing: Map<string, ExistingRecord>;
  try {
    existing = await queryExisting(allFps);
  } catch (err) {
    console.error(`[airtable] Failed to query existing records: ${err instanceof Error ? err.message : err}`);
    savePending({ jobs, runTimestamp });
    result.buffered = true;
    result.errors++;
    return result;
  }

  const toInsert: Array<{ fields: Record<string, unknown> }> = [];
  const toUpdate: Array<{ id: string; fields: Record<string, unknown> }> = [];

  for (const [fp, job] of fpMap) {
    if (existing.has(fp)) {
      toUpdate.push({
        id:     existing.get(fp)!.airtableId,
        fields: { "Last Seen At": runTimestamp, "Scraped At": runTimestamp },
      });
    } else {
      toInsert.push({ fields: jobFields(job, fp, runTimestamp) });
    }
  }

  // Batch inserts (Airtable limit: 10 per call)
  try {
    for (let i = 0; i < toInsert.length; i += 10) {
      await rateLimit();
      await withRetry(() => (table as any).create(toInsert.slice(i, i + 10)));
      result.inserted += Math.min(10, toInsert.length - i);
    }
  } catch (err) {
    console.error(`[airtable] Insert failed: ${err instanceof Error ? err.message : err}`);
    savePending({ jobs, runTimestamp });
    result.buffered = true;
    result.errors++;
    return result;
  }

  // Batch updates
  try {
    for (let i = 0; i < toUpdate.length; i += 10) {
      await rateLimit();
      await withRetry(() => (table as any).update(toUpdate.slice(i, i + 10)));
      result.updated += Math.min(10, toUpdate.length - i);
    }
  } catch (err) {
    console.error(`[airtable] Update failed: ${err instanceof Error ? err.message : err}`);
    result.errors++;
  }

  // Retry any pending buffer from a previous failed run
  const pending = loadPending();
  if (pending) {
    console.log(`[airtable] Retrying ${pending.jobs.length} buffered jobs from previous run`);
    clearPending();
    // Fire-and-forget — don't block the current run result
    upsertJobs(pending.jobs, `retry-${runId}`).catch((e: Error) =>
      console.error(`[airtable] Pending retry failed: ${e.message}`),
    );
  }

  console.log(`[airtable] Run ${runId}: ${result.inserted} inserted, ${result.updated} updated`);
  return result;
}

/**
 * Mark jobs not seen in the last staleDays as Status="Stale".
 * Only runs when STALE_DETECTION=true environment variable is set.
 */
export async function markStaleJobs(staleDays = 7): Promise<number> {
  if (!isConfigured()) return 0;
  if (process.env.STALE_DETECTION !== "true") return 0;

  const table   = getTable();
  const cutoff  = new Date();
  cutoff.setDate(cutoff.getDate() - staleDays);
  const cutoffIso = cutoff.toISOString();

  const staleIds: string[] = [];

  await rateLimit();
  await withRetry(() =>
    table
      .select({
        filterByFormula: `AND(IS_BEFORE({Last Seen At}, "${cutoffIso}"), {Status} = "New")`,
        fields: ["Fingerprint"],
      })
      .eachPage((records, next) => {
        staleIds.push(...records.map((r) => r.id));
        next();
      }),
  );

  for (let i = 0; i < staleIds.length; i += 10) {
    const batch = staleIds.slice(i, i + 10).map((id) => ({ id, fields: { Status: "Stale" } }));
    await rateLimit();
    await withRetry(() => (table as any).update(batch));
  }

  if (staleIds.length > 0) {
    console.log(`[airtable] Marked ${staleIds.length} stale job(s) (last seen > ${staleDays} days ago)`);
  }
  return staleIds.length;
}
