/**
 * companyDetector.ts
 *
 * Given a company name (and optional careers URL hint), detects the correct
 * ATS platform and slug so we can scrape jobs immediately.
 *
 * Detection order:
 *   1. Greenhouse boards-api
 *   2. Lever postings API
 *   3. Ashby posting-api
 *   4. LinkedIn guest search (company name as keyword — no company ID needed)
 */

import fetch from "node-fetch";
import { Company } from "./companies";

const FETCH_TIMEOUT = 10_000;

// ── Slug generation ───────────────────────────────────────────────────────────

const STRIP_SUFFIXES = /\s+(inc\.?|llc\.?|corp\.?|corporation|technologies|technology|labs?|software|health|ai|co\.?|group|solutions|systems)\s*$/i;

export function generateSlugs(name: string): string[] {
  const lower = name.toLowerCase().trim();
  const noSuffix = lower.replace(STRIP_SUFFIXES, "").trim();

  const variants = [lower, noSuffix]
    .flatMap((s) => [
      s.replace(/[^a-z0-9]/g, ""),       // "acme corp"  → "acmecorp"
      s.replace(/[^a-z0-9]/g, "-"),       // "acme corp"  → "acme-corp"
      s.replace(/\s+/g, ""),              // keep spaces only collapsed
    ]);

  return [...new Set(variants)].filter(Boolean);
}

// ── Individual platform probes ────────────────────────────────────────────────

async function probeGreenhouse(slug: string): Promise<number | null> {
  try {
    const r = await (fetch as any)(
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
      { timeout: FETCH_TIMEOUT }
    );
    if (!r.ok) return null;
    const d = await r.json() as { jobs?: unknown[] };
    return (d.jobs ?? []).length;
  } catch {
    return null;
  }
}

async function probeLever(slug: string): Promise<number | null> {
  try {
    const r = await (fetch as any)(
      `https://api.lever.co/v0/postings/${slug}?mode=json`,
      { timeout: FETCH_TIMEOUT }
    );
    if (!r.ok) return null;
    const d = await r.json() as unknown[];
    return Array.isArray(d) ? d.length : null;
  } catch {
    return null;
  }
}

async function probeAshby(slug: string): Promise<number | null> {
  try {
    const r = await (fetch as any)(
      `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
      { timeout: FETCH_TIMEOUT }
    );
    if (!r.ok) return null;
    const d = await r.json() as { jobs?: unknown[]; jobPostings?: unknown[] };
    return (d.jobs ?? d.jobPostings ?? []).length;
  } catch {
    return null;
  }
}

// ── LinkedIn keyword probe ────────────────────────────────────────────────────
// When no ATS is found we verify the company has PM listings on LinkedIn by
// doing a keyword search (company name + "product manager"). We don't get a
// company ID, so the slug is used as the keyword identifier.

const LI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function probeLinkedInKeyword(companyName: string): Promise<boolean> {
  try {
    const kw = encodeURIComponent(`product manager ${companyName}`);
    const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${kw}&location=United+States&start=0&count=5`;
    const r = await (fetch as any)(url, {
      headers: { "User-Agent": LI_UA },
      timeout: FETCH_TIMEOUT,
    });
    if (!r.ok) return false;
    const html: string = await r.text();
    // Check if any results contain the company name
    return html.toLowerCase().includes(companyName.toLowerCase().split(/\s+/)[0]);
  } catch {
    return false;
  }
}

// ── Main detector ─────────────────────────────────────────────────────────────

export interface DetectionResult {
  platform: Company["platform"];
  slug: string;
  careersUrl: string;
  linkedInId?: string;
  jobCount: number;
  source: string; // human-readable label for UI
}

export async function detectCompany(
  name: string,
  careersUrlHint?: string,
): Promise<DetectionResult> {
  const slugs = generateSlugs(name);

  // Run all platform × slug probes in parallel
  type Probe = { platform: "greenhouse" | "lever" | "ashby"; slug: string; count: number };
  const probePromises: Promise<Probe | null>[] = [];

  for (const slug of slugs) {
    probePromises.push(
      probeGreenhouse(slug).then((c) =>
        c !== null && c > 0 ? { platform: "greenhouse" as const, slug, count: c } : null
      )
    );
    probePromises.push(
      probeLever(slug).then((c) =>
        c !== null && c > 0 ? { platform: "lever" as const, slug, count: c } : null
      )
    );
    probePromises.push(
      probeAshby(slug).then((c) =>
        c !== null && c > 0 ? { platform: "ashby" as const, slug, count: c } : null
      )
    );
  }

  const results = await Promise.all(probePromises);
  const hit = results.find((r): r is Probe => r !== null);

  if (hit) {
    const careersUrl = careersUrlHint ?? buildCareersUrl(hit.platform, hit.slug, name);
    return {
      platform: hit.platform,
      slug: hit.slug,
      careersUrl,
      jobCount: hit.count,
      source: `${hit.platform} API (${hit.slug})`,
    };
  }

  // LinkedIn keyword fallback
  const hasLinkedIn = await probeLinkedInKeyword(name);
  if (hasLinkedIn) {
    const slug = slugs[0];
    return {
      platform: "linkedin",
      slug,
      careersUrl: careersUrlHint ?? `https://www.linkedin.com/company/${slug}/jobs/`,
      jobCount: -1, // unknown until scraped
      source: "LinkedIn (keyword search)",
    };
  }

  // Nothing found
  throw new Error(
    `No accessible job feed found for "${name}". ` +
    `The company may use a proprietary ATS or block automated access.`
  );
}

// ── Careers URL inference ─────────────────────────────────────────────────────

function buildCareersUrl(
  platform: "greenhouse" | "lever" | "ashby",
  slug: string,
  name: string,
): string {
  if (platform === "greenhouse") return `https://boards.greenhouse.io/${slug}`;
  if (platform === "lever")      return `https://jobs.lever.co/${slug}`;
  // ashby
  return `https://jobs.ashbyhq.com/${slug}`;
}
