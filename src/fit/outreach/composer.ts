/**
 * Outreach composer: dispatches by mode, assembles the final output.
 */

import { findHook, FindHookResult } from "../hook/finder";
import { writeBody } from "./bodyWriter";
import { composePersonalizationLine } from "./personalizationLine";
import { buildCoverLetterDocx } from "../coverLetterGenerator";
import { getSupabaseClient, loadMasterResume } from "../../storage/supabase";
import type { OutreachMode, PersonIntel, HookData, OutreachResult } from "./types";

// LinkedIn signature is built from master resume at runtime
const CALENDLY_URL = process.env.CALENDLY_URL || "https://calendly.com/krithiksaisreenishgopinath/15-minute-meeting";

export interface ComposeRequest {
  jobId: string;
  mode: OutreachMode;
  personIntel?: PersonIntel;
  email?: string;
}

export interface ComposeResponse {
  skip: false;
  result: OutreachResult;
  docxPath?: string;
}

export interface ComposeSkipped {
  skip: true;
  reason: string;
}

export type ComposeOutreachResult = ComposeResponse | ComposeSkipped;

/**
 * Main composer: finds hook, generates body, assembles by mode.
 */
export async function composeOutreach(request: ComposeRequest): Promise<ComposeOutreachResult> {
  // Find hook
  const hookResult: FindHookResult = await findHook(request.jobId);

  if (hookResult.skip) {
    return { skip: true, reason: hookResult.reason };
  }

  const hook = hookResult.primary;

  // Load job data for context
  const supabase = getSupabaseClient();
  const { data: job } = await supabase
    .from("job_listings")
    .select(`
      title, jd_job_title, jd_company_name, role_url,
      jd_required_qualifications, jd_role_context,
      company:companies!inner(name)
    `)
    .eq("id", request.jobId)
    .single();

  const companyName = (job?.company as any)?.name || job?.jd_company_name || "Unknown";
  const roleTitle = job?.jd_job_title || job?.title || "Product Manager";
  const reqQuals = (job?.jd_required_qualifications as string[] || []).slice(0, 5);
  const roleContext = (job?.jd_role_context as any)?.summary || "";

  const jdSummary = [
    `Role: ${roleTitle}`,
    `Company: ${companyName}`,
    reqQuals.length > 0 ? `Requirements: ${reqQuals.join("; ")}` : "",
    roleContext ? `About: ${roleContext}` : "",
  ].filter(Boolean).join("\n");

  // Generate body
  const bodyResult = await writeBody({
    hook,
    jdSummary,
    mode: request.mode,
    companyName,
    roleTitle,
  });

  // Strip any trailing ask the body writer may have included (composer adds its own)
  let body = bodyResult.body;
  if (request.mode !== "cover_letter") {
    body = body
      .replace(/\n*Would love 15 min if you're up for it[.!]?\s*$/i, "")
      .replace(/\n*If this looks like a fit, would you be open to passing my resume along\??\s*$/i, "")
      .trim();
  }

  // Load master resume for contact info
  const masterResume = await loadMasterResume();
  const contact = masterResume.contact || {};
  const name = contact.name || "Krithik Sai Sreenish Gopinath";

  // Build LinkedIn signature footer
  // Format: Interested role: <role URL>
  //         Name
  //         Website
  //         Email
  const roleUrl = job?.role_url || "";
  const sigLines: string[] = [];
  sigLines.push(`Interested role: ${roleUrl}`);
  sigLines.push(contact.short_name || name);
  if (contact.website_url) sigLines.push(contact.website_url);
  sigLines.push(request.email || contact.emails?.[0] || "");
  const linkedinSignature = sigLines.filter(Boolean).join("\n");

  // Assemble by mode
  let finalText: string;
  let totalInputTokens = bodyResult.inputTokens;
  let totalOutputTokens = bodyResult.outputTokens;

  switch (request.mode) {
    case "cover_letter": {
      finalText = `Dear Hiring Manager,\n\n${body}\n\nBest regards,\n${name}`;
      break;
    }

    case "linkedin_referral_peer": {
      let opener = "";
      if (request.personIntel?.text) {
        const pResult = await composePersonalizationLine({
          personIntel: request.personIntel,
          roleTitle,
          companyName,
          jobId: request.jobId,
        });
        opener = pResult.line + "\n\n";
        totalInputTokens += pResult.inputTokens;
        totalOutputTokens += pResult.outputTokens;
      }
      const ask = `Would love 15 min if you're up for it - ${CALENDLY_URL}`;
      finalText = `${opener}${body}\n\n${ask}\n\n${linkedinSignature}`;
      break;
    }

    case "linkedin_referral_open_to_connect": {
      let opener = "";
      if (request.personIntel?.text) {
        const pResult = await composePersonalizationLine({
          personIntel: request.personIntel,
          roleTitle,
          companyName,
          jobId: request.jobId,
        });
        opener = pResult.line + "\n\n";
        totalInputTokens += pResult.inputTokens;
        totalOutputTokens += pResult.outputTokens;
      }
      finalText = `${opener}${body}\n\nIf this looks like a fit, would you be open to passing my resume along?\n\n${linkedinSignature}`;
      break;
    }

    case "linkedin_hiring_manager": {
      let opener = "";
      if (request.personIntel?.text) {
        const pResult = await composePersonalizationLine({
          personIntel: request.personIntel,
          roleTitle,
          companyName,
          jobId: request.jobId,
        });
        opener = pResult.line + "\n\n";
        totalInputTokens += pResult.inputTokens;
        totalOutputTokens += pResult.outputTokens;
      }
      finalText = `${opener}${body}\n\n${linkedinSignature}`;
      break;
    }
  }

  const wordCount = finalText.split(/\s+/).filter(Boolean).length;

  // Build DOCX for cover_letter mode
  let docxPath: string | undefined;
  if (request.mode === "cover_letter") {
    docxPath = await buildCoverLetterDocx(finalText, companyName, roleTitle);
  }

  return {
    skip: false,
    result: {
      text: finalText,
      hook,
      mode: request.mode,
      wordCount,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    },
    docxPath,
  };
}
