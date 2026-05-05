import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase client using the service-role key.
 * Must be called after dotenv is loaded.
 */
export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("SUPABASE_URL is not set");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  _client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return _client;
}

// --------------------------------------------------------------------------- //
//  Master resume loader (Supabase, cached in-memory)
// --------------------------------------------------------------------------- //

let _resumeCache: Record<string, any> | null = null;

/**
 * Load master resume from Supabase `master_resume` table.
 * Cached in-memory after first successful load.
 */
export async function loadMasterResume(): Promise<Record<string, any>> {
  if (_resumeCache) return _resumeCache;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("master_resume")
    .select("contact, experiences, projects, education, skills")
    .eq("id", "default")
    .single();

  if (error || !data) {
    throw new Error(`Failed to load master resume from Supabase: ${error?.message || "no data"}`);
  }

  _resumeCache = {
    contact: data.contact,
    experiences: data.experiences,
    projects: data.projects,
    education: data.education,
    skills: data.skills,
  };

  return _resumeCache;
}
