/**
 * Feed discovery: given a company's domain or careers URL, find their
 * engineering blog RSS/Atom feed. Tries common path patterns, then falls
 * back to HTML <link> tag detection. Logs failures to scrape_failures.
 */

import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { getSupabaseClient } from "../../storage/supabase";

const COMMON_FEED_PATHS = [
  "/blog/feed",
  "/blog/rss",
  "/blog/feed.xml",
  "/blog/rss.xml",
  "/blog/atom.xml",
  "/engineering/feed",
  "/engineering/rss",
  "/engineering/feed.xml",
  "/engineering/rss.xml",
  "/feed",
  "/feed.xml",
  "/rss",
  "/rss.xml",
  "/atom.xml",
  "/blog/feed/atom",
  "/tech/feed",
  "/tech/rss",
];

export interface DiscoveredFeed {
  feedUrl: string;
  feedType: "rss" | "atom";
}

/**
 * Discover the RSS/Atom feed for a company's engineering blog.
 * Returns null if no feed found (logged to scrape_failures).
 */
export async function discoverFeed(
  domain: string,
  companyId: string,
): Promise<DiscoveredFeed | null> {
  // Normalize domain to base URL
  const baseUrl = domain.startsWith("http") ? new URL(domain).origin : `https://${domain}`;

  // Strategy 1: Try common feed paths
  for (const path of COMMON_FEED_PATHS) {
    const url = `${baseUrl}${path}`;
    try {
      const resp = await fetch(url, {
        method: "HEAD",
        timeout: 8_000,
        headers: { "User-Agent": "PMScout/1.0 (feed-discovery)" },
        redirect: "follow",
      });
      if (resp.ok) {
        // Verify it's actually a feed by checking content-type
        const ct = resp.headers.get("content-type") || "";
        if (ct.includes("xml") || ct.includes("rss") || ct.includes("atom")) {
          const feedType = ct.includes("atom") || path.includes("atom") ? "atom" : "rss";
          await saveFeedSource(companyId, url, feedType);
          return { feedUrl: url, feedType };
        }
        // Content-type ambiguous — try GET and check body
        const body = await fetchFeedBody(url);
        if (body) {
          const feedType = body.includes("<feed") ? "atom" : "rss";
          await saveFeedSource(companyId, url, feedType);
          return { feedUrl: url, feedType };
        }
      }
    } catch {
      // Silently try next path
    }
  }

  // Strategy 2: Fetch homepage and look for <link rel="alternate">
  try {
    const resp = await fetch(baseUrl, {
      timeout: 10_000,
      headers: { "User-Agent": "PMScout/1.0 (feed-discovery)" },
    });
    if (resp.ok) {
      const html = await resp.text();
      const $ = cheerio.load(html);
      const feedLink = $('link[rel="alternate"][type*="xml"], link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"]').first();
      if (feedLink.length) {
        let href = feedLink.attr("href") || "";
        if (href && !href.startsWith("http")) {
          href = new URL(href, baseUrl).toString();
        }
        if (href) {
          const feedType = (feedLink.attr("type") || "").includes("atom") ? "atom" : "rss";
          await saveFeedSource(companyId, href, feedType);
          return { feedUrl: href, feedType };
        }
      }
    }
  } catch {
    // Fall through to failure
  }

  // No feed found
  await logFailure(baseUrl, companyId);
  return null;
}

async function fetchFeedBody(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      timeout: 8_000,
      headers: { "User-Agent": "PMScout/1.0 (feed-discovery)" },
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    // Quick check: does it look like XML with RSS/Atom markers?
    if (text.includes("<rss") || text.includes("<feed") || text.includes("<channel>")) {
      return text;
    }
    return null;
  } catch {
    return null;
  }
}

async function saveFeedSource(companyId: string, feedUrl: string, feedType: "rss" | "atom"): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.from("intel_sources").upsert({
      company_id: companyId,
      feed_url: feedUrl,
      feed_type: feedType,
    }, { onConflict: "company_id,feed_url" });
  } catch (e: any) {
    console.error(`[intel] Failed to save feed source: ${e.message}`);
  }
}

async function logFailure(baseUrl: string, companyId: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.from("scrape_failures").insert({
      source_url: baseUrl,
      company_id: companyId,
      error_class: "no_feed_found",
      error_message: `No RSS/Atom feed found after trying ${COMMON_FEED_PATHS.length} paths + HTML link detection`,
    });
  } catch (e: any) {
    console.error(`[intel] Failed to log scrape failure: ${e.message}`);
  }
}
