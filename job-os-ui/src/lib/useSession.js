/**
 * lib/useSession.js
 * =================
 * Tracks the current Supabase auth session + the user's profile row.
 *
 * SELECTS * ON PURPOSE. This used to name its columns explicitly, and the
 * list silently fell behind every migration that added one: 012 added the
 * cv_* columns and the consent flag, 013 added availability and
 * profile_completed_at, and none of them were ever read back. The writes
 * landed in Postgres and the UI saw undefined, so the CV review card never
 * appeared, the consent toggle always read "off", and the strength meter
 * scored filled-in fields as missing — all of it looking exactly like
 * "nothing is being saved".
 *
 * An explicit list is a footgun here because profiles gains columns most
 * migrations. It is one row behind RLS; * costs a couple of KB and cannot
 * drift. Do not "optimise" this back into a column list.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase, authEnabled } from "./supabaseClient";

export function useSession() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(authEnabled);

  const loadProfile = useCallback(async (userId) => {
    if (!supabase || !userId) { setProfile(null); return; }
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      if (import.meta.env.DEV) console.warn("loadProfile:", error.message);
      return;
    }
    if (data) setProfile(data);
  }, []);

  useEffect(() => {
    if (!authEnabled) { setLoading(false); return; }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) loadProfile(data.session.user.id);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) loadProfile(newSession.user.id);
      else setProfile(null);
    });

    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const refreshProfile = useCallback(() => {
    if (session?.user) loadProfile(session.user.id);
  }, [session, loadProfile]);

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
  }

  return {
    session,
    user: session?.user || null,
    profile,
    loading,
    authEnabled,
    refreshProfile,
    signOut,
  };
}
