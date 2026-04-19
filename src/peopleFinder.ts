/**
 * peopleFinder — structured 3-persona hiring intelligence pipeline.
 *
 * Pass 1 (Groq): Extract JD signals → team, seniority, product area,
 *                generate persona-specific Apollo search strategies.
 * Pass 2 (Apollo): Run 3 parallel searches — hiring managers, recruiters, peers.
 * Pass 3 (Groq): Categorize + score every returned profile.
 *                Assigns: category, relevance_score (1-5), confidence (0-100),
 *                reasoning, outreach for top HM candidates.
 */

import Groq from "groq-sdk";
import { Job } from "./state";
import { searchApollo, ApolloPerson } from "./apolloClient";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL  = "llama-3.1-8b-instant";

// ── Public types ──────────────────────────────────────────────────────────────

export type CandidateCategory = "hiring_manager" | "recruiter" | "peer";

export interface PFCandidate {
  name:            string;
  title:           string;
  url:             string;
  team:            string;
  category:        CandidateCategory;
  relevanceScore:  number;   // 1–5 (5 = exact team + correct seniority)
  confidence:      number;   // 0–100
  reasoning:       string;
  outreach?:       string;   // top 2 HM candidates only
}

export interface JDSignals {
  team:             string;   // e.g. "Shopping Graph"
  productArea:      string;   // e.g. "Knowledge Graph / Search"
  seniorityLevel:   string;   // e.g. "Senior PM"
  keyKeywords:      string[];
  coreProblemSpace: string;
  orgHypothesis:    string;
}

export interface SearchStrategy {
  hiringManager: { titles: string[]; seniorities: string[] };
  recruiter:     { titles: string[] };
  peers:         { titles: string[]; seniorities: string[] };
  booleanStrings: {
    hiringManager: string;
    recruiter:     string;
    peers:         string;
  };
}

export interface PFResult {
  jdSignals:       JDSignals;
  searchStrategy:  SearchStrategy;
  candidates:      PFCandidate[];
  eliminated:      string[];
  scrapedCount:    number;
  linkedInSearches: { label: string; url: string }[];
}

// ── Pass 1: extract signals + generate search strategy ───────────────────────

const PASS1_PROMPT = `You are a talent intelligence analyst specializing in PM hiring at tech companies.

Analyze this job posting and return a single JSON object. No markdown, no explanation.

{
  "team": "Short team/area label e.g. 'Shopping Graph' or 'Ads Platform'",
  "productArea": "Broader product domain e.g. 'Search & Discovery'",
  "seniorityLevel": "One of: Associate PM / PM / Senior PM / Staff PM / Principal PM / Lead PM",
  "keyKeywords": ["5-10 domain-specific keywords from the JD"],
  "coreProblemSpace": "1-2 sentences on what this team builds and what problem they solve",
  "orgHypothesis": "Probable reporting chain e.g. 'PM → Senior PM → Director of Product, Search → VP Search'",
  "searchStrategy": {
    "hiringManager": {
      "titles": ["Group PM", "Senior Manager Product Management", "Director of Product", "Head of Product", "Director Product Management"],
      "seniorities": ["manager", "director", "vp", "head"]
    },
    "recruiter": {
      "titles": ["Technical Recruiter", "Product Recruiter", "Senior Recruiter", "Recruiting Manager", "Talent Acquisition Partner"]
    },
    "peers": {
      "titles": ["Product Manager", "Senior Product Manager", "Staff Product Manager", "Principal Product Manager"],
      "seniorities": ["senior", "entry", "manager"]
    }
  }
}

IMPORTANT:
- The team name should reflect what's literally in the JD title or description (e.g. "Shopping Graph" from "PM, Shopping Graph")
- Tailor hiringManager titles to the actual seniority of the HM for this role level
- peers titles should match the SAME level as the role being hired`;

interface Pass1Result {
  team:           string;
  productArea:    string;
  seniorityLevel: string;
  keyKeywords:    string[];
  coreProblemSpace: string;
  orgHypothesis:  string;
  searchStrategy: SearchStrategy;
}

async function extractSignals(job: Job): Promise<Pass1Result> {
  const desc = job.description
    ? job.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 3000)
    : "(no description)";

  const completion = await client.chat.completions.create({
    model:      MODEL,
    max_tokens: 900,
    temperature: 0,
    messages: [
      { role: "system", content: PASS1_PROMPT },
      { role: "user",   content: `Company: ${job.company}\nTitle: ${job.title}\nLocation: ${job.location}\n\nJD:\n${desc}` },
    ],
  });

  const raw     = (completion.choices[0].message.content ?? "").trim();
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  return JSON.parse(cleaned) as Pass1Result;
}

// ── Pass 3: categorize + score all returned profiles ─────────────────────────

const PASS3_PROMPT = `You are a senior talent intelligence analyst. You receive Apollo.io search results for a PM job and must categorize + score every person.

For EACH person returned, output a scored entry. Return a JSON object:
{
  "candidates": [
    {
      "name":           "exact name",
      "title":          "exact title",
      "url":            "exact linkedin URL or empty string",
      "team":           "inferred team area",
      "category":       "hiring_manager" | "recruiter" | "peer",
      "relevanceScore": 1-5,
      "confidence":     0-100,
      "reasoning":      "1-2 sentences tied to JD signals",
      "outreach":       "2-3 line outreach message OR null"
    }
  ],
  "eliminated": ["name — reason for skipping"]
}

RELEVANCE SCORE RULES:
5 = correct team + correct seniority for category
4 = adjacent team, correct seniority
3 = correct role type, team unclear
2 = wrong team but relevant company
1 = irrelevant or too senior (C-suite)

OUTREACH: only for top 2 hiring_manager candidates, null for everyone else.

CATEGORY RULES:
- hiring_manager: Group PM, Director, Head of Product, Senior Manager PM — manager-level PMs
- recruiter: anyone with Recruiter, Talent Acquisition, or Sourcer in title
- peer: PM / Senior PM / Staff PM — IC contributors at the same level as the role

ELIMINATED: skip people who are clearly wrong — different domain, C-suite, non-PM functions.

No markdown. Return ONLY the JSON object.`;

interface Pass3Result {
  candidates: PFCandidate[];
  eliminated: string[];
}

async function categorizeProfiles(
  signals: Pass1Result,
  allProfiles: ApolloPerson[],
  job: Job,
): Promise<Pass3Result> {
  if (allProfiles.length === 0) {
    return { candidates: [], eliminated: ["No Apollo profiles returned"] };
  }

  const profileList = allProfiles.map((p, i) =>
    `${i + 1}. Name: ${p.name}\n   Title: ${p.title}\n   URL: ${p.linkedInUrl || ""}\n   Org: ${p.organization}`,
  ).join("\n\n");

  const completion = await client.chat.completions.create({
    model:      MODEL,
    max_tokens: 2000,
    temperature: 0,
    messages: [
      { role: "system", content: PASS3_PROMPT },
      {
        role: "user",
        content: [
          `Company: ${job.company}`,
          `Role: ${job.title}`,
          `Team: ${signals.team}`,
          `Seniority: ${signals.seniorityLevel}`,
          `Product Area: ${signals.productArea}`,
          `Core Problem: ${signals.coreProblemSpace}`,
          `Org Hypothesis: ${signals.orgHypothesis}`,
          ``,
          `Apollo profiles (${allProfiles.length} total):`,
          profileList,
        ].join("\n"),
      },
    ],
  });

  const raw     = (completion.choices[0].message.content ?? "").trim();
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  return JSON.parse(cleaned) as Pass3Result;
}

// ── LinkedIn search shortcuts ─────────────────────────────────────────────────

function liSearch(company: string, keywords: string): string {
  const q = encodeURIComponent(`"${company}" ${keywords}`);
  return `https://www.linkedin.com/search/results/people/?keywords=${q}&origin=GLOBAL_SEARCH_HEADER`;
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function findHiringManager(job: Job): Promise<PFResult> {
  // Pass 1: extract structured signals + search strategy from JD
  console.log(`[people-finder] Pass 1 — signals for ${job.company} / ${job.title}`);
  const signals = await extractSignals(job);
  const strat   = signals.searchStrategy;

  // Pass 2: 3 parallel Apollo searches (hiring managers, recruiters, peers)
  console.log(`[people-finder] Pass 2 — Apollo searches (team: "${signals.team}")`);
  const [hmProfiles, recProfiles, peerProfiles] = await Promise.all([
    searchApollo(job.company, {
      titles:      strat.hiringManager.titles,
      seniorities: strat.hiringManager.seniorities,
      departments: ["Product Management"],
      teamArea:    signals.team,
      perPage:     15,
    }),
    searchApollo(job.company, {
      titles:      strat.recruiter.titles,
      departments: ["Human Resources"],
      perPage:     10,
    }),
    searchApollo(job.company, {
      titles:      strat.peers.titles,
      seniorities: strat.peers.seniorities,
      departments: ["Product Management"],
      teamArea:    signals.team,
      perPage:     15,
    }),
  ]);

  // Deduplicate across all three pools (prefer HM > peer > recruiter)
  const seenUrls = new Set<string>();
  const seenNames = new Set<string>();
  function dedup(profiles: ApolloPerson[]): ApolloPerson[] {
    return profiles.filter((p) => {
      const urlKey  = p.linkedInUrl?.trim();
      const nameKey = p.name.toLowerCase().trim();
      if (urlKey  && seenUrls.has(urlKey))   return false;
      if (seenNames.has(nameKey))             return false;
      if (urlKey)  seenUrls.add(urlKey);
      seenNames.add(nameKey);
      return true;
    });
  }
  const allProfiles = [
    ...dedup(hmProfiles),
    ...dedup(peerProfiles),
    ...dedup(recProfiles),
  ];

  console.log(
    `[people-finder] Pass 2 done — ${hmProfiles.length} HMs, ` +
    `${recProfiles.length} recruiters, ${peerProfiles.length} peers ` +
    `(${allProfiles.length} unique total)`,
  );

  // Pass 3: Groq categorizes + scores every profile
  console.log(`[people-finder] Pass 3 — categorizing ${allProfiles.length} profiles`);
  const pass3 = await categorizeProfiles(signals, allProfiles, job);

  // Build boolean search strings from titles
  const hmBool   = strat.hiringManager.titles.map((t) => `"${t}"`).join(" OR ");
  const recBool  = strat.recruiter.titles.map((t) => `"${t}"`).join(" OR ");
  const peerBool = strat.peers.titles.map((t) => `"${t}"`).join(" OR ");

  return {
    jdSignals: {
      team:             signals.team,
      productArea:      signals.productArea,
      seniorityLevel:   signals.seniorityLevel,
      keyKeywords:      signals.keyKeywords,
      coreProblemSpace: signals.coreProblemSpace,
      orgHypothesis:    signals.orgHypothesis,
    },
    searchStrategy: {
      ...strat,
      booleanStrings: {
        hiringManager: hmBool,
        recruiter:     recBool,
        peers:         peerBool,
      },
    },
    candidates:   pass3.candidates,
    eliminated:   pass3.eliminated,
    scrapedCount: allProfiles.length,
    linkedInSearches: [
      {
        label: `${job.company} — ${signals.team} Hiring Managers`,
        url:   liSearch(job.company, strat.hiringManager.titles.slice(0, 3).join(" OR ")),
      },
      {
        label: `${job.company} — Product Recruiters`,
        url:   liSearch(job.company, "Product Recruiter OR Technical Recruiter"),
      },
      {
        label: `${job.company} — ${signals.team} PMs`,
        url:   liSearch(job.company, `"${signals.team}" Product Manager`),
      },
    ],
  };
}
