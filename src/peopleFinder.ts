/**
 * peopleFinder — identifies probable hiring managers for a job posting.
 *
 * Strategy:
 *   1. Extract signals from the JD (product area, team, seniority, scope)
 *   2. Infer org structure and probable reporting chain
 *   3. Return 3–5 high-confidence hiring manager candidates with reasoning
 *   4. Generate LinkedIn search URLs (never automate LinkedIn requests)
 *   5. Provide 2-line tailored outreach angles per top candidate
 */

import Anthropic from "@anthropic-ai/sdk";
import { Job } from "./state";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface PFCandidate {
  name: string;          // Best-guess name, or persona label if unknown
  title: string;         // Probable title
  team: string;          // Product area / team alignment
  reasoning: string;     // Why this person is likely the HM
  confidence: number;    // 0–100
  linkedInSearchUrl: string; // Pre-built LinkedIn people search URL
}

export interface PFResult {
  signals: string;             // JD signal breakdown (brief)
  orgHypothesis: string;       // Probable org + reporting chain
  candidates: PFCandidate[];
  eliminated: string[];        // Profiles to skip and why
  outreach: { name: string; message: string }[];
  linkedInSearches: { label: string; url: string }[];
}

const SYSTEM_PROMPT = `You are a senior talent intelligence analyst. Given a job posting, identify the most probable hiring manager(s) using structured, evidence-based reasoning.

Return ONLY a JSON object with this exact schema:
{
  "signals": "2-3 sentence summary of key JD signals: product area, team function, seniority, scope keywords",
  "orgHypothesis": "Probable org structure and reporting chain. State assumptions explicitly.",
  "candidates": [
    {
      "name": "Full Name or '[Title] on [Team]' if name unknown",
      "title": "Probable title (e.g. Group PM, Director of Product)",
      "team": "Product area / team (e.g. Payments Growth, Ads Platform)",
      "reasoning": "1-2 sentences tying directly to JD signals",
      "confidence": 75,
      "linkedInSearchUrl": "https://www.linkedin.com/search/results/people/?keywords=..."
    }
  ],
  "eliminated": [
    "VP of Product — too senior, no direct hiring involvement likely"
  ],
  "outreach": [
    {
      "name": "Candidate name or label",
      "message": "2-3 line outreach grounded in their team + a challenge hypothesis"
    }
  ]
}

Rules:
- 3 to 5 candidates, ranked by confidence descending
- Every conclusion must tie to a specific JD signal — no random guessing
- Avoid VP+ unless strongly justified by scope
- linkedInSearchUrl: build a real LinkedIn people search URL using company name + likely title keywords
- outreach: write for top 2 candidates only; be specific, not generic
- Return ONLY the JSON — no markdown, no explanation`;

function buildLinkedInSearch(company: string, keywords: string): string {
  const q = encodeURIComponent(`"${company}" ${keywords}`);
  return `https://www.linkedin.com/search/results/people/?keywords=${q}&origin=GLOBAL_SEARCH_HEADER`;
}

function buildPrompt(job: Job): string {
  return [
    `Company: ${job.company}`,
    `Job Title: ${job.title}`,
    `Location: ${job.location}`,
    `Apply URL: ${job.applyUrl}`,
    ``,
    `Job Description:`,
    job.description
      ? job.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 4000)
      : "(no description available)",
  ].join("\n");
}

export async function findHiringManager(job: Job): Promise<PFResult> {
  const prompt = buildPrompt(job);

  const msg = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1500,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
  let parsed: PFResult;
  try {
    parsed = JSON.parse(raw) as PFResult;
  } catch {
    // Retry once stripping markdown fences
    const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    parsed = JSON.parse(cleaned) as PFResult;
  }

  // Supplement with a set of generic LinkedIn search URLs for the user
  parsed.linkedInSearches = [
    {
      label: `${job.company} — Product Managers`,
      url: buildLinkedInSearch(job.company, "Product Manager"),
    },
    {
      label: `${job.company} — Senior / Group PM`,
      url: buildLinkedInSearch(job.company, "Senior PM OR Group PM OR Director of Product"),
    },
    {
      label: `${job.company} — Recruiters`,
      url: buildLinkedInSearch(job.company, "Recruiter OR Talent Acquisition"),
    },
  ];

  return parsed;
}
