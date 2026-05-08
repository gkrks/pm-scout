/**
 * Typed API client for PM Scout Express BFF.
 * All requests go to the Express server on :3847 (or via proxy in production).
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3847";

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(
      body?.error || `Request failed: ${res.status}`,
      res.status,
      body
    );
  }

  return res.json() as Promise<T>;
}

// ── Kanban / Applications ──────────────────────────────────────────────────

export function fetchKanbanCards(token: string) {
  return request<{ cards: import("./types").KanbanCard[] }>(
    `/tracker/kanban?token=${token}`
  );
}

export function createApplication(
  listingId: string,
  status: string,
  token: string
) {
  return request<{
    ok: boolean;
    application: { id: string; listing_id: string; status: string; applied_date: string | null };
  }>(`/tracker/api/applications?token=${token}`, {
    method: "POST",
    body: JSON.stringify({ listing_id: listingId, status }),
  });
}

export function updateApplication(
  id: string,
  updates: { status?: string; referral_contact?: string; notes?: string },
  token: string
) {
  return request<{ ok: boolean; updated: Record<string, unknown> }>(
    `/tracker/api/applications/${id}?token=${token}`,
    { method: "PATCH", body: JSON.stringify(updates) }
  );
}

// ── Jobs list ─────────────────────────────────────────────────────────────

export function fetchJobs(token: string) {
  return request<{
    jobs: {
      id: string;
      title: string;
      companyName: string;
      companySlug: string;
      locationCity: string | null;
      isRemote: boolean;
      isHybrid: boolean;
      atsPlatform: string | null;
      postedDate: string | null;
      firstSeenAt: string;
      isActive: boolean;
      yoeMin: number | null;
      yoeMax: number | null;
      roleUrl: string;
      hasApmProgram: boolean;
    }[];
  }>(`/api/jobs?token=${token}`);
}

// ── Dashboard ─────────────────────────────────────────────────────────────

export function fetchDashboard(token: string, from?: string, to?: string) {
  let url = `/dashboard?token=${token}`;
  if (from) url += `&from=${from}`;
  if (to) url += `&to=${to}`;
  return request<Record<string, unknown>>(url);
}

// ── Application detail ────────────────────────────────────────────────────

export function fetchApplication(id: string, token: string) {
  return request<Record<string, unknown>>(
    `/api/applications/${id}?token=${token}`
  );
}

// ── Fit endpoints ──────────────────────────────────────────────────────────

export interface FitListingData {
  jobId: string;
  companyName: string;
  companySlug: string;
  title: string;
  location: string;
  isRemote: boolean;
  isHybrid: boolean;
  ats: string;
  postedDate: string | null;
  firstSeenAt: string | null;
  roleUrl: string;
  requiredQuals: string[];
  preferredQuals: string[];
  responsibilities: string[];
  roleContext: string;
  emails: string[];
  applicationStatus: {
    applied: boolean;
    appliedBy: string;
    appliedDate: string;
    status: string;
  } | null;
}

export function fetchFitListing(jobId: string, token: string) {
  return request<FitListingData>(
    `/fit/${jobId}?token=${token}`
  );
}

export function submitUrl(url: string, token: string) {
  return request<{
    jobId: string;
    token: string;
    existing: boolean;
    redirectUrl: string;
  }>(`/fit/submit-url?token=${token}`, {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export function scoreFit(jobId: string, token: string, forceRefresh = false) {
  return request<import("./types").ScoreResponse>(
    `/fit/${jobId}/score?token=${token}`,
    {
      method: "POST",
      body: JSON.stringify({ force_refresh: forceRefresh }),
    }
  );
}

export function selectBullets(
  jobId: string,
  token: string,
  selections: import("./types").UserSelection[]
) {
  return request(`/fit/${jobId}/select?token=${token}`, {
    method: "POST",
    body: JSON.stringify({ selections }),
  });
}

export function generateResume(
  jobId: string,
  token: string,
  body: {
    selections: import("./types").UserSelection[];
    summaryHints?: string;
    email?: string;
    customSkills?: string[];
    skillEdits?: Record<string, string>;
    skillDeletions?: number[];
    newSkillSections?: { name: string; list: string }[];
  }
) {
  return request<{
    status: string;
    basename: string;
    summaryUsed: string;
    summaryWarning?: string;
  }>(`/fit/${jobId}/generate?token=${token}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function markApplied(jobId: string, token: string, appliedBy: string) {
  return request<{
    ok: boolean;
    already_applied: boolean;
    applied_by: string;
    applied_date: string;
  }>(`/fit/${jobId}/apply?token=${token}`, {
    method: "POST",
    body: JSON.stringify({ applied_by: appliedBy }),
  });
}

export function generateCoverLetter(
  jobId: string,
  token: string,
  bulletTexts: string[],
  email?: string
) {
  return request(`/fit/${jobId}/cover-letter?token=${token}`, {
    method: "POST",
    body: JSON.stringify({ bulletTexts, email }),
  });
}

export function generateOutreach(
  jobId: string,
  token: string,
  mode: string,
  personIntel?: { text: string; name: string; title: string },
  email?: string
) {
  return request(`/fit/${jobId}/outreach?token=${token}`, {
    method: "POST",
    body: JSON.stringify({ mode, personIntel, email }),
  });
}

export function refreshIntel(jobId: string, token: string) {
  return request(`/fit/${jobId}/intel/refresh?token=${token}`, {
    method: "POST",
  });
}

export interface MatchedCandidate {
  bullet_id: string;
  source: string;
  source_id: string;
  source_type: "experience" | "project";
  original_text: string;
  similarity_score: number;
  matched_keywords: string[];
  unmatched_keywords: string[];
}

export function matchRequirement(
  jobId: string,
  token: string,
  body: {
    qualification_text: string;
    locked_bullet_ids?: string[];
    source_type_filter?: "experience" | "project";
  }
) {
  return request<{
    qualification: string;
    candidates: MatchedCandidate[];
  }>(`/fit/${jobId}/match-requirement?token=${token}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function rewriteBullet(
  jobId: string,
  token: string,
  body: {
    bullet_id: string;
    bullet_text: string;
    target_qualification: string;
    keywords_to_embed?: string[];
  }
) {
  return request<{
    suggestions: Array<{
      text: string;
      char_count: number;
      keywords_embedded: string[];
      was_rewritten: boolean;
    }>;
  }>(`/fit/${jobId}/rewrite-bullet?token=${token}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function downloadUrl(
  jobId: string,
  format: "pdf" | "docx",
  token: string
) {
  return `${API_BASE}/fit/${jobId}/download/${format}?token=${token}`;
}

export { ApiError };
