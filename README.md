# World Cup Predictor 2026 — deploy guide

A player-facing score-prediction game. Players sign up with email + password and
a display name, predict same-day match scores, and a live leaderboard ranks
everyone across the whole tournament. Data and accounts live in Supabase
(Postgres + Supabase Auth); the site deploys to Vercel. Both have free tiers that
comfortably cover an office pool.

Scoring: exact score (both teams) = 10, one team's score exact = 5, correct
result = 5. These stack, max 15/match. 90' + stoppage only.

---

## What you need (all free)
- A [Supabase](https://supabase.com) account
- A [Vercel](https://vercel.com) account
- [Node.js](https://nodejs.org) 18+ installed locally (only to test before deploy)
- A GitHub account (easiest path to Vercel) — optional but recommended

---

## Step 1 — Create the database (Supabase)

1. Go to supabase.com → **New project**. Pick a name, a strong database
   password (you won't need it for this app), and a region near your players.
2. Wait ~2 minutes for it to provision.
3. Left sidebar → **SQL Editor** → **New query**.
4. Open `supabase_schema.sql` from this project, copy all of it, paste into the
   editor, and click **Run**. You should see "Success. No rows returned."
   This creates the `profiles`, `predictions`, `results`, and `organizers`
   tables with security policies tied to Supabase Auth.
5. Left sidebar → **Project Settings** → **API**. Copy two values:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long string under "Project API keys")

> The anon key is meant to be public in a browser app. Do NOT copy the
> `service_role` key into this project — that one is a secret.

**Email confirmation (decide now):** By default Supabase emails a confirmation
link on signup. For a small office pool that's friction — go to
**Authentication → Providers → Email** and turn **Confirm email** OFF so people
can sign up and play immediately. Leave it ON if you want verified emails (then
players must click the link before their first login).

---

## Step 2 — Run it locally (to confirm it works)

1. In a terminal, from this project folder:
   ```
   npm install
   ```
2. Copy the env template and fill in your two values:
   ```
   cp .env.example .env
   ```
   Edit `.env` so it reads:
   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
3. Start it:
   ```
   npm run dev
   ```
4. Open the URL it prints (usually http://localhost:5173). Create a player,
   make a prediction, then open the same URL in a private window and create a
   second player — you should see both on the leaderboard. That confirms the
   database is wired correctly.

---

## Step 3 — Deploy to the web (Vercel)

**Easiest path (via GitHub):**
1. Push this folder to a new GitHub repo.
2. On vercel.com → **Add New → Project** → import that repo.
3. Vercel auto-detects Vite. Before deploying, open **Environment Variables**
   and add the same two keys from Step 1:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Click **Deploy**. In ~1 minute you get a public URL like
   `your-pool.vercel.app`. Share that link with your players.

**Without GitHub (CLI):**
```
npm i -g vercel
vercel            # follow prompts, link/create the project
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY
vercel --prod
```

Any time you change code, re-deploy (GitHub push auto-deploys; CLI: `vercel --prod`).

---

## Step 5 — Make yourself an organizer

Organizers are the only accounts allowed to enter results. After you've signed
up in the app (Step 4 / your live site):

1. Supabase → **SQL Editor** → New query. Find your user id:
   ```
   select id, email from auth.users;
   ```
2. Copy your id, then run (paste your real UUID):
   ```
   insert into organizers (user_id) values ('YOUR-UUID-HERE');
   ```
3. Refresh the app. The **⋯** menu now shows "Organizer: enter results."

Repeat for any co-organizers. Everyone else only ever sees the player view.

---

## Running the contest

- **Players** visit the link, sign up (email + password + display name), and
  predict each day's matches. Predictions lock at kickoff and only that day's
  fixtures (US Eastern) are open.
- **Organizers** enter actual scores: **⋯** menu → **Organizer: enter results**.
  Type each 90' result as matches finish; the leaderboard updates for everyone
  within ~15 seconds. (If you set up semi-live sync — see SEMI_LIVE_SETUP.md —
  finished scores arrive automatically and you rarely touch this.)
- The 12 completed June 11–14 matches are pre-seeded with verified scores;
  spot-check them before relying on them.

---

## Honest limits (read this)

**Login is now real.** Email + password via Supabase Auth, with Row Level
Security so a logged-in user can only write their *own* predictions, and only
accounts in the `organizers` table can write results. This is genuine account
security, not the old PIN scheme. Two practical notes: passwords are managed by
Supabase (you never see or store them), and if email confirmation is OFF anyone
with an email address can create an account — fine for an internal link you don't
advertise, but it's not an invite-only gate. To restrict who can join, keep the
link private, or add an allowlist check.

**Scores are entered by hand unless you set up semi-live sync.** Base install:
an organizer types results. With the optional Edge Function (SEMI_LIVE_SETUP.md),
finished matches sync automatically from a free API, with a few minutes' delay.
Either way the leaderboard is live; only the *source* of the score differs.

**Forgotten passwords** use Supabase's built-in reset email. You can enable/
customize that under Authentication → Email Templates. No custom code needed.

---

## Where things live (if you want to edit)

- `src/data.js` — fixtures, host cities + colors, team facts, seeded results,
  scoring rules. Edit match data or facts here.
- `src/db.js` — all database access + auth. Swap backends here without touching UI.
- `src/App.jsx` — the whole interface and game logic.
- `src/supabase.js` — client setup from env vars.
- `supabase_schema.sql` — database tables + security policies.

To add an organizer, insert their auth user id into the `organizers` table (above).
To adjust city colors or add the real BUCK palettes, edit `VENUES` in `src/data.js`.
