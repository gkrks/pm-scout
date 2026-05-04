/**
 * Incremental qualification map updater.
 *
 * After each scan, when new listings have qualifications extracted,
 * this module:
 *   1. Identifies qualification texts not yet in the map
 *   2. Embeds them via OpenAI text-embedding-3-large
 *   3. Ranks top-3 resume bullets by cosine similarity
 *   4. Assigns each to the best-matching semantic group
 *   5. Upserts rows into qualification_map_quals in Supabase
 *
 * Cost: ~$0.001 per scan for ~20 new quals (1 embedding API call).
 */

import crypto from "crypto";
import { getSupabaseClient } from "./supabase";

const EMBEDDING_MODEL = "text-embedding-3-large";
const TOP_K = 5;

function qualHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

/**
 * Embed texts via OpenAI in one batch call.
 */
async function embedTexts(
  texts: string[],
  openaiKey: string,
): Promise<number[][]> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: openaiKey });

  // Truncate each text to 500 chars (matching Python pipeline)
  const truncated = texts.map((t) => t.slice(0, 500));

  const resp = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: truncated,
  });

  return resp.data.map((d) => d.embedding);
}

/**
 * Normalize an embedding vector to unit length.
 */
function normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

/**
 * Main entry point: incrementally update the qualification map.
 *
 * @param newListingIds - Supabase listing IDs that were just upserted
 * @returns count of quals added
 */
export async function updateQualMapIncremental(
  newListingIds: string[],
): Promise<{ added: number; skipped: number }> {
  if (newListingIds.length === 0) return { added: 0, skipped: 0 };

  const openaiKey = process.env.OPENAI_KEY;
  if (!openaiKey) {
    console.log("[qualMap] OPENAI_KEY not set, skipping map update");
    return { added: 0, skipped: 0 };
  }

  const sb = getSupabaseClient();

  // ── 1. Fetch existing qual hashes ───────────────────────────────────────
  const { data: existingRows } = await sb
    .from("qualification_map_quals")
    .select("qual_hash");

  const existingHashes = new Set(
    (existingRows ?? []).map((r: { qual_hash: string }) => r.qual_hash),
  );

  // ── 2. Fetch qualifications from new listings ──────────────────────────
  const { data: listings } = await sb
    .from("job_listings")
    .select("jd_required_qualifications, jd_preferred_qualifications")
    .in("id", newListingIds);

  if (!listings || listings.length === 0) return { added: 0, skipped: 0 };

  // Collect unique new qual texts
  const newQuals = new Map<string, string>(); // hash -> text
  for (const listing of listings) {
    const reqQuals = (listing.jd_required_qualifications as string[]) ?? [];
    const prefQuals = (listing.jd_preferred_qualifications as string[]) ?? [];
    for (const text of [...reqQuals, ...prefQuals]) {
      if (!text || text.length < 10) continue;
      const hash = qualHash(text);
      if (!existingHashes.has(hash) && !newQuals.has(hash)) {
        newQuals.set(hash, text);
      }
    }
  }

  if (newQuals.size === 0) {
    console.log("[qualMap] No new qualifications to add");
    return { added: 0, skipped: 0 };
  }

  console.log(`[qualMap] Found ${newQuals.size} new qualifications, embedding...`);

  // ── 3. Load bullet data from meta table ────────────────────────────────
  const { data: metaRows } = await sb
    .from("qualification_map_meta")
    .select("bullets, groups")
    .order("created_at", { ascending: false })
    .limit(1);

  if (!metaRows || metaRows.length === 0) {
    console.warn("[qualMap] No meta row found, skipping map update");
    return { added: 0, skipped: 0 };
  }

  const meta = metaRows[0];
  const bulletData = meta.bullets as Record<string, { t: string; s: string }>;
  const groups = meta.groups as Record<string, string[]>;
  const bulletIds = Object.keys(bulletData);
  const bulletTexts = bulletIds.map((id) => bulletData[id].t);

  // ── 4. Embed new quals + bullets ───────────────────────────────────────
  const qualTexts = Array.from(newQuals.values());
  const qualHashes = Array.from(newQuals.keys());

  // Embed quals and bullets in parallel
  const [qualEmbeddings, bulletEmbeddings] = await Promise.all([
    embedTexts(qualTexts, openaiKey).then((vecs) => vecs.map(normalize)),
    embedTexts(bulletTexts, openaiKey).then((vecs) => vecs.map(normalize)),
  ]);

  console.log(`[qualMap] Embeddings computed: ${qualTexts.length} quals, ${bulletTexts.length} bullets`);

  // ── 5. Compute group centroids for assignment ──────────────────────────
  // Load embeddings for existing quals in each group to compute centroids
  // Simplified: assign to group with highest average similarity to the qual
  // We'll use keyword matching as a fast heuristic instead of centroids
  const groupNames = Object.keys(groups);

  function assignGroup(qualText: string): string {
    const lower = qualText.toLowerCase();

    // Simple keyword-based group assignment
    const groupKeywords: Record<string, string[]> = {
      ai_ml_llm: ["machine learning", "ml", "ai", "llm", "deep learning", "nlp", "model", "neural", "generative", "gpt", "transformer"],
      data_analytics: ["data", "analytics", "sql", "metrics", "dashboard", "tableau", "bi ", "reporting", "analysis", "insights"],
      developer_platform_infra: ["api", "platform", "infrastructure", "cloud", "aws", "gcp", "azure", "distributed", "microservice", "sdk", "developer"],
      security_compliance: ["security", "compliance", "privacy", "gdpr", "soc", "risk", "vulnerability", "encryption"],
      education: ["degree", "bachelor", "master", "phd", "mba", "university", "computer science"],
      experience_years: ["years of experience", "years experience", "yr", "yrs"],
      communication: ["communication", "presentation", "stakeholder", "written", "verbal", "storytelling"],
      cross_functional: ["cross-functional", "cross functional", "collaborate", "engineering", "design", "work with", "partner with"],
      shipping_execution: ["ship", "deliver", "launch", "roadmap", "agile", "scrum", "sprint", "execution", "release", "prioritiz"],
      product_strategy: ["strategy", "vision", "market", "competitive", "business case", "opportunity", "positioning", "gtm", "go-to-market"],
      customer_empathy: ["customer", "user", "empathy", "research", "feedback", "interview", "persona", "usability"],
      technical_depth: ["technical", "engineering", "code", "architecture", "system design", "software", "programming"],
      ambiguity_agency: ["ambiguity", "autonomous", "self-starter", "ownership", "initiative", "independent", "proactive"],
    };

    let bestGroup = "other";
    let bestScore = 0;

    for (const [group, keywords] of Object.entries(groupKeywords)) {
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestGroup = group;
      }
    }

    return bestGroup;
  }

  // ── 6. Rank bullets for each new qual ──────────────────────────────────
  const rows: Array<{
    qual_hash: string;
    qual_text: string;
    qual_type: string;
    group_name: string;
    freq: number;
    bullet_ids: string[];
    similarities: number[];
  }> = [];

  for (let i = 0; i < qualTexts.length; i++) {
    const qualVec = qualEmbeddings[i];
    const qualText = qualTexts[i];
    const hash = qualHashes[i];

    // Compute similarities to all bullets
    const sims: Array<{ id: string; sim: number }> = [];
    for (let j = 0; j < bulletIds.length; j++) {
      sims.push({ id: bulletIds[j], sim: cosineSimilarity(qualVec, bulletEmbeddings[j]) });
    }

    // Sort descending, take top-K
    sims.sort((a, b) => b.sim - a.sim);
    const topK = sims.slice(0, TOP_K);

    rows.push({
      qual_hash: hash,
      qual_text: qualText,
      qual_type: "bullet_match",
      group_name: assignGroup(qualText),
      freq: 1,
      bullet_ids: topK.map((s) => s.id),
      similarities: topK.map((s) => parseFloat(s.sim.toFixed(4))),
    });
  }

  // ── 7. Upsert to Supabase ─────────────────────────────────────────────
  let upserted = 0;
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await sb
      .from("qualification_map_quals")
      .upsert(batch, { onConflict: "qual_hash" });

    if (error) {
      console.warn(`[qualMap] Upsert batch failed: ${error.message}`);
    } else {
      upserted += batch.length;
    }
  }

  // ── 8. Update meta stats + groups ──────────────────────────────────────
  // Add new qual hashes to their groups
  const updatedGroups = { ...groups };
  for (const row of rows) {
    if (!updatedGroups[row.group_name]) updatedGroups[row.group_name] = [];
    updatedGroups[row.group_name].push(row.qual_hash);
  }

  const totalQuals = existingHashes.size + upserted;
  await sb
    .from("qualification_map_meta")
    .update({
      groups: updatedGroups,
      stats_quals: totalQuals,
      stats_groups: Object.keys(updatedGroups).length,
    })
    .order("created_at", { ascending: false })
    .limit(1);

  console.log(
    `[qualMap] Incremental update complete: ${upserted} added, ` +
    `${newQuals.size - upserted} failed, ${totalQuals} total quals`,
  );

  // ── 9. Signal Python service to reload (fire-and-forget) ──────────────
  const bulletSelectorUrl = process.env.BULLET_SELECTOR_URL || "http://127.0.0.1:8001";
  try {
    const fetch = (await import("node-fetch")).default;
    await (fetch as any)(`${bulletSelectorUrl}/map/refresh`, {
      method: "POST",
      timeout: 5_000,
    });
    console.log("[qualMap] Python service map refreshed");
  } catch {
    // Python service may not be running during scan — that's fine
  }

  return { added: upserted, skipped: newQuals.size - upserted };
}
