// =====================================================================
//  Supabase Edge Function: sync-results
//  Pulls FIFA World Cup 2026 matches from football-data.org (free tier),
//  takes FINISHED matches, maps them to our fixture IDs, and upserts the
//  90' result into the `results` table. Your app reads that table and the
//  leaderboard updates automatically.
//
//  Free-tier reality: scores are DELAYED (not second-by-second). For this
//  contest that's fine — scoring only uses final 90' results.
//
//  Secrets required (set via: supabase secrets set ...):
//    FOOTBALL_DATA_TOKEN   your free football-data.org API token
//    SUPABASE_URL          (auto-provided in Edge runtime)
//    SUPABASE_SERVICE_ROLE_KEY  service role key (server-side only, safe here)
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Normalize any team name to a comparison key: lowercase, strip accents,
// keep letters only. "Türkiye" -> "turkiye", "Korea Republic" -> "korearepublic".
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\band\b/g, "").replace(/[^a-z]/g, "");
}

// football-data.org spells some nations differently. Map THEIR name -> OUR name
// (normalized on both sides at lookup time, so only genuine wording diffs need listing).
const ALIASES: Record<string, string> = {
  "korearepublic": "southkorea",
  "iriran": "iran",
  "czechrepublic": "czechia",
  "turkiye": "turkiye",
  "cotedivoire": "ivorycoast",
  "ivorycoast": "ivorycoast",
  "capeverdeislands": "capeverde",
  "drcongo": "drcongo",
  "congodr": "drcongo",
  "democraticrepublicofcongo": "drcongo",
  "republicofthecongo": "congo",
  "congo": "congo",
  "unitedstates": "unitedstates",
  "usa": "unitedstates",
  "curacao": "curacao",
};
const canon = (apiName: string): string => {
  const n = norm(apiName);
  return ALIASES[n] || n;
};

// Pair-key (order-independent) -> our fixture ID.
const PAIR_TO_ID: Record<string, string> = {
  "mexico|southafrica": "G01",
  "czechia|southkorea": "G02",
  "bosniaherzegovina|canada": "G03",
  "paraguay|unitedstates": "G04",
  "qatar|switzerland": "G05",
  "brazil|morocco": "G06",
  "haiti|scotland": "G07",
  "australia|turkiye": "G08",
  "curacao|germany": "G09",
  "japan|netherlands": "G10",
  "ecuador|ivorycoast": "G11",
  "sweden|tunisia": "G12",
  "capeverde|spain": "G13",
  "belgium|egypt": "G14",
  "saudiarabia|uruguay": "G15",
  "iran|newzealand": "G16",
  "france|senegal": "G17",
  "iraq|norway": "G18",
  "algeria|argentina": "G19",
  "austria|jordan": "G20",
  "drcongo|portugal": "G21",
  "croatia|england": "G22",
  "ghana|panama": "G23",
  "colombia|uzbekistan": "G24",
  "czechia|southafrica": "G25",
  "bosniaherzegovina|switzerland": "G26",
  "canada|qatar": "G27",
  "mexico|southkorea": "G28",
  "morocco|scotland": "G29",
  "australia|unitedstates": "G30",
  "brazil|haiti": "G31",
  "paraguay|turkiye": "G32",
  "netherlands|sweden": "G33",
  "germany|ivorycoast": "G34",
  "curacao|ecuador": "G35",
  "japan|tunisia": "G36",
  "saudiarabia|spain": "G37",
  "belgium|iran": "G38",
  "capeverde|uruguay": "G39",
  "egypt|newzealand": "G40",
  "argentina|austria": "G41",
  "france|iraq": "G42",
  "norway|senegal": "G43",
  "algeria|jordan": "G44",
  "portugal|uzbekistan": "G45",
  "england|ghana": "G46",
  "croatia|panama": "G47",
  "colombia|drcongo": "G48",
  "canada|switzerland": "G49",
  "bosniaherzegovina|qatar": "G50",
  "brazil|scotland": "G51",
  "haiti|morocco": "G52",
  "czechia|mexico": "G53",
  "southafrica|southkorea": "G54",
  "ecuador|germany": "G55",
  "curacao|ivorycoast": "G56",
  "japan|sweden": "G57",
  "netherlands|tunisia": "G58",
  "turkiye|unitedstates": "G59",
  "australia|paraguay": "G60",
  "france|norway": "G61",
  "iraq|senegal": "G62",
  "capeverde|saudiarabia": "G63",
  "spain|uruguay": "G64",
  "egypt|iran": "G65",
  "belgium|newzealand": "G66",
  "england|panama": "G67",
  "croatia|ghana": "G68",
  "colombia|portugal": "G69",
  "drcongo|uzbekistan": "G70",
  "algeria|austria": "G71",
  "argentina|jordan": "G72",
};

// Map football-data.org stage codes to our short stage codes.
const STAGE_MAP: Record<string, string> = {
  LAST_16: "R16", ROUND_OF_16: "R16",
  LAST_32: "R32", ROUND_OF_32: "R32",
  QUARTER_FINALS: "QF", QUARTER_FINAL: "QF",
  SEMI_FINALS: "SF", SEMI_FINAL: "SF",
  THIRD_PLACE: "3rd", THIRD_PLACE_PLAY_OFF: "3rd",
  FINAL: "Final",
};
// Best-effort venue accent for KO matches (cyan default; matches theme).
const KO_ACCENT = "#00E5FF";

Deno.serve(async (_req) => {
  const token = Deno.env.get("FOOTBALL_DATA_TOKEN");
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!token || !supaUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Missing required secrets" }), { status: 500 });
  }

  const supabase = createClient(supaUrl, serviceKey);

  // Fetch ALL matches (not only finished) so we can create knockout fixtures
  // as soon as both teams are known, before kickoff.
  let matches: any[] = [];
  try {
    const res = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
      headers: { "X-Auth-Token": token },
    });
    if (!res.ok) {
      const body = await res.text();
      return new Response(JSON.stringify({ error: `API ${res.status}`, body }), { status: 502 });
    }
    const json = await res.json();
    matches = json.matches || [];
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502 });
  }

  let written = 0, skipped = 0, koCreated = 0;
  const unmatched: string[] = [];

  for (const m of matches) {
    const home = m.homeTeam?.name ?? m.homeTeam?.shortName ?? "";
    const away = m.awayTeam?.name ?? m.awayTeam?.shortName ?? "";
    const stageCode = STAGE_MAP[m.stage] || (m.stage === "GROUP_STAGE" ? "Group" : null);
    const isKO = stageCode && stageCode !== "Group";

    // ---- Group stage: map to hardcoded fixture IDs, write finished results ----
    if (!isKO) {
      if (m.status !== "FINISHED") { continue; }
      const key = [canon(home), canon(away)].sort().join("|");
      const id = PAIR_TO_ID[key];
      if (!id) { unmatched.push(`${home} v ${away}`); continue; }
      const ft = m.score?.fullTime ?? {};
      const hg = ft.home, ag = ft.away;
      if (hg == null || ag == null) { skipped++; continue; }
      const { error } = await supabase.from("results").upsert(
        { match_id: id, home: hg, away: ag }, { onConflict: "match_id" });
      if (error) { skipped++; continue; }
      written++;
      continue;
    }

    // ---- Knockout: create the fixture once both teams are known ----
    // Skip placeholder rows where teams aren't decided yet.
    if (!home || !away) { continue; }
    const koId = `K${m.id}`;            // stable id from the API match id
    const kickoff = m.utcDate;          // ISO string
    if (!kickoff) { continue; }

    // upsert the fixture (idempotent)
    const fxErr = (await supabase.from("fixtures").upsert({
      id: koId, kickoff, home, away, stage: stageCode,
      city: m.venue ?? "", country: "", accent: KO_ACCENT,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" })).error;
    if (!fxErr) koCreated++;

    // keep the anti-cheat trigger in sync: record this KO kickoff
    await supabase.from("match_kickoffs").upsert(
      { match_id: koId, kickoff }, { onConflict: "match_id" });

    // if finished, write the result (post-ET goals + who advanced)
    if (m.status === "FINISHED") {
      const ft = m.score?.fullTime ?? {};
      // football-data 'fullTime' includes extra time for KO matches.
      let hg = ft.home, ag = ft.away;
      if (hg == null || ag == null) { continue; }
      // who advanced: prefer explicit winner; fall back to goals.
      const w = m.score?.winner; // 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' (DRAW => decided on pens)
      let adv: string | null = null;
      if (w === "HOME_TEAM") adv = "home";
      else if (w === "AWAY_TEAM") adv = "away";
      else if (hg > ag) adv = "home";
      else if (ag > hg) adv = "away";
      // if level and API says DRAW (penalty decision not exposed on free tier),
      // leave adv null — organizer sets the advancer; scoring falls back to goals.
      const row: Record<string, unknown> = { match_id: koId, home: hg, away: ag };
      if (adv) row.adv = adv;
      const { error } = await supabase.from("results").upsert(row, { onConflict: "match_id" });
      if (!error) written++; else skipped++;
    }
  }

  return new Response(JSON.stringify({ ok: true, written, koCreated, skipped, unmatched }), {
    headers: { "Content-Type": "application/json" },
  });
});
