/**
 * extractYoe.ts — Extract years of experience from qualifications via OpenAI.
 *
 * For each active listing with jd_required_qualifications but NULL yoe_min,
 * calls gpt-4o-mini to extract yoe_min and yoe_max.
 * Updates the yoe_min, yoe_max, yoe_raw columns.
 *
 * Usage: npx ts-node scripts/extractYoe.ts [--limit N] [--force]
 * Cost: ~$0.0001 per listing
 */

import "dotenv/config";
import OpenAI from "openai";
import { getSupabaseClient } from "../src/storage/supabase";

const MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT = `You extract years of experience requirements from job qualifications.

Given a list of qualifications, return a JSON object:
{
  "yoe_min": <number or null>,
  "yoe_max": <number or null>,
  "yoe_raw": "<the exact text that mentions years, or null>"
}

Rules:
1. Return ONLY valid JSON. No other text.
2. "3+ years" → yoe_min: 3, yoe_max: null
3. "2-4 years" → yoe_min: 2, yoe_max: 4
4. "Less than 2 years" or "early-career" → yoe_min: 0, yoe_max: 2
5. "0 years of experience" → yoe_min: 0, yoe_max: 0
6. "5+ years" → yoe_min: 5, yoe_max: null
7. "8-10 years" → yoe_min: 8, yoe_max: 10
8. If no years mentioned → yoe_min: null, yoe_max: null, yoe_raw: null
9. Extract from required qualifications first. If not found, check preferred.
10. If multiple year requirements, use the PRIMARY one (usually the first or most prominent).`;

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1], 10) : 999;
  const force = args.includes("--force");

  const openaiKey = process.env.OPENAI_KEY;
  if (!openaiKey) { console.error("OPENAI_KEY not set"); process.exit(1); }

  const client = new OpenAI({ apiKey: openaiKey });
  const sb = getSupabaseClient();

  let query = sb
    .from("job_listings")
    .select("id, title, jd_required_qualifications, jd_preferred_qualifications")
    .eq("is_active", true)
    .not("jd_required_qualifications", "is", null)
    .order("first_seen_at", { ascending: false })
    .limit(limit);

  if (!force) {
    query = query.is("yoe_min", null);
  }

  const { data: listings, error } = await query;
  if (error) { console.error("Supabase error:", error.message); process.exit(1); }

  console.log(`Found ${listings?.length || 0} listings to process`);
  if (!listings || listings.length === 0) return;

  let processed = 0, failed = 0, tokens = 0;

  for (const listing of listings) {
    try {
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

      tokens += response.usage?.total_tokens || 0;
      const raw = response.choices[0]?.message?.content || "{}";

      let parsed;
      try {
        let jsonStr = raw.trim();
        if (jsonStr.startsWith("```")) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
        parsed = JSON.parse(jsonStr);
      } catch { parsed = {}; }

      const { error: updateErr } = await sb
        .from("job_listings")
        .update({
          yoe_min: parsed.yoe_min ?? null,
          yoe_max: parsed.yoe_max ?? null,
          yoe_raw: parsed.yoe_raw ?? null,
        })
        .eq("id", listing.id);

      if (updateErr) {
        console.error(`  FAIL ${listing.id}: ${updateErr.message}`);
        failed++;
      } else {
        processed++;
        const yoeStr = parsed.yoe_min != null ? `${parsed.yoe_min}-${parsed.yoe_max || '?'}` : "none";
        console.log(`  [${processed}/${listings.length}] ${listing.title?.substring(0, 40)} → ${yoeStr}`);
      }
    } catch (err: any) {
      console.error(`  FAIL ${listing.id}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Processed: ${processed}, Failed: ${failed}, Tokens: ~${tokens}, Cost: ~$${(tokens * 0.15 / 1_000_000).toFixed(4)}`);
}

main().catch((err) => { console.error("FATAL:", err.message); process.exit(1); });
