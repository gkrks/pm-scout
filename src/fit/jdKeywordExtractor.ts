/**
 * JD Keyword Extractor — Phase 3
 *
 * Two-stage extraction:
 *   Stage 1: Deterministic regex pass against role profile keyword taxonomy + synonyms.yaml
 *   Stage 2: Supplemental LLM call (GPT-4.1) for terms NOT in the taxonomy
 *
 * The deterministic pass is authoritative. The LLM only adds new terms it finds
 * that aren't already in the taxonomy. If the LLM disagrees with the deterministic
 * pass on whether a term appears, the deterministic pass wins.
 *
 * Feature flag: JD_KEYWORD_EXTRACTOR_ENABLED (env var, default false)
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { z } from "zod";
import type { JDKeywords, KeywordTerm, RoleFamily } from "./types";
import { JDKeywordsZ, KeywordTermZ } from "./types";

// --------------------------------------------------------------------------- //
//  Config
// --------------------------------------------------------------------------- //

const PROFILES_DIR = path.resolve(__dirname, "../../role_profiles");
const SHARED_DIR = path.join(PROFILES_DIR, "_shared");

const JD_KEYWORD_EXTRACTOR_ENABLED =
  process.env.JD_KEYWORD_EXTRACTOR_ENABLED === "true";

// --------------------------------------------------------------------------- //
//  YAML loading (lazy, cached)
// --------------------------------------------------------------------------- //

import * as yaml from "js-yaml" ;

interface SynonymsData {
  canonical_to_aliases: Record<string, string[]>;
}

interface RoleProfileData {
  role_family: string;
  detection: { title_patterns: string[]; responsibilities_signals?: string[] };
  keyword_taxonomy?: Record<string, { weight: number; terms: string[] }>;
}

let _synonymsCache: SynonymsData | null = null;
let _profileCache: Map<string, RoleProfileData> = new Map();

function loadSynonyms(): SynonymsData {
  if (_synonymsCache) return _synonymsCache;
  const filePath = path.join(SHARED_DIR, "synonyms.yaml");
  const raw = fs.readFileSync(filePath, "utf-8");
  _synonymsCache = yaml.load(raw) as SynonymsData;
  return _synonymsCache;
}

function loadProfile(family: string): RoleProfileData {
  if (_profileCache.has(family)) return _profileCache.get(family)!;
  const filePath = path.join(PROFILES_DIR, `${family}.yaml`);
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = yaml.load(raw) as RoleProfileData;
  _profileCache.set(family, data);
  return data;
}

// --------------------------------------------------------------------------- //
//  Alias map (reverse: alias -> canonical)
// --------------------------------------------------------------------------- //

let _aliasMap: Map<string, string> | null = null;

function getAliasMap(): Map<string, string> {
  if (_aliasMap) return _aliasMap;
  const syn = loadSynonyms();
  const map = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(syn.canonical_to_aliases)) {
    for (const alias of aliases) {
      map.set(alias.toLowerCase(), canonical.toLowerCase());
    }
  }
  _aliasMap = map;
  return map;
}

function canonicalize(term: string): string {
  const map = getAliasMap();
  return map.get(term.toLowerCase().trim()) || term.toLowerCase().trim();
}

function getAliasesFor(canonical: string): string[] {
  const syn = loadSynonyms();
  return syn.canonical_to_aliases[canonical] || [canonical];
}

// --------------------------------------------------------------------------- //
//  Role detection (mirrors Python role_profile.py logic)
// --------------------------------------------------------------------------- //

const DETECTION_ORDER: string[] = [
  "tpm", "pa", "data_analyst", "engineering_manager", "swe", "program_manager", "pm",
];

export function detectRoleFamily(jdTitle: string): { family: RoleFamily; confidence: number } {
  const titleLower = jdTitle.toLowerCase();
  let bestMatch: { family: string; pattern: string; length: number } | null = null;

  for (const family of DETECTION_ORDER) {
    let profile: RoleProfileData;
    try {
      profile = loadProfile(family);
    } catch {
      continue;
    }

    for (const pattern of profile.detection.title_patterns) {
      const patternLower = pattern.toLowerCase();
      if (titleLower.includes(patternLower)) {
        if (!bestMatch || patternLower.length > bestMatch.length) {
          bestMatch = { family, pattern, length: patternLower.length };
        }
      }
    }
  }

  if (bestMatch) {
    // Confidence based on pattern specificity
    const confidence = Math.min(1.0, bestMatch.length / 20);
    return { family: bestMatch.family as RoleFamily, confidence };
  }

  return { family: "pm" as RoleFamily, confidence: 0.3 };
}

// --------------------------------------------------------------------------- //
//  Stage 1: Deterministic extraction
// --------------------------------------------------------------------------- //

interface JDSection {
  id: string;
  text: string;
  positionScore: number; // 3.0 title, 2.0 basic quals, 1.5 preferred, 1.0 responsibilities
  isRequired: boolean;
}

interface RawMatch {
  surface: string;
  canonical: string;
  category: string;
  categoryWeight: number;
  positions: { sectionId: string; positionScore: number; isRequired: boolean }[];
}

function buildJDSections(
  jdTitle: string,
  basicQuals: string[],
  preferredQuals: string[],
  responsibilities: string[],
  qualIds: { basic: string[]; preferred: string[] }
): JDSection[] {
  const sections: JDSection[] = [];

  sections.push({
    id: "_title",
    text: jdTitle,
    positionScore: 3.0,
    isRequired: true,
  });

  for (let i = 0; i < basicQuals.length; i++) {
    sections.push({
      id: qualIds.basic[i] || `q_basic_${i}`,
      text: basicQuals[i],
      positionScore: 2.0,
      isRequired: true,
    });
  }

  for (let i = 0; i < preferredQuals.length; i++) {
    sections.push({
      id: qualIds.preferred[i] || `q_preferred_${i}`,
      text: preferredQuals[i],
      positionScore: 1.5,
      isRequired: false,
    });
  }

  for (let i = 0; i < responsibilities.length; i++) {
    sections.push({
      id: `resp_${i}`,
      text: responsibilities[i],
      positionScore: 1.0,
      isRequired: false,
    });
  }

  return sections;
}

function deterministicExtract(
  sections: JDSection[],
  roleFamily: string
): Map<string, RawMatch> {
  const profile = loadProfile(roleFamily);
  const taxonomy = profile.keyword_taxonomy || {};
  const aliasMap = getAliasMap();

  // Build a flat list of (term, category, weight) from taxonomy
  const termLookup: { pattern: RegExp; canonical: string; category: string; weight: number }[] = [];

  for (const [catName, catData] of Object.entries(taxonomy)) {
    for (const term of catData.terms) {
      // Also add all aliases for this term
      const allForms = [term, ...getAliasesFor(term)];
      const uniqueForms = Array.from(new Set(allForms.map((f) => f.toLowerCase())));

      for (const form of uniqueForms) {
        // Word-boundary regex with optional trailing suffixes (plural, adverb, gerund)
        const escaped = form.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
        const pattern = new RegExp(`\\b${escaped}(?:s|ly|ing|ed)?\\b`, "i");
        termLookup.push({
          pattern,
          canonical: term.toLowerCase(),
          category: catName,
          weight: catData.weight,
        });
      }
    }
  }

  // Also scan for any aliases in synonyms.yaml not already in taxonomy
  aliasMap.forEach((canonical, alias) => {
    const alreadyInTaxonomy = termLookup.some(
      (t) => t.canonical === canonical || t.canonical === alias
    );
    if (!alreadyInTaxonomy) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
      const pattern = new RegExp(`\\b${escaped}\\b`, "i");
      termLookup.push({
        pattern,
        canonical,
        category: "uncategorized",
        weight: 1,
      });
    }
  });

  // Match against all sections
  const matches = new Map<string, RawMatch>();

  for (const section of sections) {
    const text = section.text;
    for (const entry of termLookup) {
      const match = entry.pattern.exec(text);
      if (match) {
        const canonical = entry.canonical;
        if (!matches.has(canonical)) {
          matches.set(canonical, {
            surface: match[0],
            canonical,
            category: entry.category,
            categoryWeight: entry.weight,
            positions: [],
          });
        }
        const existing = matches.get(canonical)!;
        existing.positions.push({
          sectionId: section.id,
          positionScore: section.positionScore,
          isRequired: section.isRequired,
        });
      }
    }
  }

  return matches;
}

// --------------------------------------------------------------------------- //
//  Stage 2: LLM supplementation
// --------------------------------------------------------------------------- //

interface LLMKeyword {
  term: string;
  category: string;
  reasoning: string;
}

async function llmSupplementalExtract(
  jdText: string,
  existingTerms: string[],
  roleFamily: string
): Promise<LLMKeyword[]> {
  const openaiKey = process.env.OPENAI_KEY;
  if (!openaiKey) return [];

  const fetch = (await import("node-fetch")).default;

  const systemPrompt = `You are a keyword extraction assistant for ATS resume optimization.
Given a job description, identify additional skills/keywords NOT already in the provided list.
Focus on: technical skills, tools, methodologies, domain terms, and action verbs specific to this role.
Do NOT include generic terms, soft skills like "communication", or terms already in the existing list.
Return ONLY a JSON array of objects with: term, category (one of: product_craft, data_and_experimentation, technical_depth, collaboration, domain_signals, uncategorized), reasoning (1 sentence).
Return an empty array if no additional terms are found.`;

  const userPrompt = `Role family: ${roleFamily}
Existing extracted terms: ${existingTerms.join(", ")}

Job description:
${jdText.slice(0, 4000)}

Return JSON array of additional keywords not in the existing list.`;

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        temperature: 0,
        max_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      timeout: 30000,
    });

    if (!resp.ok) return [];

    const data = (await resp.json()) as any;
    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    const keywords = parsed.keywords || parsed.results || parsed;

    if (!Array.isArray(keywords)) return [];
    return keywords.filter(
      (k: any) => k.term && k.category && !existingTerms.includes(k.term.toLowerCase())
    );
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------------- //
//  Domain keyword detection
// --------------------------------------------------------------------------- //

const DOMAIN_TERMS = [
  "fintech", "healthcare", "healthtech", "edtech", "e-commerce", "ecommerce",
  "marketplace", "social media", "gaming", "ad tech", "adtech", "cybersecurity",
  "climate tech", "cleantech", "proptech", "insurtech", "legaltech",
  "b2b saas", "b2c", "enterprise", "consumer", "developer tools", "devtools",
  "infrastructure", "cloud", "mobile", "payments", "lending", "banking",
  "crypto", "blockchain", "web3", "logistics", "supply chain",
];

// --------------------------------------------------------------------------- //
//  Main extraction function
// --------------------------------------------------------------------------- //

export interface ExtractJDKeywordsInput {
  jdTitle: string;
  jdText: string; // full JD body for LLM and domain detection
  basicQualifications: string[];
  preferredQualifications: string[];
  responsibilities: string[];
  qualIds?: { basic: string[]; preferred: string[] };
}

export async function extractJDKeywords(
  input: ExtractJDKeywordsInput
): Promise<JDKeywords> {
  const {
    jdTitle,
    jdText,
    basicQualifications,
    preferredQualifications,
    responsibilities,
    qualIds,
  } = input;

  // Hash for caching
  const jdHash = crypto
    .createHash("sha256")
    .update(jdText)
    .digest("hex")
    .slice(0, 16);

  // Detect role
  const { family: roleFamily, confidence: roleConfidence } = detectRoleFamily(jdTitle);

  // Build sections
  const sections = buildJDSections(
    jdTitle,
    basicQualifications,
    preferredQualifications,
    responsibilities,
    qualIds || {
      basic: basicQualifications.map((_, i) => `q_basic_${i}`),
      preferred: preferredQualifications.map((_, i) => `q_preferred_${i}`),
    }
  );

  // Stage 1: Deterministic extraction
  const deterministicMatches = deterministicExtract(sections, roleFamily);

  // Stage 2: LLM supplementation
  const existingTerms = Array.from(deterministicMatches.keys());
  const llmKeywords = await llmSupplementalExtract(jdText, existingTerms, roleFamily);

  // Merge LLM keywords into matches (they only ADD, never override deterministic)
  for (const lk of llmKeywords) {
    const canonical = canonicalize(lk.term);
    if (!deterministicMatches.has(canonical)) {
      deterministicMatches.set(canonical, {
        surface: lk.term,
        canonical,
        category: lk.category,
        categoryWeight: 1, // LLM-found terms get base weight
        positions: [{ sectionId: "_llm", positionScore: 1.0, isRequired: false }],
      });
    }
  }

  // Domain detection from full JD text
  const domainMatches: KeywordTerm[] = [];
  const jdLower = jdText.toLowerCase();
  for (const term of DOMAIN_TERMS) {
    if (jdLower.includes(term)) {
      domainMatches.push({
        surface: term,
        canonical: term,
        aliases: [term],
        jd_count: 1,
        position_score: 1.0,
        weight: 1.0,
        source_qual_ids: [],
        category: "domain_signals",
        required: false,
      });
    }
  }

  // Convert matches to KeywordTerm objects and classify
  const allTerms: KeywordTerm[] = [];
  deterministicMatches.forEach((match) => {
    const maxPositionScore = Math.max(...match.positions.map((p) => p.positionScore));
    const isRequired = match.positions.some((p) => p.isRequired);
    const jdCount = match.positions.length;
    const weight = jdCount * maxPositionScore * match.categoryWeight;
    const sourceQualIds = match.positions
      .map((p) => p.sectionId)
      .filter((id) => id !== "_title" && id !== "_llm");

    const aliases = getAliasesFor(match.canonical);

    allTerms.push({
      surface: match.surface,
      canonical: match.canonical,
      aliases,
      jd_count: jdCount,
      position_score: maxPositionScore,
      weight,
      source_qual_ids: sourceQualIds,
      category: match.category as any,
      required: isRequired,
    });
  });

  // Sort by weight descending
  allTerms.sort((a, b) => b.weight - a.weight);

  // Classify into must_have vs nice_to_have
  // must_have: required=true OR weight in top quartile
  const weightThreshold =
    allTerms.length > 0
      ? allTerms[Math.floor(allTerms.length * 0.25)]?.weight || 0
      : 0;

  const mustHave: KeywordTerm[] = [];
  const niceToHave: KeywordTerm[] = [];
  const actionVerbs: KeywordTerm[] = [];

  for (const term of allTerms) {
    if (term.category === "domain_signals") continue; // handled separately
    if (term.required || term.weight >= weightThreshold) {
      mustHave.push(term);
    } else {
      niceToHave.push(term);
    }
  }

  // Detect banned phrases in JD (rare: "do not include...", "we are not looking for...")
  const bannedInJd: string[] = [];
  const negativePatterns = [
    /(?:do not|don't|not looking for|not seeking)\s+(?:include|mention|list)\s+(.+?)(?:\.|$)/gi,
  ];
  for (const pattern of negativePatterns) {
    let m;
    while ((m = pattern.exec(jdText)) !== null) {
      bannedInJd.push(m[1].trim());
    }
  }

  const result: JDKeywords = {
    role_family: roleFamily,
    detected_role_confidence: roleConfidence,
    must_have: mustHave,
    nice_to_have: niceToHave,
    domain: domainMatches,
    action_verbs: actionVerbs,
    banned_in_jd: bannedInJd,
    jd_hash: jdHash,
  };

  return JDKeywordsZ.parse(result);
}

// --------------------------------------------------------------------------- //
//  Caching (Supabase jd_keyword_cache table)
// --------------------------------------------------------------------------- //

export async function getCachedKeywords(
  jdHash: string,
  roleProfileVersion: string
): Promise<JDKeywords | null> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  try {
    const fetch = (await import("node-fetch")).default;
    const resp = await fetch(
      `${supabaseUrl}/rest/v1/jd_keyword_cache?jd_hash=eq.${jdHash}&role_profile_version=eq.${roleProfileVersion}&select=keywords`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        timeout: 5000,
      }
    );
    if (!resp.ok) return null;
    const rows = (await resp.json()) as any[];
    if (!rows || rows.length === 0) return null;
    return JDKeywordsZ.parse(rows[0].keywords);
  } catch {
    return null;
  }
}

export async function cacheKeywords(
  jdHash: string,
  roleProfileVersion: string,
  keywords: JDKeywords
): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  try {
    const fetch = (await import("node-fetch")).default;
    await fetch(`${supabaseUrl}/rest/v1/jd_keyword_cache`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        jd_hash: jdHash,
        role_profile_version: roleProfileVersion,
        keywords,
        cached_at: new Date().toISOString(),
      }),
      timeout: 5000,
    });
  } catch {
    // Non-critical; log and continue
  }
}

// --------------------------------------------------------------------------- //
//  High-level entry point with caching
// --------------------------------------------------------------------------- //

const ROLE_PROFILE_VERSION = "1.0.0"; // bump when taxonomy changes

export async function extractJDKeywordsCached(
  input: ExtractJDKeywordsInput
): Promise<JDKeywords> {
  if (!JD_KEYWORD_EXTRACTOR_ENABLED) {
    // Return empty structure when disabled
    const jdHash = crypto
      .createHash("sha256")
      .update(input.jdText)
      .digest("hex")
      .slice(0, 16);
    const { family } = detectRoleFamily(input.jdTitle);
    return {
      role_family: family,
      detected_role_confidence: 0,
      must_have: [],
      nice_to_have: [],
      domain: [],
      action_verbs: [],
      banned_in_jd: [],
      jd_hash: jdHash,
    };
  }

  const jdHash = crypto
    .createHash("sha256")
    .update(input.jdText)
    .digest("hex")
    .slice(0, 16);

  // Check cache
  const cached = await getCachedKeywords(jdHash, ROLE_PROFILE_VERSION);
  if (cached) return cached;

  // Extract fresh
  const keywords = await extractJDKeywords(input);

  // Cache (fire-and-forget)
  cacheKeywords(jdHash, ROLE_PROFILE_VERSION, keywords).catch(() => {});

  return keywords;
}
