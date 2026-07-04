/**
 * lib/useSession.js
 * =================
 * Tracks the current Supabase auth session + the user's profile row.
 * Now loads the full talent-graph profile (migration 006): target_roles,
 * preferences (seniority etc.), headline — these power the Briefing feed
 * and the You page.
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
      .select("id, email, full_name, country, headline, years_experience, skills, target_roles, target_salary_min, preferences")
      .eq("id", userId)
      .maybeSingle();
    if (!error && data) setProfile(data);
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
