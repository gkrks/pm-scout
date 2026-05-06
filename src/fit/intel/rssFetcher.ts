/**
 * RSS fetcher: parses an RSS/Atom feed, fetches posts from the last 90 days,
 * extracts main content, chunks by section, embeds via Voyage, and writes
 * to company_intel. Logs per-post failures to scrape_failures.
 */

import fetch from "node-fetch";
import * as cheerio from "cheerio";
import Parser from "rss-parser";
import { VoyageAIClient } from "voyageai";
import { getSupabaseClient } from "../../storage/supabase";
import { htmlToText } from "../../lib/htmlToText";

const VOYAGE_MODEL = process.env.VOYAGE_EMBED_MODEL || "voyage-3-large";
const VOYAGE_DIM = 1024;
const MAX_CHUNK_CHARS = 2000;
const MIN_CHUNK_CHARS = 100;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

const parser = new Parser({
  timeout: 15_000,
  headers: { "User-Agent": "PMScout/1.0 (rss-fetcher)" },
});

export interface RssFetchResult {
  postsFound: number;
  postsProcessed: number;
  chunksWritten: number;
  failures: string[];
}

/**
 * Fetch and process an RSS feed for a company. Filters to last 90 days,
 * fetches each post, chunks content, embeds, and writes to company_intel.
 */
export async function fetchAndProcessFeed(
  feedUrl: string,
  companyId: string,
  force = false,
): Promise<RssFetchResult> {
  const supabase = getSupabaseClient();
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (!voyageKey) throw new Error("VOYAGE_API_KEY not set");
  const voyage = new VoyageAIClient({ apiKey: voyageKey });

  const result: RssFetchResult = {
    postsFound: 0,
    postsProcessed: 0,
    chunksWritten: 0,
    failures: [],
  };

  // Parse the feed
  let feed;
  try {
    feed = await parser.parseURL(feedUrl);
  } catch (err: any) {
    await logPostFailure(feedUrl, companyId, "feed_parse_error", err.message);
    result.failures.push(`Feed parse failed: ${err.message}`);
    // Update intel_sources with failure
    await supabase.from("intel_sources").update({
      last_fetched_at: new Date().toISOString(),
      last_status: "parse_error",
      consecutive_failures: 1,
    }).match({ company_id: companyId, feed_url: feedUrl });
    return result;
  }

  const cutoffDate = new Date(Date.now() - NINETY_DAYS_MS);
  const recentItems = (feed.items || []).filter((item) => {
    const pubDate = item.pubDate || item.isoDate;
    if (!pubDate) return true; // Include undated items
    return new Date(pubDate) >= cutoffDate;
  });

  result.postsFound = recentItems.length;
  console.log(`[intel] Feed has ${feed.items?.length || 0} total items, ${recentItems.length} in last 90 days`);

  for (const item of recentItems) {
    const postUrl = item.link || item.guid || "";
    if (!postUrl) continue;

    try {
      // Fetch post HTML
      const postContent = await fetchPostContent(postUrl, item);
      if (!postContent || postContent.length < MIN_CHUNK_CHARS) {
        result.failures.push(`${postUrl}: content too short`);
        continue;
      }

      // Chunk by section headings
      const chunks = chunkBySection(postContent, item.title || "");

      // Embed all chunks in batch
      const texts = chunks.map((c) => c.text);
      const embResponse = await voyage.embed({
        input: texts,
        model: VOYAGE_MODEL,
        outputDimension: VOYAGE_DIM,
        inputType: "document",
      });

      const publishedAt = item.pubDate || item.isoDate || null;

      // Write each chunk to company_intel
      for (let i = 0; i < chunks.length; i++) {
        const embedding = embResponse.data?.[i]?.embedding;
        if (!embedding) continue;

        const { error } = await supabase.from("company_intel").insert({
          company_id: companyId,
          source_url: postUrl,
          source_type: "eng_blog_rss",
          published_at: publishedAt,
          chunk_text: chunks[i].text,
          embedding: JSON.stringify(embedding),
          intel_type: classifyChunk(chunks[i].text, item.title || ""),
        });

        if (error) {
          result.failures.push(`${postUrl} chunk ${i}: ${error.message}`);
        } else {
          result.chunksWritten++;
        }
      }

      result.postsProcessed++;
    } catch (err: any) {
      await logPostFailure(postUrl, companyId, "post_fetch_error", err.message);
      result.failures.push(`${postUrl}: ${err.message}`);
    }
  }

  // Update intel_sources status
  await supabase.from("intel_sources").update({
    last_fetched_at: new Date().toISOString(),
    last_status: "ok",
    consecutive_failures: 0,
  }).match({ company_id: companyId, feed_url: feedUrl });

  return result;
}

/**
 * Fetch post content. Uses the feed's content:encoded first, falls back
 * to fetching the URL and extracting with cheerio.
 */
async function fetchPostContent(url: string, feedItem: any): Promise<string> {
  // Try content from the feed itself first (many feeds include full text)
  const feedContent = feedItem["content:encoded"] || feedItem.content || feedItem.contentSnippet;
  if (feedContent && feedContent.length > 500) {
    return htmlToText(feedContent);
  }

  // Fall back to fetching the URL
  const resp = await fetch(url, {
    timeout: 15_000,
    headers: { "User-Agent": "PMScout/1.0 (rss-fetcher)" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();

  // Try to extract main content using common selectors
  const $ = cheerio.load(html);
  $("script, style, nav, header, footer, aside").remove();

  // Prefer article or main content
  const article = $("article").first();
  if (article.length && article.text().trim().length > 200) {
    return htmlToText(article.html() || "");
  }

  const main = $("main, [role='main'], .post-content, .entry-content, .article-body").first();
  if (main.length && main.text().trim().length > 200) {
    return htmlToText(main.html() || "");
  }

  // Fallback: full body text
  return htmlToText($.html() || "");
}

/**
 * Chunk text by section headings. Each chunk is semantically coherent.
 * Respects MAX_CHUNK_CHARS — splits long sections further by paragraph.
 */
function chunkBySection(text: string, title: string): { text: string }[] {
  const chunks: { text: string }[] = [];

  // Split by markdown-style headings or blank-line-separated sections
  const sections = text.split(/\n(?=#{1,3}\s|\n\n)/);

  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed.length < MIN_CHUNK_CHARS) continue;

    if (trimmed.length <= MAX_CHUNK_CHARS) {
      chunks.push({ text: `[${title}] ${trimmed}` });
    } else {
      // Split long sections by paragraphs
      const paragraphs = trimmed.split(/\n\n+/);
      let buffer = "";
      for (const para of paragraphs) {
        if ((buffer + "\n\n" + para).length > MAX_CHUNK_CHARS && buffer.length >= MIN_CHUNK_CHARS) {
          chunks.push({ text: `[${title}] ${buffer.trim()}` });
          buffer = para;
        } else {
          buffer = buffer ? buffer + "\n\n" + para : para;
        }
      }
      if (buffer.trim().length >= MIN_CHUNK_CHARS) {
        chunks.push({ text: `[${title}] ${buffer.trim()}` });
      }
    }
  }

  // If no chunks produced, use the whole text as one chunk
  if (chunks.length === 0 && text.trim().length >= MIN_CHUNK_CHARS) {
    chunks.push({ text: `[${title}] ${text.trim().slice(0, MAX_CHUNK_CHARS)}` });
  }

  return chunks;
}

/**
 * Classify a chunk's intel_type based on content signals.
 */
function classifyChunk(text: string, title: string): string {
  const combined = (title + " " + text).toLowerCase();
  if (/launch|ship|release|announce|now available|introducing/.test(combined)) return "launch";
  if (/architect|design|chose|migrat|refactor|stack|infra/.test(combined)) return "technical_decision";
  if (/hiring|role|join|team|position|recruit/.test(combined)) return "hiring";
  if (/fund|raise|series [a-d]|valuation|invest/.test(combined)) return "funding";
  if (/mission|pivot|vision|rebrand|strateg/.test(combined)) return "mission_shift";
  return "other";
}

async function logPostFailure(
  url: string,
  companyId: string,
  errorClass: string,
  errorMessage: string,
): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.from("scrape_failures").insert({
      source_url: url,
      company_id: companyId,
      error_class: errorClass,
      error_message: errorMessage,
    });
  } catch (e: any) {
    console.error(`[intel] Failed to log scrape failure: ${e.message}`);
  }
}
