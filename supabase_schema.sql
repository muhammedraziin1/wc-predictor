-- =====================================================================
--  World Cup Predictor — schema WITH Supabase Auth (email + password)
--  Run in Supabase: SQL Editor → New query → paste → Run.
--  This REPLACES the PIN-based schema. If you already ran the old one,
--  drop those tables first (see bottom of this file).
-- =====================================================================

-- ---- profiles: one row per authenticated user (their display name) ----
-- Linked 1:1 to auth.users. The user's id IS the auth user id.
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

create unique index if not exists profiles_name_unique on profiles (lower(name));

-- ---- predictions: belong to an auth user ----
create table if not exists predictions (
  user_id     uuid not null references auth.users(id) on delete cascade,
  match_id    text not null,
  home        smallint not null check (home between 0 and 30),
  away        smallint not null check (away between 0 and 30),
  updated_at  timestamptz not null default now(),
  primary key (user_id, match_id)
);

-- ---- results: organizer-entered actual scores ----
create table if not exists results (
  match_id    text primary key,
  home        smallint not null check (home between 0 and 30),
  away        smallint not null check (away between 0 and 30),
  updated_at  timestamptz not null default now()
);

-- ---- organizers: which users may write results ----
create table if not exists organizers (
  user_id     uuid primary key references auth.users(id) on delete cascade
);

-- =====================================================================
--  Row Level Security — the real security win over PINs.
--  A logged-in user can ONLY write their own predictions; results can
--  only be written by users listed in `organizers`.
-- =====================================================================
alter table profiles    enable row level security;
alter table predictions enable row level security;
alter table results     enable row level security;
alter table organizers  enable row level security;

-- profiles: anyone can read the roster (leaderboard); a user may create and
-- edit ONLY their own profile row.
create policy profiles_read   on profiles for select using (true);
create policy profiles_insert on profiles for insert with check (auth.uid() = id);
create policy profiles_update on profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- predictions: anyone can read (leaderboard); a user writes ONLY their own rows.
create policy preds_read   on predictions for select using (true);
create policy preds_insert on predictions for insert with check (auth.uid() = user_id);
create policy preds_update on predictions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy preds_delete on predictions for delete using (auth.uid() = user_id);

-- results: anyone can read; only organizers can write.
create policy results_read   on results for select using (true);
create policy results_write  on results for insert
  with check (exists (select 1 from organizers o where o.user_id = auth.uid()));
create policy results_update  on results for update
  using (exists (select 1 from organizers o where o.user_id = auth.uid()))
  with check (exists (select 1 from organizers o where o.user_id = auth.uid()));

-- organizers: readable so the app can tell if you're an organizer; not
-- client-writable (you add organizers yourself in the SQL editor; see below).
create policy organizers_read on organizers for select using (true);

-- =====================================================================
--  AFTER you sign up in the app, make yourself an organizer:
--    1) Sign up (creates your auth user + profile).
--    2) Find your user id:  select id, email from auth.users;
--    3) Insert it here:      insert into organizers (user_id) values ('YOUR-UUID');
--  Now the organizer "enter results" screen works for you, and the
--  sync-results Edge Function (service role) can write too.
-- =====================================================================

-- ---- If migrating from the old PIN schema, drop the old tables first: ----
-- drop table if exists predictions cascade;
-- drop table if exists results cascade;
-- drop table if exists players cascade;
-- (then re-run everything above)
