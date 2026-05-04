/**
 * Inline qualification cleaning for new listings during the scan pipeline.
 * Uses OpenAI gpt-4o-mini to remove noise (company descriptions, EEO, benefits).
 * Cost: ~$0.0002 per listing.
 */

import { getSupabaseClient } from "./supabase";

const MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT = `Clean this job qualification list. Return ONLY a JSON object: {"required": [...], "preferred": [...]}
REMOVE: company descriptions, EEO statements, privacy notices, salary ranges, benefits, location info, legal disclaimers, section headers, entries < 15 chars.
KEEP: actual skill requirements, experience requirements, education, certifications, role-specific needs.
Keep original text, just filter out noise.`;

export async function cleanQualsForNewListings(listingIds: string[]): Promise<number> {
  if (listingIds.length === 0) return 0;
  const openaiKey = process.env.OPENAI_KEY;
  if (!openaiKey) return 0;

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: openaiKey });
  const sb = getSupabaseClient();
  let cleaned = 0;

  for (const id of listingIds) {
    try {
      const { data: listing } = await sb
        .from("job_listings")
        .select("jd_required_qualifications, jd_preferred_qualifications")
        .eq("id", id)
        .single();

      if (!listing || !listing.jd_required_qualifications) continue;

      const reqQuals = listing.jd_required_qualifications as string[];
      const hasNoise = reqQuals.some((q: string) =>
        /^(About |We are |equal opportunity|background check|privacy|salary|compensation|benefits|EEO|affirmative)/i.test(q.trim())
        || q.length < 15 || /\.com\/|https?:\/\//i.test(q)
      );
      if (!hasNoise) continue;

      const response = await client.chat.completions.create({
        model: MODEL,
        temperature: 0,
        max_tokens: 2000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({
            required: reqQuals,
            preferred: listing.jd_preferred_qualifications || [],
          })},
        ],
      });

      const raw = response.choices[0]?.message?.content || "{}";
      let parsed;
      try {
        let jsonStr = raw.trim();
        if (jsonStr.startsWith("```")) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
        parsed = JSON.parse(jsonStr);
      } catch { continue; }

      await sb.from("job_listings").update({
        jd_required_qualifications: parsed.required || [],
        jd_preferred_qualifications: parsed.preferred || [],
      }).eq("id", id);
      cleaned++;
    } catch (err: any) {
      console.warn(`[cleanQuals] Failed for ${id}: ${err.message}`);
    }
  }

  if (cleaned > 0) console.log(`[cleanQuals] Cleaned qualifications for ${cleaned} listing(s)`);
  return cleaned;
}
