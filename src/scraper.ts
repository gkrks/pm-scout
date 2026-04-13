import fetch from "node-fetch";
import * as fs from "fs";
import * as cheerio from "cheerio";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BROWSER_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
};

// Heading text patterns that indicate a requirements section
const REQUIREMENT_PATTERNS = [
  "requirements",
  "qualifications",
  "what you bring",
  "what we look for",
  "what we like to see",
  "preferred",
  "nice to have",
  "nice-to-have",
  "what you'll need",
  "what you will need",
  "you have",
  "you bring",
  "ideal candidate",
  "minimum qualifications",
  "basic qualifications",
  "about you",
];

function matchesPattern(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return REQUIREMENT_PATTERNS.some((p) => lower.includes(p));
}

// Map a tag name to a numeric heading level (for comparison)
function headingLevel(tagName: string): number {
  const levels: Record<string, number> = {
    h1: 1,
    h2: 2,
    h3: 3,
    h4: 4,
    h5: 5,
    h6: 6,
    strong: 7, // treat strong as a shallow heading
  };
  return levels[tagName.toLowerCase()] ?? 99;
}

/**
 * Fetch a job posting URL and extract the requirements / qualifications sections.
 * Falls back to all <li> bullets if no matching headings are found.
 */
export async function scrapeJobPage(url: string): Promise<string> {
  let html: string;

  // Support local file paths and file:// URIs for testing
  if (url.startsWith("file://") || (url.startsWith("/") && !url.startsWith("//")) || url.startsWith("./")) {
    const filePath = url.startsWith("file://") ? url.slice(7) : url;
    html = fs.readFileSync(filePath, "utf-8");
  } else {
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }

    html = await response.text();
  }

  const $ = cheerio.load(html);

  const headingSelector = "h1, h2, h3, h4, strong";
  const sections: string[] = [];

  $(headingSelector).each((_i, el) => {
    const headingText = $(el).text().trim();
    if (!matchesPattern(headingText)) return;

    const level = headingLevel(el.tagName);
    const collected: string[] = [`${headingText}:`];

    // Walk siblings until we hit another heading of equal or higher level
    let sibling = $(el).next();
    while (sibling.length) {
      const sibTag = sibling.prop("tagName")?.toLowerCase() ?? "";
      if (
        ["h1", "h2", "h3", "h4", "h5", "h6"].includes(sibTag) &&
        headingLevel(sibTag) <= level
      ) {
        break;
      }
      const text = sibling.text().trim();
      if (text) collected.push(text);
      sibling = sibling.next();
    }

    // Also check children (some ATSes nest everything inside one div under the heading)
    const childText = $(el)
      .parent()
      .find("li, p")
      .toArray()
      .map((n) => $(n).text().trim())
      .filter(Boolean)
      .join("\n");

    if (collected.length > 1) {
      sections.push(collected.join("\n"));
    } else if (childText) {
      sections.push(`${headingText}:\n${childText}`);
    }
  });

  if (sections.length > 0) {
    return sections.join("\n\n");
  }

  // Fallback: all bullet text from the page
  const bullets = $("li")
    .toArray()
    .map((el) => $(el).text().trim())
    .filter(Boolean);

  return bullets.join("\n");
}
