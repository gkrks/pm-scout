import * as fs from "fs";
import * as path from "path";
import { Company } from "./companies";

const DATA_PATH = path.resolve(__dirname, "../data/custom-companies.json");

export interface CustomCompany extends Company {
  addedAt: string;  // ISO timestamp
  addedBy?: string; // future multi-user support
}

function read(): CustomCompany[] {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    return JSON.parse(raw) as CustomCompany[];
  } catch {
    return [];
  }
}

function write(companies: CustomCompany[]): void {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(companies, null, 2), "utf8");
}

export function loadCustomCompanies(): CustomCompany[] {
  return read();
}

export function saveCustomCompany(company: Omit<CustomCompany, "addedAt">): CustomCompany {
  const existing = read();
  // Prevent duplicates by slug
  if (existing.some((c) => c.slug === company.slug)) {
    return existing.find((c) => c.slug === company.slug)!;
  }
  const record: CustomCompany = { ...company, addedAt: new Date().toISOString() };
  write([...existing, record]);
  return record;
}

export function removeCustomCompany(slug: string): boolean {
  const existing = read();
  const filtered = existing.filter((c) => c.slug !== slug);
  if (filtered.length === existing.length) return false;
  write(filtered);
  return true;
}

export function isCustomCompany(slug: string): boolean {
  return read().some((c) => c.slug === slug);
}
