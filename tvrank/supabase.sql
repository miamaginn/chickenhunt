-- ─────────────────────────────────────────────────────────────
--  📺 Binge: Supabase setup
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  Safe to run again. Every table starts with tv_, so it can share a
--  project with other apps.
-- ─────────────────────────────────────────────────────────────

-- Profiles (one per account)
create table if not exists public.tv_profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text not null,
  name       text not null default '',
  emoji      text not null default '📺',
  created_at timestamptz not null default now()
);
create unique index if not exists tv_profiles_username_idx on public.tv_profiles (lower(username));

-- Friend requests / friendships
create table if not exists public.tv_friendships (
  id         uuid primary key default gen_random_uuid(),
  requester  uuid not null references public.tv_profiles (id) on delete cascade,
  addressee  uuid not null references public.tv_profiles (id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
create unique index if not exists tv_friendships_pair_idx
  on public.tv_friendships (least(requester, addressee), greatest(requester, addressee));

-- Show details, cached from TVmaze whenever someone logs a show
create table if not exists public.tv_shows (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Each person's log + ratings for a show
create table if not exists public.tv_logs (
  user_id      uuid not null references public.tv_profiles (id) on delete cascade,
  show_id      text not null,
  status       text not null default 'finished' check (status in ('watching', 'finished', 'want', 'dropped')),
  rating       numeric(2,1) check (rating between 0.5 and 5),
  seasons      jsonb not null default '{}'::jsonb,
  watched_with uuid[] not null default '{}',
  note         text not null default '',
  score        numeric(3,2),
  updated_at   timestamptz not null default now(),
  primary key (user_id, show_id)
);
create index if not exists tv_logs_show_idx on public.tv_logs (show_id);

-- ───── Helpers ─────
create or replace function public.tv_are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tv_friendships
    where status = 'accepted'
      and ((requester = a and addressee = b) or (requester = b and addressee = a))
  );
$$;

create or replace function public.tv_username_available(uname text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from tv_profiles where lower(username) = lower(uname));
$$;

-- Everyone's average for a list of shows (individual ratings stay private to friends)
create or replace function public.tv_show_stats(ids text[])
returns table (show_id text, avg numeric, count bigint)
language sql stable security definer set search_path = public as $$
  select show_id, round(avg(score), 2), count(*)
  from tv_logs where show_id = any(ids) and score is not null
  group by show_id;
$$;

-- Make the profile automatically when someone signs up
create or replace function public.tv_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.raw_user_meta_data ? 'username' then
    insert into tv_profiles (id, username, name, emoji)
    values (
      new.id,
      new.raw_user_meta_data->>'username',
      coalesce(new.raw_user_meta_data->>'name', ''),
      coalesce(new.raw_user_meta_data->>'emoji', '📺')
    )
    on conflict (id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists tv_on_auth_user_created on auth.users;
create trigger tv_on_auth_user_created
  after insert on auth.users for each row execute function public.tv_handle_new_user();

-- ───── Who can see what ─────
alter table public.tv_profiles    enable row level security;
alter table public.tv_friendships enable row level security;
alter table public.tv_shows       enable row level security;
alter table public.tv_logs        enable row level security;

drop policy if exists "profiles: signed-in can read" on public.tv_profiles;
drop policy if exists "profiles: own insert"         on public.tv_profiles;
drop policy if exists "profiles: own update"         on public.tv_profiles;
create policy "profiles: signed-in can read" on public.tv_profiles for select to authenticated using (true);
create policy "profiles: own insert"         on public.tv_profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles: own update"         on public.tv_profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "friendships: involved can read"    on public.tv_friendships;
drop policy if exists "friendships: send request"         on public.tv_friendships;
drop policy if exists "friendships: addressee can accept" on public.tv_friendships;
drop policy if exists "friendships: either can remove"    on public.tv_friendships;
create policy "friendships: involved can read"    on public.tv_friendships for select to authenticated using (auth.uid() in (requester, addressee));
create policy "friendships: send request"         on public.tv_friendships for insert to authenticated with check (requester = auth.uid() and status = 'pending');
create policy "friendships: addressee can accept" on public.tv_friendships for update to authenticated using (addressee = auth.uid()) with check (addressee = auth.uid());
create policy "friendships: either can remove"    on public.tv_friendships for delete to authenticated using (auth.uid() in (requester, addressee));

drop policy if exists "shows: anyone can read"     on public.tv_shows;
drop policy if exists "shows: signed-in can add"   on public.tv_shows;
drop policy if exists "shows: signed-in can update" on public.tv_shows;
create policy "shows: anyone can read"      on public.tv_shows for select to anon, authenticated using (true);
create policy "shows: signed-in can add"    on public.tv_shows for insert to authenticated with check (true);
create policy "shows: signed-in can update" on public.tv_shows for update to authenticated using (true) with check (true);

-- You see your own logs, your friends' logs, and logs where someone tagged you as "watched with".
drop policy if exists "logs: me, friends, tagged" on public.tv_logs;
drop policy if exists "logs: own insert"          on public.tv_logs;
drop policy if exists "logs: own update"          on public.tv_logs;
drop policy if exists "logs: own delete"          on public.tv_logs;
create policy "logs: me, friends, tagged" on public.tv_logs for select to authenticated
  using (user_id = auth.uid() or auth.uid() = any(watched_with) or public.tv_are_friends(auth.uid(), user_id));
create policy "logs: own insert" on public.tv_logs for insert to authenticated with check (user_id = auth.uid());
create policy "logs: own update" on public.tv_logs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "logs: own delete" on public.tv_logs for delete to authenticated using (user_id = auth.uid());

grant select on public.tv_shows to anon;
grant select, insert, update, delete on public.tv_profiles, public.tv_friendships, public.tv_shows, public.tv_logs to authenticated;
grant execute on function public.tv_username_available(text) to anon, authenticated;
grant execute on function public.tv_show_stats(text[]) to anon, authenticated;
grant execute on function public.tv_are_friends(uuid, uuid) to authenticated;
