/**
 * extractSkills.ts — Extract skill keywords from job descriptions via OpenAI.
 *
 * For each active listing with jd_required_qualifications but no jd_extracted_skills,
 * calls gpt-4o-mini to extract a clean, normalized list of skill keywords.
 * Stores the result in the jd_extracted_skills text[] column.
 *
 * Usage: npx ts-node scripts/extractSkills.ts [--limit N] [--force]
 *   --limit N   Process at most N listings (default: all)
 *   --force     Re-extract even if jd_extracted_skills already set
 *
 * Cost: ~$0.001 per listing (gpt-4o-mini, ~500 input tokens + ~200 output tokens)
 */

import "dotenv/config";
import OpenAI from "openai";
import { getSupabaseClient } from "../src/storage/supabase";

const BATCH_SIZE = 20;
const MODEL = "gpt-4o-mini"; // cheap + fast, sufficient for keyword extraction

const SYSTEM_PROMPT = `You are a skill keyword extractor for job descriptions.

Given a job listing's qualifications and skills, extract a clean list of specific, ATS-matchable skill keywords.

Rules:
1. Return ONLY a JSON array of strings. No other text.
2. Include: specific technologies, tools, languages, frameworks, methodologies, domain skills.
3. Include both the full name AND common abbreviation: ["Machine Learning", "ML"]
4. Include soft skills only if they're specific and ATS-relevant: "A/B Testing" yes, "communication" no.
5. Normalize: "python" -> "Python", "aws" -> "AWS", "ci/cd" -> "CI/CD"
6. No generic terms: no "experience", "skills", "knowledge", "understanding", "ability"
7. No company names, job titles, or years of experience
8. Deduplicate. Order by relevance to the role.
9. Typical output: 10-30 keywords.

Example output:
["Python", "SQL", "Machine Learning", "ML", "A/B Testing", "Product Management", "REST API", "AWS", "Docker", "Agile", "User Research", "PRD"]`;

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1], 10) : 999;
  const force = args.includes("--force");

  const openaiKey = process.env.OPENAI_KEY;
  if (!openaiKey) {
    console.error("OPENAI_KEY not set in .env");
    process.exit(1);
  }

  const client = new OpenAI({ apiKey: openaiKey });
  const sb = getSupabaseClient();

  // Fetch listings that need extraction
  let query = sb
    .from("job_listings")
    .select("id, title, jd_required_qualifications, jd_preferred_qualifications, jd_skills, jd_extracted_skills")
    .eq("is_active", true)
    .not("jd_required_qualifications", "is", null)
    .order("first_seen_at", { ascending: false })
    .limit(limit);

  if (!force) {
    query = query.is("jd_extracted_skills", null);
  }

  const { data: listings, error } = await query;
  if (error) {
    console.error("Supabase error:", error.message);
    process.exit(1);
  }

  console.log(`Found ${listings?.length || 0} listings to process (limit=${limit}, force=${force})`);
  if (!listings || listings.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let processed = 0;
  let failed = 0;
  let totalTokens = 0;

  for (let i = 0; i < listings.length; i += BATCH_SIZE) {
    const batch = listings.slice(i, i + BATCH_SIZE);

    for (const listing of batch) {
      try {
        const skills = await extractSkills(client, listing);
        totalTokens += skills._tokens || 0;

        // Update Supabase
        const { error: updateErr } = await sb
          .from("job_listings")
          .update({ jd_extracted_skills: skills.keywords })
          .eq("id", listing.id);

        if (updateErr) {
          console.error(`  FAIL ${listing.id}: ${updateErr.message}`);
          failed++;
        } else {
          processed++;
          console.log(`  [${processed}/${listings.length}] ${listing.title?.substring(0, 40)} -> ${skills.keywords.length} skills`);
        }
      } catch (err: any) {
        console.error(`  FAIL ${listing.id}: ${err.message}`);
        failed++;
      }
    }

    // Brief pause between batches to avoid rate limits
    if (i + BATCH_SIZE < listings.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const costEst = (totalTokens * 0.15 / 1_000_000).toFixed(4);
  console.log(`\nDone. Processed: ${processed}, Failed: ${failed}, Tokens: ~${totalTokens}, Cost: ~$${costEst}`);
}

async function extractSkills(
  client: OpenAI,
  listing: any,
): Promise<{ keywords: string[]; _tokens: number }> {
  const reqQuals = (listing.jd_required_qualifications || []).join("\n- ");
  const prefQuals = (listing.jd_preferred_qualifications || []).join("\n- ");
  const jdSkills = listing.jd_skills ? JSON.stringify(listing.jd_skills) : "";

  const userMessage = [
    `Job Title: ${listing.title || ""}`,
    reqQuals ? `\nRequired Qualifications:\n- ${reqQuals}` : "",
    prefQuals ? `\nPreferred Qualifications:\n- ${prefQuals}` : "",
    jdSkills ? `\nStructured Skills: ${jdSkills}` : "",
  ].filter(Boolean).join("\n");

  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    max_tokens: 500,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
  });

  const raw = response.choices[0]?.message?.content || "[]";
  const tokens = response.usage?.total_tokens || 0;

  // Parse JSON array
  let keywords: string[];
  try {
    let jsonStr = raw.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    keywords = JSON.parse(jsonStr);
    if (!Array.isArray(keywords)) keywords = [];
    keywords = keywords.filter((k: any) => typeof k === "string" && k.trim().length > 0);
  } catch {
    console.warn(`  WARN: Failed to parse response for ${listing.id}, raw: ${raw.substring(0, 100)}`);
    keywords = [];
  }

  return { keywords, _tokens: tokens };
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
