/**
 * Hook retriever: embeds JD summary, fetches top-K insights and intel
 * chunks by cosine similarity for hook synthesis.
 */

import { VoyageAIClient } from "voyageai";
import { getSupabaseClient } from "../../storage/supabase";

const VOYAGE_MODEL = process.env.VOYAGE_EMBED_MODEL || "voyage-3-large";
const VOYAGE_DIM = 1024;

export interface Insight {
  id: string;
  project_id: string;
  insight_type: string;
  text: string;
  similarity: number;
}

export interface IntelChunk {
  id: string;
  source_url: string;
  source_type: string;
  intel_type: string;
  chunk_text: string;
  published_at: string | null;
  similarity: number;
}

export interface CandidatePairs {
  insights: Insight[];
  intel: IntelChunk[];
  jdSummary: string;
  companyId: string;
  companyName: string;
}

/**
 * Retrieve candidate insight/intel pairs for hook synthesis.
 * Embeds the JD summary, then finds top-K similar insights and intel chunks.
 */
export async function retrieveCandidatePairs(
  jobId: string,
  k = 20,
): Promise<CandidatePairs> {
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (!voyageKey) throw new Error("VOYAGE_API_KEY not set");
  const voyage = new VoyageAIClient({ apiKey: voyageKey });
  const supabase = getSupabaseClient();

  // Load job data
  const { data: job, error: jobError } = await supabase
    .from("job_listings")
    .select(`
      id, title, jd_job_title, jd_company_name,
      jd_required_qualifications, jd_preferred_qualifications,
      jd_role_context, jd_responsibilities,
      company:companies!inner(id, name)
    `)
    .eq("id", jobId)
    .single();

  if (jobError || !job) throw new Error(`Job ${jobId} not found: ${jobError?.message}`);

  const companyId = (job.company as any)?.id;
  const companyName = (job.company as any)?.name || job.jd_company_name || "Unknown";

  // Build JD summary text for embedding
  const reqQuals = (job.jd_required_qualifications as string[] || []).slice(0, 5);
  const responsibilities = (job.jd_responsibilities as string[] || []).slice(0, 5);
  const roleContext = (job.jd_role_context as any)?.summary || "";

  const jdSummary = [
    `Role: ${job.jd_job_title || job.title}`,
    `Company: ${companyName}`,
    reqQuals.length > 0 ? `Requirements: ${reqQuals.join("; ")}` : "",
    responsibilities.length > 0 ? `Responsibilities: ${responsibilities.join("; ")}` : "",
    roleContext ? `About: ${roleContext}` : "",
  ].filter(Boolean).join("\n");

  // Embed the JD summary
  const embResponse = await voyage.embed({
    input: [jdSummary],
    model: VOYAGE_MODEL,
    outputDimension: VOYAGE_DIM,
    inputType: "query",
  });
  const jdEmbedding = embResponse.data?.[0]?.embedding;
  if (!jdEmbedding) throw new Error("Failed to embed JD summary");

  // Fetch all accepted insights with embeddings
  const { data: allInsights } = await supabase
    .from("master_insights")
    .select("id, project_id, insight_type, text, embedding")
    .not("accepted_at", "is", null)
    .not("embedding", "is", null);

  // Compute cosine similarity and rank
  const rankedInsights: Insight[] = (allInsights || [])
    .map((row: any) => {
      const emb = typeof row.embedding === "string" ? JSON.parse(row.embedding) : row.embedding;
      return {
        id: row.id,
        project_id: row.project_id,
        insight_type: row.insight_type,
        text: row.text,
        similarity: cosineSimilarity(jdEmbedding, emb),
      };
    })
    .sort((a: Insight, b: Insight) => b.similarity - a.similarity)
    .slice(0, k);

  // Fetch company intel with embeddings
  const { data: allIntel } = await supabase
    .from("company_intel")
    .select("id, source_url, source_type, intel_type, chunk_text, published_at, embedding")
    .eq("company_id", companyId)
    .not("embedding", "is", null);

  const rankedIntel: IntelChunk[] = (allIntel || [])
    .map((row: any) => {
      const emb = typeof row.embedding === "string" ? JSON.parse(row.embedding) : row.embedding;
      return {
        id: row.id,
        source_url: row.source_url,
        source_type: row.source_type,
        intel_type: row.intel_type,
        chunk_text: row.chunk_text,
        published_at: row.published_at,
        similarity: cosineSimilarity(jdEmbedding, emb),
      };
    })
    .sort((a: IntelChunk, b: IntelChunk) => b.similarity - a.similarity)
    .slice(0, k);

  console.log(`[hook] Retrieved ${rankedInsights.length} insights, ${rankedIntel.length} intel chunks for ${companyName}`);

  return {
    insights: rankedInsights,
    intel: rankedIntel,
    jdSummary,
    companyId,
    companyName,
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
