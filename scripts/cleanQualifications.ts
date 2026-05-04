/**
 * cleanQualifications.ts — Use OpenAI to clean jd_required/preferred_qualifications.
 *
 * Removes noise: company descriptions, EEO statements, salary info, benefits,
 * privacy policies, boilerplate. Keeps only actual job requirements.
 *
 * Also ensures Search Engine in Rust project gets priority for technical roles.
 *
 * Usage: npx ts-node scripts/cleanQualifications.ts [--limit N] [--force]
 * Cost: ~$0.0002 per listing (gpt-4o-mini)
 */

import "dotenv/config";
import OpenAI from "openai";
import { getSupabaseClient } from "../src/storage/supabase";

const MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT = `You clean job qualification lists by removing noise and keeping only actual job requirements.

Given a list of "qualifications" extracted from a job posting, return ONLY the ones that are actual job requirements.

REMOVE (these are NOT qualifications):
- Company descriptions ("About [Company]", "We are a...", "Our mission...")
- EEO/diversity statements ("equal opportunity employer", "do not discriminate")
- Privacy policies, background check notices, legal disclaimers
- Salary/compensation ranges
- Benefits listings (health, dental, 401k, PTO, etc.)
- Location information ("This role is based in...")
- Application instructions ("submit your application", "click here")
- Generic marketing copy about the company
- Recruiting process descriptions
- Section headers ("Minimum Qualifications", "Preferred Qualifications", etc.)
- Empty or very short entries (< 15 chars)

KEEP (these ARE qualifications):
- Specific skills required (technical, soft, domain)
- Years of experience requirements
- Education requirements
- Tool/technology proficiency
- Industry/domain experience
- Certifications
- Specific role responsibilities that are framed as requirements

Return a JSON object:
{
  "required": ["cleaned list of actual required qualifications"],
  "preferred": ["cleaned list of actual preferred qualifications"]
}

Keep the original text of each qualification. Don't rewrite them. Just filter out the noise.`;

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1], 10) : 999;
  const force = args.includes("--force");

  const openaiKey = process.env.OPENAI_KEY;
  if (!openaiKey) { console.error("OPENAI_KEY not set"); process.exit(1); }

  const client = new OpenAI({ apiKey: openaiKey });
  const sb = getSupabaseClient();

  const { data: listings, error } = await sb
    .from("job_listings")
    .select("id, title, jd_required_qualifications, jd_preferred_qualifications")
    .eq("is_active", true)
    .not("jd_required_qualifications", "is", null)
    .order("first_seen_at", { ascending: false })
    .limit(limit);

  if (error) { console.error(error.message); process.exit(1); }
  console.log(`Processing ${listings?.length || 0} listings`);

  let cleaned = 0, skipped = 0, tokens = 0;

  for (const listing of listings || []) {
    const reqQuals = listing.jd_required_qualifications as string[] || [];
    const prefQuals = listing.jd_preferred_qualifications as string[] || [];

    // Quick check: does it have obvious noise?
    const hasNoise = reqQuals.some((q: string) =>
      /^(About |We are |OpenAI |equal opportunity|background check|privacy policy|salary|compensation|benefits|EEO|affirmative action)/i.test(q.trim())
      || q.length < 15
      || /\.com\/|https?:\/\//i.test(q)
      || /paid time off|health insurance|dental|401k|parental leave/i.test(q)
    );

    if (!hasNoise && !force) {
      skipped++;
      continue;
    }

    try {
      const userMsg = JSON.stringify({
        title: listing.title,
        required: reqQuals,
        preferred: prefQuals,
      });

      const response = await client.chat.completions.create({
        model: MODEL,
        temperature: 0,
        max_tokens: 2000,
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
      } catch { continue; }

      const cleanReq = parsed.required || [];
      const cleanPref = parsed.preferred || [];

      const removedCount = reqQuals.length + prefQuals.length - cleanReq.length - cleanPref.length;
      if (removedCount > 0) {
        const { error: updateErr } = await sb
          .from("job_listings")
          .update({
            jd_required_qualifications: cleanReq,
            jd_preferred_qualifications: cleanPref,
          })
          .eq("id", listing.id);

        if (updateErr) {
          console.error(`  FAIL ${listing.id}: ${updateErr.message}`);
        } else {
          cleaned++;
          console.log(`  [${cleaned}] ${listing.title?.substring(0, 40)} — removed ${removedCount} noise entries (${reqQuals.length}→${cleanReq.length} req, ${prefQuals.length}→${cleanPref.length} pref)`);
        }
      } else {
        skipped++;
      }
    } catch (err: any) {
      console.error(`  FAIL ${listing.id}: ${err.message}`);
    }
  }

  console.log(`\nDone. Cleaned: ${cleaned}, Skipped: ${skipped}, Tokens: ~${tokens}, Cost: ~$${(tokens * 0.15 / 1_000_000).toFixed(4)}`);
}

main().catch((err) => { console.error("FATAL:", err.message); process.exit(1); });
