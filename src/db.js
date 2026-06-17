import { supabase } from "./supabase.js";

/* =========================================================================
   Data + auth layer. The UI never touches Supabase directly — it calls these.
   Auth is real Supabase Auth (email + password). RLS enforces that a user can
   only write their own predictions and that only organizers write results.
   ========================================================================= */

/* ----------------------------- auth ----------------------------- */
// Only this email domain may create accounts. The client check below is for
// instant UX feedback; the REAL enforcement is a database trigger (see
// restrict_signup_domain.sql) that rejects other domains even via direct API.
export const ALLOWED_DOMAIN = "mozilor.com";
export function isAllowedEmail(email) {
  return email.trim().toLowerCase().endsWith("@" + ALLOWED_DOMAIN);
}

// Sign up: creates the auth user, then a profile row with their display name.
// Returns { user } | { error }.
export async function signUp(email, password, name) {
  const display = name.trim();
  if (!display) return { error: "Enter a display name." };
  if (!isAllowedEmail(email)) return { error: `Sign-up is limited to @${ALLOWED_DOMAIN} email addresses.` };

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
    .select("match_id, home, away, adv");
  if (error) throw error;
  const out = {};
  for (const row of data || []) {
    out[row.match_id] = { h: row.home, a: row.away, ...(row.adv ? { adv: row.adv } : {}) };
  }
  return out;
}

// Organizer-only (enforced by RLS). `adv` ('home'|'away') is optional, used for
// knockout matches to record who advanced (e.g. on penalties).
export async function saveResult(matchId, home, away, adv) {
  const row = { match_id: matchId, home, away };
  if (adv === "home" || adv === "away") row.adv = adv;
  const { error } = await supabase
    .from("results")
    .upsert(row, { onConflict: "match_id" });
  if (error) throw error;
}

/* --------------------------- knockout fixtures --------------------------- */
// Dynamic KO fixtures created by the sync as teams become known. Group
// fixtures are hardcoded in the app; these are merged in at runtime.
export async function getFixtures() {
  const { data, error } = await supabase
    .from("fixtures")
    .select("id, kickoff, home, away, stage, city, country, accent");
  if (error) {
    // Table may not exist yet (before knockout_fixtures.sql is run) — degrade gracefully.
    console.warn("getFixtures: ", error.message);
    return [];
  }
  return data || [];
}

/* --------------------------- live scores --------------------------- */
// In-play scores written by the sync (display only — never affects points).
export async function getLiveScores() {
  const { data, error } = await supabase
    .from("live_scores")
    .select("match_id, home, away, minute, status");
  if (error) { console.warn("getLiveScores:", error.message); return {}; }
  const out = {};
  for (const r of data || []) out[r.match_id] = { h: r.home, a: r.away, minute: r.minute, status: r.status };
  return out;
}

/* --------------------------- prediction stats (how everyone predicted) --------------------------- */
// "How everyone predicted" a given match: distribution of scorelines + result
// split. Only meaningful to reveal once the match is locked (caller enforces).
export async function getPredictionStats(matchId) {
  const { data, error } = await supabase
    .from("predictions")
    .select("home, away")
    .eq("match_id", matchId);
  if (error) throw error;
  const rows = data || [];
  const total = rows.length;
  const scoreCounts = {};       // "2-1" -> n
  let homeWin = 0, draw = 0, awayWin = 0;
  for (const r of rows) {
    const key = `${r.home}-${r.away}`;
    scoreCounts[key] = (scoreCounts[key] || 0) + 1;
    if (r.home > r.away) homeWin++;
    else if (r.home < r.away) awayWin++;
    else draw++;
  }
  // top scorelines, most common first
  const topScores = Object.entries(scoreCounts)
    .map(([score, n]) => ({ score, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 4);
  return { total, homeWin, draw, awayWin, topScores };
}
