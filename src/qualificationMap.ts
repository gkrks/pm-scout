/**
 * qualificationMap.ts — Generate a qualification-to-resume-bullet knowledge base.
 *
 * 1. Fetches all qualifications from active Supabase job_listings
 * 2. Deduplicates exact strings
 * 3. Loads master resume bullets
 * 4. Calls Claude Opus 4.6 to group qualifications, extract keywords, map bullets
 * 5. Writes ats_bullet_selector/outputs/qualification_map.json
 *
 * Usage: npx ts-node src/qualificationMap.ts
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY in .env
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

import { getSupabaseClient, loadMasterResume } from "./storage/supabase";

interface ResumeBullet {
  bullet_id: string;
  text: string;
  source: string;
}

// --------------------------------------------------------------------------- //
//  Step 1: Fetch qualifications from Supabase
// --------------------------------------------------------------------------- //

async function fetchAllQualifications(): Promise<{
  required: string[];
  preferred: string[];
  listingCount: number;
}> {
  const sb = getSupabaseClient();
  const allRequired: string[] = [];
  const allPreferred: string[] = [];
  let listingCount = 0;
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const { data, error } = await sb
      .from("job_listings")
      .select("jd_required_qualifications, jd_preferred_qualifications")
      .eq("is_active", true)
      .not("jd_required_qualifications", "is", null)
      .range(offset, offset + batchSize - 1);

    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      listingCount++;
      const req = row.jd_required_qualifications as string[] | null;
      const pref = row.jd_preferred_qualifications as string[] | null;
      if (req) allRequired.push(...req);
      if (pref) allPreferred.push(...pref);
    }

    if (data.length < batchSize) break;
    offset += batchSize;
  }

  return { required: allRequired, preferred: allPreferred, listingCount };
}

// --------------------------------------------------------------------------- //
//  Step 2: Deduplicate
// --------------------------------------------------------------------------- //

function deduplicateQualifications(required: string[], preferred: string[]): string[] {
  const all = [...required, ...preferred];
  return [...new Set(all)].filter((q) => q.trim().length > 0);
}

// --------------------------------------------------------------------------- //
//  Step 3: Load master resume bullets
// --------------------------------------------------------------------------- //

async function loadResumeBullets(): Promise<ResumeBullet[]> {
  const data = await loadMasterResume();
  const bullets: ResumeBullet[] = [];

  for (const exp of data.experiences || []) {
    const source = `${exp.company} -- ${exp.role}`;
    for (const b of exp.bullets || []) {
      bullets.push({ bullet_id: b.id, text: b.text, source });
    }
  }

  for (const proj of data.projects || []) {
    const source = proj.name;
    for (const b of proj.bullets || []) {
      bullets.push({ bullet_id: b.id, text: b.text, source });
    }
  }

  return bullets;
}

// --------------------------------------------------------------------------- //
//  Step 4: Call Claude Opus 4.6
// --------------------------------------------------------------------------- //

async function groupQualifications(
  qualifications: string[],
  bullets: ResumeBullet[],
): Promise<any> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set in .env");

  const client = new Anthropic({ apiKey });

  const bulletList = bullets
    .map((b) => `- [${b.bullet_id}] (${b.source}): ${b.text}`)
    .join("\n");

  const qualList = qualifications.map((q, i) => `${i + 1}. ${q}`).join("\n");

  const systemPrompt = `You are an expert resume and ATS analyst. You will receive:
1. A list of job qualifications extracted from hundreds of PM/APM job postings
2. A list of resume bullets with IDs

Your task:
1. Group the qualifications into 15-30 semantic clusters based on what they're really asking for. Two qualifications belong in the same group if a recruiter would consider them "the same type of requirement." Examples: "3+ years PM experience" and "5+ years product management" belong together. "Python proficiency" and "Experience with SQL" might be separate groups.

2. Name each group descriptively (e.g., "Product Management Experience", "Data Analysis & SQL", "Cross-Functional Leadership", "Security Clearance").

3. For each group, extract 3-10 ATS-matchable keywords that a resume scanner would look for. These should be the most common terms recruiters and ATS systems use for this category.

4. For each group, identify which resume bullets from the provided list are relevant evidence. A bullet is relevant if it would genuinely help satisfy qualifications in that group. Map by bullet_id. If NO bullets match a group, return an empty array.

5. Every qualification from the input list must appear in exactly one group. Do not drop any.

Return ONLY valid JSON (no markdown fences, no explanation) in this exact structure:
{
  "groups": [
    {
      "group_name": "string",
      "qualifications": ["string", ...],
      "keywords": ["string", ...],
      "resume_bullets": [
        { "bullet_id": "string", "text": "string", "source": "string" }
      ]
    }
  ]
}`;

  console.log(`Calling Claude Opus 4.6 with ${qualifications.length} qualifications and ${bullets.length} bullets...`);

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 16000,
    temperature: 0,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `QUALIFICATIONS (${qualifications.length} total):\n${qualList}\n\nRESUME BULLETS (${bullets.length} total):\n${bulletList}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Parse JSON from response, stripping markdown fences if present
  let jsonStr = text.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  return JSON.parse(jsonStr);
}

// --------------------------------------------------------------------------- //
//  Step 5: Write output
// --------------------------------------------------------------------------- //

function writeOutput(
  result: any,
  listingCount: number,
  uniqueCount: number,
): string {
  const outputDir = path.resolve(
    __dirname,
    "../ats_bullet_selector/outputs",
  );
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const output = {
    generated_at: new Date().toISOString(),
    model: "claude-opus-4-6",
    total_listings_scanned: listingCount,
    total_unique_qualifications: uniqueCount,
    ...result,
  };

  const outputPath = path.join(outputDir, "qualification_map.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  return outputPath;
}

// --------------------------------------------------------------------------- //
//  Step 6: Verify completeness
// --------------------------------------------------------------------------- //

function verifyCompleteness(
  qualifications: string[],
  groups: any[],
): void {
  const mapped = new Set<string>();
  for (const g of groups) {
    for (const q of g.qualifications || []) {
      mapped.add(q);
    }
  }

  const missing = qualifications.filter((q) => !mapped.has(q));
  if (missing.length > 0) {
    console.warn(
      `WARNING: ${missing.length} qualifications not found in any group:`,
    );
    for (const m of missing.slice(0, 10)) {
      console.warn(`  - ${m.substring(0, 80)}`);
    }
    if (missing.length > 10) {
      console.warn(`  ... and ${missing.length - 10} more`);
    }
  } else {
    console.log("All qualifications accounted for in groups.");
  }
}

// --------------------------------------------------------------------------- //
//  Main
// --------------------------------------------------------------------------- //

async function main(): Promise<void> {
  console.log("Step 1: Fetching qualifications from Supabase...");
  const { required, preferred, listingCount } =
    await fetchAllQualifications();
  console.log(
    `  ${listingCount} active listings, ${required.length} required, ${preferred.length} preferred`,
  );

  console.log("Step 2: Deduplicating...");
  const unique = deduplicateQualifications(required, preferred);
  console.log(`  ${unique.length} unique qualifications`);

  console.log("Step 3: Loading master resume bullets...");
  const bullets = await loadResumeBullets();
  console.log(`  ${bullets.length} bullets loaded`);

  console.log("Step 4: Grouping via Claude Opus 4.6...");
  const result = await groupQualifications(unique, bullets);
  const groupCount = result.groups?.length || 0;
  console.log(`  ${groupCount} groups generated`);

  console.log("Step 5: Writing output...");
  const outputPath = writeOutput(result, listingCount, unique.length);
  console.log(`  Written to ${outputPath}`);

  console.log("Step 6: Verifying completeness...");
  verifyCompleteness(unique, result.groups || []);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
