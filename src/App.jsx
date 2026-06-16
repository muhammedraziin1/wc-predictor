import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  NOW, factOf, flag, FIXTURES,
  SEEDED_RESULTS, scoreMatch, fmtKick, dayKey, countdown,
} from "./data.js";
import {
  signUp, signIn, signOut as dbSignOut, getMe, ensureProfile, onAuthChange,
  amIOrganizer, getPlayers, getPredictions, savePrediction, getResults, saveResult,
  requestPasswordReset, updatePassword,
} from "./db.js";
import { supabaseConfigured } from "./supabase.js";

/* ====================================================================== */
export default function App() {
  const [me, setMe] = useState(null);              // {id,name,email}
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [players, setPlayers] = useState([]);      // [{id,name}]
  const [predictions, setPredictions] = useState({}); // {uid:{mid:{h,a}}}
  const [results, setResults] = useState({});      // {mid:{h,a}}
  const [view, setView] = useState("matches");
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState("");
  const [adminMode, setAdminMode] = useState(false);
  const [recovery, setRecovery] = useState(false); // true after clicking reset-email link

  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 30000); return () => clearInterval(t); }, []);

  const refresh = useCallback(async () => {
    try {
      const [pl, pr, rs] = await Promise.all([getPlayers(), getPredictions(), getResults()]);
      setPlayers(pl); setPredictions(pr); setResults(rs);
    } catch (e) { console.error("refresh failed", e); }
  }, []);

  const loadSession = useCallback(async () => {
    const m = await getMe();
    setMe(m);
    setIsOrganizer(m ? await amIOrganizer() : false);
  }, []);

  /* initial load: data + current auth session */
  useEffect(() => {
    (async () => {
      await Promise.all([refresh(), loadSession()]);
      setLoaded(true);
    })();
    // react to login/logout (also across tabs); catch password-recovery returns
    const unsub = onAuthChange(async (_session, event) => {
      if (event === "PASSWORD_RECOVERY") { setRecovery(true); setLoaded(true); return; }
      await loadSession();
    });
    return () => unsub();
  }, [refresh, loadSession]);

  /* poll so the leaderboard stays live across devices */
  useEffect(() => {
    if (!loaded) return;
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [loaded, refresh]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 1800); };

  const signOut = async () => { await dbSignOut(); setMe(null); setIsOrganizer(false); };

  const setPred = async (mid, side, val) => {
    if (!me) return;
    const clean = val === "" ? "" : Math.max(0, Math.min(20, parseInt(val, 10) || 0));
    const prev = predictions[me.id]?.[mid] || {};
    const nextCell = { ...prev, [side]: clean };
    setPredictions((p) => ({ ...p, [me.id]: { ...p[me.id], [mid]: nextCell } })); // optimistic
    if (nextCell.h !== "" && nextCell.a !== "" && nextCell.h != null && nextCell.a != null) {
      try { await savePrediction(me.id, mid, nextCell.h, nextCell.a); }
      catch (e) { console.error("savePrediction failed", e); flash("Save failed — check connection"); }
    }
  };

  const setResultVal = async (mid, side, val) => {
    const clean = val === "" ? "" : Math.max(0, Math.min(20, parseInt(val, 10) || 0));
    const prev = results[mid] || {};
    const nextCell = { ...prev, [side]: clean };
    setResults((r) => ({ ...r, [mid]: nextCell })); // optimistic
    if (nextCell.h !== "" && nextCell.a !== "" && nextCell.h != null && nextCell.a != null) {
      try { await saveResult(mid, nextCell.h, nextCell.a); }
      catch (e) { console.error("saveResult failed", e); flash("Save failed — are you an organizer?"); }
    }
  };


  /* derived */
  const effectiveResults = useMemo(() => ({ ...SEEDED_RESULTS, ...results }), [results]);
  const enriched = useMemo(() => FIXTURES.map((f) => {
    const r = effectiveResults[f.id];
    const settled = r && r.h !== "" && r.a !== "" && r.h != null && r.a != null;
    const kickedOff = NOW >= f.kickoff;
    const msToKick = f.kickoff - NOW;
    const WINDOW = 24 * 3.6e6; // predictions open 24h before kickoff
    // Open if kickoff is within the next 24h and hasn't started / settled.
    const open = msToKick > 0 && msToKick <= WINDOW && !settled;
    const future = msToKick > WINDOW;          // more than 24h away — not yet open
    const locked = !open;
    return { ...f, settled, kickedOff, future, open, locked, result: settled ? r : null };
  }), [effectiveResults, tick]);

  const upcoming = useMemo(() => enriched.filter((f) => f.open), [enriched]);
  const futureLocked = useMemo(() => enriched.filter((f) => f.future && !f.settled), [enriched]);
  const live = useMemo(() => enriched.filter((f) => f.kickedOff && !f.settled), [enriched]);
  const finished = useMemo(() => enriched.filter((f) => f.settled).reverse(), [enriched]);

  const leaderboard = useMemo(() => {
    const rows = players.map((p) => {
      let total = 0, exact = 0, scored = 0, made = 0;
      enriched.forEach((m) => {
        const pred = predictions[p.id]?.[m.id];
        const has = pred && pred.h !== "" && pred.a !== "" && pred.h != null && pred.a != null;
        if (has) made++;
        if (m.settled && has) {
          const s = scoreMatch(pred, m.result);
          total += s.points; scored++; if (s.exact) exact++;
        }
      });
      return { ...p, total, exact, scored, made };
    });
    return rows.sort((a, b) => b.total - a.total || b.exact - a.exact || a.name.localeCompare(b.name));
  }, [players, predictions, enriched]);

  const myRank = me ? leaderboard.findIndex((r) => r.id === me.id) + 1 : 0;
  const myRow = me ? leaderboard.find((r) => r.id === me.id) : null;

  if (!supabaseConfigured) return <Splash text="⚠ Supabase not configured. Copy .env.example to .env and add your project URL and anon key, then restart the dev server." />;
  if (recovery) return <RecoveryScreen onDone={async () => { setRecovery(false); await loadSession(); }} flash={flash} />;
  if (!loaded) return <Splash text="Loading…" />;
  if (!me) return <AuthScreen onAuthed={loadSession} flash={flash} />;

  return (
    <div style={S.page}>
      <style>{CSS}</style>
      <TopBar me={me} myRank={myRank} myPts={myRow?.total ?? 0} total={leaderboard.length}
        view={view} setView={setView} signOut={signOut}
        adminMode={adminMode} setAdminMode={setAdminMode} isOrganizer={isOrganizer} />
      <main style={S.main}>
        {view === "matches" && (
          <MatchesView upcoming={upcoming} live={live} futureLocked={futureLocked}
            me={me} predictions={predictions} setPred={setPred} />
        )}
        {view === "leaderboard" && <LeaderboardView leaderboard={leaderboard} me={me} />}
        {view === "results" && (
          <ResultsView finished={finished} me={me} predictions={predictions} />
        )}
        {view === "mypicks" && (
          <MyPicksView enriched={enriched} me={me} predictions={predictions} />
        )}
        {view === "admin" && adminMode && isOrganizer && (
          <AdminView enriched={enriched} results={effectiveResults} setResult={setResultVal} />
        )}
      </main>
      <BottomNav view={view} setView={setView} adminMode={adminMode && isOrganizer} liveCount={live.length} />
      {toast && <div style={S.toast}>{toast}</div>}
    </div>
  );
}

/* ============================ Views ============================ */
function Splash({ text }) {
  return <div style={{ ...S.page, display: "grid", placeItems: "center" }}>
    <style>{CSS}</style><div style={{ color: V.sub }}>{text}</div></div>;
}

function AuthScreen({ onAuthed, flash }) {
  const [tab, setTab] = useState("login"); // login | signup
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(""); setInfo(""); setBusy(true);
    try {
      if (tab === "signup") {
        if (!name.trim()) { setErr("Enter a display name."); return; }
        if (password.length < 6) { setErr("Password must be at least 6 characters."); return; }
        const res = await signUp(email, password, name);
        if (res.error) { setErr(res.error); return; }
        if (res.needsConfirm) {
          setInfo("Check your email to confirm your account, then log in.");
          setTab("login");
          return;
        }
        flash(`Welcome, ${name.trim()}`);
        await onAuthed();
      } else {
        const res = await signIn(email, password);
        if (res.error) { setErr(res.error); return; }
        // make sure a profile exists (covers email-confirmed accounts)
        if (name.trim()) await ensureProfile(name);
        flash("Welcome back");
        await onAuthed();
      }
    } finally { setBusy(false); }
  };

  const forgot = async () => {
    setErr(""); setInfo("");
    if (!email.trim()) { setErr("Enter your email above first, then tap reset."); return; }
    setBusy(true);
    try {
      const res = await requestPasswordReset(email);
      if (res.error) { setErr(res.error); return; }
      setInfo("Password reset link sent. Check your email.");
    } finally { setBusy(false); }
  };

  return (
    <div style={S.signWrap}>
      <style>{CSS}</style>
      <div style={S.signCard}>
        <div style={S.signCrest}>⚽</div>
        <div style={S.signEyebrow}>FIFA World Cup 2026</div>
        <h1 style={S.signTitle}>Predictor</h1>

        <div style={S.authTabs}>
          <button className="ghost" style={{ ...S.authTab, ...(tab === "login" ? S.authTabOn : {}) }}
            onClick={() => { setTab("login"); setErr(""); setInfo(""); }}>Log in</button>
          <button className="ghost" style={{ ...S.authTab, ...(tab === "signup" ? S.authTabOn : {}) }}
            onClick={() => { setTab("signup"); setErr(""); setInfo(""); }}>Sign up</button>
        </div>

        {tab === "signup" && (
          <>
            <label style={S.fieldLabel}>Display name (shown on the leaderboard)</label>
            <input autoFocus value={name} onChange={(e) => { setName(e.target.value); setErr(""); }}
              placeholder="e.g. Raz" style={S.signInput} />
          </>
        )}

        <label style={S.fieldLabel}>Email</label>
        <input value={email} type="email" autoComplete="email"
          onChange={(e) => { setEmail(e.target.value); setErr(""); }}
          placeholder="you@example.com" style={S.signInput} />

        <label style={S.fieldLabel}>Password</label>
        <input value={password} type="password"
          autoComplete={tab === "signup" ? "new-password" : "current-password"}
          onChange={(e) => { setPassword(e.target.value); setErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={tab === "signup" ? "at least 6 characters" : "your password"}
          style={S.signInput} />

        {err && <div style={S.signErr}>{err}</div>}
        {info && <div style={S.signInfo}>{info}</div>}

        <button className="primary" style={{ ...S.signBtn, opacity: busy ? 0.6 : 1 }}
          onClick={submit} disabled={busy}>
          {busy ? "Please wait…" : tab === "signup" ? "Create account & play" : "Log in"}
        </button>

        {tab === "login" && (
          <button className="ghost" style={S.forgotLink} onClick={forgot} disabled={busy}>
            Forgot password?
          </button>
        )}

        <p style={S.signFoot}>
          Real accounts with email + password. Your predictions are tied to your
          login, so only you can change them.
        </p>
      </div>
    </div>
  );
}

function RecoveryScreen({ onDone, flash }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setErr("");
    if (pw.length < 6) { setErr("Password must be at least 6 characters."); return; }
    if (pw !== pw2) { setErr("Passwords don't match."); return; }
    setBusy(true);
    try {
      const res = await updatePassword(pw);
      if (res.error) { setErr(res.error); return; }
      flash("Password updated");
      await onDone();
    } finally { setBusy(false); }
  };
  return (
    <div style={S.signWrap}>
      <style>{CSS}</style>
      <div style={S.signCard}>
        <div style={S.signCrest}>🔑</div>
        <div style={S.signEyebrow}>Account recovery</div>
        <h1 style={S.signTitle}>New password</h1>
        <p style={S.signSub}>Choose a new password for your account.</p>

        <label style={S.fieldLabel}>New password</label>
        <input type="password" autoFocus value={pw} autoComplete="new-password"
          onChange={(e) => { setPw(e.target.value); setErr(""); }}
          placeholder="at least 6 characters" style={S.signInput} />

        <label style={S.fieldLabel}>Confirm password</label>
        <input type="password" value={pw2} autoComplete="new-password"
          onChange={(e) => { setPw2(e.target.value); setErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="re-enter password" style={S.signInput} />

        {err && <div style={S.signErr}>{err}</div>}

        <button className="primary" style={{ ...S.signBtn, opacity: busy ? 0.6 : 1 }}
          onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Set new password"}
        </button>
      </div>
    </div>
  );
}

function TopBar({ me, myRank, myPts, total, signOut, adminMode, setAdminMode, isOrganizer }) {
  const [menu, setMenu] = useState(false);
  return (
    <header style={S.top}>
      <div style={S.topInner}>
        <div style={S.topBrand}>
          <span style={S.topCrest}>⚽</span>
          <div>
            <div style={S.topTitle}>World Cup Predictor</div>
            <div style={S.topSub}>{me.name}</div>
          </div>
        </div>
        <div style={S.topRight}>
          <div style={S.rankPill}>
            <span style={{ color: V.gold, fontWeight: 800 }}>#{myRank || "–"}</span>
            <span style={{ color: V.sub, fontSize: 11 }}>/{total}</span>
            <span style={S.rankDot}>·</span>
            <span style={{ fontWeight: 800 }}>{myPts}</span>
            <span style={{ color: V.sub, fontSize: 11 }}>pts</span>
          </div>
          <button className="ghost" style={S.gear} onClick={() => setMenu((m) => !m)}>⋯</button>
          {menu && (
            <div style={S.menu} onMouseLeave={() => setMenu(false)}>
              {isOrganizer && (
                <button className="menuitem" style={S.menuItem} onClick={() => { setAdminMode((a) => !a); setMenu(false); }}>
                  {adminMode ? "Hide organizer tools" : "Organizer: enter results"}
                </button>
              )}
              <button className="menuitem" style={S.menuItem} onClick={signOut}>Log out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function FunFact({ home, away, seed }) {
  // deterministically show one of the two teams' facts so it's stable per match
  const pickHome = (seed.charCodeAt(seed.length - 1) % 2) === 0;
  const team = pickHome ? home : away;
  return (
    <div style={S.factWrap}>
      <span style={S.factFlag}>{flag(team)}</span>
      <span style={S.factText}><b style={{ color: V.text }}>{team}:</b> {factOf(team)}</span>
    </div>
  );
}

function PredictCard({ m, pred, setPred, locked }) {
  const has = pred && pred.h !== "" && pred.a !== "" && pred.h != null && pred.a != null;
  const winner = has ? (+pred.h > +pred.a ? "home" : +pred.h < +pred.a ? "away" : "draw") : null;
  const ms = m.kickoff - NOW;
  const soon = ms > 0 && ms < 3.6e6 * 3;
  return (
    <div style={{ ...S.mCard, ...(has ? S.mCardDone : {}), borderLeft: `3px solid ${m.accent}` }}>
      <div style={S.mTop}>
        <span style={S.grpTag}>Group {m.group}</span>
        <span style={{ ...S.kick, color: soon ? V.red : V.sub }}>{countdown(ms)}</span>
      </div>
      <div style={S.venueRow}>
        <span style={{ ...S.venueDot, background: m.accent }} />
        <span style={S.venueText}>{m.city}{m.country ? `, ${m.country}` : ""}</span>
      </div>
      <div style={S.mTeams}>
        <div style={{ ...S.teamCell, ...(winner === "home" ? S.teamWin : {}) }}>
          <span style={S.flag}>{flag(m.home)}</span>
          <span style={S.teamLbl}>{m.home}</span>
        </div>

        <div style={S.scoreBox}>
          <input className="num" inputMode="numeric" disabled={locked} value={pred?.h ?? ""}
            onChange={(e) => setPred(m.id, "h", e.target.value)} placeholder="–" style={S.scoreInput} />
          <span style={S.colon}>:</span>
          <input className="num" inputMode="numeric" disabled={locked} value={pred?.a ?? ""}
            onChange={(e) => setPred(m.id, "a", e.target.value)} placeholder="–" style={S.scoreInput} />
        </div>

        <div style={{ ...S.teamCell, ...(winner === "away" ? S.teamWin : {}) }}>
          <span style={S.flag}>{flag(m.away)}</span>
          <span style={S.teamLbl}>{m.away}</span>
        </div>
      </div>

      {has && !locked && <div style={S.savedTag}>✓ Pick saved · {pred.h}-{pred.a} · change anytime before kickoff</div>}
      {locked && <div style={S.lockedTag}>🔒 Locked at kickoff</div>}
    </div>
  );
}

function MatchesView({ upcoming, live, futureLocked, me, predictions, setPred }) {
  const myPreds = predictions[me.id] || {};
  const hasPick = (m) => { const p = myPreds[m.id]; return p && p.h !== "" && p.a !== "" && p.h != null && p.a != null; };
  const unpicked = upcoming.filter((m) => !hasPick(m)).length;

  // group the next locked future matches by day (show just the next day or two)
  const futureByDay = [];
  let cur = null;
  futureLocked.forEach((m) => {
    const k = dayKey(m.kickoff);
    if (!cur || cur.k !== k) { cur = { k, items: [] }; futureByDay.push(cur); }
    cur.items.push(m);
  });
  const nextDays = futureByDay.slice(0, 2);

  return (
    <div style={S.col}>
      {live.length > 0 && (
        <section>
          <div style={S.sectionHead}><span style={S.liveDot} /> In progress / awaiting result</div>
          {live.map((m) => {
            const has = hasPick(m); const p = myPreds[m.id];
            return (
              <div key={m.id} style={{ ...S.mCard, opacity: 0.86, borderLeft: `3px solid ${m.accent}` }}>
                <div style={S.mTop}><span style={S.grpTag}>Group {m.group}</span><span style={{ ...S.kick, color: V.live }}>● live / pending</span></div>
                <div style={S.venueRow}><span style={{ ...S.venueDot, background: m.accent }} /><span style={S.venueText}>{m.city}{m.country ? `, ${m.country}` : ""}</span></div>
                <div style={S.liveTeams}>
                  <span>{flag(m.home)} {m.home}</span><span style={{ color: V.sub }}>vs</span><span>{m.away} {flag(m.away)}</span>
                </div>
                <div style={S.lockedTag}>{has ? `Your pick: ${p.h}-${p.a} · scores once result is in` : "No pick — locked"}</div>
              </div>
            );
          })}
        </section>
      )}

      <section>
        <div style={S.sectionHead}>
          Open to predict
          {unpicked > 0 && <span style={S.badge}>{unpicked} to predict</span>}
        </div>
        <div style={S.dayLabel}>Matches kicking off within 24 hours</div>
        {upcoming.length === 0 && (
          <div style={S.empty}>Nothing open right now. Each match opens 24 hours before kickoff.</div>
        )}
        {upcoming.map((m) => (
          <PredictCard key={m.id} m={m} pred={myPreds[m.id]} setPred={setPred} locked={false} />
        ))}
      </section>

      {nextDays.length > 0 && (
        <section>
          <div style={S.sectionHead}>Coming up <span style={S.lockBadge}>🔒 opens on the day</span></div>
          {nextDays.map((day) => (
            <div key={day.k}>
              <div style={S.dayLabel}>{day.k}</div>
              {day.items.map((m) => (
                <div key={m.id} style={{ ...S.previewCard, borderLeft: `3px solid ${m.accent}` }}>
                  <span style={S.grpTag}>Group {m.group}</span>
                  <span style={S.previewTeams}>{flag(m.home)} {m.home} <span style={{ color: V.sub }}>v</span> {m.away} {flag(m.away)}</span>
                  <span style={S.previewTime}>{m.city} · {m.kickoff.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function ResultsView({ finished, me, predictions }) {
  const mine = predictions[me.id] || {};
  // group finished matches by day (finished is already newest-first)
  const byDay = [];
  let cur = null;
  finished.forEach((m) => {
    const k = dayKey(m.kickoff);
    if (!cur || cur.k !== k) { cur = { k, items: [] }; byDay.push(cur); }
    cur.items.push(m);
  });
  return (
    <div style={S.col}>
      <section>
        <div style={S.sectionHead}>Results <span style={S.badge}>{finished.length} played</span></div>
        {finished.length === 0 && <div style={S.empty}>No results yet. Scores appear here as matches finish.</div>}
        {byDay.map((day) => (
          <div key={day.k}>
            <div style={S.dayLabel}>{day.k}</div>
            {day.items.map((m) => {
              const pred = mine[m.id];
              const had = pred && pred.h !== "" && pred.a !== "" && pred.h != null && pred.a != null;
              const sc = had ? scoreMatch(pred, m.result) : null;
              const hw = m.result.h > m.result.a, aw = m.result.a > m.result.h;
              return (
                <div key={m.id} style={{ ...S.resCard, borderLeft: `3px solid ${m.accent}` }}>
                  <div style={S.resTop}>
                    <span style={S.grpTag}>Group {m.group}</span>
                    {sc != null && (
                      <span style={{ ...S.resPts, color: sc.points >= 10 ? V.good : sc.points > 0 ? V.gold : V.sub }}>
                        {sc.exact ? "✓ " : ""}+{sc.points} pts
                      </span>
                    )}
                  </div>
                  <div style={S.venueRow}><span style={{ ...S.venueDot, background: m.accent }} /><span style={S.venueText}>{m.city}{m.country ? `, ${m.country}` : ""}</span></div>
                  <div style={S.resScoreRow}>
                    <span style={{ ...S.resTeam, fontWeight: hw ? 800 : 600, color: hw ? V.text : V.sub }}>
                      {flag(m.home)} {m.home}
                    </span>
                    <span style={S.resScore}>{m.result.h} <span style={{ color: V.sub }}>:</span> {m.result.a}</span>
                    <span style={{ ...S.resTeam, textAlign: "right", fontWeight: aw ? 800 : 600, color: aw ? V.text : V.sub }}>
                      {m.away} {flag(m.away)}
                    </span>
                  </div>
                  <div style={S.resYourPick}>
                    {had ? `Your pick: ${pred.h}-${pred.a}${sc ? ` · ${sc.breakdown}` : ""}` : "You didn't predict this one"}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </section>
    </div>
  );
}

function LeaderboardView({ leaderboard, me }) {
  const [open, setOpen] = useState(null);
  return (
    <div style={S.col}>
      <section>
        <div style={S.sectionHead}>Live leaderboard</div>
        {leaderboard.length === 0 && <div style={S.empty}>The board is empty. First prediction puts you on top.</div>}
        <div style={S.lbList}>
          {leaderboard.map((r, i) => {
            const isMe = r.id === me.id;
            return (
              <div key={r.id}>
                <div className="lbrow" style={{ ...S.lbRow, ...(isMe ? S.lbMe : {}) }}
                  onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <span style={S.lbRank(i)}>{i + 1}</span>
                  <span style={S.lbName}>{r.name}{isMe && <span style={S.youTag}>you</span>}</span>
                  <span style={S.lbStat}>{r.exact}× exact</span>
                  <span style={S.lbStat}>{r.made} picks</span>
                  <span style={S.lbPts}>{r.total}</span>
                </div>
              </div>
            );
          })}
        </div>
        <p style={S.foot}>Ranked by points, then exact-score count. Updates as results come in.</p>
      </section>
    </div>
  );
}

function MyPicksView({ enriched, me, predictions }) {
  const mine = predictions[me.id] || {};
  const rows = enriched
    .filter((m) => { const p = mine[m.id]; return p && p.h !== "" && p.a !== "" && p.h != null && p.a != null; })
    .map((m) => ({ m, pred: mine[m.id], sc: m.settled ? scoreMatch(mine[m.id], m.result) : null }));
  const settledRows = rows.filter((r) => r.m.settled);
  const totalPts = settledRows.reduce((s, r) => s + r.sc.points, 0);
  return (
    <div style={S.col}>
      <section>
        <div style={S.sectionHead}>My picks <span style={S.badge}>{totalPts} pts banked</span></div>
        {rows.length === 0 && <div style={S.empty}>No picks yet. Open the Matches tab to call your first score.</div>}
        {rows.map(({ m, pred, sc }) => (
          <div key={m.id} style={S.pickRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={S.pickTeams}>{flag(m.home)} {m.home} <span style={{ color: V.sub }}>v</span> {m.away} {flag(m.away)}</div>
              <div style={S.pickMeta}>Group {m.group} · {m.city} · {fmtKick(m.kickoff)}</div>
            </div>
            <div style={S.pickScores}>
              <div style={S.pickPred}>{pred.h}-{pred.a}</div>
              <div style={S.pickActual}>{m.settled ? `${m.result.h}-${m.result.a}` : (m.locked ? "pending" : "upcoming")}</div>
            </div>
            <div style={{ ...S.pickPts, color: sc ? (sc.points >= 10 ? V.good : sc.points > 0 ? V.gold : V.sub) : V.sub }}>
              {sc ? `+${sc.points}` : "—"}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function AdminView({ enriched, results, setResult }) {
  const [filter, setFilter] = useState("pending");
  const list = enriched.filter((m) =>
    filter === "all" ? true : filter === "pending" ? (m.locked && !m.settled) : m.settled
  );
  return (
    <div style={S.col}>
      <section>
        <div style={S.sectionHead}>Organizer · enter actual results</div>
        <p style={S.foot}>Enter the 90′ + stoppage score. Points compute for everyone instantly. Players never see this screen.</p>
        <div style={S.filterRow}>
          {["pending", "done", "all"].map((f) => (
            <button key={f} className="ghost" style={{ ...S.filterBtn, ...(filter === f ? S.filterOn : {}) }} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
        {list.map((m) => {
          const r = results[m.id] || {};
          return (
            <div key={m.id} style={S.adminRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.pickTeams}>{flag(m.home)} {m.home} <span style={{ color: V.sub }}>v</span> {m.away} {flag(m.away)}</div>
                <div style={S.pickMeta}>Group {m.group} · {m.city} · {fmtKick(m.kickoff)}</div>
              </div>
              <div style={S.scoreBox}>
                <input className="num" inputMode="numeric" value={r.h ?? ""} onChange={(e) => setResult(m.id, "h", e.target.value)} placeholder="–" style={S.scoreInput} />
                <span style={S.colon}>:</span>
                <input className="num" inputMode="numeric" value={r.a ?? ""} onChange={(e) => setResult(m.id, "a", e.target.value)} placeholder="–" style={S.scoreInput} />
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function BottomNav({ view, setView, adminMode, liveCount }) {
  const items = [["matches", "Matches", "⚽"], ["results", "Results", "📋"], ["mypicks", "My picks", "🎯"], ["leaderboard", "Board", "🏆"]];
  if (adminMode) items.push(["admin", "Results", "⚙️"]);
  return (
    <nav style={S.bottom}>
      {items.map(([k, label, icon]) => (
        <button key={k} className="navbtn" style={{ ...S.navBtn, ...(view === k ? S.navOn : {}) }} onClick={() => setView(k)}>
          <span style={S.navIcon}>{icon}</span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

/* ============================ Style ============================ */
/* Official United 2026 palette. Black is the primary canvas; green is the
   lead accent, blue/red secondary, greys for structure. */
const BRAND = {
  black: "#000000", green: "#3CAC3B", blue: "#2A398D", red: "#E61D25",
  heather: "#474A4A", lightGray: "#D1D4D1",
};
const V = {
  // Electric broadcast palette over deep space-navy glass.
  bg0: "#05060B",          // deepest backdrop
  bg1: "#0A0E1A",          // panel base
  cyan: "#00E5FF",
  green: BRAND.green,      // #3CAC3B official
  greenBright: "#5BE66A",
  violet: "#7A5CFF",
  magenta: "#FF2D78",      // live / alert
  amber: "#FFC83D",
  text: "#EAF2FF",
  sub: "#8A94B0",
  // glass surfaces
  glass: "rgba(255,255,255,0.055)",
  glassUp: "rgba(255,255,255,0.10)",
  stroke: "rgba(255,255,255,0.14)",
  strokeSoft: "rgba(255,255,255,0.08)",
  // aliases so existing references resolve
  panel: "rgba(255,255,255,0.055)", panel2: "rgba(255,255,255,0.10)",
  line: "rgba(255,255,255,0.14)", line2: "rgba(255,255,255,0.22)",
  accent: "#00E5FF", accent2: "#7A5CFF", gold: "#FFC83D",
  good: "#5BE66A", live: "#FF2D78", red: "#FF2D78", blue: "#7A5CFF",
};
const GRAD = {
  electric: "linear-gradient(100deg, #00E5FF 0%, #3CAC3B 100%)",
  electricSoft: "linear-gradient(100deg, rgba(0,229,255,.18), rgba(60,172,59,.18))",
  violet: "linear-gradient(100deg, #7A5CFF 0%, #00E5FF 100%)",
  live: "linear-gradient(100deg, #FF2D78 0%, #7A5CFF 100%)",
};
const CSS = `
*{box-sizing:border-box;} body{margin:0;}
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Chakra+Petch:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
.primary:hover{filter:brightness(1.12) saturate(1.1);box-shadow:0 0 28px rgba(0,229,255,.5);}
.ghost:hover{border-color:rgba(255,255,255,.28);color:#fff;}
.num:focus,input:focus{outline:none;border-color:#00E5FF;box-shadow:0 0 0 3px rgba(0,229,255,.25),0 0 18px rgba(0,229,255,.3);}
.lbrow:hover{cursor:pointer;background:rgba(255,255,255,.09);}
.navbtn:active{transform:scale(.9);}
.menuitem:hover{background:rgba(255,255,255,.08);}
::-webkit-scrollbar{width:9px;height:9px;}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:8px;}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.35;}}
@keyframes sweep{0%{background-position:-160% 0;}100%{background-position:260% 0;}}
@keyframes floaty{0%,100%{transform:translateY(0);}50%{transform:translateY(-3px);}}
@media (prefers-reduced-motion: reduce){*{animation:none !important;}}
`;
const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const DISPLAY = "'Chakra Petch', 'Rajdhani', " + FONT;   // technical / broadcast
const NUM = "'Rajdhani', 'Chakra Petch', " + FONT;       // tabular timer numerals
// atmospheric backdrop: pitch glow + colored mesh blobs
const BACKDROP = [
  "radial-gradient(900px 520px at 50% -8%, rgba(0,229,255,.16), rgba(0,229,255,0) 60%)",
  "radial-gradient(700px 500px at 100% 12%, rgba(122,92,255,.16), rgba(122,92,255,0) 55%)",
  "radial-gradient(680px 460px at 0% 30%, rgba(60,172,59,.14), rgba(60,172,59,0) 55%)",
  "linear-gradient(180deg, #0A0E1A 0%, #05060B 100%)",
].join(",");
const GLASS = {
  background: V.glass,
  backdropFilter: "blur(18px) saturate(1.3)",
  WebkitBackdropFilter: "blur(18px) saturate(1.3)",
  border: `1px solid ${V.stroke}`,
  borderRadius: 18,
  boxShadow: "0 10px 40px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.14)",
};
const S = {
  page: { minHeight: "100vh", background: BACKDROP, backgroundAttachment: "fixed", color: V.text, fontFamily: FONT, paddingBottom: 92 },
  main: { maxWidth: 560, margin: "0 auto", padding: "16px 14px 24px" },
  col: { display: "flex", flexDirection: "column", gap: 24 },

  /* sign in */
  signWrap: { minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, background: BACKDROP, backgroundAttachment: "fixed", color: V.text, fontFamily: FONT },
  signCard: { width: "100%", maxWidth: 390, ...GLASS, padding: 30, textAlign: "center" },
  signCrest: { fontSize: 50, marginBottom: 4, filter: "drop-shadow(0 0 16px rgba(0,229,255,.6))" },
  signEyebrow: { background: GRAD.electric, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", fontSize: 12, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase", fontFamily: DISPLAY },
  signTitle: { fontFamily: DISPLAY, fontSize: 46, fontWeight: 700, margin: "2px 0 8px", letterSpacing: 2, lineHeight: .95, textTransform: "uppercase", color: "#fff", textShadow: "0 0 30px rgba(0,229,255,.35)" },
  signSub: { color: V.sub, fontSize: 14, lineHeight: 1.5, margin: "0 0 22px", fontWeight: 500 },
  signInput: { width: "100%", background: "rgba(0,0,0,.35)", border: `1px solid ${V.stroke}`, color: V.text, borderRadius: 12, padding: "14px 16px", fontSize: 16, textAlign: "center", marginBottom: 10, fontWeight: 600, fontFamily: NUM, letterSpacing: .5 },
  fieldLabel: { display: "block", textAlign: "left", color: V.sub, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, margin: "2px 2px 6px", fontFamily: DISPLAY },
  signErr: { background: "rgba(255,45,120,.14)", border: `1px solid rgba(255,45,120,.5)`, color: "#ff8fb4", fontSize: 13, fontWeight: 600, borderRadius: 10, padding: "9px 12px", marginBottom: 10 },
  signInfo: { background: "rgba(91,230,106,.12)", border: `1px solid rgba(91,230,106,.45)`, color: "#9af0a3", fontSize: 13, fontWeight: 600, borderRadius: 10, padding: "9px 12px", marginBottom: 10 },
  authTabs: { display: "flex", gap: 6, background: "rgba(0,0,0,.3)", borderRadius: 12, padding: 5, marginBottom: 20, border: `1px solid ${V.strokeSoft}` },
  authTab: { flex: 1, background: "none", border: "none", color: V.sub, fontSize: 13, fontWeight: 700, padding: "10px 0", borderRadius: 8, cursor: "pointer", textTransform: "uppercase", letterSpacing: 1, fontFamily: DISPLAY },
  authTabOn: { background: GRAD.electric, color: "#04121a", boxShadow: "0 0 20px rgba(0,229,255,.4)" },
  rememberRow: { display: "flex", alignItems: "center", gap: 8, color: V.sub, fontSize: 13, marginBottom: 14, cursor: "pointer", justifyContent: "flex-start", fontWeight: 500 },
  signBtn: { width: "100%", background: GRAD.electric, color: "#04121a", border: "none", borderRadius: 12, padding: "15px", fontWeight: 700, fontSize: 15, cursor: "pointer", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: DISPLAY, boxShadow: "0 0 24px rgba(0,229,255,.35)" },
  signReturn: { marginTop: 18, paddingTop: 16, borderTop: `1px solid ${V.strokeSoft}` },
  chipWrap: { display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "center", marginTop: 8 },
  returnChip: { background: V.glass, border: `1px solid ${V.stroke}`, color: V.text, borderRadius: 20, padding: "6px 14px", fontSize: 13, cursor: "pointer", fontWeight: 600 },
  signFoot: { color: V.sub, fontSize: 11, marginTop: 18, marginBottom: 0, lineHeight: 1.5 },
  forgotLink: { display: "block", width: "100%", background: "none", border: "none", color: V.cyan, fontSize: 13, fontWeight: 600, padding: "12px 0 0", cursor: "pointer", textAlign: "center", fontFamily: FONT },

  /* top bar */
  top: { position: "sticky", top: 0, zIndex: 20, background: "rgba(5,6,11,.6)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: `1px solid ${V.stroke}` },
  topInner: { maxWidth: 560, margin: "0 auto", padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" },
  topBrand: { display: "flex", alignItems: "center", gap: 10 },
  topCrest: { fontSize: 24, filter: "drop-shadow(0 0 10px rgba(0,229,255,.5))" },
  topTitle: { fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, letterSpacing: 1, color: "#fff", textTransform: "uppercase" },
  topSub: { color: V.sub, fontSize: 12, fontWeight: 500 },
  topRight: { display: "flex", alignItems: "center", gap: 8, position: "relative" },
  rankPill: { display: "flex", alignItems: "center", gap: 4, background: V.glass, border: `1px solid ${V.stroke}`, borderRadius: 10, padding: "6px 12px", fontSize: 14, fontFamily: NUM, fontWeight: 700 },
  rankDot: { color: V.sub, margin: "0 2px" },
  gear: { background: V.glass, border: `1px solid ${V.stroke}`, color: V.text, borderRadius: 10, width: 36, height: 36, fontSize: 18, cursor: "pointer", lineHeight: 1 },
  menu: { position: "absolute", top: 44, right: 0, ...GLASS, borderRadius: 12, padding: 6, minWidth: 210, zIndex: 30 },
  menuItem: { display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: V.text, padding: "10px 12px", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: 500 },

  /* sections */
  sectionHead: { display: "flex", alignItems: "center", gap: 10, fontFamily: DISPLAY, fontWeight: 700, fontSize: 22, marginBottom: 14, letterSpacing: 1, textTransform: "uppercase", color: "#fff" },
  badge: { background: GRAD.electric, color: "#04121a", fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: .5, boxShadow: "0 0 16px rgba(0,229,255,.35)" },
  lockBadge: { background: V.glass, color: V.sub, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, border: `1px solid ${V.stroke}`, textTransform: "uppercase", letterSpacing: .5 },
  previewCard: { display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,.03)", border: `1px solid ${V.strokeSoft}`, borderRadius: 14, padding: "11px 14px", marginBottom: 9, opacity: .9 },
  previewTeams: { flex: 1, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: V.text, fontFamily: DISPLAY, textTransform: "uppercase", letterSpacing: .3 },
  previewTime: { fontSize: 12, color: V.sub, whiteSpace: "nowrap", fontFamily: NUM, fontWeight: 600 },
  liveDot: { width: 9, height: 9, borderRadius: "50%", background: V.magenta, boxShadow: "0 0 12px rgba(255,45,120,.9)", animation: "pulse 1.3s infinite" },
  dayLabel: { color: V.cyan, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, margin: "18px 0 10px", fontFamily: DISPLAY },
  empty: { color: V.sub, fontSize: 14, textAlign: "center", padding: "30px 0", fontWeight: 500 },

  /* match card — broadcast VS panel */
  mCard: { ...GLASS, padding: 24, marginBottom: 14, position: "relative", overflow: "hidden" },
  mCardDone: { border: `1px solid rgba(0,229,255,.4)`, boxShadow: "0 10px 40px rgba(0,0,0,.5), 0 0 30px rgba(0,229,255,.18), inset 0 1px 0 rgba(255,255,255,.14)" },
  mTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  grpTag: { fontFamily: DISPLAY, fontSize: 12, fontWeight: 700, color: V.cyan, background: "rgba(0,229,255,.1)", padding: "3px 10px", borderRadius: 6, border: `1px solid rgba(0,229,255,.3)`, textTransform: "uppercase", letterSpacing: 1 },
  kick: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5, fontFamily: NUM },
  mTeams: { display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "stretch", gap: 16 },
  teamCell: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "rgba(255,255,255,.03)", border: "1px solid transparent", borderRadius: 14, padding: "16px 8px", minWidth: 0, transition: "all .2s" },
  teamWin: { background: GRAD.electricSoft, borderColor: "rgba(0,229,255,.5)", boxShadow: "0 0 22px rgba(0,229,255,.25)" },
  flag: { fontSize: 44, lineHeight: 1, filter: "drop-shadow(0 4px 12px rgba(0,0,0,.55))" },
  teamLbl: { fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, lineHeight: 1, color: "#fff", textTransform: "uppercase", textAlign: "center", letterSpacing: .5 },
  scoreBox: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8 },
  scoreInput: { width: 52, height: 64, textAlign: "center", background: "rgba(0,0,0,.4)", border: `1px solid ${V.stroke}`, color: "#fff", borderRadius: 12, fontSize: 34, fontWeight: 700, fontFamily: NUM, boxShadow: "inset 0 0 18px rgba(0,229,255,.1)" },
  colon: { color: V.cyan, fontSize: 26, fontWeight: 700, textShadow: "0 0 12px rgba(0,229,255,.8)", fontFamily: NUM },
  savedTag: { marginTop: 24, fontSize: 12, color: V.greenBright, fontWeight: 600, textAlign: "center", letterSpacing: .3 },
  lockedTag: { marginTop: 24, fontSize: 12, color: V.sub, fontWeight: 500, textAlign: "center" },
  liveTeams: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 15, fontWeight: 700, padding: "4px 0", fontFamily: DISPLAY, textTransform: "uppercase", letterSpacing: .5 },

  /* fun fact (kept for possible match-detail use; no longer in prediction card) */
  factWrap: { display: "flex", gap: 9, marginTop: 13, padding: "10px 12px", background: "rgba(0,0,0,.25)", borderRadius: 12, border: `1px solid ${V.strokeSoft}` },
  factFlag: { fontSize: 20, lineHeight: 1.3, flexShrink: 0 },
  factText: { fontSize: 12, color: V.sub, lineHeight: 1.45, fontWeight: 500 },
  /* venue */
  venueRow: { display: "flex", alignItems: "center", gap: 6, marginBottom: 24 },
  venueDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0, boxShadow: "0 0 8px currentColor" },
  venueText: { fontSize: 11, color: V.sub, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", fontFamily: DISPLAY },

  /* leaderboard */
  lbList: { display: "flex", flexDirection: "column", gap: 9 },
  lbRow: { display: "flex", alignItems: "center", gap: 11, padding: "13px 14px", borderRadius: 14, ...GLASS },
  lbMe: { border: `1px solid rgba(255,200,61,.55)`, boxShadow: "0 10px 40px rgba(0,0,0,.5), 0 0 26px rgba(255,200,61,.22), inset 0 1px 0 rgba(255,255,255,.14)" },
  lbRank: (i) => ({ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center", fontWeight: 700, fontSize: 18, flexShrink: 0, fontFamily: NUM, color: "#04121a",
    background: i === 0 ? "linear-gradient(135deg,#FFC83D,#FF9E2D)" : i === 1 ? "linear-gradient(135deg,#D7E0F0,#9FB0CC)" : i === 2 ? "linear-gradient(135deg,#E0954E,#B36A2E)" : "rgba(255,255,255,.1)",
    boxShadow: i < 3 ? "0 0 18px rgba(255,200,61,.3)" : "none", ...(i > 2 ? { color: "#fff" } : {}) }),
  lbName: { flex: 1, fontFamily: DISPLAY, fontWeight: 700, fontSize: 18, display: "flex", alignItems: "center", gap: 8, minWidth: 0, textTransform: "uppercase", letterSpacing: .5, color: "#fff" },
  youTag: { fontSize: 10, fontWeight: 700, color: "#04121a", background: V.cyan, borderRadius: 5, padding: "2px 7px", letterSpacing: .5, boxShadow: "0 0 12px rgba(0,229,255,.5)" },
  lbStat: { color: V.sub, fontSize: 11, whiteSpace: "nowrap", fontWeight: 600, fontFamily: NUM },
  lbPts: { fontFamily: NUM, fontWeight: 700, fontSize: 30, minWidth: 46, textAlign: "right", color: "#fff", textShadow: "0 0 16px rgba(0,229,255,.4)" },
  foot: { color: V.sub, fontSize: 12, marginTop: 14, lineHeight: 1.5 },

  /* my picks */
  pickRow: { display: "flex", alignItems: "center", gap: 12, ...GLASS, padding: "13px 14px", marginBottom: 9 },
  pickTeams: { fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textTransform: "uppercase", letterSpacing: .4, color: "#fff" },
  pickMeta: { color: V.sub, fontSize: 11, marginTop: 3, fontWeight: 500, fontFamily: NUM },
  pickScores: { textAlign: "center", minWidth: 64 },
  pickPred: { fontFamily: NUM, fontWeight: 700, fontSize: 24, color: "#fff" },
  pickActual: { color: V.sub, fontSize: 11, marginTop: 1, fontFamily: NUM, fontWeight: 600 },
  pickPts: { fontFamily: NUM, fontWeight: 700, fontSize: 26, minWidth: 46, textAlign: "right" },

  /* admin */
  filterRow: { display: "flex", gap: 7, marginBottom: 14 },
  filterBtn: { background: V.glass, border: `1px solid ${V.stroke}`, color: V.sub, borderRadius: 20, padding: "7px 15px", fontSize: 12, fontWeight: 700, cursor: "pointer", textTransform: "uppercase", letterSpacing: .5, fontFamily: DISPLAY },
  filterOn: { background: GRAD.electric, color: "#04121a", border: "1px solid transparent", boxShadow: "0 0 16px rgba(0,229,255,.35)" },
  adminRow: { display: "flex", alignItems: "center", gap: 12, ...GLASS, padding: "12px 14px", marginBottom: 9 },

  /* results view */
  resCard: { ...GLASS, padding: 24, marginBottom: 14 },
  resTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  resPts: { fontFamily: NUM, fontWeight: 700, fontSize: 18 },
  resScoreRow: { display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 10 },
  resTeam: { fontFamily: DISPLAY, fontSize: 15, lineHeight: 1.1, textTransform: "uppercase", letterSpacing: .4 },
  resScore: { fontFamily: NUM, fontWeight: 700, fontSize: 34, whiteSpace: "nowrap", color: "#fff", textShadow: "0 0 18px rgba(0,229,255,.35)" },
  resYourPick: { marginTop: 16, fontSize: 12, color: V.sub, borderTop: `1px solid ${V.strokeSoft}`, paddingTop: 12, fontWeight: 500 },

  /* bottom nav */
  bottom: { position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 20, background: "rgba(5,6,11,.7)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderTop: `1px solid ${V.stroke}`, display: "flex", justifyContent: "space-around", padding: "10px 0 calc(10px + env(safe-area-inset-bottom))", maxWidth: 560, margin: "0 auto" },
  navBtn: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "none", border: "none", color: V.sub, fontSize: 10, fontWeight: 700, cursor: "pointer", padding: "4px 12px", borderRadius: 10, position: "relative", flex: 1, textTransform: "uppercase", letterSpacing: .5, fontFamily: DISPLAY },
  navOn: { color: V.cyan, textShadow: "0 0 12px rgba(0,229,255,.6)" },
  navIcon: { fontSize: 20 },

  toast: { position: "fixed", bottom: 96, left: "50%", transform: "translateX(-50%)", ...GLASS, color: "#fff", padding: "12px 22px", borderRadius: 12, fontWeight: 700, fontSize: 13, zIndex: 60, textTransform: "uppercase", letterSpacing: .5, fontFamily: DISPLAY, boxShadow: "0 0 30px rgba(0,229,255,.3)" },
};
