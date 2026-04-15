"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appState = void 0;
// ── Singleton app state ───────────────────────────────────────────────────────
class AppState {
    constructor() {
        this.jobs = [];
        this.jobResumes = {};
        this.scoringJobIds = new Set();
        // key: `${userId}::${jobId}`
        this.applications = {};
        this.status = {
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
        this.resume = {
            genericText: "",
            uploadedText: "",
            uploadedName: "",
        };
    }
    // Return the resume text to use for scoring (uploaded takes priority)
    activeResumeText() {
        return this.resume.uploadedText || this.resume.genericText;
    }
    hasResume() {
        return !!(this.resume.uploadedText || this.resume.genericText);
    }
    // Serialise jobs for the frontend — omit the description field
    jobsForClient() {
        return this.jobs.map(({ description: _desc, ...rest }) => rest);
    }
    statusForClient() {
        return {
            scanState: this.status.state,
            progress: this.status.progress,
            total: this.status.total,
            currentCompany: this.status.currentCompany,
            completedAt: this.status.completedAt,
            jobCount: this.status.jobCount,
            errors: this.status.errors,
            companyErrors: this.status.companyErrors,
            scoreProgress: this.status.scoreProgress,
            scoreTotal: this.status.scoreTotal,
            scoreLabel: this.status.scoreLabel,
            scoreCurrent: this.status.scoreCurrent,
            hasUploadedResume: !!this.resume.uploadedText,
            uploadedResumeName: this.resume.uploadedName,
            scoringJobIds: [...this.scoringJobIds],
            jobs: this.jobsForClient(),
        };
    }
}
exports.appState = new AppState();
//# sourceMappingURL=state.js.map