#!/usr/bin/env ts-node
/**
 * scripts/replayPendingBuffer.ts
 *
 * Manually replay any Supabase writes that were buffered to
 * data/pending-supabase.json during a scan where Supabase was unreachable.
 *
 * Usage:
 *   npm run replay:pending
 *   npx ts-node scripts/replayPendingBuffer.ts
 *
 * This is a one-shot helper — the scheduler also calls replayPendingBuffer()
 * automatically at the start of every scan. Run this script manually only
 * when you want to replay immediately without waiting for the next scan.
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { replayPendingBuffer } from "../src/storage/pendingBuffer";

const BUFFER_PATH = path.resolve("data", "pending-supabase.json");

async function main(): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "[replay] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n" +
      "Add them to your .env file or export them in your shell.",
    );
    process.exit(1);
  }

  if (!fs.existsSync(BUFFER_PATH)) {
    console.log("[replay] No pending buffer found — nothing to replay.");
    process.exit(0);
  }

  let count: number;
  try {
    const raw = JSON.parse(fs.readFileSync(BUFFER_PATH, "utf8"));
    count = Array.isArray(raw) ? raw.length : 0;
  } catch {
    console.error(`[replay] Could not parse ${BUFFER_PATH} — file may be corrupted.`);
    process.exit(1);
  }

  console.log(`[replay] Found ${count} buffered run(s) in ${BUFFER_PATH}`);

  await replayPendingBuffer();

  // Report final state
  if (fs.existsSync(BUFFER_PATH)) {
    const remaining = JSON.parse(fs.readFileSync(BUFFER_PATH, "utf8"));
    if (remaining.length > 0) {
      console.warn(`[replay] ${remaining.length} run(s) still pending — Supabase may still be unreachable.`);
      process.exit(1);
    }
  }

  console.log("[replay] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(`[replay] Fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
