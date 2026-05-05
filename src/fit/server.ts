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

import { getSupabaseClient } from "../storage/supabase";
import { splitCompoundQualifications } from "../jdExtractor";
import { generateCoverLetter, buildCoverLetterDocx } from "./coverLetterGenerator";
import { handleDashboard } from "./dashboard";
import { generateResume } from "./generateResume";
import { handleTracker, handleTrackerUpdate } from "./tracker";
import { renderFitPage } from "./render";
import { optimizeSkills } from "./skillsOptimizer";
import { generateSummaryCandidates } from "./summaryGenerator";
import {
  ScoreRequestBodyZ,
  ScoreResponseZ,
  SelectRequestBodyZ,
  SelectResponseZ,
  GenerateRequestBodyZ,
} from "./types";

// In-memory store of generated file paths per jobId (single-user, ephemeral)
const generatedFiles = new Map<string, { pdfPath: string; docxPath: string }>();

const app = express();
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
        role_url, ats_platform,
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
    const resumeData = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../config/master_resume.json"), "utf-8"),
    );
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
        console.log(`[fit] Cache hit for jobId=${jobId}`);
        const scoreResp = cached.score_response as any;
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
    }

    // ---- Cache miss or force_refresh — compute from scratch ----
    console.log(`[fit] Cache miss for jobId=${jobId}, computing...`);

    // Kick off Python scorer + job row fetch + resume load in parallel
    const pyAbort = new AbortController();
    const pyTimer = setTimeout(() => pyAbort.abort(), 15_000); // 15s hard kill
    const pyScoreP = fetch(`${BULLET_SELECTOR_URL}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        force_refresh: body.force_refresh,
      }),
      signal: pyAbort.signal as any,
      timeout: 15_000, // 15s — covers response timeout too
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
        jd_role_context, jd_extracted_skills,
        company:companies!inner(name)
      `)
      .eq("id", jobId)
      .single();

    const masterResume = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../config/master_resume.json"), "utf-8"),
    );
    const bulletMap = new Map<string, string>();
    for (const exp of masterResume.experiences || []) {
      for (const b of exp.bullets || []) bulletMap.set(b.id, b.text);
    }
    for (const proj of masterResume.projects || []) {
      for (const b of proj.bullets || []) bulletMap.set(b.id, b.text);
    }

    // Wait for parallel fetches
    const [validated, { data: jobRow }] = await Promise.all([pyScoreP, jobRowP]);

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

    // Generate summary + optimize skills in parallel (skills doesn't need bullet texts)
    const [summaryResult, skillsResult] = await Promise.all([
      generateSummaryCandidates(jdText, selectedBulletTexts),
      Promise.resolve(optimizeSkills(
        masterResume.skills || [],
        selectedBulletTexts,
        jobRow?.jd_skills,
        jobRow?.jd_ats_keywords,
        jobRow?.jd_required_qualifications as string[] || [],
        jobRow?.jd_preferred_qualifications as string[] || [],
        jobRow?.jd_extracted_skills as string[] || undefined,
      )),
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

    // ---- Save to cache ----
    const { job_id, model_version, system_prompt_hash, ranked_candidates, final_selection, pre_resolved } = validated;
    await supabase
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

    const result = await generateResume(jobId, body.selections, undefined, body.email, body.summaryHints, body.customSkills, body.skillEdits);

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

    const masterResume = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../config/master_resume.json"), "utf-8"),
    );

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
