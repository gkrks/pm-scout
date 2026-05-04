/**
 * One-off script: Insert a specific Meta role into Supabase and send an email digest for it.
 *
 * Usage: npx ts-node scripts/addMetaRole.ts
 */

import "dotenv/config";
import { getSupabaseClient } from "../src/storage/supabase";
import { sendEmailDigest } from "../src/notify/email";
import type { Job } from "../src/state";
import type { RunStats } from "../src/notify/telegram";

const META_COMPANY_ID = "0daa757f-74e8-5cf7-be3f-3be3b2dcd86a"; // from targets.json

const role = {
  title: "Product Manager",
  role_url: "https://www.metacareers.com/profile/job_details/1303890458343560",
  location_raw: "New York, NY",
  posted_date: "2026-04-03",
  description: `Meta seeks to fill a Product Manager position focused on building technologies that help people connect and grow businesses. Requires Master's degree (or equivalent) in CS, Engineering, Business Administration, or related field + 2+ years experience in product management, technical architecture of complex web applications, designing user interfaces, creating wireframes, developing social products, working with cross-functional teams, delivering technical presentations, analyzing large-scale datasets, and gathering requirements across diverse users.`,
  is_remote: false,
  is_hybrid: false,
  location_city: "New York",
  ats_platform: "meta-playwright",
};

async function main() {
  const supabase = getSupabaseClient();

  // 1. Upsert the listing
  console.log("[addMetaRole] Upserting listing into Supabase...");

  const row = {
    company_id: META_COMPANY_ID,
    title: role.title,
    role_url: role.role_url,
    location_raw: role.location_raw,
    location_city: role.location_city,
    posted_date: role.posted_date,
    raw_jd_excerpt: role.description.slice(0, 500),
    is_remote: role.is_remote,
    is_hybrid: role.is_hybrid,
    is_active: true,
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    ats_platform: role.ats_platform,
    tier: 1,
    apm_signal: "apm_company",
    yoe_min: 2,
    yoe_max: null,
    jd_required_qualifications: [
      "Master's degree (or equivalent) in Computer Science, Engineering, Information Systems, Analytics, Mathematics, Physics, Applied Sciences, Business Administration, Finance, Economics, or related field",
      "2+ years experience in product management or product design",
      "2+ years experience with technical architecture of complex, scalable web applications or media products",
      "2+ years experience designing simple, intuitive user interfaces",
      "2+ years experience creating wireframes and mockups",
      "2+ years experience developing social products, technologies, or platforms",
      "2+ years experience working in technical environments with cross-functional teams",
      "2+ years experience delivering technical presentations",
      "2+ years experience analyzing large-scale datasets for data-driven decisions",
      "2+ years experience gathering requirements across diverse users and converting them into product solutions",
    ],
    jd_preferred_qualifications: [
      "Experience defining product goals and gathering requirements from stakeholders",
      "Experience conducting usability studies and market analysis",
      "Experience designing specifications and ensuring feasibility",
      "Experience preparing cost-benefit analyses and establishing performance standards",
      "Experience with augmented and virtual reality platforms",
    ],
    jd_job_title: "Product Manager",
    jd_company_name: "Meta",
    jd_location: "New York, NY",
  };

  const { data, error } = await supabase
    .from("job_listings")
    .upsert(row, { onConflict: "company_id,role_url" })
    .select("id")
    .single();

  if (error) {
    console.error("[addMetaRole] Upsert failed:", error.message);
    process.exit(1);
  }

  const supabaseId = data.id;
  console.log(`[addMetaRole] Upserted listing ID: ${supabaseId}`);

  // 2. Send email digest with just this role
  console.log("[addMetaRole] Sending email...");

  const job: Job = {
    id: supabaseId,
    company: "Meta",
    title: role.title,
    location: role.location_raw,
    workType: "Onsite",
    datePosted: role.posted_date,
    applyUrl: role.role_url,
    careersUrl: "https://www.metacareers.com/jobs",
    earlyCareer: false,
    yoeMin: 2,
    yoeMax: null,
    description: role.description,
    pmTier: 1,
    apmSignal: "apm_company",
    category: "Featured: Companies with Dedicated APM / Rotational Programs",
    domainTags: ["Consumer", "AI/ML", "Platform"],
    supabaseId,
  };

  const stats: RunStats = {
    runId: `manual-${Date.now()}`,
    startedAt: new Date(),
    completedAt: new Date(),
    companiesScanned: 1,
    errors: 0,
  };

  // Force email sending even if NOTIFY_EMAIL_DIGEST wasn't set
  process.env.NOTIFY_EMAIL_DIGEST = "true";

  await sendEmailDigest([job], stats);
  console.log("[addMetaRole] Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
