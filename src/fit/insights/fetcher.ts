/**
 * Insight source fetcher: retrieves text content from project URLs.
 * Handles GitHub READMEs, blog posts (cheerio), and Medium posts.
 * On failure, logs to scrape_failures and returns null.
 */

import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { getSupabaseClient } from "../../storage/supabase";
import { htmlToText } from "../../lib/htmlToText";

export interface FetchedSource {
  url: string;
  type: string;
  content: string;
}

/**
 * Fetch content from a single source URL.
 * Returns null on failure (logged to scrape_failures).
 */
export async function fetchSourceContent(
  url: string,
  type: string,
  companyId?: string,
): Promise<FetchedSource | null> {
  try {
    const content = await fetchByType(url, type);
    if (!content || content.trim().length < 50) {
      await logFailure(url, companyId, "empty_content", "Fetched content too short or empty");
      return null;
    }
    return { url, type, content };
  } catch (err: any) {
    await logFailure(url, companyId, classifyError(err), err.message);
    return null;
  }
}

async function fetchByType(url: string, type: string): Promise<string> {
  switch (type) {
    case "local_file": {
      // Read from local filesystem (for scraped site exports)
      const resolved = path.resolve(url);
      if (!fs.existsSync(resolved)) throw new Error(`Local file not found: ${resolved}`);
      return fs.readFileSync(resolved, "utf8");
    }
    case "github_readme": {
      // Convert github.com URLs to raw.githubusercontent.com
      const rawUrl = url
        .replace("github.com", "raw.githubusercontent.com")
        .replace(/\/blob\//, "/")
        .replace(/\/?$/, url.includes("README") ? "" : "/main/README.md");
      const resp = await fetch(rawUrl, { timeout: 15_000 });
      if (!resp.ok) throw new Error(`GitHub raw fetch failed: ${resp.status}`);
      return await resp.text();
    }
    case "blog":
    case "medium":
    default: {
      const resp = await fetch(url, {
        timeout: 15_000,
        headers: { "User-Agent": "PMScout/1.0 (insight-fetcher)" },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
      const html = await resp.text();
      return htmlToText(html);
    }
  }
}

function classifyError(err: any): string {
  const msg = err.message || "";
  if (msg.includes("ENOTFOUND") || msg.includes("ECONNREFUSED")) return "network_error";
  if (msg.includes("timeout") || err.type === "request-timeout") return "timeout";
  if (msg.includes("404")) return "http_404";
  if (msg.includes("403")) return "http_403";
  return "fetch_error";
}

async function logFailure(
  sourceUrl: string,
  companyId: string | undefined,
  errorClass: string,
  errorMessage: string,
): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.from("scrape_failures").insert({
      source_url: sourceUrl,
      company_id: companyId || null,
      error_class: errorClass,
      error_message: errorMessage,
    });
  } catch (e: any) {
    console.error(`[insights] Failed to log scrape failure: ${e.message}`);
  }
}
