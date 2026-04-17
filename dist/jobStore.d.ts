/**
 * jobStore — scan-to-scan job diffing with stable fingerprints.
 *
 * Fingerprint = SHA-1( normalized(company) | normalized(title) | normalized(location) )
 * Does NOT include the URL — Google/Meta URLs are session-specific and change.
 *
 * Persistence: data/jobStore.json (excluded from git).
 * On Render free (ephemeral FS), store survives within a deployment session.
 * On server restart all jobs appear "new" for the first scan, then diffs work.
 *
 * isNew TTL: 3 days — job stays flagged "new" for 3 days after firstSeenAt.
 */
import { Job } from "./state";
export declare function jobFingerprint(company: string, title: string, location: string): string;
/**
 * Diff incoming jobs against the stored snapshot.
 * Returns jobs with firstSeenAt and isNew populated.
 * Persists updated store to disk.
 */
export declare function applyJobDiff(jobs: Job[]): Job[];
//# sourceMappingURL=jobStore.d.ts.map