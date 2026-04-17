import { MatchResult } from "./matcher";

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
  description: string; // raw HTML — never sent to frontend

  // Scan diffing (set by jobStore after each scan)
  firstSeenAt?: string;  // ISO timestamp of first scan this job appeared in
  isNew?: boolean;       // true if firstSeenAt is within the last 3 days

  // Scoring (undefined = not yet scored)
  matchScore?: number;
  requirements?: MatchResult[];
  summary?: RequirementsSummary;
  resumeAction?: string; // "apply_as_is" | "tailor_then_apply" | "skip"
  scoredWith?: string;   // "generic" | "uploaded"
  sourceLabel?: string;  // undefined = official ATS, "LinkedIn" = aggregator fallback
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
  completedAt: string;
  jobCount: number;
  errors: number;
  companyErrors: CompanyError[];
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
    completedAt: "",
    jobCount: 0,
    errors: 0,
    companyErrors: [],
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
      completedAt:        this.status.completedAt,
      jobCount:           this.status.jobCount,
      errors:             this.status.errors,
      companyErrors:      this.status.companyErrors,
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
