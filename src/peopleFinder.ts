/**
 * peopleFinder — identifies real hiring managers using LinkedIn scraping + Claude.
 *
 * Two-pass approach:
 *   Pass 1 (Claude): extract JD signals, infer org structure, produce title keywords
 *                    to search for on LinkedIn.
 *   Pass 2 (Playwright): scrape DuckDuckGo + LinkedIn guest search for real profiles
 *                        matching those keywords at the company.
 *   Pass 3 (Claude): rank the real scraped profiles by hiring manager probability,
 *                    add reasoning and outreach angles.
 */

import Anthropic from "@anthropic-ai/sdk";
import { Job } from "./state";
import { findLinkedInProfiles, LIPerson } from "./linkedInScraper";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface PFCandidate {
  name: string;
  title: string;
  url: string;        // Real LinkedIn profile URL (from scraping)
  team: string;
  reasoning: string;
  confidence: number; // 0–100
  outreach?: string;  // 2-3 line message for top candidates
}

export interface PFResult {
  signals: string;
  orgHypothesis: string;
  candidates: PFCandidate[];
  eliminated: string[];
  linkedInSearches: { label: string; url: string }[];
  scrapedCount: number;  // how many raw profiles the scraper found
}

// ── Pass 1: extract signals + title keywords ──────────────────────────────────

interface Pass1Result {
  signals: string;
  orgHypothesis: string;
  titleKeywords: string;   // e.g. "Senior PM OR Group PM OR Director of Product"
  teamArea: string;        // e.g. "Payments Growth"
}

const PASS1_PROMPT = `You are a talent intelligence analyst. Analyze this job posting and return a JSON object with:
{
  "signals": "2-3 sentence summary: product area, team function, seniority, scope keywords",
  "orgHypothesis": "Probable org + reporting chain. State assumptions explicitly.",
  "titleKeywords": "LinkedIn search keyword string for the hiring manager's title — use OR between variants, e.g. 'Senior PM OR Group PM OR Director of Product OR Head of Product'",
  "teamArea": "Short team/product area label, e.g. 'Payments Growth' or 'Ads Platform'"
}
Return ONLY the JSON — no markdown, no explanation.`;

async function extractSignals(job: Job): Promise<Pass1Result> {
  const desc = job.description
    ? job.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 3000)
    : "(no description)";

  const msg = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 600,
    temperature: 0,
    system: PASS1_PROMPT,
    messages: [{
      role: "user",
      content: `Company: ${job.company}\nTitle: ${job.title}\nLocation: ${job.location}\n\nJD:\n${desc}`,
    }],
  });

  const raw = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  return JSON.parse(cleaned) as Pass1Result;
}

// ── Pass 3: rank real scraped profiles ───────────────────────────────────────

const PASS3_PROMPT = `You are a senior recruiter analyzing scraped LinkedIn profiles to identify the most likely hiring manager for a job.

You will receive:
- The job description signals and org hypothesis
- A list of real LinkedIn profiles found via search

For each profile that is a strong hiring manager candidate, return a ranked JSON array:
[
  {
    "name": "exact name from profile",
    "title": "exact title from profile",
    "url": "exact linkedin URL from profile",
    "team": "inferred team/product area",
    "reasoning": "1-2 sentences why this person is likely the HM, tied to JD signals",
    "confidence": 80,
    "outreach": "2-3 line tailored outreach message (only for top 2, null for others)"
  }
]

Rules:
- Rank by hiring manager probability, not seniority
- Skip profiles that are clearly wrong: different team, IC contributors when HM is expected, etc.
- confidence 0-100: 80+ = strong signal, 50-79 = plausible, <50 = weak
- Include eliminated reasoning in a separate "eliminated" array of strings
- Return ONLY this JSON object: { "candidates": [...], "eliminated": [...] }
- No markdown, no explanation`;

interface Pass3Result {
  candidates: PFCandidate[];
  eliminated: string[];
}

async function rankProfiles(
  signals: string,
  orgHypothesis: string,
  profiles: LIPerson[],
  job: Job,
): Promise<Pass3Result> {
  if (profiles.length === 0) {
    return { candidates: [], eliminated: ["No LinkedIn profiles found via scraping"] };
  }

  const profileList = profiles.map((p, i) =>
    `${i + 1}. Name: ${p.name}\n   Title: ${p.title}\n   URL: ${p.url}\n   Bio: ${p.snippet || "(none)"}`,
  ).join("\n\n");

  const msg = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1500,
    temperature: 0,
    system: PASS3_PROMPT,
    messages: [{
      role: "user",
      content: [
        `Company: ${job.company}`,
        `Role: ${job.title}`,
        ``,
        `JD Signals: ${signals}`,
        `Org Hypothesis: ${orgHypothesis}`,
        ``,
        `Scraped LinkedIn Profiles (${profiles.length} found):`,
        profileList,
      ].join("\n"),
    }],
  });

  const raw = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  return JSON.parse(cleaned) as Pass3Result;
}

// ── Supplemental LinkedIn search shortcuts ────────────────────────────────────

function buildLinkedInSearch(company: string, keywords: string): string {
  const q = encodeURIComponent(`"${company}" ${keywords}`);
  return `https://www.linkedin.com/search/results/people/?keywords=${q}&origin=GLOBAL_SEARCH_HEADER`;
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function findHiringManager(job: Job): Promise<PFResult> {
  // Pass 1: extract signals + decide what to search for
  console.log(`[people-finder] Pass 1 — extracting JD signals for ${job.company} / ${job.title}`);
  const pass1 = await extractSignals(job);

  // Pass 2: scrape real LinkedIn profiles (runs through Playwright serializer)
  console.log(`[people-finder] Pass 2 — scraping LinkedIn for: "${job.company}" ${pass1.titleKeywords}`);
  const profiles = await findLinkedInProfiles(job.company, pass1.titleKeywords);

  // Pass 3: Claude ranks the real profiles
  console.log(`[people-finder] Pass 3 — ranking ${profiles.length} profiles`);
  const pass3 = await rankProfiles(pass1.signals, pass1.orgHypothesis, profiles, job);

  return {
    signals:      pass1.signals,
    orgHypothesis: pass1.orgHypothesis,
    candidates:   pass3.candidates,
    eliminated:   pass3.eliminated,
    scrapedCount: profiles.length,
    linkedInSearches: [
      {
        label: `${job.company} — ${pass1.teamArea} PMs`,
        url: buildLinkedInSearch(job.company, pass1.titleKeywords),
      },
      {
        label: `${job.company} — Recruiters`,
        url: buildLinkedInSearch(job.company, "Recruiter OR Talent Acquisition"),
      },
      {
        label: `${job.company} — All PMs`,
        url: buildLinkedInSearch(job.company, "Product Manager"),
      },
    ],
  };
}
