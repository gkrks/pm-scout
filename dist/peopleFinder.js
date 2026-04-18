"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findHiringManager = findHiringManager;
const groq_sdk_1 = __importDefault(require("groq-sdk"));
const apolloClient_1 = require("./apolloClient");
const client = new groq_sdk_1.default({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "llama-3.1-8b-instant";
const PASS1_PROMPT = `You are a talent intelligence analyst. Analyze this job posting and return a JSON object with:
{
  "signals": "2-3 sentence summary: product area, team function, seniority, scope keywords",
  "orgHypothesis": "Probable org + reporting chain. State assumptions explicitly.",
  "titleKeywords": "LinkedIn search keyword string for the hiring manager's title — use OR between variants, e.g. 'Senior PM OR Group PM OR Director of Product OR Head of Product'",
  "teamArea": "Short team/product area label, e.g. 'Payments Growth' or 'Ads Platform'"
}
Return ONLY the JSON — no markdown, no explanation.`;
async function extractSignals(job) {
    const desc = job.description
        ? job.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 3000)
        : "(no description)";
    const completion = await client.chat.completions.create({
        model: MODEL,
        max_tokens: 600,
        temperature: 0,
        messages: [
            { role: "system", content: PASS1_PROMPT },
            { role: "user", content: `Company: ${job.company}\nTitle: ${job.title}\nLocation: ${job.location}\n\nJD:\n${desc}` },
        ],
    });
    const raw = (completion.choices[0].message.content ?? "").trim();
    const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    return JSON.parse(cleaned);
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
async function rankProfiles(signals, orgHypothesis, profiles, job) {
    if (profiles.length === 0) {
        return { candidates: [], eliminated: ["No Apollo profiles found"] };
    }
    const profileList = profiles.map((p, i) => `${i + 1}. Name: ${p.name}\n   Title: ${p.title}\n   URL: ${p.linkedInUrl || "(no URL)"}\n   Org: ${p.organization}`).join("\n\n");
    const completion = await client.chat.completions.create({
        model: MODEL,
        max_tokens: 1500,
        temperature: 0,
        messages: [
            { role: "system", content: PASS3_PROMPT },
            { role: "user", content: [
                    `Company: ${job.company}`,
                    `Role: ${job.title}`,
                    ``,
                    `JD Signals: ${signals}`,
                    `Org Hypothesis: ${orgHypothesis}`,
                    ``,
                    `Scraped LinkedIn Profiles (${profiles.length} found):`,
                    profileList,
                ].join("\n") },
        ],
    });
    const raw = (completion.choices[0].message.content ?? "").trim();
    const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    return JSON.parse(cleaned);
}
// ── Supplemental LinkedIn search shortcuts ────────────────────────────────────
function buildLinkedInSearch(company, keywords) {
    const q = encodeURIComponent(`"${company}" ${keywords}`);
    return `https://www.linkedin.com/search/results/people/?keywords=${q}&origin=GLOBAL_SEARCH_HEADER`;
}
// ── Main entry ────────────────────────────────────────────────────────────────
async function findHiringManager(job) {
    // Pass 1: extract signals + decide what to search for
    console.log(`[people-finder] Pass 1 — extracting JD signals for ${job.company} / ${job.title}`);
    const pass1 = await extractSignals(job);
    // Pass 2: search Apollo for people matching title keywords
    const titleArray = pass1.titleKeywords.split(/\s+OR\s+/i).map((t) => t.trim()).filter(Boolean);
    console.log(`[people-finder] Pass 2 — Apollo search for: "${job.company}" [${titleArray.join(", ")}]`);
    const profiles = await (0, apolloClient_1.searchApollo)(job.company, titleArray);
    // Pass 3: Claude ranks the real profiles
    console.log(`[people-finder] Pass 3 — ranking ${profiles.length} profiles`);
    const pass3 = await rankProfiles(pass1.signals, pass1.orgHypothesis, profiles, job);
    return {
        signals: pass1.signals,
        orgHypothesis: pass1.orgHypothesis,
        candidates: pass3.candidates,
        eliminated: pass3.eliminated,
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
//# sourceMappingURL=peopleFinder.js.map