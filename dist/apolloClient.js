"use strict";
/**
 * apolloClient — people search via Apollo.io API.
 * Searches are free (0 credits). No email/phone reveals.
 * Results cached in memory to avoid repeat API calls for the same query.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchApollo = searchApollo;
const node_fetch_1 = __importDefault(require("node-fetch"));
const APOLLO_API = "https://api.apollo.io/v1/mixed_people/search";
const CACHE = new Map();
/**
 * Search Apollo for people at a company.
 * Deduplicates results by LinkedIn URL or name.
 */
async function searchApollo(company, opts) {
    const titleSet = new Set(opts.titles);
    // Add team-area variants if provided
    if (opts.teamArea) {
        titleSet.add(opts.teamArea);
        titleSet.add(`Product Manager ${opts.teamArea}`);
        titleSet.add(`Senior Product Manager ${opts.teamArea}`);
    }
    const titleArray = Array.from(titleSet);
    const cacheKey = [
        company.toLowerCase(),
        titleArray.join("|").toLowerCase(),
        (opts.seniorities ?? []).join("|"),
        (opts.departments ?? []).join("|"),
    ].join("::");
    if (CACHE.has(cacheKey)) {
        console.log(`[apollo] cache hit for "${company}" (${titleArray.length} titles)`);
        return CACHE.get(cacheKey);
    }
    console.log(`[apollo] searching "${company}" — ${titleArray.length} titles` +
        (opts.teamArea ? ` (team: "${opts.teamArea}")` : ""));
    const body = {
        api_key: process.env.APOLLO_API_KEY,
        q_organization_name: company,
        person_titles: titleArray,
        per_page: opts.perPage ?? 25,
        page: 1,
    };
    if (opts.seniorities?.length)
        body.person_seniorities = opts.seniorities;
    if (opts.departments?.length)
        body.person_departments = opts.departments;
    const resp = await (0, node_fetch_1.default)(APOLLO_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        throw new Error(`Apollo API error: ${resp.status} ${await resp.text()}`);
    }
    const data = (await resp.json());
    const seen = new Set();
    const people = (data.people ?? [])
        .map((p) => ({
        name: p.name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
        title: p.title ?? "",
        organization: p.organization_name ?? company,
        linkedInUrl: p.linkedin_url ?? "",
    }))
        .filter((p) => {
        if (!p.name)
            return false;
        const key = p.linkedInUrl || p.name.toLowerCase();
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
    CACHE.set(cacheKey, people);
    console.log(`[apollo] found ${people.length} people at "${company}"`);
    return people;
}
//# sourceMappingURL=apolloClient.js.map