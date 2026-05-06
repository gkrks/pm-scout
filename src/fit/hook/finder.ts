/**
 * Hook finder: composes retriever + synthesizer.
 * Returns skip decision if top hook's specificity < 7.
 */

import { retrieveCandidatePairs } from "./retriever";
import { synthesizeHooks, HookCandidate } from "./synthesizer";

export interface HookFound {
  skip: false;
  primary: HookCandidate;
  alternates: HookCandidate[];
}

export interface HookSkipped {
  skip: true;
  reason: string;
  runnerUp: HookCandidate | null;
}

export type FindHookResult = HookFound | HookSkipped;

export interface FindHookOpts {
  k?: number;
  minSpecificity?: number;
}

/**
 * Find the best hook for a job. Returns skip=true if no hook
 * meets the specificity threshold (default 7).
 */
export async function findHook(
  jobId: string,
  opts: FindHookOpts = {},
): Promise<FindHookResult> {
  const k = opts.k || 20;
  const minSpecificity = opts.minSpecificity || 7;

  // Retrieve candidates
  const candidates = await retrieveCandidatePairs(jobId, k);

  if (candidates.insights.length === 0) {
    return {
      skip: true,
      reason: "No accepted insights found in master_insights. Run the insights review CLI first.",
      runnerUp: null,
    };
  }

  if (candidates.intel.length === 0) {
    return {
      skip: true,
      reason: `No company intel found for ${candidates.companyName}. Run refreshIntel first.`,
      runnerUp: null,
    };
  }

  // Synthesize hooks
  const synthesis = await synthesizeHooks({
    insights: candidates.insights,
    intel: candidates.intel,
    jdSummary: candidates.jdSummary,
  });

  if (synthesis.hooks.length === 0) {
    return {
      skip: true,
      reason: "Opus returned no hook candidates.",
      runnerUp: null,
    };
  }

  // Sort by specificity descending
  const sorted = [...synthesis.hooks].sort(
    (a, b) => b.specificity_score - a.specificity_score,
  );

  const primary = sorted[0];

  if (primary.specificity_score < minSpecificity) {
    return {
      skip: true,
      reason: `Best hook scored ${primary.specificity_score}/10 (threshold: ${minSpecificity}). "${primary.bridge_text}"`,
      runnerUp: primary,
    };
  }

  return {
    skip: false,
    primary,
    alternates: sorted.slice(1),
  };
}
