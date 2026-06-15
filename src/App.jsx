import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  NOW, factOf, flag, FIXTURES,
  SEEDED_RESULTS, etDateKey, scoreMatch, fmtKick, dayKey, countdown,
} from "./data.js";
import {
  signUp, signIn, signOut as dbSignOut, getMe, ensureProfile, onAuthChange,
  amIOrganizer, getPlayers, getPredictions, savePrediction, getResults, saveResult,
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
    // react to login/logout (also across tabs)
    const unsub = onAuthChange(async () => { await loadSession(); });
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
  const todayET = useMemo(() => etDateKey(NOW), [tick]);
  const enriched = useMemo(() => FIXTURES.map((f) => {
    const r = effectiveResults[f.id];
    const settled = r && r.h !== "" && r.a !== "" && r.h != null && r.a != null;
    const kickedOff = NOW >= f.kickoff;
    const matchDayET = etDateKey(f.kickoff);
    const sameDay = matchDayET === todayET;
    const future = matchDayET > todayET;       // belongs to a later ET day
    // Predictions open ONLY for same-day matches that haven't kicked off / settled.
    const open = sameDay && !kickedOff && !settled;
    const locked = !open;
    return { ...f, settled, kickedOff, sameDay, future, open, locked, result: settled ? r : null, matchDayET };
  }), [effectiveResults, todayET, tick]);

  const upcoming = useMemo(() => enriched.filter((f) => f.open), [enriched]);
  const futureLocked = useMemo(() => enriched.filter((f) => f.future && !f.settled), [enriched]);
  const live = useMemo(() => enriched.filter((f) => f.sameDay && f.kickedOff && !f.settled), [enriched]);
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
          <MatchesView upcoming={upcoming} live={live} futureLocked={futureLocked} todayET={todayET}
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

        <p style={S.signFoot}>
          Real accounts with email + password. Your predictions are tied to your
          login, so only you can change them.
        </p>
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

        <div style={{ ...S.teamCell, alignItems: "flex-end", ...(winner === "away" ? S.teamWin : {}) }}>
          <span style={S.flag}>{flag(m.away)}</span>
          <span style={{ ...S.teamLbl, textAlign: "right" }}>{m.away}</span>
        </div>
      </div>

      <FunFact home={m.home} away={m.away} seed={m.id} />
      {has && !locked && <div style={S.savedTag}>✓ Pick saved · {pred.h}-{pred.a}. Change anytime before kickoff.</div>}
      {locked && <div style={S.lockedTag}>🔒 Locked at kickoff</div>}
    </div>
  );
}

function MatchesView({ upcoming, live, futureLocked, todayET, me, predictions, setPred }) {
  const myPreds = predictions[me.id] || {};
  const hasPick = (m) => { const p = myPreds[m.id]; return p && p.h !== "" && p.a !== "" && p.h != null && p.a != null; };
  const unpicked = upcoming.filter((m) => !hasPick(m)).length;

  // today's ET date, human-readable, for the header
  const todayLabel = new Date(`${todayET}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

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
          Today’s matches
          {unpicked > 0 && <span style={S.badge}>{unpicked} to predict</span>}
        </div>
        <div style={S.dayLabel}>{todayLabel} · US Eastern</div>
        {upcoming.length === 0 && (
          <div style={S.empty}>No more open matches today. Predictions open each day for that day’s fixtures.</div>
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
        {finished.length === 0 && <div style={S.empty}>No completed matches yet.</div>}
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
        {leaderboard.length === 0 && <div style={S.empty}>No players yet.</div>}
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
        {rows.length === 0 && <div style={S.empty}>You haven't made any picks yet. Head to Matches.</div>}
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
  bg: BRAND.black, panel: "#0E0E0E", panel2: "#171717", line: "#262626", line2: "#3A3A3A",
  text: "#F4F5F4", sub: "#9A9D9A", accent: BRAND.green, accent2: BRAND.blue, gold: "#F5C518",
  good: BRAND.green, live: BRAND.red, red: BRAND.red, blue: BRAND.blue,
};
const CSS = `
*{box-sizing:border-box;} body{margin:0;}
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');
.primary:hover{filter:brightness(1.08);} .ghost:hover{color:${V.text};border-color:${V.line2};}
.num:focus,input:focus{outline:2px solid ${V.accent};outline-offset:1px;}
.lbrow:hover{background:${V.panel2};cursor:pointer;}
.navbtn:active{transform:scale(.94);}
.menuitem:hover{background:${V.panel2};}
::-webkit-scrollbar{width:8px;height:8px;}::-webkit-scrollbar-thumb{background:${V.line2};border-radius:8px;}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.35;}}
`;
const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const DISPLAY = "Sora, " + FONT;
const S = {
  page: { minHeight: "100vh", background: `radial-gradient(1200px 520px at 50% -12%, rgba(60,172,59,.14) 0%, ${V.bg} 58%)`, color: V.text, fontFamily: FONT, paddingBottom: 76 },
  main: { maxWidth: 560, margin: "0 auto", padding: "14px 14px 24px" },
  col: { display: "flex", flexDirection: "column", gap: 22 },

  /* sign in */
  signWrap: { minHeight: "100vh", display: "grid", placeItems: "center", padding: 20,
    background: `radial-gradient(900px 520px at 50% -8%, rgba(42,57,141,.30) 0%, ${V.bg} 62%)`, color: V.text, fontFamily: FONT },
  signCard: { width: "100%", maxWidth: 380, background: V.panel, border: `1px solid ${V.line}`, borderRadius: 22, padding: 28, textAlign: "center", boxShadow: "0 30px 80px rgba(0,0,0,.5)" },
  signCrest: { fontSize: 44, marginBottom: 6 },
  signEyebrow: { color: V.gold, fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" },
  signTitle: { fontFamily: DISPLAY, fontSize: 38, fontWeight: 800, margin: "2px 0 8px", letterSpacing: -1 },
  signSub: { color: V.sub, fontSize: 14, lineHeight: 1.5, margin: "0 0 20px" },
  signInput: { width: "100%", background: V.panel2, border: `1px solid ${V.line}`, color: V.text, borderRadius: 12, padding: "14px 16px", fontSize: 16, textAlign: "center", marginBottom: 10 },
  fieldLabel: { display: "block", textAlign: "left", color: V.sub, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, margin: "2px 2px 6px" },
  signErr: { background: "rgba(255,92,114,.12)", border: `1px solid rgba(255,92,114,.4)`, color: "#ff8e9d", fontSize: 13, fontWeight: 600, borderRadius: 10, padding: "9px 12px", marginBottom: 10 },
  signInfo: { background: "rgba(60,172,59,.12)", border: `1px solid rgba(60,172,59,.4)`, color: "#7fd97f", fontSize: 13, fontWeight: 600, borderRadius: 10, padding: "9px 12px", marginBottom: 10 },
  authTabs: { display: "flex", gap: 4, background: V.panel2, borderRadius: 12, padding: 4, marginBottom: 18 },
  authTab: { flex: 1, background: "none", border: "none", color: V.sub, fontSize: 14, fontWeight: 700, padding: "9px 0", borderRadius: 9, cursor: "pointer" },
  authTabOn: { background: V.accent, color: "#04130b" },
  rememberRow: { display: "flex", alignItems: "center", gap: 8, color: V.sub, fontSize: 13, marginBottom: 14, cursor: "pointer", justifyContent: "flex-start" },
  signBtn: { width: "100%", background: V.accent, color: "#04130b", border: "none", borderRadius: 12, padding: "14px", fontWeight: 800, fontSize: 15, cursor: "pointer" },
  signReturn: { marginTop: 18, paddingTop: 16, borderTop: `1px solid ${V.line}` },
  chipWrap: { display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "center", marginTop: 8 },
  returnChip: { background: V.panel2, border: `1px solid ${V.line}`, color: V.text, borderRadius: 20, padding: "6px 14px", fontSize: 13, cursor: "pointer" },
  signFoot: { color: V.sub, fontSize: 11, marginTop: 18, marginBottom: 0 },

  /* top bar */
  top: { position: "sticky", top: 0, zIndex: 20, background: "rgba(11,16,32,.85)", backdropFilter: "blur(12px)", borderBottom: `1px solid ${V.line}` },
  topInner: { maxWidth: 560, margin: "0 auto", padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" },
  topBrand: { display: "flex", alignItems: "center", gap: 10 },
  topCrest: { fontSize: 24 },
  topTitle: { fontFamily: DISPLAY, fontWeight: 800, fontSize: 16, letterSpacing: -0.3 },
  topSub: { color: V.sub, fontSize: 12 },
  topRight: { display: "flex", alignItems: "center", gap: 8, position: "relative" },
  rankPill: { display: "flex", alignItems: "center", gap: 4, background: V.panel, border: `1px solid ${V.line}`, borderRadius: 20, padding: "6px 12px", fontSize: 14 },
  rankDot: { color: V.sub, margin: "0 2px" },
  gear: { background: V.panel, border: `1px solid ${V.line}`, color: V.sub, borderRadius: 10, width: 34, height: 34, fontSize: 18, cursor: "pointer", lineHeight: 1 },
  menu: { position: "absolute", top: 42, right: 0, background: V.panel, border: `1px solid ${V.line}`, borderRadius: 12, padding: 6, minWidth: 200, boxShadow: "0 20px 50px rgba(0,0,0,.5)", zIndex: 30 },
  menuItem: { display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: V.text, padding: "10px 12px", borderRadius: 8, fontSize: 13, cursor: "pointer" },

  /* sections */
  sectionHead: { display: "flex", alignItems: "center", gap: 10, fontFamily: DISPLAY, fontWeight: 700, fontSize: 18, marginBottom: 12, letterSpacing: -0.3 },
  badge: { background: V.accent, color: "#04130b", fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 20 },
  lockBadge: { background: V.panel2, color: V.sub, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20, border: `1px solid ${V.line}` },
  previewCard: { display: "flex", alignItems: "center", gap: 10, background: V.panel, border: `1px dashed ${V.line2}`, borderRadius: 12, padding: "11px 13px", marginBottom: 8, opacity: 0.72 },
  previewTeams: { flex: 1, fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  previewTime: { fontSize: 12, color: V.sub, whiteSpace: "nowrap" },
  liveDot: { width: 8, height: 8, borderRadius: "50%", background: V.live, animation: "pulse 1.4s infinite" },
  dayLabel: { color: V.sub, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, margin: "16px 0 8px" },
  empty: { color: V.sub, fontSize: 14, textAlign: "center", padding: "28px 0" },

  /* match card */
  mCard: { background: V.panel, border: `1px solid ${V.line}`, borderRadius: 16, padding: 14, marginBottom: 10 },
  mCardDone: { borderColor: "rgba(25,195,125,.4)" },
  mTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  grpTag: { fontSize: 11, fontWeight: 700, color: V.accent2, background: "rgba(91,141,239,.14)", padding: "2px 9px", borderRadius: 6 },
  kick: { fontSize: 12, fontWeight: 600 },
  mTeams: { display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 6 },
  teamCell: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, background: "none", border: "1px solid transparent", borderRadius: 12, padding: "8px 8px", minWidth: 0 },
  teamWin: { background: "rgba(25,195,125,.12)", borderColor: "rgba(25,195,125,.5)" },
  flag: { fontSize: 26, lineHeight: 1 },
  teamLbl: { fontWeight: 600, fontSize: 13, lineHeight: 1.15, color: V.text },
  scoreBox: { display: "flex", alignItems: "center", gap: 5 },
  scoreInput: { width: 46, height: 50, textAlign: "center", background: V.bg, border: `1px solid ${V.line2}`, color: V.text, borderRadius: 11, fontSize: 22, fontWeight: 800, fontFamily: DISPLAY },
  colon: { color: V.sub, fontSize: 20, fontWeight: 700 },
  savedTag: { marginTop: 10, fontSize: 12, color: V.good, fontWeight: 600 },
  lockedTag: { marginTop: 10, fontSize: 12, color: V.sub },
  liveTeams: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, fontWeight: 600, padding: "4px 0" },

  /* fun fact */
  factWrap: { display: "flex", gap: 8, marginTop: 12, padding: "9px 11px", background: V.panel2, borderRadius: 10, border: `1px solid ${V.line}` },
  factFlag: { fontSize: 18, lineHeight: 1.3, flexShrink: 0 },
  factText: { fontSize: 12, color: V.sub, lineHeight: 1.45 },
  /* venue */
  venueRow: { display: "flex", alignItems: "center", gap: 6, marginBottom: 10 },
  venueDot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  venueText: { fontSize: 11, color: V.sub, fontWeight: 600, letterSpacing: 0.2 },

  /* leaderboard */
  lbList: { display: "flex", flexDirection: "column", gap: 2 },
  lbRow: { display: "flex", alignItems: "center", gap: 10, padding: "12px 12px", borderRadius: 12, background: V.panel, border: `1px solid ${V.line}` },
  lbMe: { borderColor: V.gold, background: "rgba(255,200,61,.07)" },
  lbRank: (i) => ({ width: 28, height: 28, borderRadius: "50%", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13, flexShrink: 0,
    color: i < 3 ? "#04130b" : V.text, background: i === 0 ? V.gold : i === 1 ? "#C7CFDD" : i === 2 ? "#D08A4E" : V.panel2 }),
  lbName: { flex: 1, fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 7, minWidth: 0 },
  youTag: { fontSize: 10, fontWeight: 800, color: "#04130b", background: V.gold, borderRadius: 5, padding: "1px 6px" },
  lbStat: { color: V.sub, fontSize: 11, whiteSpace: "nowrap" },
  lbPts: { fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, minWidth: 42, textAlign: "right" },
  foot: { color: V.sub, fontSize: 12, marginTop: 12, lineHeight: 1.5 },

  /* my picks */
  pickRow: { display: "flex", alignItems: "center", gap: 12, background: V.panel, border: `1px solid ${V.line}`, borderRadius: 12, padding: "11px 13px", marginBottom: 8 },
  pickTeams: { fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  pickMeta: { color: V.sub, fontSize: 11, marginTop: 2 },
  pickScores: { textAlign: "center", minWidth: 64 },
  pickPred: { fontFamily: DISPLAY, fontWeight: 800, fontSize: 16 },
  pickActual: { color: V.sub, fontSize: 11, marginTop: 1 },
  pickPts: { fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, minWidth: 40, textAlign: "right" },

  /* admin */
  filterRow: { display: "flex", gap: 7, marginBottom: 12 },
  filterBtn: { background: V.panel, border: `1px solid ${V.line}`, color: V.sub, borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", textTransform: "capitalize" },
  filterOn: { background: V.accent, color: "#04130b", borderColor: V.accent },
  adminRow: { display: "flex", alignItems: "center", gap: 12, background: V.panel, border: `1px solid ${V.line}`, borderRadius: 12, padding: "10px 13px", marginBottom: 8 },

  /* results view */
  resCard: { background: V.panel, border: `1px solid ${V.line}`, borderRadius: 14, padding: 14, marginBottom: 8 },
  resTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  resPts: { fontFamily: DISPLAY, fontWeight: 800, fontSize: 13 },
  resScoreRow: { display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 10 },
  resTeam: { fontSize: 14, lineHeight: 1.2 },
  resScore: { fontFamily: DISPLAY, fontWeight: 800, fontSize: 22, whiteSpace: "nowrap" },
  resYourPick: { marginTop: 10, fontSize: 12, color: V.sub, borderTop: `1px solid ${V.line}`, paddingTop: 8 },

  /* bottom nav */
  bottom: { position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 20, background: "rgba(11,16,32,.92)", backdropFilter: "blur(12px)", borderTop: `1px solid ${V.line}`, display: "flex", justifyContent: "space-around", padding: "8px 0 calc(8px + env(safe-area-inset-bottom))", maxWidth: 560, margin: "0 auto" },
  navBtn: { display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: "none", border: "none", color: V.sub, fontSize: 10, fontWeight: 600, cursor: "pointer", padding: "4px 10px", borderRadius: 10, position: "relative", flex: 1 },
  navOn: { color: V.text },
  navIcon: { fontSize: 19 },

  toast: { position: "fixed", bottom: 86, left: "50%", transform: "translateX(-50%)", background: V.text, color: V.bg, padding: "10px 20px", borderRadius: 24, fontWeight: 700, fontSize: 13, zIndex: 60, boxShadow: "0 12px 30px rgba(0,0,0,.4)" },
};
