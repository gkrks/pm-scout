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
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCustomCompanies = loadCustomCompanies;
exports.saveCustomCompany = saveCustomCompany;
exports.removeCustomCompany = removeCustomCompany;
exports.isCustomCompany = isCustomCompany;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const DATA_PATH = path.resolve(__dirname, "../data/custom-companies.json");
function read() {
    try {
        const raw = fs.readFileSync(DATA_PATH, "utf8");
        return JSON.parse(raw);
    }
    catch {
        return [];
    }
}
function write(companies) {
    fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
    fs.writeFileSync(DATA_PATH, JSON.stringify(companies, null, 2), "utf8");
}
function loadCustomCompanies() {
    return read();
}
function saveCustomCompany(company) {
    const existing = read();
    // Prevent duplicates by slug
    if (existing.some((c) => c.slug === company.slug)) {
        return existing.find((c) => c.slug === company.slug);
    }
    const record = { ...company, addedAt: new Date().toISOString() };
    write([...existing, record]);
    return record;
}
function removeCustomCompany(slug) {
    const existing = read();
    const filtered = existing.filter((c) => c.slug !== slug);
    if (filtered.length === existing.length)
        return false;
    write(filtered);
    return true;
}
function isCustomCompany(slug) {
    return read().some((c) => c.slug === slug);
}
//# sourceMappingURL=customCompanies.js.map