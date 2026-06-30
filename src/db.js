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
// Create the profile row if it doesn't exist yet. NEVER overwrites an existing
// name — ignoreDuplicates means a conflict on id leaves the current row intact.
export async function ensureProfile(name) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: session.user.id, name: name.trim() }, { onConflict: "id", ignoreDuplicates: true });
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

// Change the current user's display name. Updates ONLY their own row (RLS
// enforces this server-side), trims input, caps length, enforces uniqueness.
// Returns { name } on success or { error }.
export async function renameProfile(newName) {
  const name = (newName || "").trim();
  if (!name) return { error: "Enter a display name." };
  if (name.length > 24) return { error: "Display name must be 24 characters or fewer." };

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return { error: "Not signed in." };

  const { data, error } = await supabase
    .from("profiles")
    .update({ name })
    .eq("id", session.user.id)   // own row only
    .select("name")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return { error: "That display name is taken." };
    return { error: error.message };
  }
  if (!data) return { error: "Couldn't update your name. Please try again." };
  return { name: data.name };
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

// Organizer-only: name + email + pick count for every player. Returns [] for
// non-organizers (the RPC enforces this server-side; see admin_players.sql).
export async function getAdminPlayers() {
  const { data, error } = await supabase.rpc("admin_players");
  if (error) throw error;
  return (data || []).map((r) => ({ id: r.user_id, name: r.name, email: r.email, picks: r.picks }));
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
// A user can only read their OWN predictions (enforced by RLS). This returns
// just the caller's picks, keyed the same way the app expects.
export async function getPredictions() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return {};
  const { data, error } = await supabase
    .from("predictions")
    .select("user_id, match_id, home, away, adv_pick")
    .eq("user_id", session.user.id);
  if (error) throw error;
  const out = {};
  for (const row of data || []) {
    (out[row.user_id] ||= {})[row.match_id] = { h: row.home, a: row.away, adv: row.adv_pick ?? null };
  }
  return out;
}

// Server-computed leaderboard (totals only, never raw picks). See
// secure_predictions.sql — this is what keeps other players' predictions private.
export async function getLeaderboard() {
  const { data, error } = await supabase.rpc("leaderboard");
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.user_id, name: r.name, email: r.email, total: r.total, exact: r.exact, made: r.made,
  }));
}

// Upsert the logged-in user's prediction. RLS guarantees user_id = auth.uid().
export async function savePrediction(userId, matchId, home, away, advPick = null) {
  const { error } = await supabase
    .from("predictions")
    .upsert(
      { user_id: userId, match_id: matchId, home, away, adv_pick: advPick },
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

/* --------------------------- prediction stats (how everyone predicted) --------------------------- */
// AGGREGATE-ONLY, server-side. The RPC returns nothing until the match's 9 PM
// IST lock has passed, and never exposes individual picks. See secure_predictions.sql.
export async function getPredictionStats(matchId) {
  const { data, error } = await supabase.rpc("prediction_stats", { p_match_id: matchId });
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) return { total: 0, homeWin: 0, draw: 0, awayWin: 0, topScores: [] };
  const total = rows[0].total;
  let homeWin = 0, draw = 0, awayWin = 0;
  const topScores = [];
  for (const r of rows) {
    homeWin += r.home_win; draw += r.draw; awayWin += r.away_win;
    topScores.push({ score: r.scoreline, n: r.n });
  }
  return { total, homeWin, draw, awayWin, topScores: topScores.slice(0, 4) };
}

// Golden Boot top scorers. Written by the sync edge function (service role),
// readable by everyone via the scorers_read policy.
export async function getScorers() {
  const { data, error } = await supabase
    .from("scorers")
    .select("player_id, player, team, goals");
  if (error) { console.warn("getScorers: ", error.message); return []; }
  return data || [];
}
