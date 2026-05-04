#!/usr/bin/env ts-node
/**
 * scripts/seedQualMapToSupabase.ts
 *
 * One-time seed: reads qualification_map.json and populates Supabase tables
 * (qualification_map_meta + qualification_map_quals).
 *
 * Usage: npx ts-node scripts/seedQualMapToSupabase.ts
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { getSupabaseClient } from "../src/storage/supabase";

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function main() {
  const mapPath = path.resolve(__dirname, "../ats_bullet_selector/outputs/qualification_map.json");
  if (!fs.existsSync(mapPath)) {
    console.error(`[seed] qualification_map.json not found at ${mapPath}`);
    process.exit(1);
  }

  console.log("[seed] Loading qualification_map.json...");
  const map = JSON.parse(fs.readFileSync(mapPath, "utf-8"));

  const supabase = getSupabaseClient();

  // ── 1. Upsert meta row ────────────────────────────────────────────────────
  const metaRow = {
    version: map.v ?? 3,
    embedding_model: map.embedding_model ?? "text-embedding-3-large",
    embedding_dim: map.embedding_dim ?? 3072,
    bullets: map.bullets ?? {},
    groups: map.groups ?? {},
    resume: map.resume ?? {},
    stats_quals: Object.keys(map.quals ?? {}).length,
    stats_bullets: Object.keys(map.bullets ?? {}).length,
    stats_groups: Object.keys(map.groups ?? {}).length,
  };

  // Delete existing meta rows and insert fresh
  await supabase.from("qualification_map_meta").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  const { error: metaErr } = await supabase.from("qualification_map_meta").insert(metaRow);
  if (metaErr) {
    console.error("[seed] Meta insert failed:", metaErr.message);
    process.exit(1);
  }
  console.log("[seed] Meta row inserted.");

  // ── 2. Upsert qual rows ───────────────────────────────────────────────────
  const quals = map.quals ?? {};
  const rows = Object.entries(quals).map(([hash, entry]: [string, any]) => ({
    qual_hash: hash,
    qual_text: entry.t ?? "",
    qual_type: entry.type ?? "bullet_match",
    group_name: entry.group ?? "other",
    freq: entry.freq ?? 1,
    bullet_ids: entry.bullets ?? [],
    similarities: entry.sim ?? [],
  }));

  console.log(`[seed] Upserting ${rows.length} qualification rows...`);

  const batches = chunkArray(rows, 50);
  let upserted = 0;
  let failed = 0;

  for (let i = 0; i < batches.length; i++) {
    const { error } = await supabase
      .from("qualification_map_quals")
      .upsert(batches[i], { onConflict: "qual_hash" });

    if (error) {
      console.error(`[seed] Batch ${i + 1}/${batches.length} failed: ${error.message}`);
      failed++;
    } else {
      upserted += batches[i].length;
      process.stdout.write(`\r[seed] Progress: ${upserted}/${rows.length}`);
    }
  }

  process.stdout.write("\n");
  console.log(`[seed] Done — upserted: ${upserted}, failed batches: ${failed}`);
}

main().catch((e) => {
  console.error("[seed] Fatal:", e.message);
  process.exit(1);
});
