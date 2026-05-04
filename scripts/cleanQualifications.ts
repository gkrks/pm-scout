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

const SYSTEM_PROMPT = `You clean and properly classify job posting content. The input may have RESPONSIBILITIES mixed in with QUALIFICATIONS because the parser couldn't tell them apart.

Your job: separate the content into actual qualifications vs everything else.

A QUALIFICATION is something the CANDIDATE must have BEFORE applying:
- "3+ years of product management experience"
- "Bachelor's degree in Computer Science"
- "Experience with SQL and data analysis"
- "Strong communication skills"
- "Familiarity with Agile methodologies"

A RESPONSIBILITY is something the CANDIDATE will DO after being hired:
- "Lead the cross-functional product team"
- "Conduct market research"
- "Create the product marketing plan"
- "Own Business Epics and Capabilities"
- "Drive Release Management"
- "Monitor and report on progress"

Also REMOVE:
- Company descriptions, EEO statements, privacy policies, salary ranges
- Benefits, location info, application instructions, marketing copy
- Section headers ("Product Management", "Continuous Planning", "Release and Risk Management")
- Empty or very short entries (< 15 chars)
- Recruiting process descriptions

Return a JSON object:
{
  "required": ["only actual qualifications the candidate must have"],
  "preferred": ["preferred/nice-to-have qualifications"]
}

Be strict. When in doubt, it is a responsibility, not a qualification. A qualification describes what you NEED; a responsibility describes what you will DO.`;

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

    // Quick check: does it have noise or responsibilities mixed in?
    const hasNoise = reqQuals.some((q: string) =>
      /^(About |We are |OpenAI |equal opportunity|background check|privacy policy|salary|compensation|benefits|EEO|affirmative action)/i.test(q.trim())
      || q.length < 15
      || /\.com\/|https?:\/\//i.test(q)
      || /paid time off|health insurance|dental|401k|parental leave/i.test(q)
      // Detect responsibilities mixed in as qualifications
      || /^(Lead |Conduct |Create |Own |Drive |Monitor |Build |Manage |Ensure |Collaborate |Research |Supervise |Communicate |Shepherd |Leverage )/i.test(q.trim())
      || /^(Product Management|Program Portfolio|Continuous Planning|Release and Risk)$/i.test(q.trim())
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
