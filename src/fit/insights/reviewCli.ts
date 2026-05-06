/**
 * Interactive CLI for reviewing extracted insights.
 * Keys: a=accept, r=reject, e=edit ($EDITOR), s=skip
 * On accept: embed via Voyage and write to Supabase.
 */

import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { VoyageAIClient } from "voyageai";
import { getSupabaseClient } from "../../storage/supabase";
import type { ExtractedInsight } from "./extractor";

const VOYAGE_MODEL = process.env.VOYAGE_EMBED_MODEL || "voyage-3-large";
const VOYAGE_DIM = 1024;

export interface DraftInsight extends ExtractedInsight {
  project_id: string;
  source_url: string;
}

export async function reviewInsights(drafts: DraftInsight[]): Promise<{
  accepted: number;
  rejected: number;
  skipped: number;
}> {
  const voyageKey = process.env.VOYAGE_API_KEY;
  if (!voyageKey) throw new Error("VOYAGE_API_KEY not set");
  const voyage = new VoyageAIClient({ apiKey: voyageKey });
  const supabase = getSupabaseClient();

  let accepted = 0;
  let rejected = 0;
  let skipped = 0;

  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    console.log(`\n--- Insight ${i + 1}/${drafts.length} ---`);
    console.log(`Project:  ${d.project_id}`);
    console.log(`Type:     ${d.type}`);
    console.log(`Source:   ${d.source_url}`);
    console.log(`\n  "${d.text}"\n`);
    console.log("[a]ccept  [r]eject  [e]dit  [s]kip");

    const key = await waitForKey();

    if (key === "a") {
      // Embed and save
      const embResult = await voyage.embed({
        input: [d.text],
        model: VOYAGE_MODEL,
        outputDimension: VOYAGE_DIM,
        inputType: "document",
      });
      const embedding = embResult.data?.[0]?.embedding;
      if (!embedding) {
        console.log("  Embedding failed — skipping");
        skipped++;
        continue;
      }

      const { error } = await supabase.from("master_insights").insert({
        project_id: d.project_id,
        insight_type: d.type,
        text: d.text,
        source_url: d.source_url,
        embedding: JSON.stringify(embedding),
        accepted_at: new Date().toISOString(),
      });

      if (error) {
        console.log(`  Supabase error: ${error.message}`);
        skipped++;
      } else {
        console.log("  Accepted and saved.");
        accepted++;
      }
    } else if (key === "e") {
      const edited = openInEditor(d.text);
      if (edited && edited.trim().length > 0) {
        d.text = edited.trim();
        console.log(`  Edited to: "${d.text}"`);
        // Re-queue this insight for accept/reject
        i--;
        continue;
      } else {
        console.log("  Edit cancelled — skipping");
        skipped++;
      }
    } else if (key === "r") {
      console.log("  Rejected.");
      rejected++;
    } else {
      console.log("  Skipped.");
      skipped++;
    }
  }

  return { accepted, rejected, skipped };
}

function waitForKey(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.once("data", (data: string) => {
      stdin.setRawMode(false);
      stdin.pause();
      const key = data.toLowerCase().trim();
      resolve(key);
    });
  });
}

function openInEditor(text: string): string | null {
  const editor = process.env.EDITOR || "vim";
  const tmpFile = path.join(os.tmpdir(), `insight_edit_${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, text);
  try {
    execSync(`${editor} "${tmpFile}"`, { stdio: "inherit" });
    const result = fs.readFileSync(tmpFile, "utf8");
    return result;
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}
