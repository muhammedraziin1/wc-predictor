import { supabase } from "./supabase.js";

/* =========================================================================
   Data + auth layer. The UI never touches Supabase directly — it calls these.
   Auth is real Supabase Auth (email + password). RLS enforces that a user can
   only write their own predictions and that only organizers write results.
   ========================================================================= */

/* ----------------------------- auth ----------------------------- */
// Sign up: creates the auth user, then a profile row with their display name.
// Returns { user } | { error }.
export async function signUp(email, password, name) {
  const display = name.trim();
  if (!display) return { error: "Enter a display name." };

  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
  if (error) return { error: error.message };

  const user = data.user;
  if (!user) {
    // Email-confirmation flow is ON: no session yet. Tell the user to confirm.
    return { needsConfirm: true };
  }
  // Create the profile (RLS lets a user insert only their own id).
  const { error: pErr } = await supabase
    .from("profiles")
    .insert({ id: user.id, name: display });
  if (pErr) {
    if (pErr.code === "23505") return { error: "That display name is taken." };
    return { error: pErr.message };
  }
  return { user };
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) return { error: error.message };
  return { user: data.user };
}

export async function signOut() {
  await supabase.auth.signOut();
}

// Send a password-reset email. Supabase emails a link; clicking it returns the
// user to the app in a recovery session where they can set a new password.
export async function requestPasswordReset(email) {
  const e = email.trim();
  if (!e) return { error: "Enter your email first." };
  const { error } = await supabase.auth.resetPasswordForEmail(e, {
    redirectTo: window.location.origin,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

// In a recovery session (after clicking the email link), set the new password.
export async function updatePassword(newPassword) {
  if (!newPassword || newPassword.length < 6) return { error: "Password must be at least 6 characters." };
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { error: error.message };
  return { ok: true };
}

// Current session's user + their profile, or null.
export async function getMe() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", session.user.id)
    .single();
  return { id: session.user.id, name: profile?.name || session.user.email, email: session.user.email };
}

// If a user authenticated but has no profile yet (e.g. confirmed via email
// link), create it. Returns { ok } | { error }.
export async function ensureProfile(name) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: session.user.id, name: name.trim() }, { onConflict: "id" });
  if (error) {
    if (error.code === "23505") return { error: "That display name is taken." };
    return { error: error.message };
  }
  return { ok: true };
}

// Listen for auth changes (login/logout across tabs). Callback gets (session, event).
// Returns an unsubscribe fn.
export function onAuthChange(cb) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => cb(session, event));
  return () => data.subscription.unsubscribe();
}

// Is the current user an organizer?
export async function amIOrganizer() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return false;
  const { data } = await supabase
    .from("organizers")
    .select("user_id")
    .eq("user_id", session.user.id)
    .maybeSingle();
  return Boolean(data);
}

/* --------------------------- roster --------------------------- */
// All players (profiles) for the leaderboard. -> [{ id, name }]
export async function getPlayers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

/* --------------------------- predictions --------------------------- */
export async function getPredictions() {
  const { data, error } = await supabase
    .from("predictions")
    .select("user_id, match_id, home, away");
  if (error) throw error;
  const out = {};
  for (const row of data || []) {
    (out[row.user_id] ||= {})[row.match_id] = { h: row.home, a: row.away };
  }
  return out;
}

// Upsert the logged-in user's prediction. RLS guarantees user_id = auth.uid().
export async function savePrediction(userId, matchId, home, away) {
  const { error } = await supabase
    .from("predictions")
    .upsert(
      { user_id: userId, match_id: matchId, home, away },
      { onConflict: "user_id,match_id" }
    );
  if (error) throw error;
}

/* ----------------------------- results ----------------------------- */
export async function getResults() {
  const { data, error } = await supabase
    .from("results")
    .select("match_id, home, away");
  if (error) throw error;
  const out = {};
  for (const row of data || []) out[row.match_id] = { h: row.home, a: row.away };
  return out;
}

// Organizer-only (enforced by RLS). Throws if a non-organizer tries.
export async function saveResult(matchId, home, away) {
  const { error } = await supabase
    .from("results")
    .upsert({ match_id: matchId, home, away }, { onConflict: "match_id" });
  if (error) throw error;
}
