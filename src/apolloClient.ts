/**
 * apolloClient — people search via Apollo.io API.
 * Searches are free (0 credits). No email/phone reveals.
 * Results cached in memory to avoid repeat API calls for the same query.
 */

import fetch from "node-fetch";

const APOLLO_API = "https://api.apollo.io/v1/mixed_people/search";
const CACHE = new Map<string, ApolloPerson[]>();

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
 * Search Apollo for people at a company matching given titles.
 * titleKeywords: array of title strings, e.g. ["Senior PM", "Group PM", "Director of Product"]
 */
export async function searchApollo(
  company: string,
  titleKeywords: string[],
): Promise<ApolloPerson[]> {
  const cacheKey = `${company.toLowerCase()}::${titleKeywords.join("|").toLowerCase()}`;
  if (CACHE.has(cacheKey)) {
    console.log(`[apollo] cache hit for "${company}"`);
    return CACHE.get(cacheKey)!;
  }

  console.log(`[apollo] searching "${company}" for titles: ${titleKeywords.join(", ")}`);

  const resp = await fetch(APOLLO_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    },
    body: JSON.stringify({
      api_key:            process.env.APOLLO_API_KEY,
      q_organization_name: company,
      person_titles:      titleKeywords,
      per_page:           10,
      page:               1,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Apollo API error: ${resp.status} ${await resp.text()}`);
  }

  const data = (await resp.json()) as { people?: ApolloRawPerson[] };
  const people: ApolloPerson[] = (data.people ?? [])
    .map((p) => ({
      name:         p.name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      title:        p.title ?? "",
      organization: p.organization_name ?? company,
      linkedInUrl:  p.linkedin_url ?? "",
    }))
    .filter((p) => p.name);

  CACHE.set(cacheKey, people);
  console.log(`[apollo] found ${people.length} people at "${company}"`);
  return people;
}
