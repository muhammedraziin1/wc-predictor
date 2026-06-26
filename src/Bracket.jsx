import React from "react";
import { STAGE_LABEL, STAGE_ORDER, isKnockout, flag } from "./data.js";

/* Local palette — mirrors the app's V tokens so these views match the rest
   of the UI without depending on App.jsx's private style object. */
const C = {
  bg: "#0A0E1A",
  glass: "rgba(255,255,255,0.055)",
  line: "rgba(255,255,255,0.10)",
  cyan: "#00E5FF",
  green: "#5BE66A",
  text: "#EAF2FF",
  sub: "#8A94B0",
  amber: "#FFC83D",
};

const TBD = "TBD";

/* Which side advanced, for highlighting. Uses explicit `adv` (penalties) when
   present, else the goal margin. Returns 'home' | 'away' | null. */
function winnerOf(res) {
  if (!res) return null;
  if (res.adv === "home" || res.adv === "away") return res.adv;
  if (res.h == null || res.a == null) return null;
  if (res.h > res.a) return "home";
  if (res.a > res.h) return "away";
  return null; // level with no adv recorded yet
}

function TeamRow({ name, score, isWinner, played }) {
  const known = !!name;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "7px 10px",
      opacity: known ? 1 : 0.5,
      fontWeight: isWinner ? 700 : 500,
      color: isWinner ? C.text : known ? C.text : C.sub,
    }}>
      <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>{known ? flag(name) : "•"}</span>
      <span style={{ flex: 1, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {known ? name : TBD}
      </span>
      {played && (
        <span style={{
          minWidth: 18, textAlign: "center", fontVariantNumeric: "tabular-nums",
          fontWeight: 700, color: isWinner ? C.green : C.sub,
        }}>{score}</span>
      )}
    </div>
  );
}

function TieCard({ fx, res }) {
  const w = winnerOf(res);
  const played = !!res && res.h != null && res.a != null;
  const pens = played && res.h === res.a && (res.adv === "home" || res.adv === "away");
  return (
    <div style={{
      background: C.glass, border: `1px solid ${C.line}`, borderRadius: 12,
      overflow: "hidden", minWidth: 184,
    }}>
      <TeamRow name={fx.home} score={res?.h} isWinner={w === "home"} played={played} />
      <div style={{ height: 1, background: C.line }} />
      <TeamRow name={fx.away} score={res?.a} isWinner={w === "away"} played={played} />
      {pens && (
        <div style={{ padding: "2px 10px 5px", fontSize: 10.5, color: C.amber, textAlign: "right" }}>
          {w === "home" ? fx.home : fx.away} on penalties
        </div>
      )}
    </div>
  );
}

export function BracketView({ koFixtures = [], results = {} }) {
  const ko = (koFixtures || []).filter((f) => isKnockout(f.stage));

  if (ko.length === 0) {
    return (
      <div style={{ padding: "48px 20px", textAlign: "center", color: C.sub }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🗺️</div>
        <div style={{ color: C.text, fontWeight: 700, fontSize: 17, marginBottom: 6 }}>The bracket isn’t set yet</div>
        <div style={{ fontSize: 13.5, maxWidth: 360, margin: "0 auto", lineHeight: 1.5 }}>
          Knockout ties appear here automatically as teams qualify out of the group stage — each side fills in the moment it’s decided.
        </div>
      </div>
    );
  }

  // Group by stage, order columns by round.
  const byStage = {};
  for (const f of ko) (byStage[f.stage] ||= []).push(f);
  const stages = Object.keys(byStage).sort((a, b) => (STAGE_ORDER[a] ?? 99) - (STAGE_ORDER[b] ?? 99));
  for (const s of stages) byStage[s].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));

  return (
    <div style={{ padding: "4px 0 24px" }}>
      <div style={{ display: "flex", gap: 18, overflowX: "auto", paddingBottom: 8, alignItems: "flex-start" }}>
        {stages.map((s) => (
          <div key={s} style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 184 }}>
            <div style={{
              fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase",
              color: s === "Final" ? C.amber : C.cyan, padding: "0 2px",
            }}>
              {STAGE_LABEL[s] || s}
            </div>
            {byStage[s].map((fx) => (
              <TieCard key={fx.id} fx={fx} res={results[fx.id]} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ScorersView({ scorers = [] }) {
  const rows = (scorers || []).slice().sort((a, b) => (b.goals || 0) - (a.goals || 0));

  if (rows.length === 0) {
    return (
      <div style={{ padding: "48px 20px", textAlign: "center", color: C.sub }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>👟</div>
        <div style={{ color: C.text, fontWeight: 700, fontSize: 17, marginBottom: 6 }}>No goals logged yet</div>
        <div style={{ fontSize: 13.5, maxWidth: 360, margin: "0 auto", lineHeight: 1.5 }}>
          The Golden Boot race fills in as goals are scored across the tournament.
        </div>
      </div>
    );
  }

  const medal = ["🥇", "🥈", "🥉"];
  return (
    <div style={{ padding: "4px 0 24px", maxWidth: 520, margin: "0 auto" }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: C.amber, margin: "0 2px 10px" }}>
        Golden Boot race
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((s, i) => (
          <div key={s.player_id ?? `${s.player}-${i}`} style={{
            display: "flex", alignItems: "center", gap: 10,
            background: C.glass, border: `1px solid ${C.line}`, borderRadius: 12,
            padding: "10px 12px",
          }}>
            <span style={{ width: 26, textAlign: "center", fontWeight: 800, color: C.sub, fontSize: i < 3 ? 16 : 13 }}>
              {i < 3 ? medal[i] : i + 1}
            </span>
            <span style={{ fontSize: 16 }}>{flag(s.team)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.text, fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.player}</div>
              <div style={{ color: C.sub, fontSize: 11.5 }}>{s.team || ""}</div>
            </div>
            <span style={{ fontWeight: 800, color: C.green, fontSize: 18, fontVariantNumeric: "tabular-nums" }}>{s.goals}</span>
            <span style={{ color: C.sub, fontSize: 11, alignSelf: "flex-end", marginBottom: 3 }}>{s.goals === 1 ? "goal" : "goals"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
