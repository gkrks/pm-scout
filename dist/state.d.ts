import { MatchResult } from "./matcher";
export interface ApplicationRecord {
    userId: string;
    jobId: string;
    email: string;
    appliedAt: string;
}
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
    workType: string;
    datePosted: string;
    applyUrl: string;
    careersUrl: string;
    earlyCareer: boolean;
    description: string;
    matchScore?: number;
    requirements?: MatchResult[];
    summary?: RequirementsSummary;
    resumeAction?: string;
    scoredWith?: string;
}
export interface ScanStatus {
    state: string;
    progress: number;
    total: number;
    currentCompany: string;
    completedAt: string;
    jobCount: number;
    errors: number;
    scoreProgress: number;
    scoreTotal: number;
    scoreLabel: string;
    scoreCurrent: string;
}
export interface ResumeState {
    genericText: string;
    uploadedText: string;
    uploadedName: string;
}
declare class AppState {
    jobs: Job[];
    jobResumes: Record<string, {
        text: string;
        name: string;
    }>;
    scoringJobIds: Set<string>;
    applications: Record<string, ApplicationRecord>;
    status: ScanStatus;
    resume: ResumeState;
    activeResumeText(): string;
    hasResume(): boolean;
    jobsForClient(): Omit<Job, "description">[];
    statusForClient(): {
        scanState: string;
        progress: number;
        total: number;
        currentCompany: string;
        completedAt: string;
        jobCount: number;
        errors: number;
        scoreProgress: number;
        scoreTotal: number;
        scoreLabel: string;
        scoreCurrent: string;
        hasUploadedResume: boolean;
        uploadedResumeName: string;
        scoringJobIds: string[];
        jobs: Omit<Job, "description">[];
    };
}
export declare const appState: AppState;
export {};
//# sourceMappingURL=state.d.ts.map