/**
 * Applications Tracker — JSON API for tracking applied jobs.
 *
 * Routes:
 *   GET  /tracker                          — JSON list of all applications
 *   GET  /tracker/kanban                   — Kanban board data (listings + apps + scores)
 *   POST /tracker/api/applications         — Create a new application
 *   PATCH /tracker/api/applications/:id    — Update application fields
 */

import crypto from "crypto";
import { Request, Response } from "express";
import { getSupabaseClient } from "../storage/supabase";

const FIT_TOKEN_SECRET = process.env.FIT_TOKEN_SECRET || "";

function fitToken(jobId: string): string {
  if (!FIT_TOKEN_SECRET) return "";
  return crypto.createHmac("sha256", FIT_TOKEN_SECRET).update(jobId).digest("hex").slice(0, 32);
}

const TRACKER_STATUSES = ["applied", "phone_screen", "interviewing", "offer", "rejected"];
const ALL_STATUSES = ["not_started", "researching", ...TRACKER_STATUSES, "withdrawn"];

// ── GET /tracker — JSON response ────────────────────────────────────────────

export async function handleTrackerJson(req: Request, res: Response): Promise<void> {
  const dashToken = process.env.DASHBOARD_TOKEN || "";
  if (!dashToken) { res.status(500).json({ error: "DASHBOARD_TOKEN not configured" }); return; }
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
      res.status(500).json({ error: "Query failed: " + error.message });
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
      companySlug: (a.listing?.company as any)?.slug || "",
      location: a.listing?.location_city || a.listing?.location_raw || "",
    }));

    res.json({ applications });
  } catch (err: any) {
    console.error("[tracker] Error:", err.message);
    res.status(500).json({ error: "Tracker error: " + err.message });
  }
}

// ── GET /tracker/kanban — Full board data ────────────────────────────────────

export async function handleKanbanCards(req: Request, res: Response): Promise<void> {
  const dashToken = process.env.DASHBOARD_TOKEN || "";
  if (!dashToken) { res.status(500).json({ error: "DASHBOARD_TOKEN not configured" }); return; }
  const token = (req.query.token as string) || "";
  if (token !== dashToken) { res.status(401).json({ error: "Invalid token" }); return; }

  try {
    const supabase = getSupabaseClient();

    // 3 parallel queries: active listings, applications, fit scores
    const [listingsRes, appsRes, scoresRes] = await Promise.all([
      supabase
        .from("job_listings")
        .select(`
          id, title, role_url, location_city, location_raw,
          is_remote, is_hybrid, ats_platform, posted_date, first_seen_at, last_seen_at,
          is_active, tier, yoe_min, yoe_max, salary_min, salary_max,
          company:companies!inner(name, slug, has_apm_program)
        `)
        .eq("is_active", true)
        .order("first_seen_at", { ascending: false })
        .limit(500),
      supabase
        .from("applications")
        .select(`
          id, listing_id, status, applied_date, applied_by,
          referral_contact, notes, created_at, updated_at
        `),
      supabase
        .from("fit_score_cache")
        .select("listing_id, score_response"),
    ]);

    if (listingsRes.error) {
      res.status(500).json({ error: "Listings query failed: " + listingsRes.error.message });
      return;
    }

    const listings = listingsRes.data || [];
    const apps = appsRes.data || [];
    const scores = scoresRes.data || [];

    // Build lookup maps
    const appByListing = new Map<string, any>();
    for (const a of apps) appByListing.set(a.listing_id, a);

    const scoreByListing = new Map<string, number | null>();
    for (const s of scores) {
      const resp = s.score_response as any;
      const totalScore = resp?.final_selection?.total_score ?? null;
      const numQuals = (resp?.ranked_candidates?.length || 0) + (resp?.pre_resolved?.length || 0);
      // Normalize: total_score is sum of match scores (each 0-100ish).
      // Divide by qualification count to get average match quality (0-100).
      const normalized = totalScore !== null && numQuals > 0
        ? Math.round((totalScore / numQuals) * 10) / 10
        : totalScore;
      scoreByListing.set(s.listing_id, normalized);
    }

    // Also include inactive listings that have applications (so rejected/historical cards show)
    const activeListingIds = new Set(listings.map((l: any) => l.id));
    const missingAppListingIds = apps
      .filter((a: any) => !activeListingIds.has(a.listing_id))
      .map((a: any) => a.listing_id);

    let inactiveListings: any[] = [];
    if (missingAppListingIds.length > 0) {
      const { data: inactive } = await supabase
        .from("job_listings")
        .select(`
          id, title, role_url, location_city, location_raw,
          is_remote, is_hybrid, ats_platform, posted_date, first_seen_at, last_seen_at,
          is_active, tier, yoe_min, yoe_max, salary_min, salary_max,
          company:companies!inner(name, slug, has_apm_program)
        `)
        .in("id", missingAppListingIds);
      inactiveListings = inactive || [];
    }

    const allListings = [...listings, ...inactiveListings];

    // Build cards
    const cards = allListings.map((l: any) => {
      const app = appByListing.get(l.id);
      const fitScore = scoreByListing.get(l.id) ?? null;
      const hasFitCache = scoreByListing.has(l.id);

      let columnId: string;
      if (app && TRACKER_STATUSES.includes(app.status)) {
        columnId = app.status;
      } else if (hasFitCache) {
        columnId = "fit_reviewed";
      } else {
        columnId = "discovered";
      }

      return {
        id: l.id,
        listing: {
          id: l.id,
          title: l.title,
          companyName: (l.company as any)?.name || "Unknown",
          companySlug: (l.company as any)?.slug || "",
          locationCity: l.location_city,
          locationRaw: l.location_raw,
          isRemote: l.is_remote,
          isHybrid: l.is_hybrid,
          roleUrl: l.role_url,
          atsPlatform: l.ats_platform,
          postedDate: l.posted_date,
          firstSeenAt: l.first_seen_at,
          lastSeenAt: l.last_seen_at,
          isActive: l.is_active,
          tier: l.tier,
          yoeMin: l.yoe_min,
          yoeMax: l.yoe_max,
          salaryMin: l.salary_min,
          salaryMax: l.salary_max,
          hasApmProgram: (l.company as any)?.has_apm_program ?? false,
        },
        columnId,
        applicationId: app?.id ?? null,
        appliedDate: app?.applied_date ?? null,
        fitScore,
        hasFitCache,
        fitToken: fitToken(l.id),
      };
    });

    res.json({ cards });
  } catch (err: any) {
    console.error("[tracker/kanban] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── POST /tracker/api/applications — Create application ──────────────────────

export async function handleCreateApplication(req: Request, res: Response): Promise<void> {
  const dashToken = process.env.DASHBOARD_TOKEN || "";
  const token = (req.query.token as string) || (req.headers["x-tracker-token"] as string) || "";
  if (!dashToken || token !== dashToken) { res.status(401).json({ error: "Invalid token" }); return; }

  const { listing_id, status } = req.body;
  if (!listing_id || typeof listing_id !== "string") {
    res.status(400).json({ error: "listing_id is required" });
    return;
  }
  if (!status || !ALL_STATUSES.includes(status)) {
    res.status(400).json({ error: `Invalid status. Must be one of: ${ALL_STATUSES.join(", ")}` });
    return;
  }

  try {
    const supabase = getSupabaseClient();

    const appliedDate = TRACKER_STATUSES.includes(status)
      ? new Date().toISOString().split("T")[0]
      : null;

    const { data, error } = await supabase
      .from("applications")
      .upsert({
        listing_id,
        status,
        applied_date: appliedDate,
      }, { onConflict: "listing_id" })
      .select("id, listing_id, status, applied_date")
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ ok: true, application: data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// ── PATCH /tracker/api/applications/:id — Update fields ──────────────────────

export async function handleTrackerUpdate(req: Request, res: Response): Promise<void> {
  const dashToken = process.env.DASHBOARD_TOKEN || "";
  const token = (req.query.token as string) || (req.headers["x-tracker-token"] as string) || "";
  if (!dashToken || token !== dashToken) { res.status(401).json({ error: "Invalid token" }); return; }

  const appId = req.params.id;
  const updates: Record<string, any> = {};

  if (req.body.status && ALL_STATUSES.includes(req.body.status)) {
    updates.status = req.body.status;
    // Set applied_date when first moving to an applied status
    if (TRACKER_STATUSES.includes(req.body.status) && !req.body.applied_date) {
      updates.applied_date = new Date().toISOString().split("T")[0];
    }
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
