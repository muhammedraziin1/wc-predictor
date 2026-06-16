import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  NOW, factOf, flag, FIXTURES,
  SEEDED_RESULTS, scoreMatch, fmtKick, dayKey, countdown,
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
  paper: "#EFE7D6",      // album page
  paperDark: "#E4D8C0",  // page shadow / inset
  ink: "#1F1A14",        // printed text
  inkSoft: "#6B5F4E",    // muted print
  green: BRAND.green, blue: BRAND.blue, red: BRAND.red,
  foil: "#C9A227", foilLight: "#E8CC5E",
  sticker: "#FBF7EE",    // sticker face
  binding: "#23201B",    // dark album binding (top/bottom bars)
  bindingSoft: "#34302A",
  // aliases kept so older references resolve
  bg: "#EFE7D6", panel: "#FBF7EE", panel2: "#EAE0CC", line: "#D8CBB0", line2: "#C6B594",
  text: "#1F1A14", sub: "#6B5F4E", accent: BRAND.green, accent2: BRAND.blue, gold: "#C9A227",
  good: BRAND.green, live: BRAND.red,
};
const CSS = `
*{box-sizing:border-box;} body{margin:0;}
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@500;600;700;800;900&family=Archivo+Narrow:wght@600;700&display=swap');
.primary:hover{filter:brightness(1.05) saturate(1.1);}
.ghost:hover{filter:brightness(0.97);}
.num:focus,input:focus{outline:3px solid ${V.green};outline-offset:1px;}
.lbrow:hover{filter:brightness(0.98);cursor:pointer;}
.navbtn:active{transform:scale(.92);}
.menuitem:hover{background:${V.paperDark};}
.sticker{position:relative;}
.sticker::after{content:"";position:absolute;inset:0;border-radius:14px;pointer-events:none;
  background:linear-gradient(135deg,rgba(255,255,255,.55) 0%,rgba(255,255,255,0) 28%,rgba(255,255,255,0) 72%,rgba(255,255,255,.30) 100%);}
::-webkit-scrollbar{width:10px;height:10px;}
::-webkit-scrollbar-thumb{background:${V.line2};border-radius:8px;border:2px solid ${V.paper};}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.4;}}
@keyframes shine{0%{background-position:-120% 0;}100%{background-position:220% 0;}}
@media (prefers-reduced-motion: reduce){*{animation:none !important;}}
`;
// Condensed poster face for names/scores; clean grotesque for body.
const FONT = "Archivo, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const DISPLAY = "Anton, 'Archivo Narrow', " + FONT;
// reusable bits
const STICKER = { background: V.sticker, borderRadius: 14, border: `2px solid ${V.ink}`,
  boxShadow: `4px 5px 0 ${V.paperDark}, 0 1px 0 rgba(255,255,255,.8) inset` };
const PAGE_TEXTURE = "radial-gradient(circle at 50% 0%, rgba(255,255,255,.5), rgba(255,255,255,0) 60%), repeating-linear-gradient(0deg, rgba(0,0,0,.012) 0 2px, rgba(0,0,0,0) 2px 4px)";
const S = {
  page: { minHeight: "100vh", background: `${V.paper}`, backgroundImage: PAGE_TEXTURE, color: V.ink, fontFamily: FONT, paddingBottom: 84 },
  main: { maxWidth: 560, margin: "0 auto", padding: "16px 14px 24px" },
  col: { display: "flex", flexDirection: "column", gap: 26 },

  /* sign in */
  signWrap: { minHeight: "100vh", display: "grid", placeItems: "center", padding: 20,
    background: V.paper, backgroundImage: PAGE_TEXTURE, color: V.ink, fontFamily: FONT },
  signCard: { width: "100%", maxWidth: 390, ...STICKER, padding: 30, textAlign: "center", boxShadow: `7px 9px 0 ${V.ink}` },
  signCrest: { fontSize: 52, marginBottom: 4, filter: "saturate(1.2)" },
  signEyebrow: { color: V.red, fontSize: 12, fontWeight: 800, letterSpacing: 3, textTransform: "uppercase", fontFamily: FONT },
  signTitle: { fontFamily: DISPLAY, fontSize: 48, fontWeight: 400, margin: "0 0 6px", letterSpacing: 1, lineHeight: .92, textTransform: "uppercase", color: V.ink },
  signSub: { color: V.inkSoft, fontSize: 14, lineHeight: 1.5, margin: "0 0 22px", fontWeight: 500 },
  signInput: { width: "100%", background: "#fff", border: `2px solid ${V.ink}`, color: V.ink, borderRadius: 10, padding: "13px 14px", fontSize: 16, textAlign: "center", marginBottom: 10, fontWeight: 600, fontFamily: FONT },
  fieldLabel: { display: "block", textAlign: "left", color: V.inkSoft, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.2, margin: "2px 2px 6px" },
  signErr: { background: "rgba(230,29,37,.12)", border: `2px solid ${V.red}`, color: "#a8131a", fontSize: 13, fontWeight: 700, borderRadius: 9, padding: "9px 12px", marginBottom: 10 },
  signInfo: { background: "rgba(60,172,59,.14)", border: `2px solid ${V.green}`, color: "#256b24", fontSize: 13, fontWeight: 700, borderRadius: 9, padding: "9px 12px", marginBottom: 10 },
  authTabs: { display: "flex", gap: 6, marginBottom: 20 },
  authTab: { flex: 1, background: V.paperDark, border: `2px solid ${V.ink}`, color: V.inkSoft, fontSize: 14, fontWeight: 800, padding: "10px 0", borderRadius: 9, cursor: "pointer", textTransform: "uppercase", letterSpacing: .5, fontFamily: FONT },
  authTabOn: { background: V.green, color: "#fff" },
  rememberRow: { display: "flex", alignItems: "center", gap: 8, color: V.inkSoft, fontSize: 13, marginBottom: 14, cursor: "pointer", justifyContent: "flex-start", fontWeight: 600 },
  signBtn: { width: "100%", background: V.green, color: "#fff", border: `2px solid ${V.ink}`, borderRadius: 10, padding: "15px", fontWeight: 800, fontSize: 16, cursor: "pointer", textTransform: "uppercase", letterSpacing: 1, fontFamily: FONT, boxShadow: `3px 4px 0 ${V.ink}` },
  signReturn: { marginTop: 18, paddingTop: 16, borderTop: `2px dashed ${V.line2}` },
  chipWrap: { display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "center", marginTop: 8 },
  returnChip: { background: V.paperDark, border: `2px solid ${V.ink}`, color: V.ink, borderRadius: 20, padding: "6px 14px", fontSize: 13, cursor: "pointer", fontWeight: 700 },
  signFoot: { color: V.inkSoft, fontSize: 11, marginTop: 18, marginBottom: 0, lineHeight: 1.5, fontWeight: 500 },

  /* top bar — album binding */
  top: { position: "sticky", top: 0, zIndex: 20, background: V.binding, borderBottom: `3px solid ${V.foil}` },
  topInner: { maxWidth: 560, margin: "0 auto", padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" },
  topBrand: { display: "flex", alignItems: "center", gap: 10 },
  topCrest: { fontSize: 26 },
  topTitle: { fontFamily: DISPLAY, fontWeight: 400, fontSize: 20, letterSpacing: .5, color: "#fff", textTransform: "uppercase", lineHeight: 1 },
  topSub: { color: "#c9bda4", fontSize: 12, fontWeight: 600 },
  topRight: { display: "flex", alignItems: "center", gap: 8, position: "relative" },
  rankPill: { display: "flex", alignItems: "center", gap: 4, background: V.foil, border: `2px solid ${V.ink}`, borderRadius: 8, padding: "5px 11px", fontSize: 14, color: V.ink, fontWeight: 800 },
  rankDot: { color: V.ink, margin: "0 2px", opacity: .5 },
  gear: { background: V.bindingSoft, border: `2px solid ${V.foil}`, color: "#fff", borderRadius: 8, width: 36, height: 36, fontSize: 18, cursor: "pointer", lineHeight: 1 },
  menu: { position: "absolute", top: 44, right: 0, background: V.sticker, border: `2px solid ${V.ink}`, borderRadius: 10, padding: 6, minWidth: 210, boxShadow: `5px 6px 0 ${V.ink}`, zIndex: 30 },
  menuItem: { display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: V.ink, padding: "10px 12px", borderRadius: 7, fontSize: 13, cursor: "pointer", fontWeight: 600 },

  /* sections */
  sectionHead: { display: "flex", alignItems: "center", gap: 10, fontFamily: DISPLAY, fontWeight: 400, fontSize: 28, marginBottom: 14, letterSpacing: .5, textTransform: "uppercase", color: V.ink, lineHeight: 1 },
  badge: { background: V.red, color: "#fff", fontSize: 11, fontWeight: 800, padding: "4px 10px", borderRadius: 20, border: `2px solid ${V.ink}`, textTransform: "uppercase", letterSpacing: .5 },
  lockBadge: { background: V.paperDark, color: V.inkSoft, fontSize: 11, fontWeight: 800, padding: "4px 10px", borderRadius: 20, border: `2px solid ${V.line2}`, textTransform: "uppercase", letterSpacing: .5 },
  previewCard: { display: "flex", alignItems: "center", gap: 10, background: V.paperDark, border: `2px dashed ${V.line2}`, borderRadius: 12, padding: "11px 13px", marginBottom: 9, opacity: .85 },
  previewTeams: { flex: 1, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: V.ink },
  previewTime: { fontSize: 12, color: V.inkSoft, whiteSpace: "nowrap", fontWeight: 600 },
  liveDot: { width: 9, height: 9, borderRadius: "50%", background: V.red, animation: "pulse 1.4s infinite" },
  dayLabel: { color: V.inkSoft, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.5, margin: "18px 0 10px" },
  empty: { color: V.inkSoft, fontSize: 14, textAlign: "center", padding: "28px 0", fontWeight: 600 },

  /* match card — the sticker */
  mCard: { ...STICKER, padding: 15, marginBottom: 13, position: "relative" },
  mCardDone: { boxShadow: `4px 5px 0 ${V.green}, 0 1px 0 rgba(255,255,255,.8) inset`, borderColor: V.green },
  mTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  grpTag: { fontFamily: DISPLAY, fontSize: 14, fontWeight: 400, color: "#fff", background: V.blue, padding: "3px 10px 2px", borderRadius: 6, border: `2px solid ${V.ink}`, textTransform: "uppercase", letterSpacing: .5 },
  kick: { fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: .5 },
  mTeams: { display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8 },
  teamCell: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, background: "none", border: "2px solid transparent", borderRadius: 12, padding: "8px 6px", minWidth: 0 },
  teamWin: { background: "rgba(60,172,59,.14)", borderColor: V.green },
  flag: { fontSize: 40, lineHeight: 1, filter: "drop-shadow(1px 1px 0 rgba(0,0,0,.15))" },
  teamLbl: { fontFamily: DISPLAY, fontWeight: 400, fontSize: 16, lineHeight: 1, color: V.ink, textTransform: "uppercase", textAlign: "center", letterSpacing: .3 },
  scoreBox: { display: "flex", alignItems: "center", gap: 6 },
  scoreInput: { width: 48, height: 56, textAlign: "center", background: "#fff", border: `2px solid ${V.ink}`, color: V.ink, borderRadius: 10, fontSize: 28, fontWeight: 400, fontFamily: DISPLAY },
  colon: { color: V.inkSoft, fontSize: 22, fontWeight: 800 },
  savedTag: { marginTop: 11, fontSize: 12, color: "#256b24", fontWeight: 700, textAlign: "center" },
  lockedTag: { marginTop: 11, fontSize: 12, color: V.inkSoft, fontWeight: 600, textAlign: "center" },
  liveTeams: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 15, fontWeight: 700, padding: "4px 0", fontFamily: DISPLAY, textTransform: "uppercase", letterSpacing: .3 },

  /* fun fact */
  factWrap: { display: "flex", gap: 9, marginTop: 13, padding: "10px 12px", background: V.paperDark, borderRadius: 9, border: `2px dashed ${V.line2}` },
  factFlag: { fontSize: 20, lineHeight: 1.3, flexShrink: 0 },
  factText: { fontSize: 12, color: V.inkSoft, lineHeight: 1.45, fontWeight: 500 },
  /* venue */
  venueRow: { display: "flex", alignItems: "center", gap: 6, marginBottom: 12 },
  venueDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0, border: `1px solid ${V.ink}` },
  venueText: { fontSize: 11, color: V.inkSoft, fontWeight: 800, letterSpacing: .8, textTransform: "uppercase" },

  /* leaderboard */
  lbList: { display: "flex", flexDirection: "column", gap: 9 },
  lbRow: { display: "flex", alignItems: "center", gap: 11, padding: "12px 13px", borderRadius: 12, ...STICKER },
  lbMe: { boxShadow: `4px 5px 0 ${V.foil}, 0 1px 0 rgba(255,255,255,.8) inset`, borderColor: V.foil },
  lbRank: (i) => ({ width: 34, height: 34, borderRadius: "50%", display: "grid", placeItems: "center", fontWeight: 400, fontSize: 17, flexShrink: 0, fontFamily: DISPLAY, border: `2px solid ${V.ink}`,
    color: i < 3 ? V.ink : "#fff", background: i === 0 ? V.foil : i === 1 ? "#C7C2B6" : i === 2 ? "#CD7F32" : V.inkSoft }),
  lbName: { flex: 1, fontFamily: DISPLAY, fontWeight: 400, fontSize: 20, display: "flex", alignItems: "center", gap: 8, minWidth: 0, textTransform: "uppercase", letterSpacing: .3, color: V.ink },
  youTag: { fontSize: 10, fontWeight: 800, color: "#fff", background: V.red, borderRadius: 5, padding: "2px 7px", border: `1.5px solid ${V.ink}`, letterSpacing: .5 },
  lbStat: { color: V.inkSoft, fontSize: 11, whiteSpace: "nowrap", fontWeight: 700 },
  lbPts: { fontFamily: DISPLAY, fontWeight: 400, fontSize: 28, minWidth: 44, textAlign: "right", color: V.ink },
  foot: { color: V.inkSoft, fontSize: 12, marginTop: 14, lineHeight: 1.5, fontWeight: 500 },

  /* my picks */
  pickRow: { display: "flex", alignItems: "center", gap: 12, ...STICKER, padding: "12px 14px", marginBottom: 9 },
  pickTeams: { fontFamily: DISPLAY, fontWeight: 400, fontSize: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textTransform: "uppercase", letterSpacing: .3, color: V.ink },
  pickMeta: { color: V.inkSoft, fontSize: 11, marginTop: 3, fontWeight: 600 },
  pickScores: { textAlign: "center", minWidth: 64 },
  pickPred: { fontFamily: DISPLAY, fontWeight: 400, fontSize: 22, color: V.ink },
  pickActual: { color: V.inkSoft, fontSize: 11, marginTop: 1, fontWeight: 600 },
  pickPts: { fontFamily: DISPLAY, fontWeight: 400, fontSize: 24, minWidth: 44, textAlign: "right" },

  /* admin */
  filterRow: { display: "flex", gap: 7, marginBottom: 14 },
  filterBtn: { background: V.sticker, border: `2px solid ${V.ink}`, color: V.inkSoft, borderRadius: 20, padding: "7px 15px", fontSize: 12, fontWeight: 800, cursor: "pointer", textTransform: "uppercase", letterSpacing: .5 },
  filterOn: { background: V.green, color: "#fff" },
  adminRow: { display: "flex", alignItems: "center", gap: 12, ...STICKER, padding: "11px 14px", marginBottom: 9 },

  /* results view */
  resCard: { ...STICKER, padding: 15, marginBottom: 11 },
  resTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  resPts: { fontFamily: DISPLAY, fontWeight: 400, fontSize: 18 },
  resScoreRow: { display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 10 },
  resTeam: { fontFamily: DISPLAY, fontSize: 16, lineHeight: 1, textTransform: "uppercase", letterSpacing: .3 },
  resScore: { fontFamily: DISPLAY, fontWeight: 400, fontSize: 32, whiteSpace: "nowrap", color: V.ink },
  resYourPick: { marginTop: 12, fontSize: 12, color: V.inkSoft, borderTop: `2px dashed ${V.line2}`, paddingTop: 9, fontWeight: 600 },

  /* bottom nav — album binding */
  bottom: { position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 20, background: V.binding, borderTop: `3px solid ${V.foil}`, display: "flex", justifyContent: "space-around", padding: "9px 0 calc(9px + env(safe-area-inset-bottom))", maxWidth: 560, margin: "0 auto" },
  navBtn: { display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: "none", border: "none", color: "#c9bda4", fontSize: 10, fontWeight: 800, cursor: "pointer", padding: "4px 10px", borderRadius: 9, position: "relative", flex: 1, textTransform: "uppercase", letterSpacing: .5 },
  navOn: { color: "#fff" },
  navIcon: { fontSize: 20 },

  toast: { position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", background: V.ink, color: V.sticker, padding: "11px 22px", borderRadius: 10, fontWeight: 800, fontSize: 13, zIndex: 60, boxShadow: `4px 5px 0 ${V.foil}`, border: `2px solid ${V.foil}`, textTransform: "uppercase", letterSpacing: .5 },
};
