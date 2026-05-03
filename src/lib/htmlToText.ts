import * as cheerio from "cheerio";

/**
 * Convert raw HTML to clean plain text, preserving structural cues
 * (headings become line breaks, list items become "- " prefixed lines).
 *
 * Strips <script> and <style> content, decodes HTML entities,
 * and collapses excessive whitespace.
 */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html);

  // Remove non-visible content
  $("script, style, noscript, iframe, svg").remove();

  // Insert structural line breaks before block elements
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    $(el).prepend("\n\n");
    $(el).append("\n");
  });

  $("p, div, section, article, header, footer, main, aside").each((_, el) => {
    $(el).append("\n");
  });

  $("br").replaceWith("\n");

  // Convert list items to "- " prefixed lines
  $("li").each((_, el) => {
    $(el).prepend("\n- ");
  });

  // Extract text — cheerio decodes entities automatically
  let text = $.text();

  // Collapse runs of whitespace on each line, then collapse blank lines
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n");

  // Collapse 3+ consecutive newlines into 2
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}
