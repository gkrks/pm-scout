/**
 * Wizard state management for the interactive resume builder.
 * Single useReducer drives the entire step-by-step flow.
 *
 * lockedBullets: Map<qualId, LockedBullet[]> — supports multiple bullets per requirement.
 */

import type {
  WizardStepId,
  LockedBullet,
  AllocationEntry,
  ScoreResponse,
  QualCandidates,
  UserSelection,
} from "./types";

// ── Step ordering ────────────────────────────────────────────────────────────

const STEP_ORDER: WizardStepId[] = [
  "jd_analysis",
  "summary",
  "requirement",
  "fill_remaining",
  "skills",
  "generate",
  "outreach",
];

const DEFAULT_SOURCE_MAX = 2;
const GLOBAL_BULLET_CAP = 12;

// ── State ────────────────────────────────────────────────────────────────────

export interface WizardState {
  currentStep: WizardStepId;
  reqIndex: number;
  totalReqs: number;

  // Locked decisions — array per qual supports multiple bullets per requirement
  lockedBullets: Map<string, LockedBullet[]>;
  summaryChoice: number | "custom";
  customSummaryText: string;
  summaryCandidateEdits: Map<number, string>;
  summaryLocked: boolean;
  skillEdits: Record<string, string>;
  skillDeletions: Set<number>;
  addedSkills: Map<string, string[]>;
  newSkillSections: { name: string; list: string }[];
  skillsLocked: boolean;

  // Derived
  allocation: AllocationEntry[];
  totalBulletsAssigned: number;
  remainingSlots: number;

  generated: { basename: string; summaryWarning: string | null } | null;
  completedSteps: Set<WizardStepId>;
}

// ── Actions ──────────────────────────────────────────────────────────────────

export type WizardAction =
  | { type: "GOTO_STEP"; step: WizardStepId }
  | { type: "NEXT_STEP" }
  | { type: "PREV_STEP" }
  | { type: "NEXT_REQ" }
  | { type: "PREV_REQ" }
  | { type: "LOCK_BULLET"; qualId: string; bullet: LockedBullet }
  | { type: "SKIP_TRAIT_REQ"; qualId: string }
  | { type: "UNLOCK_ALL_BULLETS"; qualId: string }
  | { type: "UNLOCK_SINGLE_BULLET"; qualId: string; bulletId: string }
  | { type: "SET_REWRITE"; qualId: string; bulletId: string; rewrittenText: string }
  | { type: "LOCK_SUMMARY"; choice: number | "custom"; customText?: string }
  | { type: "EDIT_SUMMARY_CANDIDATE"; index: number; text: string }
  | { type: "EDIT_SKILL"; key: string; value: string }
  | { type: "DELETE_SKILL"; idx: number }
  | { type: "UNDO_DELETE_SKILL"; idx: number }
  | { type: "ADD_SKILL"; category: string; skill: string }
  | { type: "REMOVE_ADDED_SKILL"; category: string; skill: string }
  | { type: "ADD_SKILL_SECTION"; name: string; list: string }
  | { type: "REMOVE_SKILL_SECTION"; index: number }
  | { type: "LOCK_SKILLS" }
  | { type: "SET_GENERATED"; basename: string; warning: string | null };

// ── Helpers: flatten locked bullets ─────────────────────────────────────────

/** Iterate all locked bullets across all qualifications */
export function flatLockedBullets(lockedBullets: Map<string, LockedBullet[]>): LockedBullet[] {
  const result: LockedBullet[] = [];
  for (const arr of lockedBullets.values()) {
    for (const lb of arr) result.push(lb);
  }
  return result;
}

// ── Allocation recomputation ────────────────────────────────────────────────

function recomputeAllocation(lockedBullets: Map<string, LockedBullet[]>): {
  allocation: AllocationEntry[];
  totalBulletsAssigned: number;
} {
  const sourceMap = new Map<string, { label: string; bulletIds: string[] }>();

  for (const lb of flatLockedBullets(lockedBullets)) {
    if (lb.isTraitSkip) continue;
    const entry = sourceMap.get(lb.sourceId) || { label: lb.sourceLabel, bulletIds: [] };
    if (!entry.bulletIds.includes(lb.bulletId)) {
      entry.bulletIds.push(lb.bulletId);
    }
    sourceMap.set(lb.sourceId, entry);
  }

  const allocation: AllocationEntry[] = [];
  let total = 0;

  for (const [sourceId, { label, bulletIds }] of sourceMap) {
    allocation.push({
      sourceId,
      sourceLabel: label,
      bulletCount: bulletIds.length,
      maxBullets: DEFAULT_SOURCE_MAX,
      bulletIds,
    });
    total += bulletIds.length;
  }

  allocation.sort((a, b) => b.bulletCount - a.bulletCount);
  return { allocation, totalBulletsAssigned: total };
}

// ── Initializer ─────────────────────────────────────────────────────────────

export function initWizardState(scoreData: ScoreResponse): WizardState {
  const lockedBullets = new Map<string, LockedBullet[]>();
  const { allocation, totalBulletsAssigned } = recomputeAllocation(lockedBullets);

  return {
    currentStep: "jd_analysis",
    reqIndex: 0,
    totalReqs: scoreData.ranked_candidates.length,
    lockedBullets,
    summaryChoice: scoreData.summary_recommended ?? 0,
    customSummaryText: "",
    summaryCandidateEdits: new Map(),
    summaryLocked: false,
    skillEdits: {},
    skillDeletions: new Set(),
    addedSkills: new Map(),
    newSkillSections: [],
    skillsLocked: false,
    allocation,
    totalBulletsAssigned,
    remainingSlots: GLOBAL_BULLET_CAP - totalBulletsAssigned,
    generated: null,
    completedSteps: new Set(),
  };
}

// ── Reducer ─────────────────────────────────────────────────────────────────

function withAllocation(state: WizardState, lockedBullets: Map<string, LockedBullet[]>): WizardState {
  const { allocation, totalBulletsAssigned } = recomputeAllocation(lockedBullets);
  return {
    ...state,
    lockedBullets,
    allocation,
    totalBulletsAssigned,
    remainingSlots: GLOBAL_BULLET_CAP - totalBulletsAssigned,
  };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "GOTO_STEP":
      return { ...state, currentStep: action.step };

    case "NEXT_STEP": {
      const idx = STEP_ORDER.indexOf(state.currentStep);
      if (idx < STEP_ORDER.length - 1) {
        const completed = new Set(state.completedSteps);
        completed.add(state.currentStep);
        return { ...state, currentStep: STEP_ORDER[idx + 1], completedSteps: completed };
      }
      return state;
    }

    case "PREV_STEP": {
      const idx = STEP_ORDER.indexOf(state.currentStep);
      return idx > 0 ? { ...state, currentStep: STEP_ORDER[idx - 1] } : state;
    }

    case "NEXT_REQ": {
      if (state.reqIndex < state.totalReqs - 1) {
        return { ...state, reqIndex: state.reqIndex + 1 };
      }
      const completed = new Set(state.completedSteps);
      completed.add("requirement");
      return { ...state, currentStep: "fill_remaining", completedSteps: completed };
    }

    case "PREV_REQ":
      return state.reqIndex > 0 ? { ...state, reqIndex: state.reqIndex - 1 } : state;

    case "LOCK_BULLET": {
      const next = new Map(state.lockedBullets);
      const existing = next.get(action.qualId) || [];
      // Don't add duplicate bullet IDs
      if (!existing.some((lb) => lb.bulletId === action.bullet.bulletId && !lb.isTraitSkip)) {
        next.set(action.qualId, [...existing.filter((lb) => !lb.isTraitSkip), action.bullet]);
      }
      return withAllocation(state, next);
    }

    case "SKIP_TRAIT_REQ": {
      const next = new Map(state.lockedBullets);
      next.set(action.qualId, [{
        qualificationId: action.qualId,
        bulletId: "",
        sourceId: "",
        sourceLabel: "",
        originalText: "",
        rewrittenText: null,
        whyItMaps: null,
        keywordsEmbedded: [],
        formatUsed: null,
        similarityScore: null,
        isTraitSkip: true,
      }]);
      return { ...state, lockedBullets: next };
    }

    case "UNLOCK_ALL_BULLETS": {
      const next = new Map(state.lockedBullets);
      next.delete(action.qualId);
      return withAllocation(state, next);
    }

    case "UNLOCK_SINGLE_BULLET": {
      const next = new Map(state.lockedBullets);
      const existing = next.get(action.qualId) || [];
      const filtered = existing.filter((lb) => lb.bulletId !== action.bulletId);
      if (filtered.length === 0) {
        next.delete(action.qualId);
      } else {
        next.set(action.qualId, filtered);
      }
      return withAllocation(state, next);
    }

    case "SET_REWRITE": {
      const next = new Map(state.lockedBullets);
      const existing = next.get(action.qualId);
      if (!existing) return state;
      next.set(action.qualId, existing.map((lb) =>
        lb.bulletId === action.bulletId ? { ...lb, rewrittenText: action.rewrittenText } : lb
      ));
      return { ...state, lockedBullets: next };
    }

    case "LOCK_SUMMARY":
      return {
        ...state,
        summaryChoice: action.choice,
        customSummaryText: action.customText ?? state.customSummaryText,
        summaryLocked: true,
      };

    case "EDIT_SUMMARY_CANDIDATE": {
      const next = new Map(state.summaryCandidateEdits);
      next.set(action.index, action.text);
      return { ...state, summaryCandidateEdits: next };
    }

    case "EDIT_SKILL":
      return { ...state, skillEdits: { ...state.skillEdits, [action.key]: action.value } };

    case "DELETE_SKILL": {
      const next = new Set(state.skillDeletions);
      next.add(action.idx);
      return { ...state, skillDeletions: next };
    }

    case "UNDO_DELETE_SKILL": {
      const next = new Set(state.skillDeletions);
      next.delete(action.idx);
      return { ...state, skillDeletions: next };
    }

    case "ADD_SKILL": {
      const next = new Map(state.addedSkills);
      const existing = next.get(action.category) || [];
      if (!existing.includes(action.skill)) {
        next.set(action.category, [...existing, action.skill]);
      }
      return { ...state, addedSkills: next };
    }

    case "REMOVE_ADDED_SKILL": {
      const next = new Map(state.addedSkills);
      const existing = next.get(action.category) || [];
      const filtered = existing.filter((s) => s !== action.skill);
      filtered.length === 0 ? next.delete(action.category) : next.set(action.category, filtered);
      return { ...state, addedSkills: next };
    }

    case "ADD_SKILL_SECTION":
      return { ...state, newSkillSections: [...state.newSkillSections, { name: action.name, list: action.list }] };

    case "REMOVE_SKILL_SECTION":
      return { ...state, newSkillSections: state.newSkillSections.filter((_, i) => i !== action.index) };

    case "LOCK_SKILLS":
      return { ...state, skillsLocked: true };

    case "SET_GENERATED":
      return { ...state, generated: { basename: action.basename, summaryWarning: action.warning } };

    default:
      return state;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build UserSelection[] from locked bullets for the /generate endpoint */
export function buildSelectionsFromLocked(
  lockedBullets: Map<string, LockedBullet[]>
): UserSelection[] {
  const selections: UserSelection[] = [];
  for (const [qualId, bullets] of lockedBullets) {
    for (const lb of bullets) {
      if (lb.isTraitSkip) continue;
      selections.push({
        qualification_id: qualId,
        bullet_id_or_text: lb.rewrittenText || lb.bulletId,
        is_custom: !!lb.rewrittenText,
      });
    }
  }
  return selections;
}

export function stepLabel(step: WizardStepId): string {
  switch (step) {
    case "jd_analysis": return "JD Analysis";
    case "summary": return "Summary";
    case "requirement": return "Requirements";
    case "fill_remaining": return "Fill Remaining";
    case "skills": return "Skills";
    case "generate": return "Generate";
    case "outreach": return "Outreach";
  }
}

export { STEP_ORDER, GLOBAL_BULLET_CAP };
