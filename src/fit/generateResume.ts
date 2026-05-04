/**
 * Phase 3: Resume generation integration.
 *
 * 1. Accept selections from the UI
 * 2. Load master_resume.json
 * 3. Apply dynamic 4+2 source selection based on Stage D scores
 * 4. Map selected bullets to template slots
 * 5. Regenerate summary via Groq
 * 6. Write working_resume.json to temp dir
 * 7. Shell out to fill_resume.js --input <path> --out-basename <name>
 * 8. Return file paths
 */

import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import OpenAI from "openai";

import { getSupabaseClient } from "../storage/supabase";
import { slug, resumeBasename } from "./slug";
import type { UserSelection, ScoreResponse } from "./types";

const REPO_ROOT = path.resolve(__dirname, "../..");
const FILL_SCRIPT = path.join(REPO_ROOT, "fill_resume.js");
const MASTER_RESUME_PATH = path.join(REPO_ROOT, "config/master_resume.json");
const SUMMARY_MAX_CHARS = 340;

interface GenerateResult {
  pdfPath: string;
  docxPath: string;
  basename: string;
  summaryUsed: string;
  summaryWarning: string | null;
}

// --------------------------------------------------------------------------- //
//  Summary regeneration prompt
// --------------------------------------------------------------------------- //

const SUMMARY_SYSTEM_PROMPT = `You are an expert resume writer. Generate a professional summary for an ATS-optimized resume.

HARD RULES (all must pass):
1. Maximum 340 characters including spaces. Not one character more.
2. No em dashes. Use " | " or commas instead.
3. No banned buzzwords: "passionate", "driven", "seasoned", "dynamic", "results-oriented", "self-starter", "guru", "ninja", "rockstar", "synergy".
4. No first-person pronouns: no "I", "my", "me", "myself".
5. No content that duplicates the resume bullets below. The summary adds framing, not repetition.
6. Mirror 2-3 key terms from the job description naturally. Do not keyword-stuff.
7. Lead with an identity noun that matches the role (e.g., "Product manager", "Engineer", "Technical PM").
8. If citing years of experience, use the format "N+ years" (e.g., "5+ years"). Never fabricate years.
9. ASCII-only punctuation. No smart quotes, no unicode dashes, no special characters.

OUTPUT FORMAT:
Return exactly 3 candidates, ranked best to worst. Format:

CANDIDATE 1:
<summary text>

CANDIDATE 2:
<summary text>

CANDIDATE 3:
<summary text>

RECOMMENDED: 1

SELF-CHECK:
1. char_count: PASS/FAIL (<count> chars)
2. no_em_dash: PASS/FAIL
3. no_buzzwords: PASS/FAIL
4. no_first_person: PASS/FAIL
5. no_bullet_duplication: PASS/FAIL
6. jd_mirroring: PASS/FAIL
7. identity_noun_lead: PASS/FAIL
8. years_format: PASS/FAIL
9. ascii_punctuation: PASS/FAIL

Only check the RECOMMENDED candidate in the self-check.`;

// --------------------------------------------------------------------------- //
//  Main generation function
// --------------------------------------------------------------------------- //

export async function generateResume(
  jobId: string,
  selections: UserSelection[],
  scoreData?: ScoreResponse,
): Promise<GenerateResult> {
  // Load master resume
  const masterResume = JSON.parse(fs.readFileSync(MASTER_RESUME_PATH, "utf-8"));

  // Load job data from Supabase
  const supabase = getSupabaseClient();
  const { data: job, error } = await supabase
    .from("job_listings")
    .select(`
      id, title, role_url,
      jd_job_title, jd_company_name,
      jd_required_qualifications, jd_preferred_qualifications,
      jd_role_context, jd_skills, ats_platform,
      company:companies!inner(name, slug)
    `)
    .eq("id", jobId)
    .single();

  if (error || !job) {
    throw new Error(`Job ${jobId} not found: ${error?.message}`);
  }

  const companyName = (job.company as any)?.name || job.jd_company_name || "Unknown";
  const roleName = job.jd_job_title || job.title;

  // Build bullet lookup from master resume
  const bulletMap = new Map<string, { text: string; sourceId: string }>();
  for (const exp of masterResume.experiences || []) {
    for (const b of exp.bullets || []) {
      bulletMap.set(b.id, { text: b.text, sourceId: exp.id });
    }
  }
  for (const proj of masterResume.projects || []) {
    for (const b of proj.bullets || []) {
      bulletMap.set(b.id, { text: b.text, sourceId: proj.id });
    }
  }

  // Resolve selections to bullet texts and source counts
  const sourceBullets = new Map<string, string[]>(); // sourceId -> selected bullet texts
  const selectedBulletTexts: string[] = [];

  for (const sel of selections) {
    let text: string;
    let sourceId: string | null = null;

    if (sel.is_custom) {
      text = sel.bullet_id_or_text;
    } else {
      const found = bulletMap.get(sel.bullet_id_or_text);
      if (found) {
        text = found.text;
        sourceId = found.sourceId;
      } else {
        text = sel.bullet_id_or_text;
      }
    }

    selectedBulletTexts.push(text);
    if (sourceId) {
      const existing = sourceBullets.get(sourceId) || [];
      existing.push(text);
      sourceBullets.set(sourceId, existing);
    }
  }

  // Dynamic 4+2 source selection
  const expSources = masterResume.experiences.map((e: any) => e.id);
  const projSources = masterResume.projects.map((p: any) => p.id);

  // Rank experiences by number of selected bullets (desc), then by original order
  const rankedExps = [...expSources].sort((a: string, b: string) => {
    const countA = (sourceBullets.get(a) || []).length;
    const countB = (sourceBullets.get(b) || []).length;
    if (countB !== countA) return countB - countA;
    return expSources.indexOf(a) - expSources.indexOf(b);
  });
  const selectedExpIds = rankedExps.slice(0, 4);

  const rankedProjs = [...projSources].sort((a: string, b: string) => {
    const countA = (sourceBullets.get(a) || []).length;
    const countB = (sourceBullets.get(b) || []).length;
    if (countB !== countA) return countB - countA;
    return projSources.indexOf(a) - projSources.indexOf(b);
  });
  const selectedProjIds = rankedProjs.slice(0, 2);

  // Build working resume with selected bullets in slots
  const workingResume = JSON.parse(JSON.stringify(masterResume));

  // Reorder experiences to match selected order
  const expMap = new Map(masterResume.experiences.map((e: any) => [e.id, e]));
  workingResume.experiences = selectedExpIds
    .map((id: string) => expMap.get(id))
    .filter(Boolean);

  // For each experience, replace bullets with selected ones + defaults
  for (const exp of workingResume.experiences) {
    const selected = sourceBullets.get(exp.id) || [];
    const defaultBullets = [...exp.bullets]
      .sort((a: any, b: any) => b.text.length - a.text.length)
      .map((b: any) => b.text);

    const finalBullets: string[] = [];
    // First add selected bullets
    for (const text of selected.slice(0, 2)) {
      finalBullets.push(text);
    }
    // Fill remaining slots with defaults
    for (const text of defaultBullets) {
      if (finalBullets.length >= 2) break;
      if (!finalBullets.includes(text)) {
        finalBullets.push(text);
      }
    }

    // Replace bullets array with the final set
    exp.bullets = finalBullets.map((text: string, i: number) => ({
      id: `${exp.id}_tailored_${i}`,
      text,
      format: "XYZ",
      skills: [],
      metrics: [],
      source: "tailored",
    }));
  }

  // Same for projects
  const projMap = new Map(masterResume.projects.map((p: any) => [p.id, p]));
  workingResume.projects = selectedProjIds
    .map((id: string) => projMap.get(id))
    .filter(Boolean);

  for (const proj of workingResume.projects) {
    const selected = sourceBullets.get(proj.id) || [];
    const defaultBullets = [...proj.bullets]
      .sort((a: any, b: any) => b.text.length - a.text.length)
      .filter((b: any) =>
        !b.text.startsWith("v1 architecture") &&
        !b.text.startsWith("v2 database schema") &&
        !b.text.startsWith("Refactored the term-index") &&
        !b.text.startsWith("Tried implementing skip")
      )
      .map((b: any) => b.text);

    const finalBullets: string[] = [];
    for (const text of selected.slice(0, 2)) {
      finalBullets.push(text);
    }
    for (const text of defaultBullets) {
      if (finalBullets.length >= 2) break;
      if (!finalBullets.includes(text)) {
        finalBullets.push(text);
      }
    }

    proj.bullets = finalBullets.map((text: string, i: number) => ({
      id: `${proj.id}_tailored_${i}`,
      text,
      format: "XYZ",
      skills: [],
      metrics: [],
      source: "tailored",
    }));
  }

  // Regenerate summary
  const { summary, warning: summaryWarning } = await regenerateSummary(
    job,
    selectedBulletTexts,
    masterResume,
  );

  // Write working resume to temp dir
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fit-resume-"));
  const workingPath = path.join(tempDir, "working_resume.json");

  // Add summary override to working resume
  (workingResume as any).__summary_override = summary;

  fs.writeFileSync(workingPath, JSON.stringify(workingResume, null, 2));

  // Build output basename
  const basename = resumeBasename(companyName, roleName, jobId);

  // Shell out to fill_resume.js
  const outDir = path.join(REPO_ROOT, "out");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  try {
    execSync(
      `node "${FILL_SCRIPT}" --input "${workingPath}" --out-basename "${basename}" --summary "${summary.replace(/"/g, '\\"')}"`,
      {
        cwd: REPO_ROOT,
        timeout: 30_000,
        stdio: "pipe",
      },
    );
  } catch (err: any) {
    throw new Error(`fill_resume.js failed: ${err.stderr?.toString() || err.message}`);
  }

  const pdfPath = path.join(outDir, `${basename}.pdf`);
  const docxPath = path.join(outDir, `${basename}.docx`);

  if (!fs.existsSync(pdfPath) || !fs.existsSync(docxPath)) {
    throw new Error(`Expected output files not found: ${basename}.{pdf,docx}`);
  }

  // Clean up temp
  try {
    fs.rmSync(tempDir, { recursive: true });
  } catch { /* ignore */ }

  return {
    pdfPath,
    docxPath,
    basename,
    summaryUsed: summary,
    summaryWarning,
  };
}

// --------------------------------------------------------------------------- //
//  Summary regeneration
// --------------------------------------------------------------------------- //

async function regenerateSummary(
  job: any,
  bulletTexts: string[],
  masterResume: any,
): Promise<{ summary: string; warning: string | null }> {
  const staticSummary = "Product-minded engineer with experience spanning consumer robotics, mobile apps, fitness tech, and enterprise SaaS. Combines product management (user research, roadmapping, stakeholder alignment) with hands-on engineering (Rust, Python, TypeScript, AWS) to ship end-to-end systems that move business metrics.";

  const openaiKey = process.env.OPENAI_KEY;
  if (!openaiKey) {
    return { summary: staticSummary, warning: "OPENAI_KEY not set; using static summary" };
  }

  const jdTitle = job.jd_job_title || job.title || "";
  const requiredQuals = (job.jd_required_qualifications as string[] || []).slice(0, 5);
  const roleContext = (job.jd_role_context as any)?.summary || "";

  const jdString = [
    `Role: ${jdTitle}`,
    `Company: ${(job.company as any)?.name || job.jd_company_name || ""}`,
    requiredQuals.length > 0 ? `Key requirements: ${requiredQuals.join("; ")}` : "",
    roleContext ? `About: ${roleContext}` : "",
  ].filter(Boolean).join("\n");

  const bulletsString = bulletTexts
    .slice(0, 8)
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");

  const userMessage = `JOB DESCRIPTION:
${jdString}

SELECTED RESUME BULLETS:
${bulletsString}

CANDIDATE FACTS:
- Name: ${masterResume.contact.name}
- Current focus: product management + engineering
- Experience: consumer robotics, mobile apps, fitness tech, enterprise SaaS
- Languages: Rust, Python, TypeScript, JavaScript, SQL
- Cloud: AWS

Generate 3 summary candidates following all 9 rules. Maximum 340 characters each.`;

  const client = new OpenAI({ apiKey: openaiKey });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const messages: Array<{ role: "system" | "user"; content: string }> = [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: attempt === 0
          ? userMessage
          : userMessage + "\n\nNOTE: Previous attempt failed self-checks. Regenerate carefully, ensuring all 9 rules pass."
        },
      ];

      const response = await client.chat.completions.create({
        model: "gpt-4o",
        temperature: 0,
        max_tokens: 1024,
        messages,
      });

      const raw = response.choices[0]?.message?.content || "";
      const parsed = parseSummaryResponse(raw);

      if (parsed) {
        // Verify length
        if (parsed.length <= SUMMARY_MAX_CHARS) {
          return { summary: parsed, warning: null };
        }
        // Truncate if slightly over
        if (parsed.length <= SUMMARY_MAX_CHARS + 20) {
          const truncated = parsed.substring(0, SUMMARY_MAX_CHARS - 3) + "...";
          return { summary: truncated, warning: "Summary truncated to fit 340 char limit" };
        }
      }
    } catch (err: any) {
      console.error(`[fit] Summary generation attempt ${attempt + 1} failed:`, err.message);
    }
  }

  return { summary: staticSummary, warning: "Summary regeneration failed; using static fallback" };
}

function parseSummaryResponse(raw: string): string | null {
  // Find RECOMMENDED line
  const recMatch = raw.match(/RECOMMENDED:\s*(\d)/);
  const recNum = recMatch ? parseInt(recMatch[1], 10) : 1;

  // Find the recommended candidate
  const candidatePattern = new RegExp(
    `CANDIDATE ${recNum}:\\s*\\n([^\\n]+(?:\\n[^\\n]*)*?)(?=\\n\\s*(?:CANDIDATE \\d|RECOMMENDED|SELF-CHECK|$))`,
    "i",
  );
  const match = raw.match(candidatePattern);
  if (match) {
    return match[1].trim().split("\n")[0].trim();
  }

  // Fallback: try to find any CANDIDATE 1
  const fallback = raw.match(/CANDIDATE 1:\s*\n([^\n]+)/i);
  if (fallback) {
    return fallback[1].trim();
  }

  return null;
}
