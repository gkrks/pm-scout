/**
 * Express web server for the "Check Fit" resume tailoring flow.
 *
 * Routes:
 *   GET  /fit/:jobId            — Render Fit page (server-rendered)
 *   POST /fit/:jobId/score      — Proxy to Python /score
 *   POST /fit/:jobId/select     — Proxy to Python /select
 *   POST /fit/:jobId/generate   — Compose payload, regen summary, fill_resume
 *   GET  /fit/:jobId/download/pdf   — Stream generated PDF
 *   GET  /fit/:jobId/download/docx  — Stream generated DOCX
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response, NextFunction } from "express";
import fetch from "node-fetch";

import { getSupabaseClient } from "../storage/supabase";
import { generateCoverLetter } from "./coverLetterGenerator";
import { generateResume } from "./generateResume";
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

const PORT = parseInt(process.env.FIT_PORT || "3847", 10);
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
      requiredQuals: (job.jd_required_qualifications as string[]) || [],
      preferredQuals: (job.jd_preferred_qualifications as string[]) || [],
      emails,
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

    const pyRes = await fetch(`${BULLET_SELECTOR_URL}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        force_refresh: body.force_refresh,
      }),
      timeout: 2_400_000,
    });

    if (!pyRes.ok) {
      const text = await pyRes.text();
      res.status(pyRes.status).json({ error: text });
      return;
    }

    const data = await pyRes.json();
    const validated = ScoreResponseZ.parse(data);

    // Enrich with summary candidates + optimized skills
    const supabase = getSupabaseClient();
    const { data: jobRow } = await supabase
      .from("job_listings")
      .select(`
        title, jd_job_title, jd_company_name, jd_skills, jd_ats_keywords,
        jd_required_qualifications, jd_preferred_qualifications,
        jd_role_context, jd_extracted_skills,
        company:companies!inner(name)
      `)
      .eq("id", jobId)
      .single();

    // Collect recommended bullet texts for summary input
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

    // Generate summary candidates (OpenAI call)
    const summaryResult = await generateSummaryCandidates(jdText, selectedBulletTexts);

    // Compute optimized skills (JD-first: only include skills the JD asks for)
    const skillsResult = optimizeSkills(
      masterResume.skills || [],
      selectedBulletTexts,
      jobRow?.jd_skills,
      jobRow?.jd_ats_keywords,
      jobRow?.jd_required_qualifications as string[] || [],
      jobRow?.jd_preferred_qualifications as string[] || [],
      jobRow?.jd_extracted_skills as string[] || undefined,
    );

    // Return enriched response
    res.json({
      ...validated,
      summary_candidates: summaryResult.candidates,
      summary_recommended: summaryResult.recommended,
      summary_jd_analysis: summaryResult.jdAnalysis,
      optimized_skills: skillsResult.lines,
      skills_gap_filled: skillsResult.gapFilled,
      skills_gap_remaining: skillsResult.gapRemaining,
    });
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

    const result = await generateResume(jobId, body.selections, undefined, body.email);

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

    res.json(result);
  } catch (err: any) {
    console.error("[fit] cover-letter error:", err.message);
    res.status(500).json({ error: err.message });
  }
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
    console.log(`[fit] Server listening on http://127.0.0.1:${PORT}`);
    console.log(`[fit] Python service at ${BULLET_SELECTOR_URL}`);
  });

  // Start cache sweep timer
  setInterval(sweepGeneratedResumes, SWEEP_INTERVAL_MS);
  sweepGeneratedResumes(); // run once on startup
}
