/**
 * Zod schemas for the Fit web layer.
 * Mirrors the Python pydantic models in ats_bullet_selector/models.py.
 */

import { z } from "zod";

// --------------------------------------------------------------------------- //
//  Python service response shapes
// --------------------------------------------------------------------------- //

export const SubScoresZ = z.object({
  keyword: z.number(),
  semantic: z.number(),
  evidence: z.number(),
  quantification: z.number(),
  seniority: z.number(),
  recency: z.number(),
});

export const ScoredCandidateZ = z.object({
  bullet_id: z.string(),
  source_id: z.string(),
  source_label: z.string(),
  text: z.string(),
  match_score: z.number(),
  confidence: z.number(),
  sub_scores: SubScoresZ,
  rationale: z.string(),
  supporting_span: z.string(),
});

export const QualificationZ = z.object({
  id: z.string(),
  kind: z.enum(["basic", "preferred"]),
  text: z.string(),
});

export const QualCandidatesZ = z.object({
  qualification: QualificationZ,
  candidates: z.array(ScoredCandidateZ),
});

export const SelectedBulletZ = z.object({
  bullet_id: z.string(),
  source_id: z.string(),
  covers_qualifications: z.array(z.string()),
});

export const FinalSelectionZ = z.object({
  selected_bullets: z.array(SelectedBulletZ),
  uncovered_qualifications: z.array(z.string()),
  total_score: z.number(),
  source_utilization: z.record(z.string(), z.number()),
});

export const PreResolvedResultZ = z.object({
  qualification_id: z.string(),
  category: z.enum(["education_check", "experience_years", "skill_check", "values_statement", "bullet_match"]),
  met: z.boolean(),
  evidence: z.string(),
  confidence: z.number(),
  source_section: z.string(),
});

export const ScoreResponseZ = z.object({
  job_id: z.string(),
  model_version: z.string(),
  system_prompt_hash: z.string(),
  ranked_candidates: z.array(QualCandidatesZ),
  final_selection: FinalSelectionZ,
  pre_resolved: z.array(PreResolvedResultZ).default([]),
});

export const ResolvedBulletZ = z.object({
  qualification_id: z.string(),
  bullet_id: z.string().nullable(),
  text: z.string(),
  source_id: z.string().nullable(),
  is_custom: z.boolean(),
});

export const SelectResponseZ = z.object({
  ok: z.boolean(),
  warnings: z.array(z.string()),
  resolved_bullets: z.array(ResolvedBulletZ),
});

// --------------------------------------------------------------------------- //
//  Node layer request schemas (validated at the boundary)
// --------------------------------------------------------------------------- //

export const ScoreRequestBodyZ = z.object({
  force_refresh: z.boolean().optional().default(false),
});

export const UserSelectionZ = z.object({
  qualification_id: z.string(),
  bullet_id_or_text: z.string(),
  is_custom: z.boolean().default(false),
});

export const SelectRequestBodyZ = z.object({
  selections: z.array(UserSelectionZ),
});

export const GenerateRequestBodyZ = z.object({
  selections: z.array(UserSelectionZ),
  summaryHints: z.string().optional(),
});

export const TokenQueryZ = z.object({
  token: z.string().min(1),
});

// --------------------------------------------------------------------------- //
//  Type exports
// --------------------------------------------------------------------------- //

export type SubScores = z.infer<typeof SubScoresZ>;
export type ScoredCandidate = z.infer<typeof ScoredCandidateZ>;
export type Qualification = z.infer<typeof QualificationZ>;
export type QualCandidates = z.infer<typeof QualCandidatesZ>;
export type SelectedBullet = z.infer<typeof SelectedBulletZ>;
export type FinalSelection = z.infer<typeof FinalSelectionZ>;
export type PreResolvedResult = z.infer<typeof PreResolvedResultZ>;
export type ScoreResponse = z.infer<typeof ScoreResponseZ>;
export type SelectResponse = z.infer<typeof SelectResponseZ>;
export type UserSelection = z.infer<typeof UserSelectionZ>;
