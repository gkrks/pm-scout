/**
 * matchRequirement.ts — Finds top matching bullets from master_resume.json
 * using Voyage AI contextual embeddings + deterministic keyword overlap.
 *
 * NO LLM calls here — just retrieval + keyword analysis.
 * Rewrites happen on-demand via the separate /rewrite-bullet endpoint.
 */

import { VoyageAIClient } from "voyageai";
import fs from "fs";
import path from "path";

const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });

const MASTER_RESUME_PATH = path.join(__dirname, "../../config/master_resume.json");
const TOP_K = 2;

// ── Types ────────────────────────────────────────────────────────────────────

export interface MatchedCandidate {
  bullet_id: string;
  source: string;
  source_id: string;
  source_type: "experience" | "project";
  original_text: string;
  similarity_score: number;
  matched_keywords: string[];   // qual keywords found in the bullet
  unmatched_keywords: string[]; // qual keywords NOT found in the bullet
}

export interface MatchRequirementResult {
  qualification: string;
  candidates: MatchedCandidate[];
}

// ── Flatten master resume ────────────────────────────────────────────────────

interface FlatBullet {
  bullet_id: string;
  source_id: string;
  source: string;
  text: string;
  text_lower: string;
  context: string;
}

let _cachedBullets: FlatBullet[] | null = null;
let _cachedEmbeddings: number[][] | null = null;
let _cachedBulletOrder: string[] | null = null;

function loadMasterBullets(): FlatBullet[] {
  if (_cachedBullets) return _cachedBullets;

  const raw = JSON.parse(fs.readFileSync(MASTER_RESUME_PATH, "utf-8"));
  const bullets: FlatBullet[] = [];

  for (const exp of raw.experiences || []) {
    const ctx = `${exp.company} | ${exp.role}`;
    for (const b of exp.bullets || []) {
      bullets.push({
        bullet_id: b.id,
        source_id: exp.id,
        source: `${exp.company} -- ${exp.role}`,
        text: b.text,
        text_lower: b.text.toLowerCase(),
        context: ctx,
      });
    }
  }

  for (const proj of raw.projects || []) {
    const ctx = `${proj.name} | Project`;
    for (const b of proj.bullets || []) {
      bullets.push({
        bullet_id: b.id,
        source_id: proj.id,
        source: proj.name,
        text: b.text,
        text_lower: b.text.toLowerCase(),
        context: ctx,
      });
    }
  }

  _cachedBullets = bullets;
  return bullets;
}

// ── Cosine similarity ────────────────────────────────────────────────────────

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ── Voyage embedding (cached) ────────────────────────────────────────────────

async function embedBullets(bullets: FlatBullet[]): Promise<number[][]> {
  // Check cache validity
  const currentIds = bullets.map(b => b.bullet_id);
  if (
    _cachedEmbeddings && _cachedBulletOrder &&
    currentIds.length === _cachedBulletOrder.length &&
    currentIds.every((id, i) => id === _cachedBulletOrder![i])
  ) {
    return _cachedEmbeddings;
  }

  // Group by source for contextual embedding
  const groups = new Map<string, { context: string; bullets: FlatBullet[] }>();
  for (const b of bullets) {
    if (!groups.has(b.source_id)) {
      groups.set(b.source_id, { context: b.context, bullets: [] });
    }
    groups.get(b.source_id)!.bullets.push(b);
  }

  const documents: string[][] = [];
  const bulletOrder: string[] = [];

  for (const [, group] of groups) {
    const chunks = [group.context];
    for (const b of group.bullets) {
      chunks.push(b.text.slice(0, 500));
      bulletOrder.push(b.bullet_id);
    }
    documents.push(chunks);
  }

  console.log(`[match-req] Embedding ${bulletOrder.length} bullets via Voyage...`);
  const t0 = Date.now();

  const result = await voyage.contextualizedEmbed({
    inputs: documents,
    model: "voyage-context-3",
    inputType: "document",
  });

  const embeddings: number[][] = [];
  for (let docIdx = 0; docIdx < documents.length; docIdx++) {
    const docData = result.data![docIdx].data!;
    const numChunks = documents[docIdx].length;
    for (let chunkIdx = 1; chunkIdx < numChunks; chunkIdx++) {
      embeddings.push(docData[chunkIdx].embedding!);
    }
  }

  _cachedEmbeddings = embeddings;
  _cachedBulletOrder = bulletOrder;

  console.log(`[match-req] Cached ${embeddings.length} bullet embeddings in ${Date.now() - t0}ms`);
  return embeddings;
}

async function embedQuery(text: string): Promise<number[]> {
  const result = await voyage.contextualizedEmbed({
    inputs: [[text]],
    model: "voyage-context-3",
    inputType: "query",
  });
  return result.data![0].data![0].embedding!;
}

// ── Deterministic keyword extraction & matching ──────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "are", "was", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can", "need",
  "that", "this", "these", "those", "it", "its", "they", "them", "their",
  "we", "our", "you", "your", "who", "which", "what", "when", "where",
  "how", "all", "each", "every", "both", "few", "more", "most", "other",
  "some", "such", "no", "not", "only", "own", "same", "so", "than",
  "too", "very", "just", "about", "above", "after", "again", "also",
  "any", "because", "before", "between", "during", "if", "into", "out",
  "over", "through", "under", "until", "up", "while", "able",
  "experience", "years", "strong", "excellent", "proven", "deep",
]);

function extractKeyTerms(text: string): string[] {
  // Extract meaningful multi-word and single-word terms
  const lower = text.toLowerCase();

  // First grab common multi-word phrases
  const multiWordPatterns = [
    /product\s+manage\w*/gi,
    /cross[\s-]functional/gi,
    /data[\s-]driven/gi,
    /a\/?b\s+test\w*/gi,
    /machine\s+learning/gi,
    /deep\s+learning/gi,
    /natural\s+language/gi,
    /user\s+research/gi,
    /stakeholder\s+management/gi,
    /product\s+strategy/gi,
    /product\s+roadmap\w*/gi,
    /go[\s-]to[\s-]market/gi,
    /ai[\s\/]ml/gi,
    /b2b\s+saas/gi,
    /end[\s-]to[\s-]end/gi,
  ];

  const terms: string[] = [];
  const usedSpans = new Set<string>();

  for (const pattern of multiWordPatterns) {
    const matches = text.matchAll(pattern);
    for (const m of matches) {
      const term = m[0].toLowerCase().replace(/\s+/g, " ").trim();
      terms.push(term);
      usedSpans.add(term);
    }
  }

  // Then extract single words not in stop words
  const words = lower
    .replace(/[^a-z0-9\s\/\-]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  for (const w of words) {
    if (!usedSpans.has(w)) {
      terms.push(w);
    }
  }

  return [...new Set(terms)];
}

function findKeywordOverlap(
  qualTerms: string[],
  bulletTextLower: string,
): { matched: string[]; unmatched: string[] } {
  const matched: string[] = [];
  const unmatched: string[] = [];

  for (const term of qualTerms) {
    // Check if term (or close variant) appears in bullet
    const variants = [
      term,
      term.replace(/-/g, " "),
      term.replace(/\s/g, "-"),
      term + "s",
      term + "ing",
      term + "ed",
      term.replace(/s$/, ""),
      term.replace(/ing$/, ""),
    ];

    const found = variants.some(v => bulletTextLower.includes(v));
    if (found) {
      matched.push(term);
    } else {
      unmatched.push(term);
    }
  }

  return { matched, unmatched };
}

// ── Main function ────────────────────────────────────────────────────────────

export async function matchRequirement(
  qualificationText: string,
  _jdKeywords: string[],   // reserved for future use
  lockedBulletIds: string[],
  sourceTypeFilter?: "experience" | "project",
): Promise<MatchRequirementResult> {
  const allBullets = loadMasterBullets();
  const qualTerms = extractKeyTerms(qualificationText);

  console.log(`[match-req] "${qualificationText.slice(0, 60)}..." → ${qualTerms.length} key terms, ${allBullets.length} bullets`);

  // Stage 1: Voyage embedding retrieval
  const t0 = Date.now();
  const bulletEmbeddings = await embedBullets(allBullets);
  const queryEmbedding = await embedQuery(qualificationText);

  // Build ID→index map (same order as embedBullets)
  const idToIdx = new Map<string, number>();
  const groups = new Map<string, FlatBullet[]>();
  for (const b of allBullets) {
    if (!groups.has(b.source_id)) groups.set(b.source_id, []);
    groups.get(b.source_id)!.push(b);
  }
  let idx = 0;
  for (const [, groupBullets] of groups) {
    for (const b of groupBullets) {
      idToIdx.set(b.bullet_id, idx++);
    }
  }

  // Source priority tiebreaker: when similarity is close, prefer Matic > Saayam > Wurq=ZS
  const SOURCE_PRIORITY: Record<string, number> = {
    exp_matic_0: 0.015,
    exp_saayam_1: 0.010,
    exp_wurq_2: 0.005,
    exp_zs_3: 0.005,
  };

  // Score and rank
  const scored: Array<{ bullet: FlatBullet; similarity: number; _sortScore: number }> = [];
  for (const bullet of allBullets) {
    if (lockedBulletIds.includes(bullet.bullet_id)) continue;
    // Apply source type filter if provided
    if (sourceTypeFilter) {
      const isProject = bullet.source_id.startsWith("proj_");
      if (sourceTypeFilter === "project" && !isProject) continue;
      if (sourceTypeFilter === "experience" && isProject) continue;
    }
    const embIdx = idToIdx.get(bullet.bullet_id);
    if (embIdx === undefined) continue;
    const sim = cosineSim(queryEmbedding, bulletEmbeddings[embIdx]);
    const boost = SOURCE_PRIORITY[bullet.source_id] || 0;
    scored.push({ bullet, similarity: sim, _sortScore: sim + boost });
  }
  scored.sort((a, b) => b._sortScore - a._sortScore);

  const topK = scored.slice(0, TOP_K);
  console.log(`[match-req] Retrieval: ${topK.length} candidates in ${Date.now() - t0}ms`);

  // Stage 2: Deterministic keyword overlap
  const candidates: MatchedCandidate[] = topK.map(({ bullet, similarity }) => {
    const { matched, unmatched } = findKeywordOverlap(qualTerms, bullet.text_lower);
    return {
      bullet_id: bullet.bullet_id,
      source: bullet.source,
      source_id: bullet.source_id,
      source_type: bullet.source_id.startsWith("proj_") ? "project" : "experience",
      original_text: bullet.text,
      similarity_score: similarity,
      matched_keywords: matched,
      unmatched_keywords: unmatched,
    };
  });

  return { qualification: qualificationText, candidates };
}
