/* =========================================================================
   Static tournament data + pure helpers. No React, no I/O.
   ========================================================================= */


/* "Now" for upcoming-match logic. Defaults to real today; override for demo. */
export const NOW = new Date();

/* US Eastern calendar date key (YYYY-MM-DD) for any Date. Uses the IANA zone
   so it handles EDT/EST automatically. A match's "day" is its kickoff date in
   ET; predictions open only for matches whose ET date equals today's ET date. */
export function etDateKey(d) {
  // en-CA gives YYYY-MM-DD; timeZone shifts the instant into US Eastern first.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/* ---------------- Tournament data ---------------- */
export const GROUPS = {
  A: ["Mexico", "South Africa", "South Korea", "Czechia"],
  B: ["Canada", "Bosnia & Herzegovina", "Qatar", "Switzerland"],
  C: ["Brazil", "Morocco", "Haiti", "Scotland"],
  D: ["United States", "Paraguay", "Australia", "Türkiye"],
  E: ["Germany", "Curaçao", "Ivory Coast", "Ecuador"],
  F: ["Netherlands", "Japan", "Sweden", "Tunisia"],
  G: ["Belgium", "Egypt", "Iran", "New Zealand"],
  H: ["Spain", "Cape Verde", "Saudi Arabia", "Uruguay"],
  I: ["France", "Senegal", "Iraq", "Norway"],
  J: ["Argentina", "Algeria", "Austria", "Jordan"],
  K: ["Portugal", "DR Congo", "Uzbekistan", "Colombia"],
  L: ["England", "Croatia", "Ghana", "Panama"],
};

/* One verifiable fun fact per team — World Cup history, records, or notables.
   Hardcoded (an artifact can't fetch live trivia). Edit freely. */
export const TEAM_FACTS = {
  Mexico: "Has hosted the World Cup three times (1970, 1986, 2026) — more than any other nation.",
  "South Africa": "In 2010 became the first host nation ever to be eliminated in the group stage.",
  "South Korea": "Reached the semi-finals as co-hosts in 2002, the best-ever finish by an Asian team.",
  Czechia: "As Czechoslovakia, reached two World Cup finals (1934 and 1962), losing both.",
  Canada: "Before 2022, their only previous World Cup was 1986 — where they failed to score a single goal.",
  "Bosnia & Herzegovina": "Edin Džeko is their all-time top scorer and the country's footballing icon.",
  Qatar: "Hosted the 2022 World Cup but lost all three games — the worst-ever record by a host.",
  Switzerland: "Has reached the knockout rounds in four of the last five World Cups.",
  Brazil: "The only nation to have played in every single World Cup, and record five-time champions.",
  Morocco: "In 2022 became the first African and first Arab nation to reach a World Cup semi-final.",
  Haiti: "At their only previous World Cup (1974), Emmanuel Sanon ended Dino Zoff's 1,142-minute clean-sheet streak.",
  Scotland: "Has qualified for nine World Cups but never once made it past the group stage.",
  "United States": "Finished third at the very first World Cup in 1930 — still their best result.",
  Paraguay: "Reached the quarter-finals in 2010, their deepest-ever run at a World Cup.",
  Australia: "Switched from the Oceania to the Asian confederation in 2006 to get a tougher qualifying path.",
  "Türkiye": "Finished third on their return to the World Cup in 2002 after a 48-year absence.",
  Germany: "Four-time champions whose 7-1 demolition of Brazil in 2014 is World Cup folklore.",
  "Curaçao": "An island of around 150,000 people — among the smallest nations ever to reach the finals.",
  "Ivory Coast": "Drogba, Touré, and co. never escaped the group despite a golden generation in 2006-2014.",
  Ecuador: "Has only ever won World Cup matches when playing at high altitude or in the Americas.",
  Netherlands: "Three-time runners-up (1974, 1978, 2010) — the best team never to win the trophy.",
  Japan: "Has knocked out a former champion in three straight World Cups (Germany & Spain in 2022).",
  Sweden: "Finished runners-up as hosts in 1958, beaten by a 17-year-old Pelé's Brazil.",
  Tunisia: "First African team to win a World Cup match (beating Mexico 3-1 in 1978).",
  Belgium: "Their 'golden generation' peaked at third place in 2018, the country's best finish.",
  Egypt: "The first African nation ever to enter the World Cup, back in 1934.",
  Iran: "Their 1998 win over the USA remains one of the most politically charged matches in the sport.",
  "New Zealand": "The only unbeaten team at the 2010 World Cup — three draws, yet still eliminated.",
  Spain: "2010 champions who won it with the lowest goals-scored total of any winner (8 in 7 games).",
  "Cape Verde": "A volcanic archipelago making its first-ever World Cup appearance in 2026.",
  "Saudi Arabia": "Stunned eventual champions Argentina 2-1 in the 2022 group stage.",
  Uruguay: "Won the very first World Cup in 1930 on home soil, and won again in 1950.",
  France: "Champions in 1998 and 2018, and the team Mbappé has dragged to back-to-back finals.",
  Senegal: "Beat reigning champions France in their 2002 World Cup debut match.",
  Iraq: "Their 2007 Asian Cup triumph amid civil war is one of football's great underdog stories.",
  Norway: "Erling Haaland's nation had never qualified in his lifetime until now.",
  Argentina: "Reigning champions; Messi's 2022 triumph capped his record as the most-capped World Cup player.",
  Algeria: "Victims of the 1982 'Disgrace of Gijón' that led FIFA to make final group games kick off simultaneously.",
  Austria: "The 1954 'Miracle of Lausanne' — a 7-5 win over Switzerland, the highest-scoring World Cup game ever.",
  Jordan: "Reached its first-ever World Cup after a runner-up finish at the 2024 Asian Cup.",
  Portugal: "Cristiano Ronaldo is the only male player to score at five different World Cups.",
  "DR Congo": "As Zaire in 1974, became the first sub-Saharan African nation at a World Cup.",
  Uzbekistan: "Qualified for its first-ever World Cup in 2026 since independence in 1991.",
  Colombia: "Carlos Valderrama and his iconic hair lit up three World Cups in the 1990s.",
  England: "1966 champions on home soil — still their only major men's trophy.",
  Croatia: "A nation of under four million that reached the 2018 final and 2022 third place.",
  Ghana: "Came within a Suárez handball and a missed penalty of being Africa's first semi-finalist in 2010.",
  Panama: "Declared a national holiday when they qualified for their first World Cup in 2018.",
};
export const factOf = (t) => TEAM_FACTS[t] || "Making their mark on the world's biggest stage.";

export const FLAG = {
  Mexico: "🇲🇽", "South Africa": "🇿🇦", "South Korea": "🇰🇷", Czechia: "🇨🇿",
  Canada: "🇨🇦", "Bosnia & Herzegovina": "🇧🇦", Qatar: "🇶🇦", Switzerland: "🇨🇭",
  Brazil: "🇧🇷", Morocco: "🇲🇦", Haiti: "🇭🇹", Scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  "United States": "🇺🇸", Paraguay: "🇵🇾", Australia: "🇦🇺", "Türkiye": "🇹🇷",
  Germany: "🇩🇪", "Curaçao": "🇨🇼", "Ivory Coast": "🇨🇮", Ecuador: "🇪🇨",
  Netherlands: "🇳🇱", Japan: "🇯🇵", Sweden: "🇸🇪", Tunisia: "🇹🇳",
  Belgium: "🇧🇪", Egypt: "🇪🇬", Iran: "🇮🇷", "New Zealand": "🇳🇿",
  Spain: "🇪🇸", "Cape Verde": "🇨🇻", "Saudi Arabia": "🇸🇦", Uruguay: "🇺🇾",
  France: "🇫🇷", Senegal: "🇸🇳", Iraq: "🇮🇶", Norway: "🇳🇴",
  Argentina: "🇦🇷", Algeria: "🇩🇿", Austria: "🇦🇹", Jordan: "🇯🇴",
  Portugal: "🇵🇹", "DR Congo": "🇨🇩", Uzbekistan: "🇺🇿", Colombia: "🇨🇴",
  England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", Croatia: "🇭🇷", Ghana: "🇬🇭", Panama: "🇵🇦",
};
export const flag = (t) => FLAG[t] || "⚽";

/* Group fixtures with real kickoff datetimes (UTC). 72 matches. */
export const RAW = [
  ["2026-06-11T19:00Z", "Mexico", "South Africa", "A", "Mexico City"],
  ["2026-06-12T02:00Z", "South Korea", "Czechia", "A", "Guadalajara"],
  ["2026-06-12T19:00Z", "Canada", "Bosnia & Herzegovina", "B", "Toronto"],
  ["2026-06-13T01:00Z", "United States", "Paraguay", "D", "Los Angeles"],
  ["2026-06-13T19:00Z", "Qatar", "Switzerland", "B", "San Francisco"],
  ["2026-06-13T22:00Z", "Brazil", "Morocco", "C", "New York"],
  ["2026-06-14T01:00Z", "Haiti", "Scotland", "C", "Boston"],
  ["2026-06-14T04:00Z", "Australia", "Türkiye", "D", "Vancouver"],
  ["2026-06-14T17:00Z", "Germany", "Curaçao", "E", "Houston"],
  ["2026-06-14T20:00Z", "Netherlands", "Japan", "F", "Dallas"],
  ["2026-06-14T23:00Z", "Ivory Coast", "Ecuador", "E", "Philadelphia"],
  ["2026-06-15T02:00Z", "Sweden", "Tunisia", "F", "Monterrey"],
  ["2026-06-15T16:00Z", "Spain", "Cape Verde", "H", "Atlanta"],
  ["2026-06-15T19:00Z", "Belgium", "Egypt", "G", "Seattle"],
  ["2026-06-15T22:00Z", "Saudi Arabia", "Uruguay", "H", "Miami"],
  ["2026-06-16T01:00Z", "Iran", "New Zealand", "G", "Los Angeles"],
  ["2026-06-16T19:00Z", "France", "Senegal", "I", "New York"],
  ["2026-06-16T22:00Z", "Iraq", "Norway", "I", "Boston"],
  ["2026-06-17T01:00Z", "Argentina", "Algeria", "J", "Kansas City"],
  ["2026-06-17T04:00Z", "Austria", "Jordan", "J", "San Francisco"],
  ["2026-06-17T17:00Z", "Portugal", "DR Congo", "K", "Houston"],
  ["2026-06-17T20:00Z", "England", "Croatia", "L", "Dallas"],
  ["2026-06-17T23:00Z", "Ghana", "Panama", "L", "Toronto"],
  ["2026-06-18T02:00Z", "Uzbekistan", "Colombia", "K", "Mexico City"],
  ["2026-06-18T16:00Z", "Czechia", "South Africa", "A", "Atlanta"],
  ["2026-06-18T19:00Z", "Switzerland", "Bosnia & Herzegovina", "B", "Los Angeles"],
  ["2026-06-18T22:00Z", "Canada", "Qatar", "B", "Vancouver"],
  ["2026-06-19T01:00Z", "Mexico", "South Korea", "A", "Guadalajara"],
  ["2026-06-19T22:00Z", "Scotland", "Morocco", "C", "Boston"],
  ["2026-06-19T19:00Z", "United States", "Australia", "D", "Seattle"],
  ["2026-06-20T00:30Z", "Brazil", "Haiti", "C", "Philadelphia"],
  ["2026-06-20T03:00Z", "Türkiye", "Paraguay", "D", "San Francisco"],
  ["2026-06-20T17:00Z", "Netherlands", "Sweden", "F", "Houston"],
  ["2026-06-20T20:00Z", "Germany", "Ivory Coast", "E", "Toronto"],
  ["2026-06-21T03:00Z", "Ecuador", "Curaçao", "E", "Kansas City"],
  ["2026-06-21T04:00Z", "Tunisia", "Japan", "F", "Monterrey"],
  ["2026-06-21T16:00Z", "Spain", "Saudi Arabia", "H", "Atlanta"],
  ["2026-06-21T19:00Z", "Belgium", "Iran", "G", "Los Angeles"],
  ["2026-06-21T22:00Z", "Uruguay", "Cape Verde", "H", "Miami"],
  ["2026-06-22T01:00Z", "New Zealand", "Egypt", "G", "Vancouver"],
  ["2026-06-22T17:00Z", "Argentina", "Austria", "J", "Dallas"],
  ["2026-06-22T21:00Z", "France", "Iraq", "I", "Philadelphia"],
  ["2026-06-23T00:00Z", "Norway", "Senegal", "I", "New York"],
  ["2026-06-23T03:00Z", "Jordan", "Algeria", "J", "San Francisco"],
  ["2026-06-23T17:00Z", "Portugal", "Uzbekistan", "K", "Houston"],
  ["2026-06-23T20:00Z", "England", "Ghana", "L", "Boston"],
  ["2026-06-23T23:00Z", "Panama", "Croatia", "L", "Toronto"],
  ["2026-06-24T02:00Z", "Colombia", "DR Congo", "K", "Guadalajara"],
  ["2026-06-24T19:00Z", "Switzerland", "Canada", "B", "Vancouver"],
  ["2026-06-24T19:00Z", "Bosnia & Herzegovina", "Qatar", "B", "Seattle"],
  ["2026-06-24T22:00Z", "Scotland", "Brazil", "C", "Miami"],
  ["2026-06-24T22:00Z", "Morocco", "Haiti", "C", "Atlanta"],
  ["2026-06-25T01:00Z", "Czechia", "Mexico", "A", "Mexico City"],
  ["2026-06-25T01:00Z", "South Africa", "South Korea", "A", "Monterrey"],
  ["2026-06-25T20:00Z", "Ecuador", "Germany", "E", "New York"],
  ["2026-06-25T20:00Z", "Curaçao", "Ivory Coast", "E", "Philadelphia"],
  ["2026-06-25T23:00Z", "Japan", "Sweden", "F", "Dallas"],
  ["2026-06-25T23:00Z", "Tunisia", "Netherlands", "F", "Kansas City"],
  ["2026-06-26T02:00Z", "Türkiye", "United States", "D", "Los Angeles"],
  ["2026-06-26T02:00Z", "Paraguay", "Australia", "D", "San Francisco"],
  ["2026-06-26T19:00Z", "Norway", "France", "I", "Boston"],
  ["2026-06-26T19:00Z", "Senegal", "Iraq", "I", "Toronto"],
  ["2026-06-27T00:00Z", "Cape Verde", "Saudi Arabia", "H", "Houston"],
  ["2026-06-27T00:00Z", "Uruguay", "Spain", "H", "Guadalajara"],
  ["2026-06-27T03:00Z", "Egypt", "Iran", "G", "Seattle"],
  ["2026-06-27T03:00Z", "New Zealand", "Belgium", "G", "Vancouver"],
  ["2026-06-27T21:00Z", "Panama", "England", "L", "New York"],
  ["2026-06-27T21:00Z", "Croatia", "Ghana", "L", "Philadelphia"],
  ["2026-06-27T23:30Z", "Colombia", "Portugal", "K", "Miami"],
  ["2026-06-27T23:30Z", "DR Congo", "Uzbekistan", "K", "Atlanta"],
  ["2026-06-28T02:00Z", "Algeria", "Austria", "J", "Kansas City"],
  ["2026-06-28T02:00Z", "Jordan", "Argentina", "J", "Dallas"],
];

/* 16 host cities: country + a BUCK-inspired accent "color world".
   Where BUCK published a city palette (Miami, Dallas, Seattle, Houston) those
   are used; the rest are tasteful picks within the same system. */
export const VENUES = {
  "Mexico City":   { country: "Mexico",  accent: "#3CAC3B" },
  "Guadalajara":   { country: "Mexico",  accent: "#E61D25" },
  "Monterrey":     { country: "Mexico",  accent: "#E68A1D" },
  "Toronto":       { country: "Canada",  accent: "#E61D25" },
  "Vancouver":     { country: "Canada",  accent: "#1DB0E6" },
  "Los Angeles":   { country: "USA",     accent: "#F5C518" },
  "San Francisco": { country: "USA",     accent: "#E64A1D" },
  "New York":      { country: "USA",     accent: "#2A398D" },
  "Boston":        { country: "USA",     accent: "#1D5FE6" },
  "Houston":       { country: "USA",     accent: "#2A6BE6" }, // innovation blue
  "Dallas":        { country: "USA",     accent: "#5BE61D" }, // neon green
  "Philadelphia":  { country: "USA",     accent: "#2A398D" },
  "Atlanta":       { country: "USA",     accent: "#E61D6B" },
  "Seattle":       { country: "USA",     accent: "#6B2AE6" }, // deep purple + gold
  "Miami":         { country: "USA",     accent: "#1DE6C4" }, // aqua + electric pink
  "Kansas City":   { country: "USA",     accent: "#2A8DE6" },
};
export const venueOf = (city) => VENUES[city] || { country: "", accent: "#3CAC3B" };
export const FIXTURES = RAW.map((m, i) => {
  const v = VENUES[m[4]] || { country: "", accent: "#3CAC3B" };
  return {
    id: `G${String(i + 1).padStart(2, "0")}`,
    kickoff: new Date(m[0]),
    home: m[1], away: m[2], group: m[3], stage: "Group",
    city: m[4], country: v.country, accent: v.accent,
  };
}).sort((a, b) => a.kickoff - b.kickoff);

/* Knockout-round display labels and ordering. Dynamic KO fixtures arrive from
   the DB (created by the sync as teams are known) carrying one of these stage
   codes. */
export const STAGE_LABEL = {
  Group: "Group", R32: "Round of 32", R16: "Round of 16",
  QF: "Quarter-final", SF: "Semi-final", "3rd": "Third place", Final: "Final",
};
export const STAGE_ORDER = { Group: 0, R32: 1, R16: 2, QF: 3, SF: 4, "3rd": 5, Final: 6 };
export const isKnockout = (stage) => stage && stage !== "Group";

// Normalize a fixtures-table row (from the DB) into the same shape the app uses
// for hardcoded group fixtures.
export function normalizeDbFixture(row) {
  return {
    id: row.id,
    kickoff: new Date(row.kickoff),
    home: row.home, away: row.away,
    group: null, stage: row.stage || "R32",
    city: row.city || "", country: row.country || "", accent: row.accent || "#00E5FF",
  };
}

/* Verified final scores (90'+stoppage) for matches already completed,
   cross-checked against FIFA, CBS Sports and Yahoo as of Jun 15 2026.
   Organizer-entered results override these (merged in App). Add new lines
   here or just enter them via the organizer screen as matches finish. */
export const SEEDED_RESULTS = {
  G01: { h: 2, a: 0 }, // Mexico 2-0 South Africa
  G02: { h: 2, a: 1 }, // South Korea 2-1 Czechia
  G03: { h: 1, a: 1 }, // Canada 1-1 Bosnia & Herzegovina
  G04: { h: 4, a: 1 }, // United States 4-1 Paraguay
  G05: { h: 1, a: 1 }, // Qatar 1-1 Switzerland
  G06: { h: 1, a: 1 }, // Brazil 1-1 Morocco
  G07: { h: 0, a: 1 }, // Haiti 0-1 Scotland
  G08: { h: 2, a: 0 }, // Australia 2-0 Türkiye
  G09: { h: 7, a: 1 }, // Germany 7-1 Curaçao
  G10: { h: 2, a: 2 }, // Netherlands 2-2 Japan
  G11: { h: 1, a: 0 }, // Ivory Coast 1-0 Ecuador
  G12: { h: 5, a: 1 }, // Sweden 5-1 Tunisia
};

/* ---------------- scoring ----------------
   Group stage: three independent 5-pt criteria (result + home + away), max 15.
   A correctly predicted draw earns the result point.
   Knockouts: same three criteria, but "result" = who ADVANCED (so a penalty-
   shootout winner counts as the correct result even when goals are level).
   For KO matches, predictions and results may carry `adv` ("home"|"away"):
   who the predictor/actual says went through. Home/away points still use the
   post-ET goal count. */
export function scoreMatch(pred, actual, opts = {}) {
  if (!pred || !actual) return { points: 0, exact: false, breakdown: "—" };
  const vals = [pred.h, pred.a, actual.h, actual.a];
  if (vals.some((v) => v === "" || v == null)) return { points: 0, exact: false, breakdown: "—" };
  const ph = +pred.h, pa = +pred.a, ah = +actual.h, aa = +actual.a;
  const isKO = opts.knockout === true;
  let pts = 0; const parts = [];

  if (isKO) {
    // "result" = who advanced. Prefer explicit `adv`; fall back to goals if level.
    const predAdv = pred.adv || (ph > pa ? "home" : ph < pa ? "away" : null);
    const actAdv  = actual.adv || (ah > aa ? "home" : ah < aa ? "away" : null);
    if (predAdv && actAdv && predAdv === actAdv) { pts += 5; parts.push("Right team through"); }
  } else {
    if (Math.sign(ph - pa) === Math.sign(ah - aa)) { pts += 5; parts.push("Correct result"); }
  }
  if (ph === ah) { pts += 5; parts.push("Home score"); }
  if (pa === aa) { pts += 5; parts.push("Away score"); }
  const exact = ph === ah && pa === aa; // perfect call = 15, used for tiebreak
  return { points: pts, exact, breakdown: parts.join(" + ") || "No points" };
}


/* ---------------- formatting ---------------- */
/* All match times are shown in IST (Asia/Kolkata), regardless of the viewer's
   device timezone, since the pool runs on IST rules. */
const IST = "Asia/Kolkata";
export const fmtKick = (d) =>
  d.toLocaleString("en-IN", { timeZone: IST, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " IST";
// Short IST time for compact display, e.g. "Thu, 18 Jun · 10:30 PM IST"
export const fmtKickIST = (d) =>
  d.toLocaleString("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + " IST";
export const dayKey = (d) =>
  d.toLocaleDateString("en-IN", { timeZone: IST, weekday: "long", month: "short", day: "numeric" });

/* Prediction lock: a match locks at the most recent 9 PM IST at or before its
   kickoff. This groups a late-night-through-morning slate (IST) under one
   cutoff the evening before, and guarantees the lock is always before kickoff
   (no watch-then-predict loophole). */
const IST_OFFSET_MS = 5.5 * 3600 * 1000;
export function lockTime(kickoff) {
  const ist = new Date(kickoff.getTime() + IST_OFFSET_MS); // IST wall-clock in UTC fields
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth(), d = ist.getUTCDate();
  let lock = Date.UTC(y, m, d, 21, 0, 0);        // 9 PM IST on the kickoff's IST day
  if (ist.getTime() < lock) lock = Date.UTC(y, m, d - 1, 21, 0, 0); // before 9PM → previous evening
  return new Date(lock - IST_OFFSET_MS);          // back to real UTC
}

export function countdown(ms) {
  if (ms <= 0) return "kicked off";
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4);
  if (h >= 24) return `in ${Math.floor(h / 24)}d ${h % 24}h`;
  if (h >= 1) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}
