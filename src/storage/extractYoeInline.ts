/**
 * Inline YOE extraction for new job listings during the scan pipeline.
 * Calls OpenAI gpt-4o-mini to extract yoe_min/yoe_max from qualifications.
 * Cost: ~$0.0001 per listing.
 */

import { getSupabaseClient } from "./supabase";

const MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT = `Extract years of experience from job qualifications. Return ONLY JSON:
{"yoe_min": <number or null>, "yoe_max": <number or null>, "yoe_raw": "<exact text or null>"}
Rules: "3+ years" → min:3,max:null. "2-4 years" → min:2,max:4. "Less than 2" → min:0,max:2. "early-career" → min:0,max:2. No years → all null.`;

export async function extractYoeForNewListings(
  listingIds: string[],
): Promise<number> {
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
        .select("jd_required_qualifications, jd_preferred_qualifications, yoe_min")
        .eq("id", id)
        .single();

      if (!listing || listing.yoe_min != null) continue;
      if (!listing.jd_required_qualifications) continue;

      const reqQuals = (listing.jd_required_qualifications as string[] || []).join("\n- ");
      const prefQuals = (listing.jd_preferred_qualifications as string[] || []).join("\n- ");
      const userMsg = [
        reqQuals ? `Required:\n- ${reqQuals}` : "",
        prefQuals ? `Preferred:\n- ${prefQuals}` : "",
      ].filter(Boolean).join("\n\n");

      const response = await client.chat.completions.create({
        model: MODEL,
        temperature: 0,
        max_tokens: 200,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
      });

      const raw = response.choices[0]?.message?.content || "{}";
      let parsed;
      try {
        let jsonStr = raw.trim();
        if (jsonStr.startsWith("```")) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
        parsed = JSON.parse(jsonStr);
      } catch { parsed = {}; }

      if (parsed.yoe_min != null || parsed.yoe_max != null) {
        await sb.from("job_listings").update({
          yoe_min: parsed.yoe_min ?? null,
          yoe_max: parsed.yoe_max ?? null,
          yoe_raw: parsed.yoe_raw ?? null,
        }).eq("id", id);
        extracted++;
      }
    } catch (err: any) {
      console.warn(`[extractYoe] Failed for ${id}: ${err.message}`);
    }
  }

  if (extracted > 0) {
    console.log(`[extractYoe] Extracted YOE for ${extracted} new listing(s)`);
  }
  return extracted;
}
