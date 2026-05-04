/**
 * Shared Playwright utilities for Google, Meta, and custom-playwright scrapers.
 * Extracted from jobScraper.ts so the new scraper modules don't depend on it.
 */

export const LI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/120.0.0.0 Safari/537.36";

export const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-blink-features=AutomationControlled",
  "--disable-gpu",
  "--no-zygote",
  "--single-process",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-sync",
  "--no-first-run",
  "--mute-audio",
];

const SYSTEM_CHROMIUM_PATHS = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
];

export async function launchChromium(): Promise<import("playwright").Browser> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pw = require("playwright") as typeof import("playwright");

  try {
    const browser = await pw.chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    return browser;
  } catch (e) {
    console.warn(`[playwright] own browser unavailable: ${e instanceof Error ? e.message : e}`);
  }

  try {
    console.log("[playwright] attempting runtime browser install...");
    const { execFileSync } = require("child_process") as typeof import("child_process");
    const cli = "./node_modules/.bin/playwright";
    execFileSync(cli, ["install", "chromium"], {
      env: { ...process.env },
      stdio: "inherit",
      timeout: 120_000,
    });
    const browser = await pw.chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    return browser;
  } catch (e) {
    console.warn(`[playwright] runtime install failed: ${e instanceof Error ? e.message : e}`);
  }

  const fs = require("fs") as typeof import("fs");
  for (const executablePath of SYSTEM_CHROMIUM_PATHS) {
    if (!fs.existsSync(executablePath)) continue;
    try {
      const browser = await pw.chromium.launch({ headless: true, args: CHROMIUM_ARGS, executablePath });
      return browser;
    } catch (e) {
      console.warn(`[playwright] failed with ${executablePath}: ${e instanceof Error ? e.message : e}`);
    }
  }

  throw new Error("No Chromium available — all install attempts failed");
}

// Serialise all Playwright launches so only one Chromium instance runs at a time
// (low-memory hosts like Render free tier cap at ~512 MB).
let _pwQueue = Promise.resolve();

export function withPlaywright<T>(fn: () => Promise<T>): Promise<T> {
  const next = _pwQueue.then(fn);
  _pwQueue = next.then(
    () => { /* empty */ },
    () => { /* empty */ },
  );
  return next;
}

// ── Shared description selectors ──────────────────────────────────────────────

const DESC_SELECTORS = [
  ".aG5W3", ".KwJkGe", ".BDNOWe", ".gc-formatted-body", // Google (About, Quals, Responsibilities)
  "._job_requirements", "._6nq", "._1n3p",               // Meta
  "[itemprop='description']", "[data-testid='job-description']",
  "main article", "main section", "article",
];

/**
 * Visit an individual job page and return its description HTML.
 * Returns empty string on failure — scraping continues without it.
 */
export async function fetchJobDescription(
  context: import("playwright").BrowserContext,
  applyUrl: string,
): Promise<string> {
  const page = await context.newPage();
  try {
    await page.goto(applyUrl, { waitUntil: "networkidle", timeout: 20_000 });

    // Google Careers is an Angular SPA that loads qualifications lazily.
    // Wait briefly for the qualifications section to appear after networkidle.
    const isGoogleCareers = applyUrl.includes("careers") && applyUrl.includes("google");
    if (isGoogleCareers) {
      try {
        await page.waitForSelector(".KwJkGe", { timeout: 5_000 });
      } catch { /* OK — proceed with whatever rendered */ }
    }

    const html = await page.evaluate((selectors: string[]) => {
      // Collect ALL matching elements (not just the first) and concatenate.
      // Google Careers splits JD and qualifications into separate divs.
      const parts: string[] = [];
      const seen = new Set<string>();
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => {
          const text = (el.textContent ?? "").trim();
          const key = text.substring(0, 100);
          if (text.length > 80 && !seen.has(key)) {
            parts.push(el.innerHTML);
            seen.add(key);
          }
        });
      }
      // If selectors found content but missed qualifications, grab the whole main content
      const combined = parts.join("\n\n");
      if (combined.length > 0 && !combined.includes("Minimum") && !combined.includes("qualifications")) {
        // Try to find qualifications section separately
        const qualSel = document.querySelector(".KwJkGe, .gc-qualification, [data-field='minimum_qualifications']");
        if (qualSel) {
          parts.push(qualSel.innerHTML);
        }
      }
      if (parts.length > 0) return parts.join("\n\n");

      // Fallback: Google embeds job data in a script tag; extract HTML descriptions
      // from the AF_initDataCallback payload when Angular hasn't rendered content.
      const scripts = document.querySelectorAll("script");
      for (let i = 0; i < scripts.length; i++) {
        const txt = scripts[i].textContent ?? "";
        if (!txt.includes("Minimum qualifications")) continue;
        // Extract all HTML fragments from the data payload
        const htmlFrags: string[] = [];
        const re = /\\u003c(h[2-4]|ul|li|p|div|ol)[^]*?\\u003c\/\1\\u003e/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(txt)) !== null) {
          try {
            const decoded = JSON.parse('"' + m[0] + '"');
            htmlFrags.push(decoded);
          } catch { /* skip malformed */ }
        }
        if (htmlFrags.length > 0) return htmlFrags.join("\n");
      }

      return "";
    }, DESC_SELECTORS);
    return html;
  } catch {
    return "";
  } finally {
    await page.close();
  }
}

/**
 * Fetch descriptions for a batch of jobs, 2 pages concurrently.
 * Mutates job.description in-place.
 */
export async function fetchDescriptionBatch(
  context: import("playwright").BrowserContext,
  jobs: Array<{ role_url: string; description?: string }>,
  label: string,
): Promise<void> {
  let done = 0;
  const BATCH = 2;
  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (job) => {
        job.description = await fetchJobDescription(context, job.role_url);
        done++;
      }),
    );
    console.log(`[playwright] ${label}: fetched descriptions ${done}/${jobs.length}`);
  }
}
