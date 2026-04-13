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
exports.parseResume = parseResume;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const pdf_parse_1 = __importDefault(require("pdf-parse"));
// Known section heading names
const KNOWN_SECTIONS = [
    "experience",
    "work experience",
    "professional experience",
    "employment",
    "education",
    "skills",
    "technical skills",
    "projects",
    "summary",
    "objective",
    "certifications",
    "awards",
    "publications",
    "volunteer",
    "leadership",
];
function isHeading(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 80)
        return false;
    // All-caps line (at least 3 chars, no lowercase)
    if (trimmed.length >= 3 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
        return true;
    }
    // Matches a known section name (case-insensitive)
    const lower = trimmed.toLowerCase().replace(/[^a-z ]/g, "").trim();
    if (KNOWN_SECTIONS.some((s) => lower === s || lower.startsWith(s))) {
        return true;
    }
    return false;
}
// Month name → "MM" string
const MONTH_MAP = {
    jan: "01", feb: "02", mar: "03", apr: "04",
    may: "05", jun: "06", jul: "07", aug: "08",
    sep: "09", oct: "10", nov: "11", dec: "12",
    january: "01", february: "02", march: "03", april: "04",
    june: "06", july: "07", august: "08", september: "09",
    october: "10", november: "11", december: "12",
};
function todayYYYYMM() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${d.getFullYear()}-${mm}`;
}
/**
 * Parse a date token like "Jan 2021", "01/2021", "2021", "Present" → "YYYY-MM"
 */
function normalizeDate(token) {
    const lower = token.trim().toLowerCase();
    if (lower === "present" || lower === "current" || lower === "now") {
        return "present";
    }
    // "MM/YYYY" or "MM-YYYY"
    const slashFmt = lower.match(/^(\d{1,2})[\/\-](\d{4})$/);
    if (slashFmt) {
        return `${slashFmt[2]}-${slashFmt[1].padStart(2, "0")}`;
    }
    // "Month YYYY" or "MonthYYYY"
    const monthYear = lower.match(/^([a-z]+)[.\s,\-]*(\d{4})$/);
    if (monthYear) {
        const mm = MONTH_MAP[monthYear[1]] ?? "01";
        return `${monthYear[2]}-${mm}`;
    }
    // "YYYY"
    const yearOnly = lower.match(/^(\d{4})$/);
    if (yearOnly) {
        return `${yearOnly[1]}-01`;
    }
    return lower;
}
/**
 * Try to extract a date range from a line of text.
 * Returns [startDate, endDate] in "YYYY-MM" format or null.
 */
function extractDateRange(line) {
    // Pattern: any token – any token  (supports –, -, —, "to")
    const rangeRe = /([A-Za-z]+\.?\s*\d{4}|\d{1,2}[\/\-]\d{4}|\d{4})\s*(?:–|—|-|to)\s*(present|current|now|[A-Za-z]+\.?\s*\d{4}|\d{1,2}[\/\-]\d{4}|\d{4})/i;
    const match = line.match(rangeRe);
    if (match) {
        return [normalizeDate(match[1]), normalizeDate(match[2])];
    }
    return null;
}
function splitSections(lines) {
    const sections = [];
    let currentHeading = "Header";
    let currentLines = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        // Check if this is a section divider (line of dashes/equals after previous line)
        const nextIsDash = /^[-=]{3,}$/.test(trimmed);
        if (nextIsDash && currentLines.length > 0) {
            // Promote the last line to a heading
            const promoted = currentLines.pop();
            sections.push({
                heading: currentHeading,
                content: currentLines.join("\n"),
                lines: [...currentLines],
            });
            currentHeading = promoted.trim();
            currentLines = [];
            continue;
        }
        if (isHeading(trimmed)) {
            if (currentLines.length > 0 || currentHeading !== "Header") {
                sections.push({
                    heading: currentHeading,
                    content: currentLines.join("\n"),
                    lines: [...currentLines],
                });
            }
            currentHeading = trimmed;
            currentLines = [];
        }
        else {
            currentLines.push(trimmed);
        }
    }
    if (currentLines.length > 0) {
        sections.push({
            heading: currentHeading,
            content: currentLines.join("\n"),
            lines: [...currentLines],
        });
    }
    return sections;
}
function parseExperience(sections) {
    const expSection = sections.find((s) => {
        const h = s.heading.toLowerCase();
        return h.includes("experience") || h.includes("employment") || h.includes("work history");
    });
    if (!expSection)
        return [];
    const entries = [];
    let current = null;
    for (const line of expSection.lines) {
        const dateRange = extractDateRange(line);
        if (dateRange) {
            // This line contains dates — save it as part of current entry metadata
            if (current) {
                current.startDate = dateRange[0];
                current.endDate = dateRange[1];
            }
            continue;
        }
        // Bullet lines
        if (/^[•\-–—*▪◦·]/.test(line) || /^\d+\./.test(line)) {
            if (current) {
                current.bullets = current.bullets ?? [];
                current.bullets.push(line.replace(/^[•\-–—*▪◦·\d.]\s*/, "").trim());
            }
            continue;
        }
        // Non-bullet, non-date line — likely a new job title/company line
        // If current entry has no title/company yet, assign; otherwise start a new one
        if (!current) {
            current = { company: "", title: line, startDate: "", endDate: "", bullets: [] };
        }
        else if (!current.company && current.title) {
            current.company = current.title;
            current.title = line;
        }
        else {
            // Push completed entry and start new
            if (current.title) {
                entries.push({
                    company: current.company ?? "",
                    title: current.title,
                    startDate: current.startDate ?? "",
                    endDate: current.endDate ?? "",
                    bullets: current.bullets ?? [],
                });
            }
            current = { company: "", title: line, startDate: "", endDate: "", bullets: [] };
        }
    }
    if (current?.title) {
        entries.push({
            company: current.company ?? "",
            title: current.title,
            startDate: current.startDate ?? "",
            endDate: current.endDate ?? "",
            bullets: current.bullets ?? [],
        });
    }
    return entries;
}
function parseEducation(sections) {
    const eduSection = sections.find((s) => s.heading.toLowerCase().includes("education"));
    return eduSection?.lines ?? [];
}
function parseSkills(sections) {
    const skillSection = sections.find((s) => s.heading.toLowerCase().includes("skill"));
    if (!skillSection)
        return [];
    return skillSection.lines
        .flatMap((l) => l.split(/[,;|•]/))
        .map((s) => s.trim())
        .filter(Boolean);
}
/**
 * Parse a resume PDF or text file into structured ResumeData.
 */
async function parseResume(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    let raw;
    if (ext === ".pdf") {
        const buffer = fs.readFileSync(filePath);
        const result = await (0, pdf_parse_1.default)(buffer);
        raw = result.text;
    }
    else if (ext === ".txt" || ext === ".md") {
        raw = fs.readFileSync(filePath, "utf-8");
    }
    else {
        throw new Error(`Unsupported file type: ${ext}. Use .pdf, .txt, or .md`);
    }
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    const sections = splitSections(lines);
    const experience = parseExperience(sections);
    const education = parseEducation(sections);
    const skills = parseSkills(sections);
    return { raw, sections, experience, education, skills };
}
//# sourceMappingURL=parser.js.map