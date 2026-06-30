import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  factOf, flag, FIXTURES,
  SEEDED_RESULTS, scoreMatch, fmtKick, fmtKickIST, fmtTimeIST, dayKey, countdown, lockTime, openTime,
  STAGE_LABEL, STAGE_ORDER, isKnockout, normalizeDbFixture,
} from "./data.js";
import {
  signUp, signIn, signOut as dbSignOut, getMe, ensureProfile, onAuthChange, renameProfile,
  amIOrganizer, getPlayers, getPredictions, savePrediction, getResults, saveResult, getLeaderboard, getAdminPlayers,
  requestPasswordReset, updatePassword, getFixtures, getPredictionStats, isAllowedEmail, ALLOWED_DOMAIN,
  getScorers,
} from "./db.js";
import { supabaseConfigured } from "./supabase.js";
import { BracketView, ScorersView } from "./Bracket.jsx";

// Responsive breakpoints (match the mockup): desktop ≥1200 has the rail,
// 920–1200 has sidebar+content, <920 is the mobile shell.
function useViewport() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return { w, isMobile: w < 920, isMedium: w >= 920 && w < 1200, isWide: w >= 1200, isDesktop: w >= 920 };
}

/* ====================================================================== */
export default function App() {
  const [me, setMe] = useState(null);              // {id,name,email}
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [players, setPlayers] = useState([]);      // [{id,name}]
  const [leaderboard, setLeaderboard] = useState([]); // server-computed: [{id,name,total,exact,made}]
  const [predictions, setPredictions] = useState({}); // {uid:{mid:{h,a}}}
  const [results, setResults] = useState({});      // {mid:{h,a,adv?}}
  const [koFixtures, setKoFixtures] = useState([]); // dynamic knockout fixtures from DB
  const [scorers, setScorers] = useState([]);       // golden-boot top scorers from DB
  const [view, setView] = useState("matches");
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState("");
  const [adminMode, setAdminMode] = useState(false);
  const [recovery, setRecovery] = useState(false); // true after clicking reset-email link

  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 30000); return () => clearInterval(t); }, []);

  const refresh = useCallback(async () => {
    try {
      const [pl, pr, rs, fx, lb, sc] = await Promise.all([getPlayers(), getPredictions(), getResults(), getFixtures(), getLeaderboard(), getScorers()]);
      setPlayers(pl); setPredictions(pr); setResults(rs); setKoFixtures(fx); setLeaderboard(lb); setScorers(sc);
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

  // Change display name: persists via db (own-row only, unique-enforced),
  // updates local state, and refreshes the leaderboard so the new name shows.
  const handleRename = async (newName) => {
    const res = await renameProfile(newName);
    if (res?.name) {
      setMe((m) => (m ? { ...m, name: res.name } : m));
      flash("Name updated");
      refresh();
    }
    return res;
  };

  const setPred = async (mid, side, val) => {
    if (!me) return;
    const clean = val === "" ? "" : Math.max(0, Math.min(20, parseInt(val, 10) || 0));
    const prev = predictions[me.id]?.[mid] || {};
    const nextCell = { ...prev, [side]: clean };
    setPredictions((p) => ({ ...p, [me.id]: { ...p[me.id], [mid]: nextCell } })); // optimistic
    if (nextCell.h !== "" && nextCell.a !== "" && nextCell.h != null && nextCell.a != null) {
      try { await savePrediction(me.id, mid, nextCell.h, nextCell.a, nextCell.adv ?? null); }
      catch (e) { console.error("savePrediction failed", e); flash("Save failed — check connection"); }
    }
  };

  // KO penalty-winner pick. Only meaningful when the user predicted a level score;
  // stored in adv_pick and used by the leaderboard RPC for the advancement point.
  const setAdv = async (mid, advVal) => {
    if (!me) return;
    const prev = predictions[me.id]?.[mid] || {};
    const nextCell = { ...prev, adv: advVal };
    setPredictions((p) => ({ ...p, [me.id]: { ...p[me.id], [mid]: nextCell } })); // optimistic
    if (nextCell.h !== "" && nextCell.a !== "" && nextCell.h != null && nextCell.a != null) {
      try { await savePrediction(me.id, mid, nextCell.h, nextCell.a, advVal); }
      catch (e) { console.error("saveAdv failed", e); flash("Save failed — check connection"); }
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
  const allFixtures = useMemo(
    () => [...FIXTURES, ...koFixtures.map(normalizeDbFixture)].sort((a, b) => a.kickoff - b.kickoff),
    [koFixtures]
  );
  const enriched = useMemo(() => {
    const now = new Date();   // live time, recomputed every tick (NOT the frozen module NOW)
    return allFixtures.map((f) => {
    const r = effectiveResults[f.id];
    const settled = r && r.h !== "" && r.a !== "" && r.h != null && r.a != null;
    const kickedOff = now >= f.kickoff;
    const lock = lockTime(f.kickoff);          // 9 PM IST cutoff for this match
    const opens = openTime(f.kickoff);         // 12 AM IST on the lock's day
    const msToLock = lock - now;
    // Open from midnight IST of the lock's day until the 9 PM IST lock. Before
    // that midnight it's "future" (not yet open); after the lock it's locked.
    const open = now >= opens && msToLock > 0 && !settled;
    const future = now < opens && !settled;
    const locked = !open;
    const ko = isKnockout(f.stage);
    return { ...f, ko, lock, opens, msToLock, settled, kickedOff, future, open, locked, result: settled ? r : null };
  });
  }, [allFixtures, effectiveResults, tick]);

  const upcoming = useMemo(() => enriched.filter((f) => f.open), [enriched]);
  const futureLocked = useMemo(() => enriched.filter((f) => f.future && !f.settled), [enriched]);
  // Locked but not yet settled: past the 9 PM cutoff, awaiting kickoff OR in progress.
  // These stay visible (with the user's frozen pick) instead of vanishing.
  const lockedPending = useMemo(
    () => enriched.filter((f) => f.locked && !f.future && !f.settled).sort((a, b) => a.kickoff - b.kickoff),
    [enriched]
  );
  const live = useMemo(() => enriched.filter((f) => f.kickedOff && !f.settled), [enriched]);
  const finished = useMemo(() => enriched.filter((f) => f.settled).reverse(), [enriched]);

  // leaderboard is server-computed (see getLeaderboard / secure_predictions.sql);
  // raw predictions of other users never reach the client.
  const myRank = me ? leaderboard.findIndex((r) => r.id === me.id) + 1 : 0;
  const myRow = me ? leaderboard.find((r) => r.id === me.id) : null;

  // Hooks must run on every render in the same order — keep this ABOVE the
  // early returns below, or React crashes when the guards change post-login.
  const vp = useViewport();

  if (!supabaseConfigured) return <Splash text="⚠ Supabase not configured. Copy .env.example to .env and add your project URL and anon key, then restart the dev server." />;
  if (recovery) return <RecoveryScreen onDone={async () => { setRecovery(false); await loadSession(); }} flash={flash} />;
  if (!loaded) return <Splash text="Loading…" />;
  if (!me) return <AuthScreen onAuthed={loadSession} flash={flash} />;

  const showRail = false; // leaderboard rail removed from matches; it has its own tab

  const content = (
    <>
      {view === "matches" && (
        <MatchesView upcoming={upcoming} live={live} futureLocked={futureLocked}
          lockedPending={lockedPending} me={me} predictions={predictions} setPred={setPred} setAdv={setAdv} desktop={vp.isDesktop} />
      )}
      {view === "leaderboard" && <LeaderboardView leaderboard={leaderboard} me={me} fullPage={vp.isDesktop} />}
      {view === "results" && (
        <ResultsView finished={finished} me={me} predictions={predictions} desktop={vp.isDesktop} />
      )}
      {view === "mypicks" && (
        <MyPicksView enriched={enriched} me={me} predictions={predictions} desktop={vp.isDesktop} />
      )}
      {view === "bracket" && <BracketView koFixtures={koFixtures} results={effectiveResults} />}
      {view === "scorers" && <ScorersView scorers={scorers} />}
      {view === "admin" && adminMode && isOrganizer && (
        <AdminView enriched={enriched} results={effectiveResults} setResult={setResultVal} />
      )}
    </>
  );

  if (vp.isDesktop) {
    return (
      <div style={S.page}>
        <style>{CSS}</style>
        <div style={{ ...S.shell, gridTemplateColumns: showRail ? "248px 1fr 320px" : "248px 1fr" }}>
          <Sidebar me={me} myRank={myRank} myPts={myRow?.total ?? 0} total={leaderboard.length}
            view={view} setView={setView} signOut={signOut} liveCount={live.length}
            adminMode={adminMode} setAdminMode={setAdminMode} isOrganizer={isOrganizer} onRename={handleRename} />
          <main style={S.deskMain}>{content}</main>
          {showRail && <LeaderboardRail leaderboard={leaderboard} me={me} myRank={myRank} />}
        </div>
        {toast && <div style={S.toast}>{toast}</div>}
      </div>
    );
  }

  // mobile (unchanged experience)
  return (
    <div style={S.page}>
      <style>{CSS}</style>
      <TopBar me={me} myRank={myRank} myPts={myRow?.total ?? 0} total={leaderboard.length}
        view={view} setView={setView} signOut={signOut}
        adminMode={adminMode} setAdminMode={setAdminMode} isOrganizer={isOrganizer} onRename={handleRename} />
      <main style={S.main}>{content}</main>
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
        // Login never touches the display name — the profile already exists from
        // signup. (Passing the form's name here previously overwrote real names.)
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
      <div style={S.signSplit}>
        {/* LEFT: the form */}
        <div style={S.signCard} className="signsplit-card">
          <div style={S.signCrest}>⚽</div>
          <div style={S.signEyebrow}>FIFA World Cup 2026</div>
          <h1 style={S.signTitle}>Mozilor FanZone</h1>

          <div style={S.authTabs}>
            <button className="ghost" style={{ ...S.authTab, ...(tab === "login" ? S.authTabOn : {}) }}
              onClick={() => { setTab("login"); setErr(""); setInfo(""); setName(""); }}>Log in</button>
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

          <label style={S.fieldLabel}>Email{tab === "signup" ? ` (@${ALLOWED_DOMAIN} only)` : ""}</label>
          <input value={email} type="email" autoComplete="email"
            onChange={(e) => { setEmail(e.target.value); setErr(""); }}
            placeholder={tab === "signup" ? `you@${ALLOWED_DOMAIN}` : "you@example.com"} style={S.signInput} />

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

        {/* RIGHT: rotating World Cup facts (desktop only) */}
        <FactPanel />
      </div>
    </div>
  );
}

const WC_FACTS = [
  { stat: "1930", text: "The first FIFA World Cup was held in Uruguay, who won it on home soil." },
  { stat: "48", text: "2026 is the first World Cup with 48 teams, expanded from 32." },
  { stat: "3", text: "2026 is the first World Cup hosted by three nations: USA, Canada and Mexico." },
  { stat: "5", text: "Brazil hold the record with five World Cup titles." },
  { stat: "104", text: "A record 104 matches will be played across the 2026 tournament." },
  { stat: "13", text: "Just Fontaine scored 13 goals at the 1958 World Cup, still a single-tournament record." },
  { stat: "16", text: "Sixteen cities across North America will host matches in 2026." },
  { stat: "1950", text: "The famous 'Maracanazo': Uruguay stunned Brazil in front of ~200,000 fans." },
];

function FactPanel() {
  const [i, setI] = useState(() => Math.floor(Math.random() * WC_FACTS.length));
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % WC_FACTS.length), 5000);
    return () => clearInterval(t);
  }, []);
  const f = WC_FACTS[i];
  return (
    <div style={S.factPanel} className="factpanel">
      <div style={S.factEyebrow}>Did you know?</div>
      <div key={i} style={S.factCard} className="factfade">
        <div style={S.factStat}>{f.stat}</div>
        <div style={S.factText}>{f.text}</div>
      </div>
      <div style={S.factDots}>
        {WC_FACTS.map((_, n) => (
          <span key={n} style={{ ...S.factDot, ...(n === i ? S.factDotOn : {}) }} />
        ))}
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

/* ---- Desktop sidebar nav ---- */
// Inline display-name editor for the sidebar. Shows current name with an Edit
// affordance; expands to an input that saves via onRename (which calls the
// uniqueness-enforcing db.renameProfile and updates app state on success).
function NameEditor({ me, onRename }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(me?.name || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const start = () => { setVal(me?.name || ""); setErr(""); setEditing(true); };
  const cancel = () => { setEditing(false); setErr(""); };
  const save = async () => {
    const next = val.trim();
    if (next === (me?.name || "")) { setEditing(false); return; }
    setBusy(true); setErr("");
    const res = await onRename(next);
    setBusy(false);
    if (res?.error) { setErr(res.error); return; }
    setEditing(false);
  };

  if (!editing) {
    return (
      <div style={S.nameRow}>
        <div style={S.nameWrap}>
          <div style={S.nameLabel}>Signed in as</div>
          <div style={S.nameValue}>{me?.name}</div>
        </div>
        <button className="ghost" style={S.nameEditBtn} onClick={start}>Edit</button>
      </div>
    );
  }
  return (
    <div style={S.nameEdit}>
      <div style={S.nameLabel}>Display name</div>
      <input value={val} maxLength={24} autoFocus
        onChange={(e) => { setVal(e.target.value); setErr(""); }}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
        style={S.nameInput} />
      {err && <div style={S.nameErr}>{err}</div>}
      <div style={S.nameBtns}>
        <button className="ghost" style={S.nameCancel} onClick={cancel} disabled={busy}>Cancel</button>
        <button className="primary" style={{ ...S.nameSave, opacity: busy ? 0.6 : 1 }} onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Sidebar({ me, myRank, myPts, total, view, setView, signOut, liveCount, adminMode, setAdminMode, isOrganizer, onRename }) {
  const items = [
    { key: "matches", icon: "⚽", label: "Matches", badge: liveCount > 0 ? liveCount : null },
    { key: "results", icon: "📋", label: "Results" },
    { key: "mypicks", icon: "🎯", label: "My picks" },
    { key: "leaderboard", icon: "🏆", label: "Leaderboard" },
    { key: "bracket", icon: "🗺️", label: "Bracket" },
    { key: "scorers", icon: "👟", label: "Golden Boot" },
  ];
  if (adminMode && isOrganizer) items.push({ key: "admin", icon: "🛠", label: "Enter results" });
  return (
    <aside style={S.sidebar}>
      <div style={S.sbBrand}>
        <span style={S.sbCrest}>⚽</span>
        <div><div style={S.sbTitle}>Mozilor FanZone</div><div style={S.sbSub}>FIFA World Cup 2026</div></div>
      </div>
      <nav style={S.sbNav}>
        {items.map((it) => (
          <button key={it.key} className={`sidenav${view === it.key ? " sidenav-on" : ""}`}
            style={{ ...S.sbItem, ...(view === it.key ? S.sbItemOn : {}) }}
            onClick={() => setView(it.key)}>
            <span style={S.sbIcon}>{it.icon}</span> {it.label}
            {it.badge != null && <span style={S.sbBadge}>{it.badge}</span>}
          </button>
        ))}
      </nav>
      <div style={S.sbFoot}>
        <NameEditor me={me} onRename={onRename} />
        <div style={S.sbRankCard}>
          <div style={S.sbRankLabel}>Your standing</div>
          <div style={S.sbRankBig}><span style={S.sbRankPos}>#{myRank || "—"}</span><span style={S.sbRankOf}>of {total}</span></div>
          <div style={S.sbRankPts}>{myPts} pts</div>
        </div>
        {isOrganizer && (
          <button className="ghost" style={S.sbSecondary} onClick={() => setAdminMode((a) => !a)}>
            {adminMode ? "Hide organizer tools" : "Organizer tools"}
          </button>
        )}
        <button className="ghost" style={S.sbSecondary} onClick={signOut}>Log out</button>
      </div>
    </aside>
  );
}

/* ---- Desktop right rail: compact leaderboard, top 5 + gap + neighbors ---- */
function LeaderboardRail({ leaderboard, me, myRank }) {
  // top 5, then if I'm outside it, a gap + (above / me / below)
  const top = leaderboard.slice(0, 5);
  let neighbors = [];
  const myIdx = leaderboard.findIndex((r) => r.id === me?.id);
  if (myIdx >= 5) {
    neighbors = leaderboard.slice(Math.max(5, myIdx - 1), myIdx + 2);
  }
  const Row = (r, i) => (
    <div key={r.id} className="lbrow" style={{ ...S.railRow, ...(r.id === me?.id ? S.railRowMe : {}) }}>
      <div style={S.railRank(i)}>{i + 1}</div>
      <div style={S.railName}>{r.name}{r.id === me?.id && <span style={S.youTag}>YOU</span>}</div>
      <div style={S.railPts}>{r.total}</div>
    </div>
  );
  return (
    <aside style={S.rail}>
      <div style={S.railHead}>🏆 Live leaderboard</div>
      {top.map((r, i) => Row(r, i))}
      {neighbors.length > 0 && (
        <>
          <div style={S.railGap}>· · ·</div>
          {neighbors.map((r) => Row(r, leaderboard.indexOf(r)))}
        </>
      )}
    </aside>
  );
}

function TopBar({ me, myRank, myPts, total, signOut, adminMode, setAdminMode, isOrganizer, onRename }) {
  const [menu, setMenu] = useState(false);
  const [editingName, setEditingName] = useState(false);
  return (
    <header style={S.top}>
      <div style={S.topInner}>
        <div style={S.topBrand}>
          <span style={S.topCrest}>⚽</span>
          <div>
            <div style={S.topTitle}>Mozilor FanZone</div>
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
          <button className="ghost" style={S.gear} onClick={() => { setMenu((m) => !m); setEditingName(false); }}>⋯</button>
          {menu && (
            <div style={S.menu} onMouseLeave={() => { setMenu(false); setEditingName(false); }}>
              {editingName ? (
                <div style={{ padding: 6 }}>
                  <NameEditor me={me} onRename={async (n) => {
                    const res = await onRename(n);
                    if (res?.name) { setEditingName(false); setMenu(false); }
                    return res;
                  }} />
                </div>
              ) : (
                <button className="menuitem" style={S.menuItem} onClick={() => setEditingName(true)}>Edit display name</button>
              )}
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

// Match tag: "Group H" for group matches, the round name for knockouts.
function tagOf(m) {
  return m.ko ? (STAGE_LABEL[m.stage] || m.stage) : `Group ${m.group}`;
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

function PredictCard({ m, pred, setPred, setAdv, locked }) {
  const has = pred && pred.h !== "" && pred.a !== "" && pred.h != null && pred.a != null;
  const winner = has ? (+pred.h > +pred.a ? "home" : +pred.h < +pred.a ? "away" : "draw") : null;
  const needsAdv = m.ko && has && winner === "draw"; // KO + level => who advances on penalties
  const lockMs = m.lock - Date.now();
  const soon = lockMs > 0 && lockMs < 3.6e6 * 3; // predictions close within 3h
  return (
    <div style={{ ...S.mCard, ...(has ? S.mCardDone : {}), borderLeft: `3px solid ${m.accent}` }}>
      <div style={S.mTop}>
        <span style={S.grpTag}>{tagOf(m)}</span>
        <span style={{ ...S.kick, color: soon ? V.red : V.sub }}>{fmtKickIST(m.kickoff)}</span>
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

      {needsAdv && (
        <div style={S.advRow}>
          <span style={{ ...S.advLabel, color: pred.adv ? V.sub : V.amber }}>
            Level after extra time — who advances on penalties?
          </span>
          <div style={S.advBtns}>
            <button type="button" disabled={locked} onClick={() => setAdv(m.id, "home")}
              style={{ ...S.advBtn, ...(pred.adv === "home" ? S.advBtnOn : {}) }}>
              <span style={S.flag}>{flag(m.home)}</span> {m.home}
            </button>
            <button type="button" disabled={locked} onClick={() => setAdv(m.id, "away")}
              style={{ ...S.advBtn, ...(pred.adv === "away" ? S.advBtnOn : {}) }}>
              <span style={S.flag}>{flag(m.away)}</span> {m.away}
            </button>
          </div>
        </div>
      )}
      {has && !locked && <div style={S.savedTag}>✓ Pick saved · {pred.h}-{pred.a}{needsAdv ? (pred.adv ? ` · ${pred.adv === "home" ? m.home : m.away} on pens` : " · pick a penalty winner") : ""} · edit until {fmtKickIST(m.lock)}</div>}
      {!has && !locked && <div style={S.lockedTag}>Predictions close {fmtKickIST(m.lock)}</div>}
      {locked && <div style={S.lockedTag}>🔒 Predictions closed</div>}
    </div>
  );
}

function MatchesView({ upcoming, live, futureLocked, lockedPending, me, predictions, setPred, setAdv, desktop }) {
  const myPreds = predictions[me.id] || {};
  const hasPick = (m) => { const p = myPreds[m.id]; return p && p.h !== "" && p.a !== "" && p.h != null && p.a != null; };
  const unpicked = upcoming.filter((m) => !hasPick(m)).length;
  const gridStyle = desktop ? S.grid : undefined;

  // group the next locked future matches by day (show just the next day or two)
  const futureByDay = [];
  let cur = null;
  futureLocked.forEach((m) => {
    const k = dayKey(m.kickoff);
    if (!cur || cur.k !== k) { cur = { k, items: [] }; futureByDay.push(cur); }
    cur.items.push(m);
  });
  const nextDays = futureByDay.slice(0, 2);

  const nothingToShow = upcoming.length === 0 && lockedPending.length === 0 && nextDays.length === 0;

  return (
    <div style={S.col}>
      {upcoming.length > 0 && (
        <section>
          <div style={S.sectionHead}>
            Open to predict
            {unpicked > 0 && <span style={S.badge}>{unpicked} to predict</span>}
          </div>
          <div style={S.dayLabel}>Matches open until tonight's 9 PM IST cutoff</div>
          <div style={gridStyle}>
            {upcoming.map((m) => (
              <PredictCard key={m.id} m={m} pred={myPreds[m.id]} setPred={setPred} setAdv={setAdv} locked={false} />
            ))}
          </div>
        </section>
      )}

      {lockedPending.length > 0 && (
        <section>
          <div style={S.sectionHead}>Locked / awaiting kickoff <span style={S.lockBadge}>🔒 closed</span></div>
          <div style={gridStyle}>
          {lockedPending.map((m) => {
            const has = hasPick(m); const p = myPreds[m.id];
            const inProgress = m.kickedOff;
            return (
              <div key={m.id} style={{ ...S.mCard, opacity: 0.92, borderLeft: `3px solid ${m.accent}` }}>
                <div style={S.mTop}>
                  <span style={S.grpTag}>{tagOf(m)}</span>
                  {inProgress
                    ? <span style={{ ...S.kick, color: V.live, display: "flex", alignItems: "center", gap: 6 }}><span style={S.liveDot} /> in progress</span>
                    : <span style={S.kick}>{fmtKickIST(m.kickoff)}</span>}
                </div>
                <div style={S.venueRow}><span style={{ ...S.venueDot, background: m.accent }} /><span style={S.venueText}>{m.city}{m.country ? `, ${m.country}` : ""}</span></div>
                <div style={S.mTeams}>
                  <div style={S.teamCell}><span style={S.flag}>{flag(m.home)}</span><span style={S.teamLbl}>{m.home}</span></div>
                  <div style={S.scoreBox}>
                    <div style={{ ...S.scoreInput, display: "grid", placeItems: "center", color: has ? V.text : V.sub }}>{has ? p.h : "–"}</div>
                    <span style={S.colon}>:</span>
                    <div style={{ ...S.scoreInput, display: "grid", placeItems: "center", color: has ? V.text : V.sub }}>{has ? p.a : "–"}</div>
                  </div>
                  <div style={S.teamCell}><span style={S.flag}>{flag(m.away)}</span><span style={S.teamLbl}>{m.away}</span></div>
                </div>
                <div style={S.lockedTag}>
                  {has
                    ? `🔒 Your locked pick: ${p.h}-${p.a}${inProgress ? " · scores from the final result" : " · awaiting kickoff"}`
                    : "No pick locked in for this match"}
                </div>
              </div>
            );
          })}
          </div>
        </section>
      )}

      {nextDays.length > 0 && (
        <section>
          <div style={S.sectionHead}>Coming up <span style={S.lockBadge}>🔒 opens on the day</span></div>
          {nextDays.map((day) => (
            <div key={day.k}>
              <div style={S.dayLabel}>{day.k}</div>
              {day.items.map((m) => (
                <div key={m.id} style={{ ...S.previewCard, borderLeft: `3px solid ${m.accent}` }}>
                  <span style={S.grpTag}>{tagOf(m)}</span>
                  <span style={S.previewTeams}>{flag(m.home)} {m.home} <span style={{ color: V.sub }}>v</span> {m.away} {flag(m.away)}</span>
                  <span style={S.previewTime}>{m.city} · {fmtTimeIST(m.kickoff)}</span>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      {nothingToShow && (
        <div style={S.empty}>No matches to predict right now. Check back when the next match day opens (midnight IST), or see played matches under Results.</div>
      )}
    </div>
  );
}

function ResultsView({ finished, me, predictions, desktop }) {
  const mine = predictions[me.id] || {};
  // group finished matches by day (finished is already newest-first)
  const byDay = [];
  let cur = null;
  finished.forEach((m) => {
    const k = dayKey(m.kickoff);
    if (!cur || cur.k !== k) { cur = { k, items: [] }; byDay.push(cur); }
    cur.items.push(m);
  });

  const ptsColor = (sc) => sc == null ? V.sub : sc.points >= 10 ? V.good : sc.points > 0 ? V.gold : V.sub;

  // desktop: compact full-width horizontal rows
  if (desktop) {
    return (
      <div style={S.col}>
        <section>
          <div style={S.sectionHead}>Results <span style={S.badge}>{finished.length} played</span></div>
          {finished.length === 0 && <div style={S.empty}>No results yet. Scores appear here as matches finish.</div>}
          {byDay.map((day) => (
            <div key={day.k}>
              <div style={S.dayLabel}>{day.k}</div>
              <div style={S.rows}>
                {day.items.map((m) => {
                  const pred = mine[m.id];
                  const had = pred && pred.h !== "" && pred.a !== "" && pred.h != null && pred.a != null;
                  const sc = had ? scoreMatch(pred, m.result, { knockout: m.ko }) : null;
                  return (
                    <div key={m.id} style={{ ...S.lrow, borderLeft: `3px solid ${m.accent}` }}>
                      <span style={S.lrTag}>{tagOf(m)}</span>
                      <div style={S.lrTeams}>
                        <span>{flag(m.home)} {m.home}</span>
                        <span style={S.lrScore}>{m.result.h} : {m.result.a}</span>
                        <span>{m.away} {flag(m.away)}</span>
                      </div>
                      <span style={S.lrPick}>{had ? `Your pick: ${pred.h}-${pred.a}` : "No pick"}{sc ? <><br />{sc.breakdown}</> : ""}</span>
                      <span style={{ ...S.lrPts, color: ptsColor(sc) }}>{sc != null ? `${sc.exact ? "✓ " : ""}+${sc.points}` : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      </div>
    );
  }

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
              const sc = had ? scoreMatch(pred, m.result, { knockout: m.ko }) : null;
              const hw = m.result.h > m.result.a, aw = m.result.a > m.result.h;
              return (
                <div key={m.id} style={{ ...S.resCard, borderLeft: `3px solid ${m.accent}` }}>
                  <div style={S.resTop}>
                    <span style={S.grpTag}>{tagOf(m)}</span>
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
                  <MatchStats m={m} />
                </div>
              );
            })}
          </div>
        ))}
      </section>
    </div>
  );
}

// "How everyone predicted" — tap to reveal the prediction distribution for a
// settled match. Lazy-loads on first open so we don't query every card upfront.
function MatchStats({ m }) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const toggle = async () => {
    const next = !open; setOpen(next);
    if (next && !stats) {
      setLoading(true);
      try { setStats(await getPredictionStats(m.id)); }
      catch (e) { console.error("stats failed", e); }
      finally { setLoading(false); }
    }
  };
  const pct = (n) => stats && stats.total ? Math.round((n / stats.total) * 100) : 0;
  return (
    <div style={S.statsWrap}>
      <button className="ghost" style={S.statsToggle} onClick={toggle}>
        {open ? "Hide" : "How everyone predicted"}
      </button>
      {open && (
        <div style={S.statsBody}>
          {loading && <div style={S.statsMuted}>Loading…</div>}
          {!loading && stats && stats.total === 0 && <div style={S.statsMuted}>No predictions for this match.</div>}
          {!loading && stats && stats.total > 0 && (
            <>
              <div style={S.statsRow}>
                <span style={S.statsLbl}>{m.home} win</span>
                <div style={S.barTrack}><div style={{ ...S.barFill, width: `${pct(stats.homeWin)}%` }} /></div>
                <span style={S.statsPct}>{pct(stats.homeWin)}%</span>
              </div>
              <div style={S.statsRow}>
                <span style={S.statsLbl}>Draw</span>
                <div style={S.barTrack}><div style={{ ...S.barFill, width: `${pct(stats.draw)}%`, background: V.sub }} /></div>
                <span style={S.statsPct}>{pct(stats.draw)}%</span>
              </div>
              <div style={S.statsRow}>
                <span style={S.statsLbl}>{m.away} win</span>
                <div style={S.barTrack}><div style={{ ...S.barFill, width: `${pct(stats.awayWin)}%`, background: V.violet }} /></div>
                <span style={S.statsPct}>{pct(stats.awayWin)}%</span>
              </div>
              {stats.topScores.length > 0 && (
                <div style={S.statsScores}>
                  Most-picked: {stats.topScores.map((s) => `${s.score} (${s.n})`).join(" · ")}
                </div>
              )}
              <div style={S.statsMuted}>{stats.total} prediction{stats.total === 1 ? "" : "s"}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LeaderboardView({ leaderboard, me, fullPage }) {
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState("");
  const meRef = useRef(null);
  const myIdx = leaderboard.findIndex((r) => r.id === me.id);
  const jumpToMe = () => meRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });

  // Search by display name OR the local part of the email (name in the email).
  const s = q.trim().toLowerCase();
  const matches = (r) => {
    if (!s) return true;
    const emailLocal = (r.email || "").split("@")[0].toLowerCase();
    return r.name.toLowerCase().includes(s) || emailLocal.includes(s) || (r.email || "").toLowerCase().includes(s);
  };
  // Keep the true rank (index in the full, sorted board) even while filtering.
  const rows = leaderboard.map((r, i) => ({ r, rank: i })).filter(({ r }) => matches(r));

  return (
    <div style={S.col}>
      <section>
        <div style={S.sectionHead}>
          {fullPage ? "Leaderboard" : "Live leaderboard"}
          {leaderboard.length > 0 && <span style={S.badge}>{leaderboard.length} player{leaderboard.length === 1 ? "" : "s"}</span>}
          {fullPage && myIdx >= 0 && !s && (
            <button className="ghost" style={S.jumpBtn} onClick={jumpToMe}>↓ Jump to my position (#{myIdx + 1})</button>
          )}
        </div>

        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or email…" style={S.lbSearch} />

        {leaderboard.length === 0 && <div style={S.empty}>The board is empty. First prediction puts you on top.</div>}
        {leaderboard.length > 0 && rows.length === 0 && <div style={S.empty}>No players match “{q}”.</div>}

        <div style={S.lbList}>
          {rows.map(({ r, rank }) => {
            const isMe = r.id === me.id;
            return (
              <div key={r.id} ref={isMe && !s ? meRef : null}>
                <div className="lbrow" style={{ ...S.lbRow, ...(isMe ? S.lbMe : {}) }}
                  onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <span style={S.lbRank(rank)}>{rank + 1}</span>
                  <span style={S.lbNameWrap}>
                    <span style={S.lbName}>{r.name}{isMe && <span style={S.youTag}>you</span>}</span>
                    {r.email && <span style={S.lbEmail}>{r.email}</span>}
                  </span>
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

function MyPicksView({ enriched, me, predictions, desktop }) {
  const mine = predictions[me.id] || {};
  const rows = enriched
    .filter((m) => { const p = mine[m.id]; return p && p.h !== "" && p.a !== "" && p.h != null && p.a != null; })
    .map((m) => ({ m, pred: mine[m.id], sc: m.settled ? scoreMatch(mine[m.id], m.result, { knockout: m.ko }) : null }));
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
              <div style={S.pickMeta}>{tagOf(m)} · {m.city} · {fmtKick(m.kickoff)}</div>
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
  const [tab, setTab] = useState("results"); // results | players
  const [players, setPlayers] = useState(null);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [playerErr, setPlayerErr] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    if (tab !== "players" || players !== null) return;
    setLoadingPlayers(true);
    getAdminPlayers()
      .then((rows) => setPlayers(rows))
      .catch((e) => setPlayerErr(e.message || "Couldn't load players"))
      .finally(() => setLoadingPlayers(false));
  }, [tab, players]);

  const list = enriched.filter((m) =>
    filter === "all" ? true : filter === "pending" ? (m.locked && !m.settled) : m.settled
  );
  const filteredPlayers = (players || []).filter((p) => {
    const s = q.trim().toLowerCase();
    return !s || p.name.toLowerCase().includes(s) || (p.email || "").toLowerCase().includes(s);
  });

  return (
    <div style={S.col}>
      <section>
        <div style={S.filterRow}>
          <button className="ghost" style={{ ...S.filterBtn, ...(tab === "results" ? S.filterOn : {}) }} onClick={() => setTab("results")}>Enter results</button>
          <button className="ghost" style={{ ...S.filterBtn, ...(tab === "players" ? S.filterOn : {}) }} onClick={() => setTab("players")}>Players</button>
        </div>

        {tab === "results" && (
          <>
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
                    <div style={S.pickMeta}>{tagOf(m)} · {m.city} · {fmtKick(m.kickoff)}</div>
                  </div>
                  <div style={S.scoreBox}>
                    <input className="num" inputMode="numeric" value={r.h ?? ""} onChange={(e) => setResult(m.id, "h", e.target.value)} placeholder="–" style={S.scoreInput} />
                    <span style={S.colon}>:</span>
                    <input className="num" inputMode="numeric" value={r.a ?? ""} onChange={(e) => setResult(m.id, "a", e.target.value)} placeholder="–" style={S.scoreInput} />
                  </div>
                </div>
              );
            })}
          </>
        )}

        {tab === "players" && (
          <>
            <div style={S.sectionHead}>Organizer · player directory</div>
            <p style={S.foot}>Name and registered email for every player. Visible to organizers only, never on the public leaderboard.</p>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" style={S.signInput} />
            {loadingPlayers && <div style={S.empty}>Loading players…</div>}
            {playerErr && <div style={S.signErr}>{playerErr}</div>}
            {players && filteredPlayers.length === 0 && <div style={S.empty}>No players match that search.</div>}
            {filteredPlayers.map((p) => (
              <div key={p.id} style={S.adminRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={S.pickTeams}>{p.name}</div>
                  <div style={S.pickMeta}>{p.email} · {p.picks} pick{p.picks === 1 ? "" : "s"}</div>
                </div>
              </div>
            ))}
            {players && <p style={S.foot}>{players.length} player{players.length === 1 ? "" : "s"} registered.</p>}
          </>
        )}
      </section>
    </div>
  );
}

function BottomNav({ view, setView, adminMode, liveCount }) {
  const items = [["matches", "Matches", "⚽"], ["results", "Results", "📋"], ["mypicks", "My picks", "🎯"], ["leaderboard", "Board", "🏆"], ["bracket", "Bracket", "🗺️"], ["scorers", "Boot", "👟"]];
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
.sidenav{outline:none;transition:background .15s,color .15s;}
.sidenav:focus,.sidenav:focus-visible{outline:none;}
.sidenav:not(.sidenav-on):hover{background:rgba(255,255,255,.05);color:#fff;}
.num:focus,input:focus{outline:none;border-color:#00E5FF;box-shadow:0 0 0 3px rgba(0,229,255,.25),0 0 18px rgba(0,229,255,.3);}
.lbrow:hover{cursor:pointer;background:rgba(255,255,255,.09);}
.navbtn:active{transform:scale(.9);}
.menuitem:hover{background:rgba(255,255,255,.08);}
/* Login: fade facts in, and collapse the split to a single card on mobile */
.factfade{animation:factIn .5s ease;}
@keyframes factIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}
@media (max-width: 760px){
  .factpanel{display:none !important;}
  .signsplit-card{max-width:420px !important;border-radius:18px !important;}
}
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
  col: { display: "flex", flexDirection: "column", gap: 32 },

  /* desktop 3-region shell */
  shell: { display: "grid", minHeight: "100vh", maxWidth: 1680, margin: "0 auto" },
  deskMain: { padding: "36px 44px", minWidth: 0, overflow: "hidden" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 20, minWidth: 0 },

  /* sidebar */
  sidebar: { position: "sticky", top: 0, height: "100vh", display: "flex", flexDirection: "column", padding: "24px 18px", borderRight: `1px solid ${V.stroke}`, background: "rgba(5,6,11,.4)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" },
  sbBrand: { display: "flex", alignItems: "center", gap: 11, padding: "6px 10px 22px" },
  sbCrest: { fontSize: 28, filter: "drop-shadow(0 0 12px rgba(0,229,255,.5))" },
  sbTitle: { fontFamily: DISPLAY, fontWeight: 700, fontSize: 18, letterSpacing: 1, textTransform: "uppercase", lineHeight: 1, color: "#fff" },
  sbSub: { color: V.sub, fontSize: 11, marginTop: 2 },
  sbNav: { display: "flex", flexDirection: "column", gap: 4, marginTop: 4 },
  sbItem: { display: "flex", alignItems: "center", gap: 13, padding: "13px 14px", borderRadius: 12, color: V.sub, fontFamily: DISPLAY, fontWeight: 700, fontSize: 14, textTransform: "uppercase", letterSpacing: .6, cursor: "pointer", border: "1px solid transparent", boxShadow: "none", background: "none", width: "100%", textAlign: "left" },
  sbItemOn: { background: GRAD.electricSoft, border: "1px solid rgba(0,229,255,.35)", color: "#fff", boxShadow: "0 0 20px rgba(0,229,255,.12)" },
  sbIcon: { fontSize: 19, width: 22, textAlign: "center" },
  sbBadge: { marginLeft: "auto", background: V.magenta, color: "#fff", fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 10, fontFamily: FONT },
  sbFoot: { marginTop: "auto" },
  nameRow: { display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", marginBottom: 10, borderRadius: 12, background: "rgba(255,255,255,.04)", border: `1px solid ${V.strokeSoft}` },
  nameWrap: { flex: 1, minWidth: 0 },
  nameLabel: { fontSize: 10, color: V.sub, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", fontFamily: DISPLAY },
  nameValue: { fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 },
  nameEditBtn: { background: "none", border: `1px solid ${V.strokeSoft}`, color: V.cyan, fontFamily: DISPLAY, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: .5, padding: "6px 10px", borderRadius: 8, cursor: "pointer", flexShrink: 0 },
  nameEdit: { padding: 12, marginBottom: 10, borderRadius: 12, background: "rgba(255,255,255,.04)", border: `1px solid ${V.strokeSoft}` },
  nameInput: { width: "100%", boxSizing: "border-box", marginTop: 6, padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,.3)", border: `1px solid ${V.stroke}`, color: "#fff", fontFamily: FONT, fontSize: 14 },
  nameErr: { color: V.red, fontSize: 12, marginTop: 6 },
  nameBtns: { display: "flex", gap: 8, marginTop: 10 },
  nameCancel: { flex: 1, background: "none", border: `1px solid ${V.strokeSoft}`, color: V.sub, padding: "8px 0", borderRadius: 8, fontFamily: DISPLAY, fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: .5, cursor: "pointer" },
  nameSave: { flex: 1, border: "none", color: "#04121a", padding: "8px 0", borderRadius: 8, fontFamily: DISPLAY, fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: .5, cursor: "pointer" },
  sbRankCard: { padding: 16, borderRadius: 14, background: "rgba(255,255,255,.04)", border: `1px solid ${V.strokeSoft}` },
  sbRankLabel: { fontSize: 10, color: V.sub, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: DISPLAY },
  sbRankBig: { display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 },
  sbRankPos: { fontFamily: NUM, fontWeight: 700, fontSize: 32, color: "#fff", lineHeight: 1 },
  sbRankOf: { fontSize: 13, color: V.sub },
  sbRankPts: { marginTop: 8, fontFamily: NUM, fontWeight: 700, fontSize: 16, color: V.cyan, textShadow: "0 0 12px rgba(0,229,255,.4)" },
  sbSecondary: { marginTop: 10, width: "100%", background: "none", border: `1px solid ${V.strokeSoft}`, color: V.sub, padding: 10, borderRadius: 10, fontFamily: DISPLAY, fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: .6, cursor: "pointer" },

  /* right rail */
  rail: { position: "sticky", top: 0, height: "100vh", overflowY: "auto", padding: "28px 20px", borderLeft: `1px solid ${V.stroke}`, background: "rgba(5,6,11,.3)" },
  railHead: { fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, letterSpacing: 1, textTransform: "uppercase", color: "#fff", marginBottom: 16 },
  railRow: { display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", borderRadius: 12, marginBottom: 8, background: V.glass, border: `1px solid ${V.stroke}` },
  railRowMe: { borderColor: "rgba(255,200,61,.5)", boxShadow: "0 0 20px rgba(255,200,61,.16)" },
  railRank: (i) => ({ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", fontFamily: NUM, fontWeight: 700, fontSize: 15, color: "#04121a", flexShrink: 0,
    background: i === 0 ? "linear-gradient(135deg,#FFC83D,#FF9E2D)" : i === 1 ? "linear-gradient(135deg,#D7E0F0,#9FB0CC)" : i === 2 ? "linear-gradient(135deg,#E0954E,#B36A2E)" : "rgba(255,255,255,.1)", ...(i > 2 ? { color: "#fff" } : {}) }),
  railName: { flex: 1, fontFamily: DISPLAY, fontWeight: 700, fontSize: 14, textTransform: "uppercase", letterSpacing: .4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#fff", display: "flex", alignItems: "center", gap: 6 },
  railPts: { fontFamily: NUM, fontWeight: 700, fontSize: 18, color: "#fff" },
  railGap: { textAlign: "center", color: V.sub, fontSize: 18, letterSpacing: 3, padding: "4px 0 10px" },

  /* horizontal list rows (desktop results / my picks) */
  rows: { display: "flex", flexDirection: "column", gap: 10 },
  lrow: { display: "grid", gridTemplateColumns: "110px 1fr auto auto", alignItems: "center", gap: 18, padding: "14px 18px", borderRadius: 14, ...GLASS },
  lrTag: { fontFamily: DISPLAY, fontSize: 11, fontWeight: 700, color: V.cyan, textTransform: "uppercase", letterSpacing: .6 },
  lrTeams: { display: "flex", alignItems: "center", gap: 14, fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, textTransform: "uppercase", letterSpacing: .4, minWidth: 0 },
  lrScore: { fontFamily: NUM, fontWeight: 700, fontSize: 24, color: "#fff", whiteSpace: "nowrap" },
  lrPick: { fontSize: 12, color: V.sub, textAlign: "right", minWidth: 130 },
  lrPts: { fontFamily: NUM, fontWeight: 700, fontSize: 22, minWidth: 54, textAlign: "right" },

  /* full leaderboard page */
  jumpBtn: { marginLeft: "auto", background: GRAD.electricSoft, border: "1px solid rgba(0,229,255,.4)", color: V.cyan, fontFamily: DISPLAY, fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: .5, padding: "8px 14px", borderRadius: 10, cursor: "pointer" },


  /* sign in */
  signWrap: { minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, background: BACKDROP, backgroundAttachment: "fixed", color: V.text, fontFamily: FONT },
  signSplit: { display: "flex", gap: 0, width: "100%", maxWidth: 880, borderRadius: 20, overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,.5)" },
  signCard: { width: "100%", maxWidth: 420, flexShrink: 0, ...GLASS, borderRadius: 0, padding: 36, textAlign: "center" },
  factPanel: { flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "36px 40px", background: "linear-gradient(150deg, rgba(0,229,255,.10), rgba(60,172,59,.10))", borderLeft: `1px solid ${V.stroke}`, position: "relative", overflow: "hidden" },
  factEyebrow: { fontFamily: DISPLAY, fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: V.cyan, marginBottom: 18 },
  factCard: { minHeight: 160 },
  factStat: { fontFamily: NUM, fontWeight: 700, fontSize: 64, lineHeight: 1, background: GRAD.electric, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", marginBottom: 14 },
  factText: { fontSize: 16, lineHeight: 1.5, color: V.text, maxWidth: 320 },
  factDots: { display: "flex", gap: 7, marginTop: 28 },
  factDot: { width: 7, height: 7, borderRadius: 4, background: "rgba(255,255,255,.2)", transition: "all .3s" },
  factDotOn: { background: V.cyan, width: 20 },
  signCrest: { fontSize: 50, marginBottom: 4, filter: "drop-shadow(0 0 16px rgba(0,229,255,.6))" },
  signEyebrow: { background: GRAD.electric, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", fontSize: 12, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase", fontFamily: DISPLAY },
  signTitle: { fontFamily: DISPLAY, fontSize: 38, fontWeight: 700, margin: "2px 0 8px", letterSpacing: 1, lineHeight: 1, textTransform: "uppercase", color: "#fff", textShadow: "0 0 30px rgba(0,229,255,.35)" },
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
  menu: { position: "absolute", top: 44, right: 0, background: "rgba(12,15,26,.97)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", border: "1px solid rgba(255,255,255,.16)", boxShadow: "0 16px 48px rgba(0,0,0,.6)", borderRadius: 12, padding: 6, minWidth: 210, zIndex: 30 },
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
  teamCell: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, minHeight: 118, background: "rgba(255,255,255,.03)", border: "1px solid transparent", boxShadow: "none", borderRadius: 14, padding: "16px 8px", minWidth: 0, transition: "all .2s" },
  teamWin: { background: GRAD.electricSoft, border: "1px solid rgba(0,229,255,.5)", boxShadow: "0 0 22px rgba(0,229,255,.25)" },
  flag: { fontSize: 44, lineHeight: 1, filter: "drop-shadow(0 4px 12px rgba(0,0,0,.55))" },
  teamLbl: { fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, lineHeight: 1.1, color: "#fff", textTransform: "uppercase", textAlign: "center", letterSpacing: .5, width: "100%", overflowWrap: "anywhere", hyphens: "auto" },
  scoreBox: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8 },
  scoreInput: { width: 52, height: 64, textAlign: "center", background: "rgba(0,0,0,.4)", border: `1px solid ${V.stroke}`, color: "#fff", borderRadius: 12, fontSize: 34, fontWeight: 700, fontFamily: NUM, boxShadow: "inset 0 0 18px rgba(0,229,255,.1)" },
  colon: { color: V.cyan, fontSize: 26, fontWeight: 700, textShadow: "0 0 12px rgba(0,229,255,.8)", fontFamily: NUM },
  savedTag: { marginTop: 24, fontSize: 12, color: V.greenBright, fontWeight: 600, textAlign: "center", letterSpacing: .3 },
  advRow: { marginTop: 14, padding: "12px 12px 14px", borderRadius: 12, background: "rgba(122,92,255,.08)", border: `1px solid ${V.strokeSoft}` },
  advLabel: { display: "block", fontSize: 11.5, fontWeight: 600, textAlign: "center", letterSpacing: .2, marginBottom: 10 },
  advBtns: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  advBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 8px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700, color: V.text, background: V.glass, border: `1px solid ${V.stroke}` },
  advBtnOn: { background: "rgba(0,229,255,.16)", border: `1px solid ${V.cyan}`, boxShadow: "0 0 0 1px rgba(0,229,255,.25) inset" },
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
  lbNameWrap: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 },
  lbName: { fontFamily: DISPLAY, fontWeight: 700, fontSize: 18, display: "flex", alignItems: "center", gap: 8, minWidth: 0, textTransform: "uppercase", letterSpacing: .5, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  lbEmail: { fontSize: 11, color: V.sub, fontFamily: FONT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textTransform: "none", letterSpacing: 0 },
  lbSearch: { width: "100%", boxSizing: "border-box", margin: "4px 0 14px", padding: "12px 14px", borderRadius: 12, background: "rgba(0,0,0,.25)", border: `1px solid ${V.stroke}`, color: "#fff", fontFamily: FONT, fontSize: 14 },
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
  statsWrap: { marginTop: 12 },
  statsToggle: { background: "none", border: `1px solid ${V.strokeSoft}`, color: V.cyan, fontSize: 11, fontWeight: 700, padding: "7px 12px", borderRadius: 8, cursor: "pointer", textTransform: "uppercase", letterSpacing: .5, fontFamily: DISPLAY, width: "100%" },
  statsBody: { marginTop: 12, display: "flex", flexDirection: "column", gap: 8 },
  statsRow: { display: "flex", alignItems: "center", gap: 10 },
  statsLbl: { fontSize: 11, color: V.sub, fontWeight: 600, width: 92, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  barTrack: { flex: 1, height: 8, background: "rgba(255,255,255,.06)", borderRadius: 6, overflow: "hidden" },
  barFill: { height: "100%", background: GRAD.electric, borderRadius: 6 },
  statsPct: { fontSize: 12, fontWeight: 700, fontFamily: NUM, width: 38, textAlign: "right", flexShrink: 0 },
  statsScores: { fontSize: 11, color: V.sub, marginTop: 4, fontWeight: 500 },
  statsMuted: { fontSize: 11, color: V.sub, fontWeight: 500 },

  /* bottom nav */
  bottom: { position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 20, background: "rgba(5,6,11,.7)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderTop: `1px solid ${V.stroke}`, display: "flex", justifyContent: "space-around", padding: "10px 0 calc(10px + env(safe-area-inset-bottom))", maxWidth: 560, margin: "0 auto" },
  navBtn: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "none", border: "none", color: V.sub, fontSize: 10, fontWeight: 700, cursor: "pointer", padding: "4px 12px", borderRadius: 10, position: "relative", flex: 1, textTransform: "uppercase", letterSpacing: .5, fontFamily: DISPLAY },
  navOn: { color: V.cyan, textShadow: "0 0 12px rgba(0,229,255,.6)" },
  navIcon: { fontSize: 20 },

  toast: { position: "fixed", bottom: 96, left: "50%", transform: "translateX(-50%)", ...GLASS, color: "#fff", padding: "12px 22px", borderRadius: 12, fontWeight: 700, fontSize: 13, zIndex: 60, textTransform: "uppercase", letterSpacing: .5, fontFamily: DISPLAY, boxShadow: "0 0 30px rgba(0,229,255,.3)" },
};
