-- HYPERDRIVE simulator — account system schema (Supabase / Postgres)
-- Applied to the "nrl" Supabase project. Safe to re-run.

-- ------------------------------------------------------------------ profiles
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null,
  display_name text not null,
  settings     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  constraint profiles_display_name_len check (char_length(display_name) between 1 and 32),
  constraint profiles_settings_size check (pg_column_size(settings) < 16384)
);
create unique index if not exists profiles_username_lower_idx on public.profiles (lower(username));

-- ------------------------------------------------------------------ matches
create table if not exists public.matches (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  red_score   integer not null check (red_score between 0 and 5000),
  blue_score  integer not null check (blue_score between 0 and 5000),
  winner      text not null check (winner in ('red', 'blue', 'tie')),
  red_rp      smallint not null check (red_rp between 0 and 6),
  blue_rp     smallint not null check (blue_rp between 0 and 6),
  star_map    text not null check (star_map ~ '^[CG]{3}$'),
  details     jsonb not null default '{}'::jsonb check (pg_column_size(details) < 16384),
  created_at  timestamptz not null default now()
);
create index if not exists matches_user_created_idx on public.matches (user_id, created_at desc);

-- ------------------------------------------------------------------ row level security
alter table public.profiles enable row level security;
alter table public.matches  enable row level security;

drop policy if exists "profiles: read own"   on public.profiles;
drop policy if exists "profiles: update own" on public.profiles;
drop policy if exists "matches: read own"    on public.matches;
drop policy if exists "matches: insert own"  on public.matches;
drop policy if exists "matches: delete own"  on public.matches;

create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "matches: read own" on public.matches
  for select to authenticated using (user_id = (select auth.uid()));
create policy "matches: insert own" on public.matches
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "matches: delete own" on public.matches
  for delete to authenticated using (user_id = (select auth.uid()));

-- column-level privileges: users may edit only their display name and settings
revoke all on public.profiles from anon, authenticated;
revoke all on public.matches  from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, settings, updated_at) on public.profiles to authenticated;
grant select, insert, delete on public.matches to authenticated;

-- ------------------------------------------------------------------ profile row created at sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  uname text := coalesce(new.raw_user_meta_data ->> 'username', '');
  dname text;
begin
  if uname !~ '^[A-Za-z0-9_]{3,20}$' then
    uname := 'driver_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  dname := left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), uname), 32);
  insert into public.profiles (id, username, display_name) values (new.id, uname, dname);
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------ RPCs
create or replace function public.username_available(name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select name ~ '^[A-Za-z0-9_]{3,20}$'
     and not exists (select 1 from public.profiles p where lower(p.username) = lower(name));
$$;
revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- global leaderboard: each driver's best squad score in a full match
create or replace function public.leaderboard(lim integer default 20)
returns table (rank bigint, username text, display_name text, best_score integer, squad text, matches bigint, achieved_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with best as (
    select distinct on (m.user_id)
           m.user_id,
           greatest(m.red_score, m.blue_score) as best_score,
           case when m.red_score >= m.blue_score then 'red' else 'blue' end as squad,
           m.created_at
      from public.matches m
     order by m.user_id, greatest(m.red_score, m.blue_score) desc, m.created_at asc
  ), counts as (
    select user_id, count(*) as n from public.matches group by user_id
  )
  select row_number() over (order by b.best_score desc, b.created_at asc),
         p.username, p.display_name, b.best_score, b.squad, c.n, b.created_at
    from best b
    join public.profiles p on p.id = b.user_id
    join counts c on c.user_id = b.user_id
   order by b.best_score desc, b.created_at asc
   limit least(greatest(lim, 1), 100);
$$;
revoke execute on function public.leaderboard(integer) from public;
grant execute on function public.leaderboard(integer) to anon, authenticated;

-- personal stats for the signed-in driver (runs with the caller's RLS)
create or replace function public.my_stats()
returns json language sql stable security invoker set search_path = '' as $$
  select json_build_object(
    'matches',   count(*),
    'best',      coalesce(max(greatest(red_score, blue_score)), 0),
    'avg',       coalesce(round(avg((red_score + blue_score) / 2.0), 1), 0),
    'star_maps', coalesce(sum(coalesce((details ->> 'red_maps')::int, 0) + coalesce((details ->> 'blue_maps')::int, 0)), 0),
    'balances',  coalesce(sum(coalesce((details ->> 'balances')::int, 0)), 0)
  )
  from public.matches where user_id = (select auth.uid());
$$;
revoke execute on function public.my_stats() from public, anon;
grant execute on function public.my_stats() to authenticated;

-- ------------------------------------------------------------------ self-service account deletion
-- deletes the caller's auth user; profiles and matches go with it (on delete cascade)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Apply once to existing deployments (also included by schema.sql below).
-- Browser-submitted history is deliberately unverified. Only a trusted backend
-- may grant verified status; no verification backend is supplied by this app.
alter table public.matches add column if not exists verified boolean not null default false;
revoke insert on public.matches from authenticated;
grant insert (user_id, red_score, blue_score, winner, red_rp, blue_rp, star_map, details) on public.matches to authenticated;

create or replace function public.leaderboard(lim integer default 20)
returns table (rank bigint, username text, display_name text, best_score integer, squad text, matches bigint, achieved_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with best as (
    select distinct on (m.user_id) m.user_id,
      greatest(m.red_score, m.blue_score) as best_score,
      case when m.red_score >= m.blue_score then 'red' else 'blue' end as squad,
      m.created_at
    from public.matches m where m.verified
    order by m.user_id, greatest(m.red_score, m.blue_score) desc, m.created_at asc
  ), counts as (
    select user_id, count(*) as n from public.matches where verified group by user_id
  )
  select row_number() over (order by b.best_score desc, b.created_at asc),
    p.username, p.display_name, b.best_score, b.squad, c.n, b.created_at
  from best b join public.profiles p on p.id = b.user_id join counts c on c.user_id = b.user_id
  order by b.best_score desc, b.created_at asc limit least(greatest(lim, 1), 100);
$$;

-- JSON counters are optional. Reject bad new data, tolerate legacy malformed data.
create or replace function public.safe_match_counter(value jsonb)
returns integer language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(value) = 'number' and value::text ~ '^[0-9]{1,6}$'
    then least((value::text)::integer, 10000) else 0 end;
$$;
revoke all on function public.safe_match_counter(jsonb) from public;
grant execute on function public.safe_match_counter(jsonb) to authenticated;
create or replace function public.my_stats()
returns json language sql stable security invoker set search_path = '' as $$
  select json_build_object(
    'matches', count(*),
    'best', coalesce(max(greatest(red_score, blue_score)), 0),
    'avg', coalesce(round(avg((red_score + blue_score) / 2.0), 1), 0),
    'star_maps', coalesce(sum(public.safe_match_counter(details -> 'red_maps') + public.safe_match_counter(details -> 'blue_maps')), 0),
    'balances', coalesce(sum(public.safe_match_counter(details -> 'balances')), 0)
  ) from public.matches where user_id = (select auth.uid());
$$;

