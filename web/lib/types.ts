/**
 * Shared types for the PM Scout frontend.
 * Mirrors backend shapes from src/state.ts, src/fit/types.ts, and Supabase schema.
 */

// ── Kanban / Application tracking ──────────────────────────────────────────

export type ApplicationStatus =
  | "not_started"
  | "researching"
  | "applied"
  | "phone_screen"
  | "interviewing"
  | "offer"
  | "rejected"
  | "withdrawn";

/** Kanban column IDs — "discovered" and "fit_reviewed" are virtual */
export type KanbanColumnId =
  | "discovered"
  | "fit_reviewed"
  | "applied"
  | "phone_screen"
  | "interviewing"
  | "offer"
  | "rejected";

export interface KanbanColumnDef {
  id: KanbanColumnId;
  label: string;
  collapsed?: boolean;
  /** Gradient for card left-border accent */
  gradient: string;
  /** Subtle tint for card background on hover */
  tint: string;
  /** Column header dot color */
  dot: string;
  /** Badge/count bg */
  countBg: string;
  /** Drop target ring */
  dropRing: string;
}

export const KANBAN_COLUMNS: KanbanColumnDef[] = [
  {
    id: "discovered",
    label: "Discovered",
    gradient: "from-sky-400 via-blue-500 to-indigo-500",
    tint: "",
    dot: "bg-sky-400",
    countBg: "bg-sky-400/10 text-sky-300",
    dropRing: "ring-sky-400/20",
  },
  {
    id: "fit_reviewed",
    label: "Fit Reviewed",
    gradient: "from-cyan-400 via-teal-400 to-emerald-400",
    tint: "",
    dot: "bg-teal-400",
    countBg: "bg-teal-400/10 text-teal-300",
    dropRing: "ring-teal-400/20",
  },
  {
    id: "applied",
    label: "Applied",
    gradient: "from-violet-400 via-purple-500 to-fuchsia-500",
    tint: "",
    dot: "bg-violet-400",
    countBg: "bg-violet-400/10 text-violet-300",
    dropRing: "ring-violet-400/20",
  },
  {
    id: "phone_screen",
    label: "Phone Screen",
    gradient: "from-fuchsia-400 via-pink-500 to-rose-400",
    tint: "",
    dot: "bg-pink-400",
    countBg: "bg-pink-400/10 text-pink-300",
    dropRing: "ring-pink-400/20",
  },
  {
    id: "interviewing",
    label: "Interviewing",
    gradient: "from-amber-400 via-orange-400 to-red-400",
    tint: "",
    dot: "bg-amber-400",
    countBg: "bg-amber-400/10 text-amber-300",
    dropRing: "ring-amber-400/20",
  },
  {
    id: "offer",
    label: "Offer",
    gradient: "from-emerald-400 via-green-400 to-lime-400",
    tint: "",
    dot: "bg-emerald-400",
    countBg: "bg-emerald-400/10 text-emerald-300",
    dropRing: "ring-emerald-400/20",
  },
  {
    id: "rejected",
    label: "Rejected",
    collapsed: true,
    gradient: "from-slate-500 to-zinc-600",
    tint: "",
    dot: "bg-slate-500",
    countBg: "bg-slate-500/10 text-slate-400",
    dropRing: "ring-slate-500/20",
  },
];

// ── Job listing ────────────────────────────────────────────────────────────

export interface JobListing {
  id: string;
  title: string;
  companyName: string;
  companySlug: string;
  locationCity: string | null;
  locationRaw: string | null;
  isRemote: boolean;
  isHybrid: boolean;
  roleUrl: string;
  atsPlatform: string | null;
  postedDate: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  isActive: boolean;
  yoeMin: number | null;
  yoeMax: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  hasApmProgram: boolean;
}

// ── Kanban card (listing + application state) ──────────────────────────────

export interface KanbanCard {
  id: string; // listing id
  listing: JobListing;
  columnId: KanbanColumnId;
  applicationId: string | null;
  appliedDate: string | null;
  fitScore: number | null;
  hasFitCache: boolean;
  fitToken: string;
}

// ── Application ────────────────────────────────────────────────────────────

export interface Application {
  id: string;
  listingId: string;
  status: ApplicationStatus;
  appliedDate: string | null;
  appliedBy: string | null;
  referralContact: string | null;
  notes: string | null;
  emailUsed: string | null;
  isReferral: boolean;
  referrerName: string | null;
  createdAt: string;
  updatedAt: string;
  listing: JobListing;
}

// ── Score response (mirrors src/fit/types.ts) ──────────────────────────────

export interface SubScores {
  keyword: number;
  semantic: number;
  evidence: number;
  quantification: number;
  seniority: number;
  recency: number;
}

export interface ScoredCandidate {
  bullet_id: string;
  source_id: string;
  source_label: string;
  text: string;
  match_score: number;
  confidence: number;
  sub_scores: SubScores;
  rationale: string;
  supporting_span: string;
}

export interface Qualification {
  id: string;
  kind: "basic" | "preferred";
  text: string;
}

export interface QualCandidates {
  qualification: Qualification;
  candidates: ScoredCandidate[];
}

export interface SelectedBullet {
  bullet_id: string;
  source_id: string;
  covers_qualifications: string[];
}

export interface FinalSelection {
  selected_bullets: SelectedBullet[];
  uncovered_qualifications: string[];
  uncovered_keywords: string[];
  impossible_keywords: string[];
  total_score: number;
  source_utilization: Record<string, number>;
}

export interface PreResolvedResult {
  qualification_id: string;
  category: string;
  met: boolean;
  evidence: string;
  confidence: number;
  source_section: string;
}

export interface ScoreResponse {
  job_id: string;
  model_version: string;
  ranked_candidates: QualCandidates[];
  final_selection: FinalSelection;
  pre_resolved: PreResolvedResult[];
  summary_candidates?: { text: string; reasoning: string }[];
  summary_recommended?: number;
  summary_jd_analysis?: string;
  optimized_skills?: { name?: string; category?: string; list?: string; items?: string[] }[];
  skills_gap_filled?: string[];
  skills_gap_remaining?: string[];
}

export interface UserSelection {
  qualification_id: string;
  bullet_id_or_text: string;
  is_custom: boolean;
}

// ── Wizard types ─────────────────────────────────────────────────────────────

export type WizardStepId =
  | "jd_analysis"
  | "summary"
  | "requirement"
  | "fill_remaining"
  | "skills"
  | "generate"
  | "outreach";

export interface LockedBullet {
  qualificationId: string;
  bulletId: string;
  sourceId: string;
  sourceLabel: string;
  originalText: string;
  rewrittenText: string | null;
  whyItMaps: string | null;
  keywordsEmbedded: string[];
  formatUsed: "xyz" | "car" | null;
  similarityScore: number | null;
  isTraitSkip: boolean;
}

export interface AllocationEntry {
  sourceId: string;
  sourceLabel: string;
  bulletCount: number;
  maxBullets: number;
  bulletIds: string[];
}

export interface RewriteSuggestion {
  text: string;
  char_count: number;
  keywords_embedded: string[];
  was_rewritten: boolean;
}

export interface MatchedCandidateUI {
  bullet_id: string;
  source: string;
  source_id: string;
  original_text: string;
  rewritten_text: string;
  char_count: number;
  format_used: "xyz" | "car";
  keywords_embedded: string[];
  why_it_maps: string;
}
