"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrapeJobPage = scrapeJobPage;
const node_fetch_1 = __importDefault(require("node-fetch"));
const fs = __importStar(require("fs"));
const cheerio = __importStar(require("cheerio"));
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
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
function matchesPattern(text) {
    const lower = text.toLowerCase().trim();
    return REQUIREMENT_PATTERNS.some((p) => lower.includes(p));
}
// Map a tag name to a numeric heading level (for comparison)
function headingLevel(tagName) {
    const levels = {
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
async function scrapeJobPage(url) {
    let html;
    // Support local file paths and file:// URIs for testing
    if (url.startsWith("file://") || (url.startsWith("/") && !url.startsWith("//")) || url.startsWith("./")) {
        const filePath = url.startsWith("file://") ? url.slice(7) : url;
        html = fs.readFileSync(filePath, "utf-8");
    }
    else {
        const response = await (0, node_fetch_1.default)(url, {
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
    const sections = [];
    $(headingSelector).each((_i, el) => {
        const headingText = $(el).text().trim();
        if (!matchesPattern(headingText))
            return;
        const level = headingLevel(el.tagName);
        const collected = [`${headingText}:`];
        // Walk siblings until we hit another heading of equal or higher level
        let sibling = $(el).next();
        while (sibling.length) {
            const sibTag = sibling.prop("tagName")?.toLowerCase() ?? "";
            if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(sibTag) &&
                headingLevel(sibTag) <= level) {
                break;
            }
            const text = sibling.text().trim();
            if (text)
                collected.push(text);
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
        }
        else if (childText) {
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
//# sourceMappingURL=scraper.js.map