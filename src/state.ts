import { MatchResult } from "./matcher";
import type { ExtractedJD } from "./types/extractedJD";

export interface ApplicationRecord {
  userId: string;
  jobId: string;
  email: string;
  appliedAt: string; // ISO timestamp
}

// ── Job ───────────────────────────────────────────────────────────────────────

export interface RequirementsSummary {
  met: number;
  partial: number;
  missing: number;
  score: number;
}

export interface Job {
  id: string;
  company: string;
  title: string;
  location: string;
  workType: string;   // "Remote" | "Hybrid" | "Onsite" | "—"
  datePosted: string;
  applyUrl: string;
  careersUrl: string;    // company careers portal
  earlyCareer: boolean;
  yoeMin?: number | null;  // from jd_required_qualifications (LLM-extracted)
  yoeMax?: number | null;
  description: string; // raw HTML — never sent to frontend

  tier?: "T0" | "T1" | "T2" | "T3" | "T3R"; // Company's target-list tier (legacy)
  pmTier?: 1 | 2 | 3;                         // PM job tier (1=apply today, 2=this week, 3=review)
  apmSignal?: "priority_apm" | "apm_company" | "none"; // APM priority lane (Bug Fix 15)
  category?: string;                           // Company category from JSON (e.g. "AI Labs")
  domainTags?: string[];                       // e.g. ["ai", "fintech"]
  sponsorshipOffered?: boolean | null;         // true=yes, false=no, null=unclear

  // Scan diffing (set by jobStore after each scan)
  firstSeenAt?: string;  // ISO timestamp of first scan this job appeared in
  isNew?: boolean;       // true if firstSeenAt is within the last 3 days

  // Scoring (undefined = not yet scored)
  matchScore?: number;
  requirements?: MatchResult[];
  summary?: RequirementsSummary;
  resumeAction?: string; // "apply_as_is" | "tailor_then_apply" | "skip"
  scoredWith?: string;   // "generic" | "uploaded"
  sourceLabel?: string;  // undefined = official ATS, "scraper-failed" = primary scrape failed

  // JD extraction (populated for new/reactivated listings)
  extractedJD?: ExtractedJD;

  // Supabase UUID (populated after upsert, used for Check Fit links)
  supabaseId?: string;
}

// ── Scan / score status ───────────────────────────────────────────────────────

export interface CompanyError {
  name: string;
  reason: string;
  careersUrl: string;
}

export interface ScanStatus {
  state: string;          // "idle" | "scanning" | "scoring" | "done"
  progress: number;
  total: number;
  currentCompany: string;
  currentPool: string;    // "api" | "playwright" | "" — which pool is active
  completedAt: string;
  jobCount: number;
  errors: number;
  companyErrors: CompanyError[];
  // Live counters updated each time a company result arrives
  companiesScanned: number;
  companiesFailed: number;
  listingsFound: number;
  runStartedAt: string;   // ISO timestamp of current run start
  // Scoring phase
  scoreProgress: number;
  scoreTotal: number;
  scoreLabel: string;     // "generic" | "uploaded" | ""
  scoreCurrent: string;   // "Company — Title" being scored right now
}

// ── Resume state ──────────────────────────────────────────────────────────────

export interface ResumeState {
  genericText: string;    // extracted from GENERIC_RESUME_PATH at startup
  uploadedText: string;   // extracted from the last uploaded PDF
  uploadedName: string;   // original filename shown in the toolbar
}

// ── Singleton app state ───────────────────────────────────────────────────────

class AppState {
  jobs: Job[] = [];
  scanDays = 180; // how far back to fetch jobs (0 = no cutoff)
  jobResumes: Record<string, { text: string; name: string }> = {};
  scoringJobIds: Set<string> = new Set();
  // key: `${userId}::${jobId}`
  applications: Record<string, ApplicationRecord> = {};
  status: ScanStatus = {
    state: "idle",
    progress: 0,
    total: 0,
    currentCompany: "",
    currentPool: "",
    completedAt: "",
    jobCount: 0,
    errors: 0,
    companyErrors: [],
    companiesScanned: 0,
    companiesFailed: 0,
    listingsFound: 0,
    runStartedAt: "",
    scoreProgress: 0,
    scoreTotal: 0,
    scoreLabel: "",
    scoreCurrent: "",
  };
  resume: ResumeState = {
    genericText: "",
    uploadedText: "",
    uploadedName: "",
  };

  // Return the resume text to use for scoring (uploaded takes priority)
  activeResumeText(): string {
    return this.resume.uploadedText || this.resume.genericText;
  }

  hasResume(): boolean {
    return !!(this.resume.uploadedText || this.resume.genericText);
  }

  // Serialise jobs for the frontend — omit the description field
  jobsForClient(): Omit<Job, "description">[] {
    return this.jobs.map(({ description: _desc, ...rest }) => rest);
  }

  statusForClient() {
    return {
      scanState:          this.status.state,
      progress:           this.status.progress,
      total:              this.status.total,
      currentCompany:     this.status.currentCompany,
      currentPool:        this.status.currentPool,
      completedAt:        this.status.completedAt,
      jobCount:           this.status.jobCount,
      errors:             this.status.errors,
      companyErrors:      this.status.companyErrors,
      companiesScanned:   this.status.companiesScanned,
      companiesFailed:    this.status.companiesFailed,
      listingsFound:      this.status.listingsFound,
      runStartedAt:       this.status.runStartedAt,
      scoreProgress:      this.status.scoreProgress,
      scoreTotal:         this.status.scoreTotal,
      scoreLabel:         this.status.scoreLabel,
      scoreCurrent:       this.status.scoreCurrent,
      hasUploadedResume:  !!this.resume.uploadedText,
      uploadedResumeName: this.resume.uploadedName,
      scoringJobIds:      [...this.scoringJobIds],
      jobs:               this.jobsForClient(),
    };
  }
}

export const appState = new AppState();
