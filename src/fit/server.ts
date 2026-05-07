/**
 * Express web server for the "Check Fit" resume tailoring flow.
 *
 * Routes:
 *   GET  /dashboard                 — Analytics dashboard
 *   GET  /fit/:jobId                — Render Fit page (server-rendered)
 *   POST /fit/:jobId/score          — Proxy to Python /score
 *   POST /fit/:jobId/select         — Proxy to Python /select
 *   POST /fit/:jobId/generate       — Compose payload, regen summary, fill_resume
 *   GET  /fit/:jobId/download/pdf   — Stream generated PDF
 *   GET  /fit/:jobId/download/docx  — Stream generated DOCX
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

// Only load .env file in local dev (Railway injects env vars directly)
if (!process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_PROJECT_ID) {
  require("dotenv").config();
}
// Debug: log which critical env vars are available
console.log("[fit] env check:", {
  SUPABASE_URL: process.env.SUPABASE_URL ? "set" : "MISSING",
  SUPABASE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? "set" : "MISSING",
  FIT_TOKEN_SECRET: process.env.FIT_TOKEN_SECRET ? "set" : "MISSING",
  OPENAI_KEY: process.env.OPENAI_KEY ? "set" : "MISSING",
  DASHBOARD_TOKEN: process.env.DASHBOARD_TOKEN ? "set" : "MISSING",
  RAILWAY: process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || "not railway",
});

import express, { Request, Response, NextFunction } from "express";
import fetch from "node-fetch";

import { getSupabaseClient, loadMasterResume } from "../storage/supabase";
import { splitCompoundQualifications } from "../jdExtractor";
import { generateCoverLetter, buildCoverLetterDocx } from "./coverLetterGenerator";
import { handleDashboard } from "./dashboard";
import { generateResume } from "./generateResume";
import { handleTracker, handleTrackerUpdate } from "./tracker";
import { renderFitPage } from "./render";
import { submitJobUrl, SubmitUrlError } from "./submitUrl";
import { renderSubmitUrlPage } from "./submitUrlRender";
import { optimizeSkills } from "./skillsOptimizer";
import { generateSummaryCandidates } from "./summaryGenerator";
import {
  ScoreRequestBodyZ,
  ScoreResponseZ,
  SelectRequestBodyZ,
  SelectResponseZ,
  GenerateRequestBodyZ,
  RewriteBulletRequestBodyZ,
  MatchRequirementRequestBodyZ,
} from "./types";
import { rewriteBulletSafe } from "./bulletRewriter";
import { matchRequirement } from "./matchRequirement";

// In-memory store of generated file paths per jobId (single-user, ephemeral)
const generatedFiles = new Map<string, { pdfPath: string; docxPath: string }>();

const app = express();

// CORS: allow Next.js dev server on :3000 to call Express on :3847
app.use((_req, res, next) => {
  const origin = _req.headers.origin;
  if (origin && (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1"))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-fit-token, x-tracker-token, x-dashboard-token");
  }
  if (_req.method === "OPTIONS") { res.status(204).end(); return; }
  next();
});

app.use(express.json());

const PORT = parseInt(process.env.PORT || process.env.FIT_PORT || "3847", 10);
const TOKEN_SECRET = process.env.FIT_TOKEN_SECRET || "";
const BULLET_SELECTOR_URL = process.env.BULLET_SELECTOR_URL || "http://127.0.0.1:8001";

if (!TOKEN_SECRET) {
  console.warn("[fit] WARNING: FIT_TOKEN_SECRET is not set. Token verification disabled.");
}

// --------------------------------------------------------------------------- //
//  Token verification
// --------------------------------------------------------------------------- //

function generateToken(jobId: string): string {
  return crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(jobId)
    .digest("hex")
    .slice(0, 32);
}

function verifyToken(req: Request, res: Response, next: NextFunction): void {
  if (!TOKEN_SECRET) {
    next();
    return;
  }

  const jobId = req.params.jobId;
  const token = (req.query.token as string) || (req.headers["x-fit-token"] as string) || "";
  const expected = generateToken(jobId);

  if (token !== expected) {
    console.warn(`[fit] 401 token mismatch for jobId=${jobId}, token=***`);
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  next();
}

// --------------------------------------------------------------------------- //
//  Logging middleware
// --------------------------------------------------------------------------- //

app.use("/fit/:jobId", (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(JSON.stringify({
      jobId: req.params.jobId,
      route: req.path,
      method: req.method,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
    }));
  });
  next();
});

// --------------------------------------------------------------------------- //
//  Health check
// --------------------------------------------------------------------------- //

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, version: process.env.npm_package_version || "1.0.0" });
});

// --------------------------------------------------------------------------- //
//  Jobs list (JSON API for Next.js frontend)
// --------------------------------------------------------------------------- //

app.get("/api/jobs", async (req: Request, res: Response) => {
  const dashToken = process.env.DASHBOARD_TOKEN || "";
  if (!dashToken) { res.status(500).json({ error: "DASHBOARD_TOKEN not configured" }); return; }
  const token = (req.query.token as string) || "";
  if (token !== dashToken) { res.status(401).json({ error: "Invalid token" }); return; }

  try {
    const supabase = getSupabaseClient();
    const { data: listings, error } = await supabase
      .from("job_listings")
      .select(`
        id, title, role_url, location_city, location_raw,
        is_remote, is_hybrid, ats_platform, posted_date, first_seen_at,
        is_active, tier, yoe_min, yoe_max, salary_min, salary_max,
        company:companies!inner(name, slug, has_apm_program)
      `)
      .order("first_seen_at", { ascending: false })
      .limit(2000);

    if (error) { res.status(500).json({ error: error.message }); return; }

    const jobs = (listings || []).map((l: any) => ({
      id: l.id,
      title: l.title,
      companyName: (l.company as any)?.name || "Unknown",
      companySlug: (l.company as any)?.slug || "",
      locationCity: l.location_city,
      isRemote: l.is_remote,
      isHybrid: l.is_hybrid,
      atsPlatform: l.ats_platform,
      postedDate: l.posted_date,
      firstSeenAt: l.first_seen_at,
      isActive: l.is_active,
      tier: l.tier,
      yoeMin: l.yoe_min,
      yoeMax: l.yoe_max,
      roleUrl: l.role_url,
      hasApmProgram: (l.company as any)?.has_apm_program ?? false,
    }));

    res.json({ jobs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------------------- //
//  Application detail (JSON API for Next.js frontend)
// --------------------------------------------------------------------------- //

app.get("/api/applications/:id", async (req: Request, res: Response) => {
  const dashToken = process.env.DASHBOARD_TOKEN || "";
  if (!dashToken) { res.status(500).json({ error: "DASHBOARD_TOKEN not configured" }); return; }
  const token = (req.query.token as string) || (req.headers["x-tracker-token"] as string) || "";
  if (token !== dashToken) { res.status(401).json({ error: "Invalid token" }); return; }

  try {
    const supabase = getSupabaseClient();
    const { data: appData, error } = await supabase
      .from("applications")
      .select(`
        id, listing_id, status, applied_date, applied_by,
        referral_contact, notes, email_used, is_referral, referrer_name,
        created_at, updated_at,
        listing:job_listings!inner(
          id, title, role_url, location_city, location_raw,
          is_remote, is_hybrid, ats_platform, posted_date, first_seen_at,
          tier, jd_job_title, jd_company_name,
          company:companies!inner(name, slug)
        )
      `)
      .eq("id", req.params.id)
      .single();

    if (error || !appData) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    const { data: fitCache } = await supabase
      .from("fit_score_cache")
      .select("score_response")
      .eq("listing_id", appData.listing_id)
      .maybeSingle();

    const fitScore = (fitCache?.score_response as any)?.final_selection?.total_score ?? null;

    res.json({
      ...appData,
      listing: {
        ...(appData.listing as any),
        companyName: ((appData.listing as any)?.company as any)?.name || "Unknown",
        companySlug: ((appData.listing as any)?.company as any)?.slug || "",
      },
      fitScore,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------------------- //
//  Serve static client.js
// --------------------------------------------------------------------------- //

app.get("/fit/client.js", (_req: Request, res: Response) => {
  const jsPath = path.join(__dirname, "client.js");
  // In dev, try src/ path; in prod, try dist/ path
  const srcPath = path.resolve(__dirname, "../../src/fit/client.js");
  const filePath = fs.existsSync(jsPath) ? jsPath : srcPath;
  res.setHeader("Content-Type", "application/javascript");
  fs.createReadStream(filePath).pipe(res);
});

// --------------------------------------------------------------------------- //
//  Serve dashboard client.js + dashboard route
// --------------------------------------------------------------------------- //

app.get("/dashboard/client.js", (_req: Request, res: Response) => {
  const jsPath = path.join(__dirname, "dashboardClient.js");
  const srcPath = path.resolve(__dirname, "../../src/fit/dashboardClient.js");
  const filePath = fs.existsSync(jsPath) ? jsPath : srcPath;
  res.setHeader("Content-Type", "application/javascript");
  fs.createReadStream(filePath).pipe(res);
});

app.get("/dashboard", handleDashboard);

// --------------------------------------------------------------------------- //
//  Tracker routes
// --------------------------------------------------------------------------- //

app.get("/tracker/client.js", (_req: Request, res: Response) => {
  const jsPath = path.join(__dirname, "trackerClient.js");
  const srcPath = path.resolve(__dirname, "../../src/fit/trackerClient.js");
  const filePath = fs.existsSync(jsPath) ? jsPath : srcPath;
  res.setHeader("Content-Type", "application/javascript");
  fs.createReadStream(filePath).pipe(res);
});

app.get("/tracker", handleTracker);
app.patch("/tracker/api/applications/:id", express.json(), handleTrackerUpdate);

// --------------------------------------------------------------------------- //
//  GET /fit/new — Submit URL form page
//  POST /fit/submit-url — Process submitted URL
//  (Must be above /fit/:jobId so Express doesn't match "new" as a jobId)
// --------------------------------------------------------------------------- //

const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || "";

function verifyDashboardToken(req: Request, res: Response, next: NextFunction): void {
  if (!DASHBOARD_TOKEN) { next(); return; }
  const token = (req.query.token as string) || (req.headers["x-dashboard-token"] as string) || "";
  if (token !== DASHBOARD_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

app.get("/fit/new", verifyDashboardToken, (_req: Request, res: Response) => {
  res.send(renderSubmitUrlPage(DASHBOARD_TOKEN));
});

app.post("/fit/submit-url", verifyDashboardToken, async (req: Request, res: Response) => {
  const url = req.body?.url;
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Missing or invalid 'url' field" });
    return;
  }

  try {
    const result = await submitJobUrl(url.trim());
    const fitToken = generateToken(result.jobId);
    res.json({
      jobId: result.jobId,
      token: fitToken,
      existing: result.existing,
      redirectUrl: `/fit/${result.jobId}?token=${fitToken}`,
    });
  } catch (err: any) {
    if (err instanceof SubmitUrlError) {
      res.status(err.statusCode).json({ error: err.message, detail: err.detail });
    } else {
      console.error("[fit] submit-url error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// --------------------------------------------------------------------------- //
//  GET /fit/:jobId — Render Fit page
// --------------------------------------------------------------------------- //

app.get("/fit/:jobId", verifyToken, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId;
    const token = (req.query.token as string) || "";
    const supabase = getSupabaseClient();

    const { data: job, error } = await supabase
      .from("job_listings")
      .select(`
        id, title, location_raw, location_city, is_remote, is_hybrid,
        role_url, ats_platform, posted_date, first_seen_at,
        jd_job_title, jd_company_name, jd_required_qualifications,
        jd_preferred_qualifications, jd_role_context,
        company:companies!inner(name, slug)
      `)
      .eq("id", jobId)
      .single();

    if (error || !job) {
      res.status(404).send("Job not found");
      return;
    }

    // Load emails from master resume
    const resumeData = await loadMasterResume();
    const emails: string[] = resumeData.contact?.emails || ["krithiksaisreenishgopinath@gmail.com"];

    // Check application status
    const { data: appStatus } = await supabase
      .from("applications")
      .select("status, applied_by, applied_date")
      .eq("listing_id", jobId)
      .maybeSingle();

    const html = renderFitPage({
      jobId,
      token,
      companyName: (job.company as any)?.name || job.jd_company_name || "Unknown",
      title: job.jd_job_title || job.title,
      location: job.location_city || job.location_raw || "",
      isRemote: job.is_remote,
      isHybrid: job.is_hybrid,
      ats: job.ats_platform || "",
      postedDate: job.posted_date || null,
      firstSeenAt: job.first_seen_at || null,
      roleUrl: job.role_url,
      requiredQuals: splitCompoundQualifications((job.jd_required_qualifications as string[]) || []),
      preferredQuals: splitCompoundQualifications((job.jd_preferred_qualifications as string[]) || []),
      emails,
      applicationStatus: appStatus ? {
        applied: appStatus.status === "applied",
        appliedBy: appStatus.applied_by || "",
        appliedDate: appStatus.applied_date || "",
        status: appStatus.status,
      } : null,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err: any) {
    console.error("[fit] render error:", err.message);
    res.status(500).send("Internal error");
  }
});

// --------------------------------------------------------------------------- //
//  POST /fit/:jobId/score — Proxy to Python /score
// --------------------------------------------------------------------------- //

app.post("/fit/:jobId/score", verifyToken, async (req: Request, res: Response) => {
  try {
    const body = ScoreRequestBodyZ.parse(req.body);
    const jobId = req.params.jobId;
    const supabase = getSupabaseClient();

    // ---- Check cache first ----
    if (!body.force_refresh) {
      const { data: cached } = await supabase
        .from("fit_score_cache")
        .select("*")
        .eq("listing_id", jobId)
        .maybeSingle();

      if (cached) {
        const scoreResp = cached.score_response as any;
        const hasRealData = scoreResp?.ranked_candidates?.length > 0 ||
                            scoreResp?.pre_resolved?.length > 0;
        if (hasRealData) {
          console.log(`[fit] Cache hit for jobId=${jobId}`);
          res.json({
            ...scoreResp,
            summary_candidates: cached.summary_candidates,
            summary_recommended: cached.summary_recommended,
            summary_jd_analysis: cached.summary_jd_analysis,
            optimized_skills: cached.optimized_skills,
            skills_gap_filled: cached.skills_gap_filled,
            skills_gap_remaining: cached.skills_gap_remaining,
          });
          return;
        }
        console.log(`[fit] Cache hit for jobId=${jobId} has empty data, recomputing...`);
      }
    }

    // ---- Cache miss or force_refresh — compute from scratch ----
    console.log(`[fit] Cache miss for jobId=${jobId}, computing...`);

    // Kick off Python scorer + job row fetch + resume load in parallel
    const pyAbort = new AbortController();
    const pyTimer = setTimeout(() => pyAbort.abort(), 90_000); // 90s hard kill — cold scores can take 60s+ for embeddings + rerank
    const pyScoreP = fetch(`${BULLET_SELECTOR_URL}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        force_refresh: body.force_refresh,
      }),
      signal: pyAbort.signal as any,
      timeout: 90_000, // 90s — cold scores: embeddings + LLM rerank can take 60s+
    })
      .then(async (pyRes) => {
        clearTimeout(pyTimer);
        if (!pyRes.ok) throw new Error(`Python service returned ${pyRes.status}`);
        return ScoreResponseZ.parse(await pyRes.json());
      })
      .catch((pyErr: any) => {
        clearTimeout(pyTimer);
        console.log(`[fit] Python unavailable (${pyErr.message}), using Node-native scoring`);
        return {
          job_id: jobId,
          model_version: "node-native",
          system_prompt_hash: "none",
          ranked_candidates: [] as any[],
          final_selection: { selected_bullets: [] as any[], uncovered_qualifications: [] as any[], total_score: 0, source_utilization: {} },
          pre_resolved: [] as any[],
        };
      });

    const jobRowP = supabase
      .from("job_listings")
      .select(`
        title, jd_job_title, jd_company_name, jd_skills, jd_ats_keywords,
        jd_required_qualifications, jd_preferred_qualifications,
        jd_responsibilities, jd_role_context, jd_extracted_skills,
        company:companies!inner(name)
      `)
      .eq("id", jobId)
      .single();

    const masterResume = await loadMasterResume();
    const bulletMap = new Map<string, string>();
    for (const exp of masterResume.experiences || []) {
      for (const b of exp.bullets || []) bulletMap.set(b.id, b.text);
    }
    for (const proj of masterResume.projects || []) {
      for (const b of proj.bullets || []) bulletMap.set(b.id, b.text);
    }

    // Wait for parallel fetches
    const [validated, { data: jobRow }] = await Promise.all([pyScoreP, jobRowP]);

    // Bail early if scorer returned nothing — no point generating summary/skills
    if (validated.ranked_candidates.length === 0 && validated.pre_resolved.length === 0) {
      console.error(`[fit] Scoring produced no candidates for jobId=${jobId} (Python scorer likely unreachable)`);
      res.status(503).json({ error: "Bullet scoring service unavailable. Please try again later." });
      return;
    }

    const selectedBulletTexts = validated.final_selection.selected_bullets
      .map((sb: any) => bulletMap.get(sb.bullet_id) || "")
      .filter(Boolean);

    // Build JD text for summary prompt
    const jdTitle = jobRow?.jd_job_title || jobRow?.title || "";
    const companyName = (jobRow?.company as any)?.name || jobRow?.jd_company_name || "";
    const reqQuals = (jobRow?.jd_required_qualifications as string[] || []).slice(0, 5);
    const roleContext = (jobRow?.jd_role_context as any)?.summary || "";
    const jdText = [
      `Title: ${jdTitle}`,
      `Company: ${companyName}`,
      reqQuals.length > 0 ? `Key requirements: ${reqQuals.join("; ")}` : "",
      roleContext ? `About: ${roleContext}` : "",
    ].filter(Boolean).join("\n");

    // Generate summary + optimize skills in parallel
    const [summaryResult, skillsResult] = await Promise.all([
      generateSummaryCandidates(jdText, selectedBulletTexts),
      optimizeSkills(
        masterResume.skills || [],
        selectedBulletTexts,
        jobRow?.jd_skills,
        jobRow?.jd_ats_keywords,
        jobRow?.jd_required_qualifications as string[] || [],
        jobRow?.jd_preferred_qualifications as string[] || [],
        jobRow?.jd_extracted_skills as string[] || undefined,
        jdTitle,
        jobRow?.jd_responsibilities as string[] || [],
      ),
    ]);

    // Build enriched response
    const enrichedResponse = {
      ...validated,
      summary_candidates: summaryResult.candidates,
      summary_recommended: summaryResult.recommended,
      summary_jd_analysis: summaryResult.jdAnalysis,
      optimized_skills: skillsResult.lines,
      skills_gap_filled: skillsResult.gapFilled,
      skills_gap_remaining: skillsResult.gapRemaining,
    };

    // ---- Save to cache (only if we got real data) ----
    const { job_id, model_version, system_prompt_hash, ranked_candidates, final_selection, pre_resolved } = validated;
    const hasRealScoreData = ranked_candidates.length > 0 || pre_resolved.length > 0;
    if (hasRealScoreData) await supabase
      .from("fit_score_cache")
      .upsert({
        listing_id: jobId,
        score_response: { job_id, model_version, system_prompt_hash, ranked_candidates, final_selection, pre_resolved },
        summary_candidates: summaryResult.candidates,
        summary_recommended: summaryResult.recommended,
        summary_jd_analysis: summaryResult.jdAnalysis || null,
        optimized_skills: skillsResult.lines,
        skills_gap_filled: skillsResult.gapFilled,
        skills_gap_remaining: skillsResult.gapRemaining,
        model_version: validated.model_version,
      }, { onConflict: "listing_id" })
      .then(({ error }) => {
        if (error) console.error("[fit] Cache write failed:", error.message);
        else console.log(`[fit] Cache saved for jobId=${jobId}`);
      });

    res.json(enrichedResponse);
  } catch (err: any) {
    console.error("[fit] score error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------------------- //
//  POST /fit/:jobId/select — Proxy to Python /select
// --------------------------------------------------------------------------- //

app.post("/fit/:jobId/select", verifyToken, async (req: Request, res: Response) => {
  try {
    const body = SelectRequestBodyZ.parse(req.body);
    const jobId = req.params.jobId;

    const pyRes = await fetch(`${BULLET_SELECTOR_URL}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        user_selections: body.selections.map((s) => ({
          qualification_id: s.qualification_id,
          bullet_id_or_text: s.bullet_id_or_text,
          is_custom: s.is_custom,
        })),
      }),
      timeout: 10_000,
    });

    if (!pyRes.ok) {
      const text = await pyRes.text();
      res.status(pyRes.status).json({ error: text });
      return;
    }

    const data = await pyRes.json();
    const validated = SelectResponseZ.parse(data);
    res.json(validated);
  } catch (err: any) {
    console.error("[fit] select error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------------------- //
//  POST /fit/:jobId/generate — Build resume
// --------------------------------------------------------------------------- //

app.post("/fit/:jobId/generate", verifyToken, async (req: Request, res: Response) => {
  try {
    const body = GenerateRequestBodyZ.parse(req.body);
    const jobId = req.params.jobId;

    const result = await generateResume(jobId, body.selections, undefined, body.email, body.summaryHints, body.customSkills, body.skillEdits, body.skillDeletions, body.newSkillSections);

    generatedFiles.set(jobId, {
      pdfPath: result.pdfPath,
      docxPath: result.docxPath,
    });

    res.json({
      status: "ok",
      basename: result.basename,
      summaryUsed: result.summaryUsed,
      summaryWarning: result.summaryWarning,
    });
  } catch (err: any) {
    console.error("[fit] generate error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------------------- //
//  POST /fit/:jobId/apply — Mark job as applied
// --------------------------------------------------------------------------- //

app.post("/fit/:jobId/apply", verifyToken, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId;
    const { applied_by } = req.body as { applied_by?: string };

    if (!applied_by || !applied_by.trim()) {
      res.status(400).json({ error: "applied_by is required" });
      return;
    }

    const supabase = getSupabaseClient();

    // Check if already applied
    const { data: existing } = await supabase
      .from("applications")
      .select("id, applied_by, applied_date, status")
      .eq("listing_id", jobId)
      .maybeSingle();

    if (existing && existing.status === "applied") {
      res.json({
        ok: true,
        already_applied: true,
        applied_by: existing.applied_by,
        applied_date: existing.applied_date,
      });
      return;
    }

    // Upsert application
    const today = new Date().toISOString().split("T")[0];
    const { error } = await supabase
      .from("applications")
      .upsert({
        listing_id: jobId,
        status: "applied",
        applied_by: applied_by.trim(),
        applied_date: today,
      }, { onConflict: "listing_id" });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    console.log(`[fit] Job ${jobId} marked as applied by ${applied_by.trim()}`);
    res.json({
      ok: true,
      already_applied: false,
      applied_by: applied_by.trim(),
      applied_date: today,
    });
  } catch (err: any) {
    console.error("[fit] apply error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------------------- //
//  POST /fit/:jobId/match-requirement — Match master resume bullets to a requirement
// --------------------------------------------------------------------------- //

app.post("/fit/:jobId/match-requirement", verifyToken, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId;
    const parsed = MatchRequirementRequestBodyZ.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    const { qualification_text, locked_bullet_ids, source_type_filter } = parsed.data;

    const supabase = getSupabaseClient();
    const { data: jobRow } = await supabase
      .from("job_listings")
      .select("jd_ats_keywords, jd_extracted_skills")
      .eq("id", jobId)
      .single();

    const jdKeywords: string[] = [];
    if (jobRow?.jd_ats_keywords) {
      const atsKw = typeof jobRow.jd_ats_keywords === "string"
        ? JSON.parse(jobRow.jd_ats_keywords)
        : jobRow.jd_ats_keywords;
      if (Array.isArray(atsKw)) jdKeywords.push(...atsKw.slice(0, 10));
    }
    if (jobRow?.jd_extracted_skills) {
      const skills = typeof jobRow.jd_extracted_skills === "string"
        ? JSON.parse(jobRow.jd_extracted_skills)
        : jobRow.jd_extracted_skills;
      if (Array.isArray(skills)) jdKeywords.push(...skills.slice(0, 10));
    }
    const uniqueKeywords = [...new Set(jdKeywords)].slice(0, 8);

    const result = await matchRequirement(qualification_text, uniqueKeywords, locked_bullet_ids, source_type_filter);
    res.json(result);
  } catch (err: any) {
    console.error("[match-requirement] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------------------- //
//  POST /fit/:jobId/rewrite-bullet — Rewrite a single bullet with JD keywords
// --------------------------------------------------------------------------- //

app.post("/fit/:jobId/rewrite-bullet", verifyToken, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId;
    const parsed = RewriteBulletRequestBodyZ.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    const { bullet_id, bullet_text, target_qualification, keywords_to_embed } = parsed.data;

    const supabase = getSupabaseClient();
    const { data: jobRow } = await supabase
      .from("job_listings")
      .select("jd_ats_keywords, jd_extracted_skills")
      .eq("id", jobId)
      .single();

    const jdKeywords: string[] = [];
    if (jobRow?.jd_ats_keywords) {
      const atsKw = typeof jobRow.jd_ats_keywords === "string"
        ? JSON.parse(jobRow.jd_ats_keywords)
        : jobRow.jd_ats_keywords;
      if (Array.isArray(atsKw)) jdKeywords.push(...atsKw.slice(0, 10));
    }
    const allKeywords = [...new Set([...keywords_to_embed, ...jdKeywords])].slice(0, 5);

    const result = await rewriteBulletSafe({
      bulletId: bullet_id,
      bulletText: bullet_text,
      targetQualification: target_qualification,
      keywordsToEmbed: allKeywords,
      bannedPhrases: [
        "responsible for", "helped with", "worked on", "assisted in",
        "participated in", "in charge of", "tasked with", "duties included",
      ],
      preferredVerbs: [
        "shipped", "launched", "drove", "owned", "scaled", "defined",
        "prioritized", "led", "architected", "delivered", "built", "reduced",
        "increased", "accelerated",
      ],
      acronymsToSpellOut: {},
      acronymsToKeep: [],
    });

    res.json({
      suggestions: [{
        text: result.text,
        char_count: result.text.length,
        keywords_embedded: result.keywordsEmbedded,
        was_rewritten: result.wasRewritten,
      }],
    });
  } catch (err: any) {
    console.error("[rewrite-bullet] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------------------- //
//  POST /fit/:jobId/cover-letter — Generate cover letter
// --------------------------------------------------------------------------- //

app.post("/fit/:jobId/cover-letter", verifyToken, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId;
    const { bulletTexts, email } = req.body as { bulletTexts?: string[]; email?: string };

    const supabase = getSupabaseClient();
    const { data: jobRow } = await supabase
      .from("job_listings")
      .select(`
        title, jd_job_title, jd_company_name,
        jd_required_qualifications, jd_preferred_qualifications,
        jd_role_context, jd_responsibilities,
        company:companies!inner(name)
      `)
      .eq("id", jobId)
      .single();

    if (!jobRow) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const masterResume = await loadMasterResume();

    const companyName = (jobRow.company as any)?.name || jobRow.jd_company_name || "Unknown";
    const roleTitle = jobRow.jd_job_title || jobRow.title;

    // Build JD text
    const reqQuals = (jobRow.jd_required_qualifications as string[] || []);
    const prefQuals = (jobRow.jd_preferred_qualifications as string[] || []);
    const responsibilities = (jobRow.jd_responsibilities as string[] || []);
    const roleContext = (jobRow.jd_role_context as any)?.summary || "";

    const jdText = [
      `Title: ${roleTitle}`,
      `Company: ${companyName}`,
      responsibilities.length > 0 ? `Responsibilities:\n- ${responsibilities.join("\n- ")}` : "",
      reqQuals.length > 0 ? `Required Qualifications:\n- ${reqQuals.join("\n- ")}` : "",
      prefQuals.length > 0 ? `Preferred Qualifications:\n- ${prefQuals.join("\n- ")}` : "",
      roleContext ? `About: ${roleContext}` : "",
    ].filter(Boolean).join("\n\n");

    const contact = masterResume.contact;
    const result = await generateCoverLetter(
      {
        name: contact.name,
        location: contact.location,
        phone: contact.phone,
        email: email || contact.emails?.[0] || "krithiksaisreenishgopinath@gmail.com",
        linkedin: contact.linkedin_url,
        github: contact.github_url,
        website: contact.website_url,
      },
      companyName,
      roleTitle,
      jdText,
      bulletTexts || [],
    );

    // Build DOCX
    if (result.letter && result.wordCount > 0) {
      const docxPath = await buildCoverLetterDocx(result.letter, companyName, roleTitle);
      result.docxPath = docxPath;
      // Store for download
      generatedFiles.set(`cover-${jobId}`, { pdfPath: "", docxPath });
    }

    res.json(result);
  } catch (err: any) {
    console.error("[fit] cover-letter error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------------------- //
//  POST /fit/:jobId/outreach — Unified outreach generation
// --------------------------------------------------------------------------- //

import { composeOutreach } from "./outreach/composer";
import { OutreachModeZ } from "./outreach/types";

app.post("/fit/:jobId/outreach", verifyToken, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId;
    const { mode, personIntel, email } = req.body as { mode?: string; personIntel?: any; email?: string };

    const parsedMode = OutreachModeZ.safeParse(mode);
    if (!parsedMode.success) {
      res.status(400).json({ error: "Invalid mode. Must be: cover_letter, linkedin_referral_peer, linkedin_referral_open_to_connect, or linkedin_hiring_manager" });
      return;
    }

    const result = await composeOutreach({
      jobId,
      mode: parsedMode.data,
      personIntel: personIntel ? { text: personIntel.text, name: personIntel.name, title: personIntel.title } : undefined,
      email,
    });

    if (result.skip) {
      res.json({ skip: true, reason: result.reason });
      return;
    }

    // Store DOCX path for download if cover letter
    if (result.docxPath) {
      generatedFiles.set(`outreach-${jobId}`, { pdfPath: "", docxPath: result.docxPath });
    }

    res.json({
      skip: false,
      text: result.result.text,
      hook: result.result.hook,
      mode: result.result.mode,
      wordCount: result.result.wordCount,
      downloadUrl: result.docxPath ? `/fit/${jobId}/download/outreach?token=${(req.query.token as string) || ""}` : undefined,
    });
  } catch (err: any) {
    console.error("[fit] outreach error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------------------- //
//  POST /fit/:jobId/outreach/download — Build DOCX from edited text
// --------------------------------------------------------------------------- //

app.post("/fit/:jobId/outreach/download", verifyToken, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId;
    const { text } = req.body as { text?: string };

    if (!text) {
      res.status(400).json({ error: "Missing text field" });
      return;
    }

    const supabase = getSupabaseClient();
    const { data: job } = await supabase
      .from("job_listings")
      .select("title, jd_job_title, jd_company_name, company:companies!inner(name)")
      .eq("id", jobId)
      .single();

    const companyName = (job?.company as any)?.name || job?.jd_company_name || "Unknown";
    const roleName = job?.jd_job_title || job?.title || "PM";

    const docxPath = await buildCoverLetterDocx(text, companyName, roleName);
    generatedFiles.set(`outreach-${jobId}`, { pdfPath: "", docxPath });

    const token = (req.query.token as string) || "";
    res.json({ downloadUrl: `/fit/${jobId}/download/outreach?token=${token}` });
  } catch (err: any) {
    console.error("[fit] outreach download error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------------------- //
//  GET /fit/:jobId/download/outreach — Stream outreach DOCX
// --------------------------------------------------------------------------- //

app.get("/fit/:jobId/download/outreach", verifyToken, (req: Request, res: Response) => {
  const { jobId } = req.params;
  const files = generatedFiles.get(`outreach-${jobId}`);
  if (!files || !files.docxPath || !fs.existsSync(files.docxPath)) {
    res.status(404).json({ error: "No outreach DOCX generated." });
    return;
  }
  const basename = path.basename(files.docxPath);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${basename}"`);
  fs.createReadStream(files.docxPath).pipe(res);
});

// --------------------------------------------------------------------------- //
//  POST /fit/:jobId/intel/refresh — Refresh company intel
// --------------------------------------------------------------------------- //

import { refreshCompanyIntel } from "./intel/orchestrator";

app.post("/fit/:jobId/intel/refresh", verifyToken, async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId;
    const supabase = getSupabaseClient();

    // Look up company for this job
    const { data: job } = await supabase
      .from("job_listings")
      .select("company:companies!inner(id, careers_url)")
      .eq("id", jobId)
      .single();

    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const companyId = (job.company as any)?.id;
    const domain = (job.company as any)?.careers_url;

    const result = await refreshCompanyIntel(companyId, { force: true, domain });
    res.json(result);
  } catch (err: any) {
    console.error("[fit] intel refresh error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------------------------------------------- //
//  GET /fit/:jobId/download/cover-letter — Stream cover letter DOCX
// --------------------------------------------------------------------------- //

app.get("/fit/:jobId/download/cover-letter", verifyToken, (req: Request, res: Response) => {
  const { jobId } = req.params;
  const files = generatedFiles.get(`cover-${jobId}`);
  if (!files || !files.docxPath || !fs.existsSync(files.docxPath)) {
    res.status(404).json({ error: "No cover letter generated. Click 'Cover Letter' first." });
    return;
  }
  const basename = path.basename(files.docxPath);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${basename}"`);
  fs.createReadStream(files.docxPath).pipe(res);
});

// --------------------------------------------------------------------------- //
//  GET /fit/:jobId/preview/pdf — Inline PDF for in-browser preview
// --------------------------------------------------------------------------- //

app.get("/fit/:jobId/preview/pdf", verifyToken, (req: Request, res: Response) => {
  const { jobId } = req.params;
  const files = generatedFiles.get(jobId);
  if (!files || !files.pdfPath || !fs.existsSync(files.pdfPath)) {
    res.status(404).json({ error: "No generated resume found. Click Preview to generate first." });
    return;
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "inline");
  fs.createReadStream(files.pdfPath).pipe(res);
});

// --------------------------------------------------------------------------- //
//  GET /fit/:jobId/download/:format — Stream file
// --------------------------------------------------------------------------- //

app.get("/fit/:jobId/download/:format", verifyToken, (req: Request, res: Response) => {
  const { jobId, format } = req.params;
  if (format !== "pdf" && format !== "docx") {
    res.status(400).json({ error: "Format must be pdf or docx" });
    return;
  }

  const files = generatedFiles.get(jobId);
  if (!files) {
    res.status(404).json({ error: "No generated resume found. Run /generate first." });
    return;
  }

  const filePath = format === "pdf" ? files.pdfPath : files.docxPath;
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: `Generated ${format} file not found on disk.` });
    return;
  }

  const mimeType = format === "pdf"
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const basename = path.basename(filePath);

  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${basename}"`);
  fs.createReadStream(filePath).pipe(res);
});

// --------------------------------------------------------------------------- //
//  Start server
// --------------------------------------------------------------------------- //

// --------------------------------------------------------------------------- //
//  Cache sweep: delete generated resumes older than 24h
// --------------------------------------------------------------------------- //

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // check every hour

function sweepGeneratedResumes(): void {
  const outDir = path.resolve(__dirname, "../../out");
  if (!fs.existsSync(outDir)) return;

  const now = Date.now();
  let swept = 0;

  for (const file of fs.readdirSync(outDir)) {
    if (!file.startsWith("Krithik_Gopinath_")) continue;
    const filePath = path.join(outDir, file);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > CACHE_TTL_MS) {
        fs.unlinkSync(filePath);
        swept++;
      }
    } catch { /* ignore */ }
  }

  if (swept > 0) {
    console.log(JSON.stringify({ event: "cache_sweep", swept, dir: outDir }));
  }

  // Also clear stale entries from in-memory map
  for (const [jobId, files] of generatedFiles.entries()) {
    if (!fs.existsSync(files.pdfPath) && !fs.existsSync(files.docxPath)) {
      generatedFiles.delete(jobId);
    }
  }
}

export { app, generateToken };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[fit] Server listening on port ${PORT}`);
    console.log(`[fit] Python service at ${BULLET_SELECTOR_URL}`);
  });

  // Start cache sweep timer
  setInterval(sweepGeneratedResumes, SWEEP_INTERVAL_MS);
  sweepGeneratedResumes();
}
