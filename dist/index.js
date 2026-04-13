#!/usr/bin/env node
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
require("dotenv/config");
const fs = __importStar(require("fs"));
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const scraper_1 = require("./scraper");
const extractor_1 = require("./extractor");
const parser_1 = require("./parser");
const matcher_1 = require("./matcher");
const reporter_1 = require("./reporter");
// ── Server mode ───────────────────────────────────────────────────────────────
// `node dist/index.js serve`  →  starts the web UI on localhost:8080
if (process.argv[2] === "serve") {
    // Dynamic require keeps the server module out of the CLI hot path
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { startServer } = require("./server");
    startServer().catch((err) => {
        console.error("Server failed to start:", err);
        process.exit(1);
    });
}
else {
    // ── CLI mode ──────────────────────────────────────────────────────────────────
    const program = new commander_1.Command();
    program
        .name("resume-matcher")
        .description("Match your resume against a job posting using Claude")
        .version("1.0.0");
    program
        .command("match")
        .description("Run a full resume ↔ job match analysis")
        .requiredOption("--job <url>", "URL of the job posting")
        .requiredOption("--resume <file>", "Path to your resume (.pdf, .txt, or .md)")
        .option("--verbose", "Print extra debug output", false)
        .action(async (opts) => {
        const { job: jobUrl, resume: resumePath, verbose } = opts;
        if (!process.env.ANTHROPIC_API_KEY) {
            console.error(chalk_1.default.red("Error: ANTHROPIC_API_KEY is not set. Add it to a .env file."));
            process.exit(1);
        }
        if (!fs.existsSync(resumePath)) {
            console.error(chalk_1.default.red(`Error: Resume file not found: ${resumePath}`));
            process.exit(1);
        }
        try {
            // Stage 1: Scrape
            console.log(chalk_1.default.bold("\nFetching job page..."));
            let rawText;
            try {
                rawText = await (0, scraper_1.scrapeJobPage)(jobUrl);
            }
            catch (err) {
                console.error(chalk_1.default.red(`Error fetching job page: ${err}`));
                process.exit(1);
            }
            if (!rawText.trim()) {
                console.error(chalk_1.default.red("Could not find requirement sections on this page. " +
                    "Try a different URL or paste the requirements text manually."));
                process.exit(1);
            }
            if (verbose) {
                console.log(chalk_1.default.dim(`\n--- Raw scraped text (${rawText.length} chars) ---`));
                console.log(chalk_1.default.dim(rawText.slice(0, 600) + (rawText.length > 600 ? "..." : "")));
                console.log(chalk_1.default.dim("---\n"));
            }
            // Stage 2: Extract requirements
            console.log(chalk_1.default.bold("Extracting requirements..."));
            let requirements;
            try {
                requirements = await (0, extractor_1.extractRequirements)(rawText);
            }
            catch (err) {
                console.error(chalk_1.default.red(`Error extracting requirements: ${err}`));
                process.exit(1);
            }
            console.log(chalk_1.default.dim(`Found ${requirements.length} requirements.`));
            if (verbose) {
                requirements.forEach((r, i) => console.log(chalk_1.default.dim(`  ${i + 1}. ${r}`)));
            }
            // Stage 3: Parse resume
            console.log(chalk_1.default.bold("Parsing resume..."));
            let resumeData;
            try {
                resumeData = await (0, parser_1.parseResume)(resumePath);
            }
            catch (err) {
                console.error(chalk_1.default.red(`Error parsing resume: ${err}`));
                process.exit(1);
            }
            if (verbose) {
                console.log(chalk_1.default.dim(`Resume: ${resumeData.sections.length} sections, ` +
                    `${resumeData.experience.length} work entries, ` +
                    `${resumeData.skills.length} skills`));
            }
            // Stage 4: Match
            console.log(chalk_1.default.bold(`Matching ${requirements.length} requirements against resume...`));
            const results = await (0, matcher_1.matchRequirements)(requirements, resumeData, (current, total) => {
                process.stdout.write(`\r  Matching requirement ${current}/${total}...`);
            });
            process.stdout.write("\n");
            // Stage 5: Report
            (0, reporter_1.generateReport)(jobUrl, requirements, results);
        }
        catch (err) {
            console.error(chalk_1.default.red(`\nUnexpected error: ${err}`));
            process.exit(1);
        }
    });
    program.parse(process.argv);
    if (process.argv.length < 3) {
        program.help();
    }
} // end CLI mode
//# sourceMappingURL=index.js.map