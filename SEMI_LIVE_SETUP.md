# Semi-live results — setup guide

This adds automatic result syncing. A Supabase Edge Function pulls finished
World Cup matches from football-data.org (free) every few minutes and writes the
final scores into your `results` table. Your app already reads that table, so
finished scores and the leaderboard update on their own.

**What "semi-live" means here:** the free API gives *delayed* scores, not a
second-by-second feed. A finished match's result typically lands within a few
minutes. Since your contest scores only the final 90' result, that delay
doesn't affect fairness — you just don't get a ticking live scoreline mid-match.
You can still enter any score by hand (organizer screen); manual entry and the
auto-sync both write the same table, last write wins.

---

## Step 1 — Get a free football-data.org API token
1. Go to https://www.football-data.org/client/register
2. Register (free). You'll get an **API token** by email / on your dashboard.
3. The free tier includes the FIFA World Cup and allows 10 requests/minute —
   plenty, since we poll only every few minutes.

## Step 2 — Install the Supabase CLI (one time)
```
npm install -g supabase
supabase login
```
Then link your project (find the ref in your Supabase dashboard URL):
```
supabase link --project-ref YOUR-PROJECT-REF
```

## Step 3 — Set the function's secret
```
supabase secrets set FOOTBALL_DATA_TOKEN=your-football-data-token
```
(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically to
Edge Functions — you do NOT set those. The function uses the service role key,
which writes results directly; no organizer passphrase needed.)

## Step 4 — Deploy the function
From the project root (the folder with `supabase/`):
```
supabase functions deploy sync-results
```

## Step 5 — Test it once, manually
```
supabase functions invoke sync-results
```
You should get back JSON like:
```
{ "ok": true, "written": 12, "skipped": 0, "unmatched": [] }
```
- `written` = matches whose final score was saved.
- `unmatched` = any API match name our map didn't recognize. If this list is
  non-empty, copy the names to me (or add them to the `ALIASES` map in
  `supabase/functions/sync-results/index.ts`) and redeploy.

## Step 6 — Schedule it (auto-run every few minutes)
In the Supabase dashboard: **Database → Cron** (pg_cron), or **Edge Functions →
Schedules**, create a schedule that invokes `sync-results`. A sensible cadence:
- Every 5 minutes during the tournament: `*/5 * * * *`

That's it. Finished matches now flow in automatically.

---

## Cost
- football-data.org free tier: free, World Cup included, 10 req/min.
- Supabase Edge Functions: free tier covers far more than every-5-min calls.
Total added cost: $0.

## Honest limits
- **Delayed, not real-time.** Fine for final-score scoring; not a live ticker.
- **Name matching can miss.** If the API spells a team in a way our map doesn't
  know, that match shows in `unmatched` and isn't written until you add an alias.
  This is why Step 5 matters — run it once and check `unmatched` is empty.
- **fullTime score assumption.** The function reads the API's `fullTime` score.
  For group games that's regulation + stoppage, which matches your rules. If you
  later add knockout matches (where `fullTime` can include extra time on some
  feeds), verify the field still means 90' for your scoring before trusting it.
- **The seeded June 11–14 scores** remain in the app as a fallback; once the API
  sync runs, real fetched results overwrite them in the `results` table.
