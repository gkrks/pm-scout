/**
 * Zod schemas for the unified outreach system.
 */

import { z } from "zod";

export const OutreachModeZ = z.enum([
  "cover_letter",
  "linkedin_referral_peer",
  "linkedin_referral_open_to_connect",
  "linkedin_hiring_manager",
]);
export type OutreachMode = z.infer<typeof OutreachModeZ>;

export const PersonIntelZ = z.object({
  text: z.string().min(1),
  name: z.string().optional(),
  title: z.string().optional(),
}).optional();
export type PersonIntel = z.infer<typeof PersonIntelZ>;

export const OutreachRequestZ = z.object({
  jobId: z.string().uuid(),
  mode: OutreachModeZ,
  personIntel: PersonIntelZ,
  email: z.string().email().optional(),
});
export type OutreachRequest = z.infer<typeof OutreachRequestZ>;

export const HookDataZ = z.object({
  bridge_text: z.string(),
  insight_id: z.string(),
  intel_id: z.string(),
  specificity_score: z.number(),
  score_rationale: z.string(),
});
export type HookData = z.infer<typeof HookDataZ>;

export const OutreachResultZ = z.object({
  text: z.string(),
  hook: HookDataZ,
  mode: OutreachModeZ,
  wordCount: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
});
export type OutreachResult = z.infer<typeof OutreachResultZ>;
