/**
 * Company intel orchestrator: refreshes RSS-based intel for a company.
 * Cache policy: skip if last_fetched_at < 7 days ago unless force=true.
 */

import { getSupabaseClient } from "../../storage/supabase";
import { discoverFeed } from "./feedDiscovery";
import { fetchAndProcessFeed, RssFetchResult } from "./rssFetcher";

export interface RefreshResult {
  rssPostsAdded: number;
  chunksWritten: number;
  feedUrl: string | null;
  feedDiscovered: boolean;
  skipped: boolean;
  skipReason?: string;
  failures: string[];
}

/**
 * Refresh company intel from RSS. Discovers feed if not known,
 * then fetches and processes recent posts.
 */
export async function refreshCompanyIntel(
  companyId: string,
  opts: { force?: boolean; domain?: string } = {},
): Promise<RefreshResult> {
  const supabase = getSupabaseClient();
  const result: RefreshResult = {
    rssPostsAdded: 0,
    chunksWritten: 0,
    feedUrl: null,
    feedDiscovered: false,
    skipped: false,
    failures: [],
  };

  // Check existing feed sources
  const { data: sources } = await supabase
    .from("intel_sources")
    .select("*")
    .eq("company_id", companyId);

  let feedSource = sources?.[0];

  // If no known feed, try to discover one
  if (!feedSource) {
    // Need a domain to discover feeds — get from company record
    let domain = opts.domain;
    if (!domain) {
      const { data: company } = await supabase
        .from("companies")
        .select("careers_url, slug")
        .eq("id", companyId)
        .single();
      if (company?.careers_url) {
        domain = company.careers_url;
      }
    }

    if (!domain) {
      result.failures.push("No domain available for feed discovery");
      return result;
    }

    const discovered = await discoverFeed(domain, companyId);
    if (!discovered) {
      result.failures.push("No RSS/Atom feed found");
      return result;
    }

    result.feedDiscovered = true;
    result.feedUrl = discovered.feedUrl;

    // Reload from DB
    const { data: newSources } = await supabase
      .from("intel_sources")
      .select("*")
      .eq("company_id", companyId);
    feedSource = newSources?.[0];
  }

  if (!feedSource) {
    result.failures.push("Feed source not found after discovery");
    return result;
  }

  result.feedUrl = feedSource.feed_url;

  // Cache policy: skip if fetched within 7 days (unless force)
  if (!opts.force && feedSource.last_fetched_at) {
    const lastFetched = new Date(feedSource.last_fetched_at);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (lastFetched > sevenDaysAgo) {
      result.skipped = true;
      result.skipReason = `Last fetched ${lastFetched.toISOString().split("T")[0]}, within 7-day cache window`;
      return result;
    }
  }

  // Circuit breaker: skip feeds with 5+ consecutive failures
  if (feedSource.consecutive_failures >= 5 && !opts.force) {
    result.skipped = true;
    result.skipReason = `Feed has ${feedSource.consecutive_failures} consecutive failures (circuit breaker)`;
    return result;
  }

  // Fetch and process the feed
  console.log(`[intel] Fetching feed: ${feedSource.feed_url}`);
  const fetchResult: RssFetchResult = await fetchAndProcessFeed(
    feedSource.feed_url,
    companyId,
    opts.force,
  );

  result.rssPostsAdded = fetchResult.postsProcessed;
  result.chunksWritten = fetchResult.chunksWritten;
  result.failures.push(...fetchResult.failures);

  return result;
}
