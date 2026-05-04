#!/usr/bin/env ts-node
/**
 * scripts/syncCompanies.ts
 *
 * Syncs config/targets.json into the Supabase `public.companies` table.
 *
 * Run on initial setup and whenever targets.json changes.
 * Also runs automatically at the start of each hourly scan (see scheduler.ts).
 *
 * Usage:
 *   npm run sync:companies
 *   npx ts-node scripts/syncCompanies.ts
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { getSupabaseClient } from "../src/storage/supabase";

// ── Zod schema ────────────────────────────────────────────────────────────────
// Mirrors the fields defined in config/targets.json → company_field_descriptions
// and the Supabase `public.companies` table.

const APM_STATUSES = ["active", "paused", "intermittent", "discontinued"] as const;

const CompanyEntrySchema = z.object({
  uuid:               z.string().uuid(),
  slug:               z.string().min(1),
  name:               z.string().min(1),
  category:           z.string().min(1),
  careers_url:        z.string().min(1),
  program_url:        z.string().nullable().optional(),
  has_apm_program:    z.boolean(),
  apm_program_name:   z.string().nullable().optional(),
  apm_program_status: z.enum(APM_STATUSES).nullable().optional(),
  domain_tags:        z.array(z.string()).default([]),
  target_roles:       z.array(z.string()).default([]),
  notes:              z.string().nullable().optional(),
  index:              z.number().optional(),
  content_hash:       z.string().min(1),
});

const ConfigSchema = z.object({
  metadata: z.object({
    version:        z.string().optional(),
    schema_version: z.string().optional(),
    total_companies: z.number().optional(),
    deterministic_uuid_namespace: z.string().optional(),
  }).passthrough(),
  companies: z.array(CompanyEntrySchema),
}).passthrough();

type CompanyEntry = z.infer<typeof CompanyEntrySchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function toRow(c: CompanyEntry) {
  return {
    id:                 c.uuid,
    slug:               c.slug,
    name:               c.name,
    category:           c.category,
    careers_url:        c.careers_url,
    program_url:        c.program_url ?? null,
    has_apm_program:    c.has_apm_program,
    apm_program_name:   c.apm_program_name ?? null,
    apm_program_status: c.apm_program_status ?? null,
    domain_tags:        c.domain_tags,
    target_roles:       c.target_roles,
    notes:              c.notes ?? null,
    content_hash:       c.content_hash,
  };
}

// ── Load + validate ───────────────────────────────────────────────────────────

function loadConfig() {
  const configPath = path.join(process.cwd(), "config", "targets.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    throw new Error(`Failed to parse JSON at ${configPath}`);
  }

  const result = ConfigSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 15)
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `[syncCompanies] Config validation failed:\n${issues}\n\n` +
      `Ensure all company entries have uuid, slug, name, category, careers_url, ` +
      `has_apm_program, domain_tags, target_roles, and content_hash.`,
    );
  }

  return result.data;
}

// ── Drift detection ───────────────────────────────────────────────────────────

async function detectDrift(
  companies: CompanyEntry[],
): Promise<{ slug: string; oldHash: string; newHash: string }[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("companies")
    .select("slug, content_hash");

  if (error) {
    console.warn(
      `[syncCompanies] Could not fetch existing rows for drift detection: ${error.message}`,
    );
    return [];
  }

  const stored = new Map<string, string>(
    (data ?? []).map((r: { slug: string; content_hash: string }) => [r.slug, r.content_hash]),
  );

  const drifted: { slug: string; oldHash: string; newHash: string }[] = [];
  for (const c of companies) {
    const oldHash = stored.get(c.slug);
    if (oldHash && oldHash !== c.content_hash) {
      drifted.push({ slug: c.slug, oldHash, newHash: c.content_hash });
    }
  }

  return drifted;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[syncCompanies] Loading config/targets.json...");
  const config = loadConfig();
  const companies = config.companies;
  const version = config.metadata.schema_version ?? config.metadata.version ?? "unknown";

  console.log(
    `[syncCompanies] ${companies.length} companies loaded (schema version ${version})`,
  );

  // Drift detection
  console.log("[syncCompanies] Checking for content_hash drift...");
  const drifted = await detectDrift(companies);

  if (drifted.length > 0) {
    console.log(`[syncCompanies] ⚠  ${drifted.length} companies have changed content_hash:`);
    for (const d of drifted) {
      console.log(`    ${d.slug}: ${d.oldHash} → ${d.newHash}`);
    }
  } else {
    console.log("[syncCompanies] No content_hash drift detected.");
  }

  // Batch upsert
  const rows = companies.map(toRow);
  const batches = chunkArray(rows, 50);
  const supabase = getSupabaseClient();

  let upserted = 0;
  let failedBatches = 0;

  console.log(
    `[syncCompanies] Upserting ${rows.length} companies in ${batches.length} batches of 50...`,
  );

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    const { error } = await supabase
      .from("companies")
      .upsert(batch, { onConflict: "id" });

    if (error) {
      console.error(
        `[syncCompanies] Batch ${i + 1}/${batches.length} FAILED: ${error.message}`,
      );
      failedBatches++;
    } else {
      upserted += batch.length;
      process.stdout.write(
        `\r[syncCompanies] Progress: ${upserted}/${rows.length}`,
      );
    }
  }

  process.stdout.write("\n");

  if (drifted.length > 0) {
    const slugList = drifted.map((d) => d.slug).join(", ");
    console.log(
      `[syncCompanies] Drift note (for parser_runs.notes): config changed for: ${slugList}`,
    );
  }

  const status = failedBatches > 0 ? "partial" : "ok";
  console.log(
    `[syncCompanies] Done — status: ${status}, ` +
    `upserted: ${upserted}/${rows.length}, ` +
    `failed batches: ${failedBatches}, ` +
    `drifted: ${drifted.length}`,
  );

  if (failedBatches > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(
    `[syncCompanies] Fatal: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
