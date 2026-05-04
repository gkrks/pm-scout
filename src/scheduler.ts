import { loadTargetsConfig, type CompanyConfig } from "./config/targets";
import { applyJobDiff, saveJobs } from "./jobStore";
import { upsertJobs, markStaleJobs } from "./airtable/upsert";
import { sendTelegramDigest, RunStats } from "./notify/telegram";
import { sendEmailDigest } from "./notify/email";
import { sendHealthAlert, hasHealthIssues, buildHealthAlertText } from "./notify/healthAlert";
import { buildEmailText } from "./notify/email";
import { appState, Job } from "./state";
import { detectApmSignal } from "./ranking/apmSignal";
import { startParserRun, finalizeParserRun, sweepStaleRuns } from "./storage/parserRuns";
import { upsertCompanyListings, type ListingToUpsert } from "./storage/upsertListing";
import { deactivateUnseen } from "./storage/deactivateUnseen";
import { normalizeRoleUrl } from "./lib/normalizeUrl";
import {
  bufferRun,
  replayPendingBuffer,
  type PendingRunBuffer,
  type BufferedListing,
} from "./storage/pendingBuffer";
import { acquireLock, releaseLock } from "./orchestrator/lock";
import { extractSkillsForNewListings } from "./storage/extractSkillsInline";
import { extractYoeForNewListings } from "./storage/extractYoeInline";
import { cleanQualsForNewListings } from "./storage/cleanQualsInline";
import { orchestrateRun, type OrchestratorResult } from "./orchestrator/runScan";
import type { CompanyResult } from "./orchestrator/classify";
import { extractJD } from "./jdExtractor";

// ── Supabase helpers ──────────────────────────────────────────────────────────

function isSupabaseConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function isWithinDays(dateStr: string | undefined, days: number): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  return d >= new Date(Date.now() - days * 24 * 60 * 60 * 1_000);
}

function buildCompanyMap(
  config: ReturnType<typeof loadTargetsConfig>,
): Map<string, CompanyConfig & { id: string }> {
  const map = new Map<string, CompanyConfig & { id: string }>();
  if (!config) return map;
  for (const c of config.companies) {
    if (c.enabled && c.id) map.set(c.name, c as CompanyConfig & { id: string });
  }
  return map;
}

function jobToListingToUpsert(
  job:     Job,
  company: CompanyConfig & { id: string },
): ListingToUpsert {
  // Detect APM signal using company program metadata + job title/description.
  // Also stamp the signal on the job object so the notification renders it.
  const apmSignal = detectApmSignal({
    title:       job.title,
    description: job.description,
    company: {
      has_apm_program:    company.has_apm_program,
      apm_program_name:   company.apm_program_name,
      apm_program_status: company.apm_program_status,
    },
  });
  job.apmSignal = apmSignal;  // mutate so the notification digest can use it

  return {
    job: {
      title:        job.title,
      role_url:     job.applyUrl,
      location_raw: job.location,
      posted_date:  (job.datePosted && job.datePosted !== "—") ? job.datePosted : null,
      description:  job.description,
    },
    company: {
      id:                 company.id,
      slug:               company.slug ?? company.name.toLowerCase().replace(/\s+/g, "-"),
      name:               company.name,
      careers_url:        company.careersUrl,
      has_apm_program:    company.has_apm_program ?? false,
      apm_program_name:   company.apm_program_name,
      apm_program_status: company.apm_program_status,
      domain_tags:        [],
      target_roles:       company.roles,
    },
    enrichment: {
      location_city:                null,
      is_remote:                    job.workType === "Remote",
      is_hybrid:                    job.workType === "Hybrid",
      yoe_min:                      null,
      yoe_max:                      null,
      yoe_raw:                      null,
      experience_confidence:        "inferred-junior",
      is_new_grad_language:         job.earlyCareer,
      freshness_confidence:         job.datePosted ? "known" : "unknown",
      posted_within_7_days:         isWithinDays(job.datePosted, 7),
      posted_within_30_days:        isWithinDays(job.datePosted, 30),
      sponsorship_offered:          null,
      requires_sponsorship_unclear: true,
      salary_min:                   null,
      salary_max:                   null,
      salary_currency:              null,
    },
    tier:       (job.pmTier ?? (job.earlyCareer ? 1 : 2)) as 1 | 2 | 3,
    apm_signal: apmSignal,
    ats_platform: job.extractedJD?.extraction_meta.source_ats ?? company.ats,
    ...(job.extractedJD ? { extracted_jd: job.extractedJD } : {}),
  };
}

async function writeToSupabase(
  jobs:              Job[],
  companyMap:        Map<string, CompanyConfig & { id: string }>,
  failedCompanyNames: Set<string>,
  runId:             string,
  runStartedAt:      Date,
): Promise<{ listingsNew: number; listingsUpdated: number; listingsDeactivated: number; newRoleUrls: Set<string> }> {
  const byCompany = new Map<string, { company: CompanyConfig & { id: string }; jobs: Job[] }>();
  for (const job of jobs) {
    const company = companyMap.get(job.company);
    if (!company) continue;
    if (!byCompany.has(company.id)) byCompany.set(company.id, { company, jobs: [] });
    byCompany.get(company.id)!.jobs.push(job);
  }

  let listingsNew         = 0;
  let listingsUpdated     = 0;
  let listingsDeactivated = 0;
  const newRoleUrls       = new Set<string>();

  for (const { company, jobs: companyJobs } of byCompany.values()) {
    // Deduplicate by normalized role_url within the same company — first occurrence wins.
    // Prevents "ON CONFLICT DO UPDATE command cannot affect row a second time"
    // when multiple config entries share the same scraper (e.g. Google/Looker/Alphabet).
    const seenUrls = new Set<string>();
    const dedupedJobs = companyJobs.filter((j) => {
      const normalized = normalizeRoleUrl(j.applyUrl);
      if (seenUrls.has(normalized)) {
        console.warn(`[scheduler] Duplicate role_url skipped for ${company.name}: ${j.applyUrl}`);
        return false;
      }
      seenUrls.add(normalized);
      return true;
    });

    const listings: ListingToUpsert[] = dedupedJobs.map((j) =>
      jobToListingToUpsert(j, company),
    );
    const results = await upsertCompanyListings(company.id, listings, runId);

    for (const r of results) {
      if (r.seenState === "new") {
        listingsNew++;
        newRoleUrls.add(r.roleUrl);
      } else {
        listingsUpdated++;
      }
    }

    // Thread Supabase UUIDs back to Job objects for Check Fit links
    const urlToListingId = new Map(results.map((r) => [normalizeRoleUrl(r.roleUrl), r.listingId]));
    for (const j of dedupedJobs) {
      const lid = urlToListingId.get(normalizeRoleUrl(j.applyUrl));
      if (lid) j.supabaseId = lid;
    }

    // Extract skills + YOE for new listings inline (gpt-4o-mini, ~$0.0002 each)
    const newListingIds = results
      .filter((r) => r.seenState === "new")
      .map((r) => r.listingId);
    if (newListingIds.length > 0) {
      // Clean qualifications first (remove noise), then extract skills + YOE
      await cleanQualsForNewListings(newListingIds).catch((err) => {
        console.warn(`[scheduler] Quals cleaning failed for ${company.name}: ${err.message}`);
      });
      await Promise.all([
        extractSkillsForNewListings(newListingIds).catch((err) => {
          console.warn(`[scheduler] Skill extraction failed for ${company.name}: ${err.message}`);
        }),
        extractYoeForNewListings(newListingIds).catch((err) => {
          console.warn(`[scheduler] YOE extraction failed for ${company.name}: ${err.message}`);
        }),
      ]);

      // Read back YOE values and populate on Job objects for email filtering
      const sb = (await import("./storage/supabase")).getSupabaseClient();
      const { data: yoeRows } = await sb
        .from("job_listings")
        .select("id, yoe_min, yoe_max")
        .in("id", newListingIds);
      if (yoeRows) {
        const yoeMap = new Map(yoeRows.map((r: any) => [r.id, { min: r.yoe_min, max: r.yoe_max }]));
        for (const j of dedupedJobs) {
          if (j.supabaseId && yoeMap.has(j.supabaseId)) {
            const yoe = yoeMap.get(j.supabaseId)!;
            j.yoeMin = yoe.min;
            j.yoeMax = yoe.max;
          }
        }
      }
    }

    if (!failedCompanyNames.has(company.name)) {
      listingsDeactivated += await deactivateUnseen(company.id, runStartedAt);
    }
  }

  return { listingsNew, listingsUpdated, listingsDeactivated, newRoleUrls };
}

function buildPendingBuffer(
  runId:            string,
  runStartedAt:     Date,
  jobs:             Job[],
  companyMap:       Map<string, CompanyConfig & { id: string }>,
  failedCompanyNames: Set<string>,
  companiesScanned: number,
  companiesFailed:  number,
): PendingRunBuffer {
  const listings: BufferedListing[]    = [];
  const successfulCompanyIds: string[] = [];

  for (const [, entry] of companyMap) {
    if (!failedCompanyNames.has(entry.name)) {
      successfulCompanyIds.push(entry.id);
    }
  }

  for (const job of jobs) {
    const company = companyMap.get(job.company);
    if (!company) continue;
    const l = jobToListingToUpsert(job, company);
    listings.push({
      companyId:            company.id,
      companySlug:          l.company.slug,
      companyName:          company.name,
      companyDomainTags:    [],
      companyTargetRoles:   company.roles,
      companyHasApmProgram: false,
      job:                  l.job,
      enrichment:           l.enrichment,
      tier:                 l.tier,
    });
  }

  return {
    runId,
    bufferedAt:           new Date().toISOString(),
    runStartedAt:         runStartedAt.toISOString(),
    configVersion:        undefined,
    configHash:           undefined,
    successfulCompanyIds,
    listings,
    summary: {
      status:              companiesFailed > 0 ? "partial" : "completed",
      companiesScanned,
      companiesFailed,
      listingsFound:       jobs.length,
      listingsNew:         0,
      listingsUpdated:     0,
      listingsDeactivated: 0,
    },
  };
}

// ── Public run interface ──────────────────────────────────────────────────────

export interface ScanRunResult {
  runId:            string;
  newJobs:          Job[];
  totalJobs:        number;
  companiesScanned: number;
  errors:           number;
  startedAt:        Date;
  completedAt:      Date;
}

/**
 * Run a complete scan: load config → orchestrate (two-pool) → dedup → persist → notify.
 *
 * Requires config/targets.json (or TARGETS_CONFIG_PATH) to be present.
 */
export async function runScanOnce(runId?: string): Promise<ScanRunResult> {
  const id        = runId ?? `run-${Date.now()}`;
  const startedAt = new Date();

  // ── Startup tasks (before lock — idempotent, low cost) ──────────────────────
  if (isSupabaseConfigured()) {
    await sweepStaleRuns().catch((e: unknown) =>
      console.warn(`[scheduler] sweepStaleRuns: ${e instanceof Error ? e.message : e}`),
    );
    await replayPendingBuffer().catch((e: unknown) =>
      console.warn(`[scheduler] replayPendingBuffer: ${e instanceof Error ? e.message : e}`),
    );
  }

  if (!acquireLock(id)) {
    const msg = `[scheduler] Run ${id} skipped — scan already in progress`;
    console.warn(msg);
    return {
      runId: id, newJobs: [], totalJobs: 0,
      companiesScanned: 0, errors: 0,
      startedAt, completedAt: new Date(),
    };
  }

  console.log(`[scheduler] ── Starting scan run ${id} ──`);

  let supabaseRunId: string | null = null;
  if (isSupabaseConfigured()) {
    supabaseRunId = await startParserRun().catch((e: unknown) => {
      console.warn(`[scheduler] startParserRun failed: ${e instanceof Error ? e.message : e}`);
      return null;
    });
  }

  // Keep a reference to orchestrator results for health alerting
  let orchResult: OrchestratorResult | null = null;

  try {
    const config = loadTargetsConfig();
    if (!config) {
      throw new Error(
        "[scheduler] config/targets.json not found.\n" +
        "Copy config/targets.json.example → config/targets.json and edit it, " +
        "or set TARGETS_CONFIG_PATH to the file location.",
      );
    }

    const enabled = config.companies.filter((c) => c.enabled);
    const total   = enabled.length;
    let   errors  = 0;

    appState.status = {
      state:            "scanning",
      progress:         0,
      total,
      currentCompany:   "",
      currentPool:      "",
      completedAt:      "",
      jobCount:         0,
      errors:           0,
      companyErrors:    [],
      companiesScanned: 0,
      companiesFailed:  0,
      listingsFound:    0,
      runStartedAt:     startedAt.toISOString(),
      scoreProgress:    0,
      scoreTotal:       0,
      scoreLabel:       "",
      scoreCurrent:     "",
    };
    appState.jobs = [];

    // ── Orchestrated two-pool scrape ─────────────────────────────────────────

    orchResult = await orchestrateRun(config, {
      onProgress: (p) => {
        appState.status.progress          = p.done;
        appState.status.currentCompany    = p.company;
        appState.status.currentPool       = p.pool;
        appState.status.errors            = p.errors;
        appState.status.companiesScanned  = p.scanned;
        appState.status.companiesFailed   = p.failed;
        appState.status.listingsFound     = p.listingsFound;
        errors = p.errors;
        if (p.status === "error" || p.status === "timeout") {
          appState.status.companyErrors.push({
            name:       p.company,
            reason:     p.errorMessage ?? p.status,
            careersUrl: p.careersUrl,
          });
        }
      },
    });

    const { jobs: allJobs, companyResults, stats: orchStats } = orchResult;
    appState.jobs            = allJobs;
    appState.status.jobCount = allJobs.length;

    // ── Local dedup + persist ────────────────────────────────────────────────

    const diffed   = applyJobDiff(allJobs);
    const newJobs  = diffed.filter((j) => j.isNew);
    appState.jobs  = diffed;
    saveJobs(diffed);

    console.log(
      `[scheduler] Scrape complete: ${allJobs.length} total, ` +
      `${newJobs.length} new, ${errors} company errors`,
    );

    // ── JD Extraction ──────────────────────────────────────────────────────────
    //
    // Run before Supabase write so extracted_jd is included in the upsert.
    // Query Supabase for already-extracted URLs to avoid re-extracting.
    // Failures are logged but do not abort the run.

    if (process.env.JD_EXTRACT_ENABLED === "true" && isSupabaseConfigured()) {
      let alreadyExtractedUrls = new Set<string>();

      // Fetch URLs that already have extraction data in Supabase
      try {
        const { getSupabaseClient } = await import("./storage/supabase");
        const supabase = getSupabaseClient();
        const { data: extracted } = await supabase
          .from("job_listings")
          .select("role_url")
          .not("extracted_at", "is", null);

        for (const row of extracted ?? []) {
          alreadyExtractedUrls.add(normalizeRoleUrl(row.role_url as string));
        }
      } catch (err) {
        console.warn("[scheduler] Could not fetch extracted URLs — will extract all jobs");
      }

      const unextractedJobs = diffed.filter(
        (j) => !alreadyExtractedUrls.has(normalizeRoleUrl(j.applyUrl)),
      );

      if (unextractedJobs.length > 0) {
        const JD_EXTRACT_CONCURRENCY = 3;
        const extractQueue = [...unextractedJobs];
        let extractOk = 0;
        let extractFail = 0;

        // Build company→ats lookup for extraction metadata
        const atsLookup = new Map<string, string>();
        for (const c of config.companies) {
          atsLookup.set(c.name, c.ats);
        }

        const extractWorker = async (): Promise<void> => {
          while (true) {
            const job = extractQueue.shift();
            if (!job) break;
            try {
              const result = await extractJD({
                rawHtml:     job.description || undefined,
                jobTitle:    job.title,
                companyName: job.company,
                sourceAts:   atsLookup.get(job.company) ?? null,
                sourceUrl:   job.applyUrl,
              });
              job.extractedJD = result;
              extractOk++;
            } catch (err) {
              extractFail++;
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(
                `[scheduler] JD extraction failed for ${job.company} — ${job.title}: ${msg}`,
              );
            }
          }
        };

        await Promise.all(
          Array.from(
            { length: Math.min(JD_EXTRACT_CONCURRENCY, extractQueue.length) },
            extractWorker,
          ),
        );

        console.log(
          `[scheduler] JD extraction: ${extractOk} succeeded, ${extractFail} failed ` +
          `(of ${unextractedJobs.length} unextracted jobs)`,
        );
      } else {
        console.log("[scheduler] JD extraction: all jobs already extracted");
      }
    }

    // ── Airtable upsert (legacy) ─────────────────────────────────────────────

    const upsert = await upsertJobs(diffed, id);
    if (upsert.buffered) {
      console.warn("[scheduler] Airtable upsert buffered — will retry on next run");
    }
    await markStaleJobs(7);

    // ── Supabase write path ──────────────────────────────────────────────────
    //
    // Run BEFORE notification dispatch so we can use Supabase's authoritative
    // seen_state='new' to determine which jobs to include in the digest.

    // supabaseNewRoleUrls: normalized role_urls that Supabase classified as 'new'.
    // null means Supabase is not configured or the write failed — fall back to local diff.
    let supabaseNewRoleUrls: Set<string> | null = null;

    if (isSupabaseConfigured()) {
      const companyMap  = buildCompanyMap(config);
      const failedNames = new Set<string>(
        companyResults
          .filter((r) => r.status === "error" || r.status === "timeout")
          .map((r) => r.name),
      );
      const effectiveRunId = supabaseRunId ?? id;

      try {
        const { listingsNew, listingsUpdated, listingsDeactivated, newRoleUrls } =
          await writeToSupabase(diffed, companyMap, failedNames, effectiveRunId, startedAt);

        supabaseNewRoleUrls = newRoleUrls;

        console.log(
          `[scheduler] Supabase: ${listingsNew} new, ${listingsUpdated} updated, ` +
          `${listingsDeactivated} deactivated`,
        );

        if (supabaseRunId) {
          await finalizeParserRun(supabaseRunId, {
            status:              errors > 0 ? "partial" : "completed",
            companiesScanned:    orchStats.scanned,
            companiesFailed:     orchStats.errors,
            listingsFound:       diffed.length,
            listingsNew,
            listingsUpdated,
            listingsDeactivated,
          });
        }
      } catch (supaErr: unknown) {
        const msg = supaErr instanceof Error ? supaErr.message : String(supaErr);
        console.error(`[scheduler] Supabase write failed — buffering: ${msg}`);

        bufferRun(
          buildPendingBuffer(
            effectiveRunId, startedAt, diffed, companyMap, failedNames,
            orchStats.scanned, orchStats.errors,
          ),
        );

        if (supabaseRunId) {
          await finalizeParserRun(supabaseRunId, {
            status:              "failed",
            companiesScanned:    orchStats.scanned,
            companiesFailed:     orchStats.errors,
            listingsFound:       diffed.length,
            listingsNew:         0,
            listingsUpdated:     0,
            listingsDeactivated: 0,
            errorMessage:        msg,
            notes:               "Results buffered to data/pending-supabase.json",
          }).catch(() => { /* best-effort */ });
        }
      }
    }

    // ── Determine the authoritative "new jobs" set for this run ─────────────
    //
    // When Supabase write succeeded, use its seen_state='new' classification
    // (keyed on normalized role_url) — this prevents duplicates across scans.
    // Fall back to the local applyJobDiff result when Supabase is not in use.

    const notificationNewJobsRaw: Job[] = supabaseNewRoleUrls !== null
      ? diffed.filter((j) => {
          const normalized = normalizeRoleUrl(j.applyUrl);
          if (!supabaseNewRoleUrls!.has(normalized)) return false;

          // 3d — Defensive guard: flag any "new" job whose firstSeenAt predates the run.
          if (j.firstSeenAt) {
            const seenMs  = new Date(j.firstSeenAt).getTime();
            const startMs = startedAt.getTime();
            if (seenMs < startMs - 60_000) {
              console.error(
                `[scheduler] Job marked new but firstSeenAt predates run ` +
                `(runId=${id}, applyUrl=${j.applyUrl}, firstSeenAt=${j.firstSeenAt})`,
              );
              return false;
            }
          }
          return true;
        })
      : newJobs; // local diff fallback

    // Filter: only include jobs where yoe_min <= 3 or NULL (early-career/junior roles)
    const notificationNewJobs = notificationNewJobsRaw.filter((j) => {
      if (j.yoeMin == null) return true;  // NULL = unknown, include
      return j.yoeMin <= 3;
    });

    // ── Finalise app status ──────────────────────────────────────────────────

    const completedAt = new Date();
    appState.status.state           = "done";
    appState.status.completedAt     = completedAt.toISOString();
    appState.status.currentCompany  = "";

    const runStats: RunStats = {
      runId: id,
      startedAt,
      completedAt,
      companiesScanned: total,
      errors,
    };

    // ── Digest notifications ─────────────────────────────────────────────────

    const telegramDigestOn = process.env.NOTIFY_TELEGRAM_DIGEST === "true";
    const emailDigestOn    = process.env.NOTIFY_EMAIL_DIGEST     === "true";

    if (notificationNewJobs.length > 0) {
      await Promise.allSettled([
        sendTelegramDigest(notificationNewJobs, runStats),
        sendEmailDigest(notificationNewJobs, runStats),
      ]);

      // Stdout fallback when all digest channels are disabled
      if (!telegramDigestOn && !emailDigestOn) {
        console.log("\n[scheduler] ── Digest (stdout fallback — no channels enabled) ──");
        console.log(buildEmailText(notificationNewJobs, runStats));
      }
    } else {
      console.log(`[scheduler] Run ${id} complete — no new jobs`);
    }

    // ── Health alert ─────────────────────────────────────────────────────────

    await sendHealthAlert(companyResults, orchStats.durationMs).catch((e: unknown) =>
      console.warn(`[scheduler] Health alert failed: ${e instanceof Error ? e.message : e}`),
    );

    // Stdout fallback for health when Telegram health channel is disabled
    if (process.env.NOTIFY_TELEGRAM_HEALTH !== "true" && hasHealthIssues(companyResults)) {
      console.log("\n[scheduler] ── Health summary (stdout fallback) ──");
      console.log(buildHealthAlertText(companyResults, companyResults, orchStats.durationMs));
    }

    return {
      runId: id, newJobs: notificationNewJobs, totalJobs: diffed.length,
      companiesScanned: total, errors,
      startedAt, completedAt,
    };

  } finally {
    releaseLock();
  }
}

// Scheduling is handled by GitHub Actions (.github/workflows/scan.yml).
// The in-process node-cron scheduler has been removed — use `npm run scan:once`
// or the GitHub Actions workflow_dispatch trigger for manual runs.
