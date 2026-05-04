/**
 * Extract qualifications via OpenAI for listings where the deterministic
 * JD extractor failed (e.g., Google Careers HTML format).
 * Runs after JD extraction for new listings with empty qualifications.
 * Cost: ~$0.0003 per listing (gpt-4o-mini).
 */

import { getSupabaseClient } from "./supabase";

const MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT = `Extract qualifications from a job description HTML/text.
Return ONLY JSON: {"required": ["list of required qualifications"], "preferred": ["list of preferred qualifications"]}

Rules:
- A QUALIFICATION = what the candidate must HAVE (skills, experience, education)
- A RESPONSIBILITY = what they will DO (not a qualification)
- Remove company descriptions, EEO, salary, benefits, boilerplate
- Look for sections labeled: "Minimum qualifications", "Required", "Basic Qualifications", "What you need", "Requirements"
- Look for sections labeled: "Preferred qualifications", "Nice to have", "Bonus"
- Keep original text. Don't rewrite.
- If no qualifications found, return {"required": [], "preferred": []}`;

export async function extractQualsForNewListings(listingIds: string[]): Promise<number> {
  if (listingIds.length === 0) return 0;
  const openaiKey = process.env.OPENAI_KEY;
  if (!openaiKey) return 0;

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: openaiKey });
  const sb = getSupabaseClient();
  let extracted = 0;

  for (const id of listingIds) {
    try {
      const { data: listing } = await sb
        .from("job_listings")
        .select("jd_required_qualifications, raw_jd_excerpt, title")
        .eq("id", id)
        .single();

      if (!listing) continue;
      // Only run if quals are empty (deterministic extractor failed)
      const existing = listing.jd_required_qualifications as string[] | null;
      if (existing && existing.length > 0) continue;
      if (!listing.raw_jd_excerpt) continue;

      const response = await client.chat.completions.create({
        model: MODEL,
        temperature: 0,
        max_tokens: 1500,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Title: ${listing.title}\n\nJob Description:\n${listing.raw_jd_excerpt}` },
        ],
      });

      const raw = response.choices[0]?.message?.content || "{}";
      let parsed;
      try {
        let jsonStr = raw.trim();
        if (jsonStr.startsWith("```")) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
        parsed = JSON.parse(jsonStr);
      } catch { continue; }

      const reqQuals = parsed.required || [];
      const prefQuals = parsed.preferred || [];

      if (reqQuals.length > 0 || prefQuals.length > 0) {
        await sb.from("job_listings").update({
          jd_required_qualifications: reqQuals,
          jd_preferred_qualifications: prefQuals,
        }).eq("id", id);
        extracted++;
      }
    } catch (err: any) {
      console.warn(`[extractQuals] Failed for ${id}: ${err.message}`);
    }
  }

  if (extracted > 0) console.log(`[extractQuals] Extracted quals for ${extracted} listing(s)`);
  return extracted;
}
