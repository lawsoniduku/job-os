/**
 * lib/supabaseClient.js
 * =====================
 * Frontend Supabase client. Uses the ANON key — same key the backend uses
 * (it's designed to be public; Row Level Security in the database is what
 * keeps users' data private, not secrecy of this key).
 *
 * Set these in job-os-ui/.env (see .env.example):
 *   VITE_SUPABASE_URL=https://your-project.supabase.co
 *   VITE_SUPABASE_ANON_KEY=your-anon-key   (same value as backend SUPABASE_KEY)
 */
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// If env vars are missing, export null and let useSession() degrade
// gracefully (app still works fully signed-out / without accounts).
export const supabase = (url && anonKey) ? createClient(url, anonKey) : null;

export const authEnabled = !!supabase;
