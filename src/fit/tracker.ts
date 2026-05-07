/**
 * Applications Tracker — Full CRUD page for tracking applied jobs.
 *
 * Routes:
 *   GET  /tracker                          — Render tracker page
 *   GET  /tracker/api/applications         — JSON list of all applications
 *   PATCH /tracker/api/applications/:id    — Update application fields
 */

import { Request, Response } from "express";
import { getSupabaseClient } from "../storage/supabase";
import { renderTrackerPage } from "./trackerRender";

const TRACKER_STATUSES = ["applied", "phone_screen", "interviewing", "offer", "rejected"];

// ── GET /tracker — Render page ───────────────────────────────────────────────

export async function handleTracker(req: Request, res: Response): Promise<void> {
  const dashToken = process.env.DASHBOARD_TOKEN || "";
  if (!dashToken) { res.status(500).send("DASHBOARD_TOKEN not configured"); return; }
  const token = (req.query.token as string) || "";
  if (token !== dashToken) { res.status(401).json({ error: "Invalid token" }); return; }

  try {
    const supabase = getSupabaseClient();

    const { data: apps, error } = await supabase
      .from("applications")
      .select(`
        id, listing_id, status, applied_date, applied_by,
        referral_contact, notes, created_at, updated_at,
        listing:job_listings!inner(
          id, title, role_url, location_city, location_raw,
          company:companies!inner(name, slug)
        )
      `)
      .order("applied_date", { ascending: false });

    if (error) {
      console.error("[tracker] Query error:", error.message);
      res.status(500).send("Query failed: " + error.message);
      return;
    }

    const applications = (apps || []).map((a: any) => ({
      id: a.id,
      listingId: a.listing_id,
      status: a.status,
      appliedDate: a.applied_date || "",
      email: a.applied_by || "",
      referralContact: a.referral_contact || "",
      notes: a.notes || "",
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      title: a.listing?.title || "Unknown",
      roleUrl: a.listing?.role_url || "",
      company: (a.listing?.company as any)?.name || "Unknown",
      location: a.listing?.location_city || a.listing?.location_raw || "",
    }));

    const html = renderTrackerPage(applications, token);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err: any) {
    console.error("[tracker] Error:", err.message);
    res.status(500).send("Tracker error: " + err.message);
  }
}

// ── PATCH /tracker/api/applications/:id — Update fields ──────────────────────

export async function handleTrackerUpdate(req: Request, res: Response): Promise<void> {
  const dashToken = process.env.DASHBOARD_TOKEN || "";
  const token = (req.query.token as string) || (req.headers["x-tracker-token"] as string) || "";
  if (!dashToken || token !== dashToken) { res.status(401).json({ error: "Invalid token" }); return; }

  const appId = req.params.id;
  const updates: Record<string, any> = {};

  if (req.body.status && TRACKER_STATUSES.includes(req.body.status)) {
    updates.status = req.body.status;
  }
  if (typeof req.body.referral_contact === "string") {
    updates.referral_contact = req.body.referral_contact;
  }
  if (typeof req.body.notes === "string") {
    updates.notes = req.body.notes;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("applications")
      .update(updates)
      .eq("id", appId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ ok: true, updated: updates });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
