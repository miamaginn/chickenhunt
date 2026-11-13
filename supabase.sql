-- ─────────────────────────────────────────────────────────────
--  🐓 Chicken Hunt: Supabase setup
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  Safe to run again (it won't delete data).
-- ─────────────────────────────────────────────────────────────

create table if not exists public.ch_games (
  id   text primary key,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.ch_teams (
  id         uuid primary key default gen_random_uuid(),
  game_id    text not null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ch_teams_game_idx on public.ch_teams (game_id);

create table if not exists public.ch_visits (
  id      uuid primary key default gen_random_uuid(),
  game_id text not null,
  team_id uuid not null references public.ch_teams (id) on delete cascade,
  bar     text not null,
  at      bigint not null
);
create index if not exists ch_visits_team_idx on public.ch_visits (team_id);

-- Open access for a one-night party game (anyone with the site link can play).
alter table public.ch_games  enable row level security;
alter table public.ch_teams  enable row level security;
alter table public.ch_visits enable row level security;
drop policy if exists "party: anyone" on public.ch_games;
drop policy if exists "party: anyone" on public.ch_teams;
drop policy if exists "party: anyone" on public.ch_visits;
create policy "party: anyone" on public.ch_games  for all to anon, authenticated using (true) with check (true);
create policy "party: anyone" on public.ch_teams  for all to anon, authenticated using (true) with check (true);
create policy "party: anyone" on public.ch_visits for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.ch_games, public.ch_teams, public.ch_visits to anon, authenticated;

-- Live updates
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.ch_games;  exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.ch_teams;  exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.ch_visits; exception when duplicate_object then null; end;
  end if;
end $$;

-- ───── Functions (so updates are atomic: no lost bar counts, only one winner) ─────

create or replace function public.ch_update_game(gid text, patch jsonb)
returns void language sql security definer set search_path = public as $$
  insert into ch_games (id, data) values (gid, patch)
  on conflict (id) do update set data = ch_games.data || excluded.data;
$$;

create or replace function public.ch_update_team(tid uuid, patch jsonb)
returns void language sql security definer set search_path = public as $$
  update ch_teams set data = data || patch where id = tid;
$$;

create or replace function public.ch_add_visit(gid text, tid uuid, bar_name text, at_ms bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into ch_visits (game_id, team_id, bar, at) values (gid, tid, bar_name, at_ms);
  update ch_teams
     set data = data || jsonb_build_object(
           'barCount', coalesce((data->>'barCount')::int, 0) + 1,
           'lastVisitAt', at_ms)
   where id = tid;
end $$;

create or replace function public.ch_remove_visit(tid uuid, vid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from ch_visits where id = vid and team_id = tid;
  if found then
    update ch_teams
       set data = data || jsonb_build_object('barCount', greatest(coalesce((data->>'barCount')::int, 1) - 1, 0))
     where id = tid;
  end if;
end $$;

create or replace function public.ch_claim_find(gid text, tid uuid, at_ms bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g jsonb; t jsonb; rank int;
begin
  insert into ch_games (id) values (gid) on conflict (id) do nothing;
  select data into g from ch_games where id = gid for update;   -- one claim at a time
  select data into t from ch_teams where id = tid for update;
  if t is null then raise exception 'Team not found'; end if;
  if (t->>'foundAt') is not null then
    return jsonb_build_object('rank', (t->>'findRank')::int, 'already', true);
  end if;
  rank := coalesce((g->>'findCount')::int, 0) + 1;
  update ch_teams set data = data || jsonb_build_object('foundAt', at_ms, 'findRank', rank) where id = tid;
  g := g || jsonb_build_object('findCount', rank);
  if g->'winner' is null or jsonb_typeof(g->'winner') = 'null' then
    g := g || jsonb_build_object('winner', jsonb_build_object(
      'teamId', tid, 'name', t->>'name', 'emoji', t->>'emoji', 'at', at_ms));
  end if;
  update ch_games set data = g where id = gid;
  return jsonb_build_object('rank', rank);
end $$;

create or replace function public.ch_unfind(gid text, tid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update ch_teams set data = data || '{"foundAt": null, "findRank": null}'::jsonb where id = tid;
  update ch_games set data = data || '{"winner": null}'::jsonb
   where id = gid and data->'winner'->>'teamId' = tid::text;
end $$;

create or replace function public.ch_reset_hunt(gid text, wipe boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from ch_visits where game_id = gid;
  if wipe then
    delete from ch_teams where game_id = gid;
  else
    update ch_teams
       set data = data || '{"barCount": 0, "foundAt": null, "findRank": null, "lastVisitAt": null}'::jsonb
     where game_id = gid;
  end if;
  insert into ch_games (id) values (gid) on conflict (id) do nothing;
  update ch_games
     set data = data || '{"roostedAt": null, "winner": null, "findCount": 0, "spends": []}'::jsonb
   where id = gid;
end $$;

grant execute on function
  public.ch_update_game(text, jsonb), public.ch_update_team(uuid, jsonb),
  public.ch_add_visit(text, uuid, text, bigint), public.ch_remove_visit(uuid, uuid),
  public.ch_claim_find(text, uuid, bigint), public.ch_unfind(text, uuid),
  public.ch_reset_hunt(text, boolean)
to anon, authenticated;
