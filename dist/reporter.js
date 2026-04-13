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
exports.generateReport = generateReport;
const fs = __importStar(require("fs"));
const chalk_1 = __importDefault(require("chalk"));
const REPORT_FILE = "match-report.json";
function separator() {
    return "═".repeat(55);
}
function computeScore(results) {
    if (results.length === 0)
        return 0;
    const numerator = results.reduce((sum, r) => {
        if (r.status === "met")
            return sum + 1.0;
        if (r.status === "partial")
            return sum + 0.5;
        return sum;
    }, 0);
    return Math.round((numerator / results.length) * 100);
}
/**
 * Print a match report to stdout and write match-report.json.
 */
function generateReport(jobUrl, requirements, results) {
    const now = new Date();
    const datetime = now.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
    const metCount = results.filter((r) => r.status === "met").length;
    const partialCount = results.filter((r) => r.status === "partial").length;
    const missingCount = results.filter((r) => r.status === "missing").length;
    const score = computeScore(results);
    // ── Header ────────────────────────────────────────────────────────────────────
    console.log("\n" + chalk_1.default.bold(separator()));
    console.log(chalk_1.default.bold("RESUME MATCH REPORT"));
    console.log(`Job: ${chalk_1.default.cyan(jobUrl)}`);
    console.log(`Generated: ${datetime}`);
    console.log(chalk_1.default.bold(separator()));
    // ── Summary ───────────────────────────────────────────────────────────────────
    console.log(chalk_1.default.green(`✅ Met: ${metCount}`) +
        "  " +
        chalk_1.default.yellow(`⚠️  Partial: ${partialCount}`) +
        "  " +
        chalk_1.default.red(`❌ Missing: ${missingCount}`) +
        "  |  " +
        chalk_1.default.bold(`Match score: ${score}%`));
    console.log();
    // ── Per-requirement rows ──────────────────────────────────────────────────────
    for (const r of results) {
        switch (r.status) {
            case "met":
                console.log(chalk_1.default.green(`✅ ${r.requirement}`));
                if (r.proof) {
                    console.log(chalk_1.default.green(`   Proof: "${r.proof}"`));
                }
                if (r.location) {
                    console.log(chalk_1.default.green(`   Location: ${r.location}`));
                }
                break;
            case "partial":
                console.log(chalk_1.default.yellow(`⚠️  ${r.requirement}`));
                if (r.proof) {
                    console.log(chalk_1.default.yellow(`   Proof: "${r.proof}" — partial match`));
                }
                if (r.location) {
                    console.log(chalk_1.default.yellow(`   Location: ${r.location}`));
                }
                break;
            case "missing":
                console.log(chalk_1.default.red(`❌ ${r.requirement}`));
                console.log(chalk_1.default.red(`   Not found in resume.`));
                break;
        }
        console.log();
    }
    console.log(chalk_1.default.bold(separator()) + "\n");
    // ── JSON report file ──────────────────────────────────────────────────────────
    const report = {
        jobUrl,
        generatedAt: now.toISOString(),
        summary: { met: metCount, partial: partialCount, missing: missingCount, score },
        matches: results,
    };
    try {
        fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), "utf-8");
        console.log(chalk_1.default.dim(`Report saved to ${REPORT_FILE}`));
    }
    catch (err) {
        console.error(chalk_1.default.red(`Warning: could not write ${REPORT_FILE}: ${err}`));
    }
}
//# sourceMappingURL=reporter.js.map