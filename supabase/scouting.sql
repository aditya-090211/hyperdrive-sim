-- OVERDRIVE SCOUT — scouting schema (Supabase / Postgres). Safe to re-run.
-- Depends on schema.sql (profiles, auth). Every table is behind row-level security:
--   * a scout sees only their own team's events, members and reports;
--   * Overdrive 009 staff listed in scout_admins can read every team's data (see /privacy and /terms);
--   * writes go through column grants, RLS checks and SECURITY DEFINER RPCs that validate their input.

-- ------------------------------------------------------------------ tables
create table if not exists public.scout_admins (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

create table if not exists public.scout_consents (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  terms_version text not null check (terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  accepted_at   timestamptz not null default now()
);

create table if not exists public.scout_teams (
  id         uuid primary key default gen_random_uuid(),
  number     text not null check (number ~ '^[0-9]{1,6}$'),
  name       text not null check (char_length(btrim(name)) between 1 and 48),
  join_code  text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
-- "009" and "9" are the same team
create unique index if not exists scout_teams_number_idx on public.scout_teams ((coalesce(nullif(ltrim(number, '0'), ''), '0')));

create table if not exists public.scout_members (
  team_id      uuid not null references public.scout_teams (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'scout' check (role in ('owner', 'lead', 'scout')),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  joined_at    timestamptz not null default now(),
  primary key (team_id, user_id),
  unique (user_id)                                   -- one team per account
);

create table if not exists public.scout_events (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.scout_teams (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  starts_on  date,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists scout_events_team_idx on public.scout_events (team_id, created_at desc);

create table if not exists public.scout_reports (
  id           uuid primary key,                     -- generated on the device so offline retries are idempotent
  team_id      uuid not null references public.scout_teams (id) on delete cascade,
  event_id     uuid not null references public.scout_events (id) on delete cascade,
  match_type   text not null default 'qm' check (match_type in ('pr', 'qm', 'sf', 'f')),
  match_number smallint not null check (match_number between 1 and 999),
  robot_number text not null check (robot_number ~ '^[0-9]{1,6}$'),
  alliance     text not null check (alliance in ('red', 'blue')),
  station      smallint not null check (station between 1 and 2),
  scout_id     uuid default auth.uid() references auth.users (id) on delete set null,
  data         jsonb not null,
  points       smallint not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists scout_reports_event_idx on public.scout_reports (event_id, robot_number);
create index if not exists scout_reports_team_idx on public.scout_reports (team_id, created_at desc);

create table if not exists public.scout_pits (
  id           uuid primary key,
  team_id      uuid not null references public.scout_teams (id) on delete cascade,
  event_id     uuid not null references public.scout_events (id) on delete cascade,
  robot_number text not null check (robot_number ~ '^[0-9]{1,6}$'),
  scout_id     uuid default auth.uid() references auth.users (id) on delete set null,
  data         jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (event_id, robot_number)
);

-- ------------------------------------------------------------------ helpers (run as owner so policies can use them without recursion)
create or replace function public.scout_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.scout_admins a where a.user_id = (select auth.uid()));
$$;
create or replace function public.scout_my_team() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.team_id from public.scout_members m where m.user_id = (select auth.uid());
$$;
create or replace function public.scout_my_role() returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.scout_members m where m.user_id = (select auth.uid());
$$;
create or replace function public.scout_can_read(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select t is not null and (t = public.scout_my_team() or public.scout_is_admin());
$$;
-- Overdrive Scout accounts sign in with Google; checked on every way into a team
create or replace function public.scout_is_google() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() -> 'app_metadata' -> 'providers') ? 'google', false)
      or coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google';
$$;
-- names people see: printable, at least one letter or digit, no invisible or direction-changing characters
create or replace function public.scout_name_ok(n text) returns boolean
language sql immutable set search_path = '' as $$
  select n is not null and n ~ '[[:alnum:]]' and n !~ '[\u0000-\u001f\u007f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]';
$$;
revoke all on function public.scout_is_admin(), public.scout_my_team(), public.scout_my_role(), public.scout_can_read(uuid) from public, anon;
grant execute on function public.scout_is_admin(), public.scout_my_team(), public.scout_my_role(), public.scout_can_read(uuid) to authenticated;
revoke all on function public.scout_is_google(), public.scout_name_ok(text) from public, anon;
grant execute on function public.scout_is_google(), public.scout_name_ok(text) to authenticated;
do $$ begin
  alter table public.scout_members add constraint scout_members_name_ok check (public.scout_name_ok(display_name));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.scout_teams add constraint scout_teams_name_ok check (public.scout_name_ok(name));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.scout_events add constraint scout_events_name_ok check (public.scout_name_ok(name));
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------------ report validation
-- Every key must be known and in range; unknown keys are rejected.
create or replace function public.scout_valid_report(d jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb;
begin
  if d is null or jsonb_typeof(d) <> 'object' or pg_column_size(d) > 4096 then return false; end if;
  for k, v in select * from jsonb_each(d) loop
    if k in ('m_high', 'm_star', 'm_drop', 'm_gstar', 'm_gdrop', 'm_miss', 'l_high', 'l_star', 'l_drop', 'l_gstar', 'l_gdrop', 'l_apex', 'l_miss', 'minor', 'major') then
      if jsonb_typeof(v) <> 'number' or v::text !~ '^[0-9]{1,2}$' or (v::text)::int > 60 then return false; end if;
    elsif k in ('defense', 'driver', 'speed') then
      if jsonb_typeof(v) <> 'number' or v::text !~ '^[0-5]$' then return false; end if;
    elsif k in ('noshow', 'died', 'tipped', 'starburst') then
      if jsonb_typeof(v) <> 'boolean' then return false; end if;
    elsif k = 'start' then
      if v not in ('"l"', '"c"', '"r"', 'null') then return false; end if;
    elsif k = 'payload' then
      if v not in ('"none"', '"attempt"', '"scored"') then return false; end if;
    elsif k = 'station' then
      if v not in ('"none"', '"engage"', '"dock"', '"balance"') then return false; end if;
    elsif k = 'tags' then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 8 then return false; end if;
      if exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string'
                 or e #>> '{}' not in ('fast', 'accurate', 'defender', 'clumsy', 'consistent', 'golden', 'apex', 'pusher', 'quiet-hp', 'carried')) then return false; end if;
    elsif k = 'note' then
      if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 500 then return false; end if;
    elsif k = 'v' then
      if v <> '1' then return false; end if;
    else return false;
    end if;
  end loop;
  return true;
end $$;

create or replace function public.scout_valid_pit(d jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb;
begin
  if d is null or jsonb_typeof(d) <> 'object' or pg_column_size(d) > 4096 then return false; end if;
  for k, v in select * from jsonb_each(d) loop
    if k = 'drive' then
      if v not in ('"tank"', '"mecanum"', '"swerve"', '"omni"', '"other"') then return false; end if;
    elsif k = 'motors' then
      if jsonb_typeof(v) <> 'number' or v::text !~ '^[0-9]{1,2}$' or (v::text)::int > 16 then return false; end if;
    elsif k = 'weight' then
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric < 0 or (v::text)::numeric > 20 then return false; end if;
    elsif k in ('high', 'star', 'apex', 'golden', 'payload', 'auto') then
      if jsonb_typeof(v) <> 'boolean' then return false; end if;
    elsif k = 'station' then
      if v not in ('"none"', '"engage"', '"dock"', '"balance"') then return false; end if;
    elsif k in ('strategy', 'note') then
      if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 500 then return false; end if;
    elsif k = 'v' then
      if v <> '1' then return false; end if;
    else return false;
    end if;
  end loop;
  return true;
end $$;

-- points this robot put on the board (HYPERDRIVE Table 4.5.1); computed here so every client agrees
create or replace function public.scout_report_points(d jsonb) returns smallint
language sql immutable set search_path = '' as $$
  select least(32000, (
      3 * (coalesce((d ->> 'm_high')::int, 0) + coalesce((d ->> 'l_high')::int, 0))
    + 5 * (coalesce((d ->> 'm_star')::int, 0) + coalesce((d ->> 'l_star')::int, 0))
    + 1 * (coalesce((d ->> 'm_drop')::int, 0) + coalesce((d ->> 'l_drop')::int, 0))
    + 7 * (coalesce((d ->> 'm_gstar')::int, 0) + coalesce((d ->> 'l_gstar')::int, 0))
    + 3 * (coalesce((d ->> 'm_gdrop')::int, 0) + coalesce((d ->> 'l_gdrop')::int, 0))
    + 9 * coalesce((d ->> 'l_apex')::int, 0)
    + case d ->> 'station' when 'engage' then 3 when 'dock' then 8 when 'balance' then 15 else 0 end))::smallint;
$$;
revoke all on function public.scout_valid_report(jsonb), public.scout_valid_pit(jsonb), public.scout_report_points(jsonb) from public, anon;
grant execute on function public.scout_valid_report(jsonb), public.scout_valid_pit(jsonb), public.scout_report_points(jsonb) to authenticated;

do $$ begin
  alter table public.scout_reports add constraint scout_reports_data_valid check (public.scout_valid_report(data));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.scout_pits add constraint scout_pits_data_valid check (public.scout_valid_pit(data));
exception when duplicate_object then null; end $$;

-- server-owned columns: points, timestamps, and the scout cannot be reassigned
create or replace function public.scout_reports_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.points := public.scout_report_points(new.data);
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_at := now(); new.scout_id := (select auth.uid());
  else new.created_at := old.created_at; new.scout_id := old.scout_id; new.team_id := old.team_id; new.id := old.id;
  end if;
  return new;
end $$;
drop trigger if exists scout_reports_stamp on public.scout_reports;
create trigger scout_reports_stamp before insert or update on public.scout_reports for each row execute function public.scout_reports_stamp();

create or replace function public.scout_pits_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_at := now(); new.scout_id := (select auth.uid());
  else new.created_at := old.created_at; new.team_id := old.team_id; new.id := old.id; new.scout_id := old.scout_id;
  end if;
  return new;
end $$;
drop trigger if exists scout_pits_stamp on public.scout_pits;
create trigger scout_pits_stamp before insert or update on public.scout_pits for each row execute function public.scout_pits_stamp();

-- an owner who deletes their account hands the team to the longest-serving lead, then scout
create or replace function public.scout_members_succession() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.scout_members m where m.team_id = old.team_id) then
    delete from public.scout_teams where id = old.team_id;         -- nobody left: the team and its data go, and its number is free again
    return null;
  end if;
  if old.role = 'owner' and not exists (select 1 from public.scout_members m where m.team_id = old.team_id and m.role = 'owner') then
    update public.scout_members set role = 'owner'
     where (team_id, user_id) = (select m.team_id, m.user_id from public.scout_members m where m.team_id = old.team_id
                                  order by (m.role = 'lead') desc, m.joined_at asc limit 1);
  end if;
  return null;
end $$;
revoke all on function public.scout_members_succession() from public, anon, authenticated;
drop trigger if exists scout_members_succession on public.scout_members;
create trigger scout_members_succession after delete on public.scout_members for each row execute function public.scout_members_succession();

-- ------------------------------------------------------------------ per-team limits (keeps one team from filling the database)
create or replace function public.scout_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cap int; n int;
begin
  cap := case tg_table_name when 'scout_reports' then 20000 when 'scout_pits' then 3000 when 'scout_events' then 200 else 100000 end;
  execute format('select count(*) from public.%I where team_id = $1', tg_table_name) into n using new.team_id;
  if n >= cap then raise exception 'Your team has reached the limit of % %', cap, replace(replace(tg_table_name, 'scout_', ''), '_', ' '); end if;
  return new;
end $$;
revoke all on function public.scout_quota() from public, anon, authenticated;
drop trigger if exists scout_reports_quota on public.scout_reports;
create trigger scout_reports_quota before insert on public.scout_reports for each row execute function public.scout_quota();
drop trigger if exists scout_pits_quota on public.scout_pits;
create trigger scout_pits_quota before insert on public.scout_pits for each row execute function public.scout_quota();
drop trigger if exists scout_events_quota on public.scout_events;
create trigger scout_events_quota before insert on public.scout_events for each row execute function public.scout_quota();

-- failed join-code guesses, for rate limiting
create table if not exists public.scout_join_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists scout_join_attempts_idx on public.scout_join_attempts (user_id, at desc);
alter table public.scout_join_attempts enable row level security;
revoke all on public.scout_join_attempts from anon, authenticated;

-- ------------------------------------------------------------------ row level security
alter table public.scout_admins   enable row level security;
alter table public.scout_consents enable row level security;
alter table public.scout_teams    enable row level security;
alter table public.scout_members  enable row level security;
alter table public.scout_events   enable row level security;
alter table public.scout_reports  enable row level security;
alter table public.scout_pits     enable row level security;

revoke all on public.scout_admins, public.scout_consents, public.scout_teams, public.scout_members,
              public.scout_events, public.scout_reports, public.scout_pits from anon, authenticated;

-- consents: read your own; written by scout_accept_terms()
drop policy if exists "consents: read own" on public.scout_consents;
create policy "consents: read own" on public.scout_consents for select to authenticated using (user_id = (select auth.uid()));
grant select on public.scout_consents to authenticated;

-- teams: the join code is only readable through scout_team_code()
drop policy if exists "teams: read" on public.scout_teams;
create policy "teams: read" on public.scout_teams for select to authenticated using (public.scout_can_read(id));
drop policy if exists "teams: rename" on public.scout_teams;
create policy "teams: rename" on public.scout_teams for update to authenticated
  using (id = public.scout_my_team() and public.scout_my_role() = 'owner') with check (id = public.scout_my_team());
grant select (id, number, name, created_at) on public.scout_teams to authenticated;
grant update (name) on public.scout_teams to authenticated;

drop policy if exists "members: read" on public.scout_members;
create policy "members: read" on public.scout_members for select to authenticated using (public.scout_can_read(team_id));
drop policy if exists "members: rename self" on public.scout_members;
create policy "members: rename self" on public.scout_members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select (team_id, user_id, role, display_name, joined_at) on public.scout_members to authenticated;
grant update (display_name) on public.scout_members to authenticated;

drop policy if exists "events: read" on public.scout_events;
create policy "events: read" on public.scout_events for select to authenticated using (public.scout_can_read(team_id));
drop policy if exists "events: create" on public.scout_events;
create policy "events: create" on public.scout_events for insert to authenticated
  with check (team_id = public.scout_my_team() and created_by = (select auth.uid()));
drop policy if exists "events: edit" on public.scout_events;
create policy "events: edit" on public.scout_events for update to authenticated
  using (team_id = public.scout_my_team() and public.scout_my_role() in ('owner', 'lead')) with check (team_id = public.scout_my_team());
drop policy if exists "events: delete" on public.scout_events;
create policy "events: delete" on public.scout_events for delete to authenticated
  using (team_id = public.scout_my_team() and public.scout_my_role() in ('owner', 'lead'));
grant select on public.scout_events to authenticated;
grant insert (team_id, name, starts_on, created_by) on public.scout_events to authenticated;
grant update (name, starts_on) on public.scout_events to authenticated;
grant delete on public.scout_events to authenticated;

drop policy if exists "reports: read" on public.scout_reports;
create policy "reports: read" on public.scout_reports for select to authenticated using (public.scout_can_read(team_id));
drop policy if exists "reports: create" on public.scout_reports;
create policy "reports: create" on public.scout_reports for insert to authenticated
  with check (team_id = public.scout_my_team()
              and exists (select 1 from public.scout_events e where e.id = event_id and e.team_id = public.scout_my_team()));
drop policy if exists "reports: edit" on public.scout_reports;
create policy "reports: edit" on public.scout_reports for update to authenticated
  using (team_id = public.scout_my_team() and (scout_id = (select auth.uid()) or public.scout_my_role() in ('owner', 'lead')))
  with check (team_id = public.scout_my_team()
              and exists (select 1 from public.scout_events e where e.id = event_id and e.team_id = public.scout_my_team()));
drop policy if exists "reports: delete" on public.scout_reports;
create policy "reports: delete" on public.scout_reports for delete to authenticated
  using (team_id = public.scout_my_team() and (scout_id = (select auth.uid()) or public.scout_my_role() in ('owner', 'lead')));
grant select on public.scout_reports to authenticated;
grant insert (id, team_id, event_id, match_type, match_number, robot_number, alliance, station, data) on public.scout_reports to authenticated;
grant update (id, team_id, event_id, match_type, match_number, robot_number, alliance, station, data) on public.scout_reports to authenticated;
grant delete on public.scout_reports to authenticated;

drop policy if exists "pits: read" on public.scout_pits;
create policy "pits: read" on public.scout_pits for select to authenticated using (public.scout_can_read(team_id));
drop policy if exists "pits: create" on public.scout_pits;
create policy "pits: create" on public.scout_pits for insert to authenticated
  with check (team_id = public.scout_my_team()
              and exists (select 1 from public.scout_events e where e.id = event_id and e.team_id = public.scout_my_team()));
drop policy if exists "pits: edit" on public.scout_pits;
create policy "pits: edit" on public.scout_pits for update to authenticated
  using (team_id = public.scout_my_team()) with check (team_id = public.scout_my_team());
drop policy if exists "pits: delete" on public.scout_pits;
create policy "pits: delete" on public.scout_pits for delete to authenticated
  using (team_id = public.scout_my_team() and (scout_id = (select auth.uid()) or public.scout_my_role() in ('owner', 'lead')));
grant select on public.scout_pits to authenticated;
grant insert (id, team_id, event_id, robot_number, data) on public.scout_pits to authenticated;
grant update (data) on public.scout_pits to authenticated;
grant delete on public.scout_pits to authenticated;

-- ------------------------------------------------------------------ RPCs
create or replace function public.scout_accept_terms(version text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.scout_is_google() then raise exception 'Overdrive Scout needs Google sign-in'; end if;
  if version is null or version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid terms version'; end if;
  insert into public.scout_consents (user_id, terms_version) values (auth.uid(), version)
  on conflict (user_id) do update set terms_version = excluded.terms_version, accepted_at = now();
end $$;

create or replace function public.scout_new_code() returns text
language sql volatile set search_path = '' as $$
  -- 8 characters from an unambiguous alphabet (no 0/O, 1/I/L)
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 31), 1), '')
    from (select substring(decode(replace(gen_random_uuid()::text, '-', ''), 'hex') from 1 for 6)
              || substring(decode(replace(gen_random_uuid()::text, '-', ''), 'hex') from 11 for 2) as b) r, generate_series(0, 7) i;
$$;

create or replace function public.scout_create_team(team_number text, team_name text, display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare tid uuid; norm text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.scout_is_google() then raise exception 'Overdrive Scout needs Google sign-in'; end if;
  if not public.scout_name_ok(btrim(team_name)) or not public.scout_name_ok(btrim(display_name)) then raise exception 'Use a real name with letters or numbers'; end if;
  if not exists (select 1 from public.scout_consents c where c.user_id = auth.uid()) then raise exception 'Accept the terms first'; end if;
  if exists (select 1 from public.scout_members m where m.user_id = auth.uid()) then raise exception 'You are already on a team'; end if;
  team_number := btrim(coalesce(team_number, ''));
  if team_number !~ '^[0-9]{1,6}$' then raise exception 'Team numbers are 1 to 6 digits'; end if;
  norm := coalesce(nullif(ltrim(team_number, '0'), ''), '0');
  if norm = '9' and not public.scout_is_admin() then raise exception 'Team 009 is managed by Overdrive. Ask a team lead for the join code.'; end if;
  if exists (select 1 from public.scout_teams t where coalesce(nullif(ltrim(t.number, '0'), ''), '0') = norm) then
    raise exception 'Team % already uses Overdrive Scout. Ask a team lead for the join code.', team_number;
  end if;
  insert into public.scout_teams (number, name, join_code, created_by)
  values (team_number, btrim(team_name), public.scout_new_code(), auth.uid()) returning id into tid;
  insert into public.scout_members (team_id, user_id, role, display_name) values (tid, auth.uid(), 'owner', btrim(display_name));
  return tid;
end $$;

create or replace function public.scout_join_team(code text, display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare tid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.scout_is_google() then raise exception 'Overdrive Scout needs Google sign-in'; end if;
  if not exists (select 1 from public.scout_consents c where c.user_id = auth.uid()) then raise exception 'Accept the terms first'; end if;
  if exists (select 1 from public.scout_members m where m.user_id = auth.uid()) then raise exception 'You are already on a team'; end if;
  if not public.scout_name_ok(btrim(display_name)) then raise exception 'Use a real name with letters or numbers'; end if;
  if (select count(*) from public.scout_join_attempts a where a.user_id = auth.uid() and a.at > now() - interval '15 minutes') >= 8 then
    raise exception 'Too many wrong codes. Wait 15 minutes and try again.';
  end if;
  select t.id into tid from public.scout_teams t where t.join_code = upper(btrim(coalesce(code, '')));
  if tid is null then
    insert into public.scout_join_attempts (user_id) values (auth.uid());   -- kept: the function returns instead of raising
    delete from public.scout_join_attempts a where a.at < now() - interval '1 day';
    return null;                                          -- the app shows "That join code does not match a team"
  end if;
  if (select count(*) from public.scout_members m where m.team_id = tid) >= 80 then raise exception 'This team is full'; end if;
  insert into public.scout_members (team_id, user_id, role, display_name) values (tid, auth.uid(), 'scout', btrim(display_name));
  return tid;
end $$;

create or replace function public.scout_team_code() returns text
language sql stable security definer set search_path = '' as $$
  select t.join_code from public.scout_teams t
   where t.id = public.scout_my_team() and public.scout_my_role() in ('owner', 'lead');
$$;

create or replace function public.scout_rotate_code() returns text
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if public.scout_my_role() is distinct from 'owner' then raise exception 'Only the team owner can change the join code'; end if;
  c := public.scout_new_code();
  update public.scout_teams set join_code = c where id = public.scout_my_team();
  return c;
end $$;

create or replace function public.scout_set_role(member uuid, new_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.scout_my_role() is distinct from 'owner' then raise exception 'Only the team owner can change roles'; end if;
  if new_role not in ('lead', 'scout') then raise exception 'Invalid role'; end if;
  if member = auth.uid() then raise exception 'You cannot change your own role'; end if;
  update public.scout_members set role = new_role where team_id = public.scout_my_team() and user_id = member;
  if not found then raise exception 'That person is not on your team'; end if;
end $$;

create or replace function public.scout_transfer_owner(member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare tid uuid := public.scout_my_team();
begin
  if public.scout_my_role() is distinct from 'owner' then raise exception 'Only the team owner can hand over the team'; end if;
  if member = auth.uid() or not exists (select 1 from public.scout_members m where m.team_id = tid and m.user_id = member) then
    raise exception 'Pick someone else on your team';
  end if;
  update public.scout_members set role = 'lead' where team_id = tid and user_id = auth.uid();
  update public.scout_members set role = 'owner' where team_id = tid and user_id = member;
end $$;

create or replace function public.scout_remove_member(member uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare tid uuid := public.scout_my_team(); their text;
begin
  if public.scout_my_role() not in ('owner', 'lead') then raise exception 'Only owners and leads can remove people'; end if;
  select m.role into their from public.scout_members m where m.team_id = tid and m.user_id = member;
  if their is null then raise exception 'That person is not on your team'; end if;
  if member = auth.uid() then raise exception 'Use Leave team instead'; end if;
  if their = 'owner' or (their = 'lead' and public.scout_my_role() <> 'owner') then raise exception 'You cannot remove this person'; end if;
  delete from public.scout_members where team_id = tid and user_id = member;
end $$;

-- leave the team; the owner must hand it over first unless they are the last member (then the team and its data are deleted)
create or replace function public.scout_leave_team() returns void
language plpgsql security definer set search_path = '' as $$
declare tid uuid := public.scout_my_team(); n int;
begin
  if tid is null then return; end if;
  select count(*) into n from public.scout_members m where m.team_id = tid;
  if public.scout_my_role() = 'owner' then
    if n > 1 then raise exception 'Hand the team to someone else before leaving'; end if;
    delete from public.scout_teams where id = tid;
  else
    delete from public.scout_members where team_id = tid and user_id = auth.uid();
  end if;
end $$;

-- Overdrive staff: a directory of every team with report counts
create or replace function public.scout_admin_overview() returns table (team_id uuid, number text, name text, members bigint, events bigint, reports bigint, pits bigint, last_report timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.id, t.number, t.name,
         (select count(*) from public.scout_members m where m.team_id = t.id),
         (select count(*) from public.scout_events e where e.team_id = t.id),
         (select count(*) from public.scout_reports r where r.team_id = t.id),
         (select count(*) from public.scout_pits p where p.team_id = t.id),
         (select max(r.created_at) from public.scout_reports r where r.team_id = t.id)
    from public.scout_teams t
   where public.scout_is_admin()
   order by 6 desc, t.created_at;
$$;

revoke all on function public.scout_accept_terms(text), public.scout_new_code(), public.scout_create_team(text, text, text),
  public.scout_join_team(text, text), public.scout_team_code(), public.scout_rotate_code(), public.scout_set_role(uuid, text),
  public.scout_transfer_owner(uuid), public.scout_remove_member(uuid), public.scout_leave_team(), public.scout_admin_overview() from public, anon;
grant execute on function public.scout_accept_terms(text), public.scout_create_team(text, text, text),
  public.scout_join_team(text, text), public.scout_team_code(), public.scout_rotate_code(), public.scout_set_role(uuid, text),
  public.scout_transfer_owner(uuid), public.scout_remove_member(uuid), public.scout_leave_team(), public.scout_admin_overview() to authenticated;

-- ------------------------------------------------------------------ Google sign-in: use the Google name for new profiles
-- (replaces the version in schema.sql: Google sends full_name / name rather than display_name)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  uname text := coalesce(new.raw_user_meta_data ->> 'username', '');
  dname text;
begin
  if uname !~ '^[A-Za-z0-9_]{3,20}$' then
    uname := 'driver_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  dname := left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
                         nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
                         nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), uname), 32);
  insert into public.profiles (id, username, display_name) values (new.id, uname, dname);
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
