/**
 * Inline skill extraction for new job listings during the scan pipeline.
 * Calls OpenAI gpt-4o-mini to extract clean skill keywords from the JD,
 * then updates the jd_extracted_skills column.
 *
 * Cost: ~$0.0001 per listing (~700 tokens).
 * Only runs for listings where jd_extracted_skills is NULL.
 */

import { getSupabaseClient } from "./supabase";

const MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT = `You are a skill keyword extractor for job descriptions.
Given qualifications and skills from a job listing, extract a clean JSON array of specific, ATS-matchable skill keywords.
Rules:
1. Return ONLY a JSON array of strings. No other text.
2. Include specific technologies, tools, languages, frameworks, methodologies, domain skills.
3. Include both full name AND abbreviation: ["Machine Learning", "ML"]
4. Normalize casing: "python" -> "Python", "aws" -> "AWS"
5. No generic terms (experience, skills, knowledge, ability, understanding)
6. No company names, job titles, or years of experience
7. Deduplicate. 10-30 keywords typical.`;

export async function extractSkillsForNewListings(
  listingIds: string[],
): Promise<number> {
  if (listingIds.length === 0) return 0;

  const openaiKey = process.env.OPENAI_KEY;
  if (!openaiKey) {
    console.log("[extractSkills] OPENAI_KEY not set, skipping skill extraction");
    return 0;
  }

  // Dynamic import to avoid loading OpenAI SDK when not needed
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: openaiKey });
  const sb = getSupabaseClient();

  let extracted = 0;

  for (const id of listingIds) {
    try {
      // Fetch the listing's JD data
      const { data: listing, error } = await sb
        .from("job_listings")
        .select("title, jd_required_qualifications, jd_preferred_qualifications, jd_skills, jd_extracted_skills")
        .eq("id", id)
        .single();

      if (error || !listing) continue;
      if (listing.jd_extracted_skills) continue; // already extracted
      if (!listing.jd_required_qualifications) continue; // no JD data

      const reqQuals = (listing.jd_required_qualifications as string[] || []).join("\n- ");
      const prefQuals = (listing.jd_preferred_qualifications as string[] || []).join("\n- ");
      const jdSkills = listing.jd_skills ? JSON.stringify(listing.jd_skills) : "";

      const userMessage = [
        `Job Title: ${listing.title || ""}`,
        reqQuals ? `\nRequired:\n- ${reqQuals}` : "",
        prefQuals ? `\nPreferred:\n- ${prefQuals}` : "",
        jdSkills ? `\nSkills: ${jdSkills}` : "",
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
        keywords = [];
      }

      if (keywords.length > 0) {
        await sb
          .from("job_listings")
          .update({ jd_extracted_skills: keywords })
          .eq("id", id);
        extracted++;
      }
    } catch (err: any) {
      console.warn(`[extractSkills] Failed for ${id}: ${err.message}`);
    }
  }

  if (extracted > 0) {
    console.log(`[extractSkills] Extracted skills for ${extracted} new listing(s)`);
  }

  return extracted;
}
