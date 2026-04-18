/**
 * apolloClient — people search via Apollo.io API.
 * Searches are free (0 credits). No email/phone reveals.
 * Results cached in memory to avoid repeat API calls for the same query.
 */

import fetch from "node-fetch";

const APOLLO_API = "https://api.apollo.io/v1/mixed_people/search";
const CACHE = new Map<string, ApolloPerson[]>();

// Base PM/leadership titles always included regardless of JD
const BASE_TITLES = [
  "Product Manager",
  "Senior Product Manager",
  "Staff Product Manager",
  "Principal Product Manager",
  "Group Product Manager",
  "Director of Product",
  "Director of Product Management",
  "Head of Product",
  "VP of Product",
  "Vice President of Product",
  "VP Product Management",
  "Product Lead",
  "Product Owner",
  "Hiring Manager",
];

export interface ApolloPerson {
  name: string;
  title: string;
  organization: string;
  linkedInUrl: string;
}

interface ApolloRawPerson {
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  organization_name?: string;
  linkedin_url?: string;
}

/**
 * Search Apollo for people at a company.
 * - Always searches broad PM/leadership base titles
 * - Merges JD-inferred title keywords (hiring manager level titles)
 * - If teamArea provided, also searches for that team name in titles
 *   (catches "Product Manager, Shopping Graph" style titles)
 * - Deduplicates results by LinkedIn URL or name
 */
export async function searchApollo(
  company: string,
  titleKeywords: string[],
  teamArea?: string,
): Promise<ApolloPerson[]> {
  // Build unified title list: base + JD-inferred + team-specific variants
  const titles = new Set<string>([...BASE_TITLES, ...titleKeywords]);
  if (teamArea) {
    titles.add(teamArea);                              // exact team name match
    titles.add(`Product Manager ${teamArea}`);         // "PM, Shopping Graph" style
    titles.add(`Senior Product Manager ${teamArea}`);
  }
  const titleArray = Array.from(titles);

  const cacheKey = `${company.toLowerCase()}::${titleArray.join("|").toLowerCase()}`;
  if (CACHE.has(cacheKey)) {
    console.log(`[apollo] cache hit for "${company}"`);
    return CACHE.get(cacheKey)!;
  }

  console.log(`[apollo] searching "${company}" — ${titleArray.length} title variants${teamArea ? ` (team: "${teamArea}")` : ""}`);

  const resp = await fetch(APOLLO_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    },
    body: JSON.stringify({
      api_key:             process.env.APOLLO_API_KEY,
      q_organization_name: company,
      person_titles:       titleArray,
      per_page:            25,
      page:                1,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Apollo API error: ${resp.status} ${await resp.text()}`);
  }

  const data = (await resp.json()) as { people?: ApolloRawPerson[] };
  const seen = new Set<string>();
  const people: ApolloPerson[] = (data.people ?? [])
    .map((p) => ({
      name:         p.name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      title:        p.title ?? "",
      organization: p.organization_name ?? company,
      linkedInUrl:  p.linkedin_url ?? "",
    }))
    .filter((p) => {
      if (!p.name) return false;
      const key = p.linkedInUrl || p.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  CACHE.set(cacheKey, people);
  console.log(`[apollo] found ${people.length} people at "${company}"`);
  return people;
}
