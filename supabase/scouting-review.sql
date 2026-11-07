-- Overdrive Scout: fixes from the November 2026 security review. Idempotent; run after scouting.sql.

-- A removed member could rejoin straight away with the code they already knew: removing someone now rotates the code.
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
  update public.scout_teams set join_code = public.scout_new_code() where id = tid;
end $$;

-- Pit reports follow the same rule as match reports: the scout who filed it, or a lead, can change it.
drop policy if exists "pits: edit" on public.scout_pits;
create policy "pits: edit" on public.scout_pits for update to authenticated
  using (team_id = public.scout_my_team() and (scout_id = (select auth.uid()) or public.scout_my_role() in ('owner', 'lead')))
  with check (team_id = public.scout_my_team());

-- Length limits measured on what is stored, not on the trimmed value (whitespace padding got around them).
do $$ begin alter table public.scout_teams add constraint scout_teams_name_len check (char_length(name) <= 48) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.scout_members add constraint scout_members_name_len check (char_length(display_name) <= 40) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.scout_events add constraint scout_events_name_len check (char_length(name) <= 80) not valid; exception when duplicate_object then null; end $$;

-- A no-show scored nothing, whatever else the row carries.
create or replace function public.scout_report_points(d jsonb) returns smallint
language sql immutable set search_path = '' as $$
  select case when coalesce((d ->> 'noshow')::boolean, false) then 0::smallint else least(32000, (
      3 * (coalesce((d ->> 'm_high')::int, 0) + coalesce((d ->> 'l_high')::int, 0))
    + 5 * (coalesce((d ->> 'm_star')::int, 0) + coalesce((d ->> 'l_star')::int, 0))
    + 1 * (coalesce((d ->> 'm_drop')::int, 0) + coalesce((d ->> 'l_drop')::int, 0))
    + 7 * (coalesce((d ->> 'm_gstar')::int, 0) + coalesce((d ->> 'l_gstar')::int, 0))
    + 3 * (coalesce((d ->> 'm_gdrop')::int, 0) + coalesce((d ->> 'l_gdrop')::int, 0))
    + 9 * coalesce((d ->> 'l_apex')::int, 0)
    + case d ->> 'station' when 'engage' then 3 when 'dock' then 8 when 'balance' then 15 else 0 end))::smallint end;
$$;

-- The join-code rate limit counted then inserted without a lock, so parallel calls could each pass the check.
create or replace function public.scout_join_team(code text, display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare tid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform pg_advisory_xact_lock(hashtext('scout_join:' || auth.uid()::text));
  if not public.scout_is_google() then raise exception 'Overdrive Scout needs Google sign-in'; end if;
  if not exists (select 1 from public.scout_consents c where c.user_id = auth.uid()) then raise exception 'Accept the terms first'; end if;
  if exists (select 1 from public.scout_members m where m.user_id = auth.uid()) then raise exception 'You are already on a team'; end if;
  if not public.scout_name_ok(btrim(display_name)) then raise exception 'Use a real name with letters or numbers'; end if;
  if (select count(*) from public.scout_join_attempts a where a.user_id = auth.uid() and a.at > now() - interval '15 minutes') >= 8 then
    raise exception 'Too many wrong codes. Wait 15 minutes and try again.';
  end if;
  select t.id into tid from public.scout_teams t where t.join_code = upper(btrim(coalesce(code, '')));
  if tid is null then
    insert into public.scout_join_attempts (user_id) values (auth.uid());
    delete from public.scout_join_attempts a where a.at < now() - interval '1 day';
    return null;
  end if;
  if (select count(*) from public.scout_members m where m.team_id = tid) >= 80 then raise exception 'This team is full'; end if;
  insert into public.scout_members (team_id, user_id, role, display_name) values (tid, auth.uid(), 'scout', btrim(display_name));
  return tid;
end $$;

-- ---- round 2 ----------------------------------------------------------------------------------------------------
-- Demoting a lead also changes the join code (they knew it); so does handing the team over.
create or replace function public.scout_set_role(member uuid, new_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare was text;
begin
  if public.scout_my_role() is distinct from 'owner' then raise exception 'Only the team owner can change roles'; end if;
  if new_role not in ('lead', 'scout') then raise exception 'Invalid role'; end if;
  if member = auth.uid() then raise exception 'You cannot change your own role'; end if;
  select m.role into was from public.scout_members m where m.team_id = public.scout_my_team() and m.user_id = member;
  update public.scout_members set role = new_role where team_id = public.scout_my_team() and user_id = member;
  if not found then raise exception 'That person is not on your team'; end if;
  if was = 'lead' and new_role = 'scout' then update public.scout_teams set join_code = public.scout_new_code() where id = public.scout_my_team(); end if;
end $$;

-- Names: no invisible or direction-changing characters (bidi isolates, fillers, C1 controls, braille blank), at most
-- a few combining marks in a row, and nothing padded with spaces.
create or replace function public.scout_name_ok(n text) returns boolean
language sql immutable set search_path = '' as $$
  select n is not null and n ~ '[[:alnum:]]'
     and n !~ '[\u0000-\u001f\u007f-\u009f­͏؜ᅟᅠ᠎​-‏ -‮⁠-⁯⠀ㅤ︀-️﻿ﾠ]'
     and n !~ '[̀-ͯ]{4,}';
$$;
do $$ begin alter table public.scout_teams add constraint scout_teams_name_trim check (name = btrim(name)) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.scout_members add constraint scout_members_name_trim check (display_name = btrim(display_name)) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.scout_events add constraint scout_events_name_trim check (name = btrim(name)) not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.scout_members add constraint scout_members_name_chars check (public.scout_name_ok(display_name)) not valid; exception when duplicate_object then null; end $$;

-- One pit report per robot per event, whatever leading zeros were typed ("456" and "0456" are the same robot).
do $$ begin
  create unique index if not exists scout_pits_robot_norm_idx on public.scout_pits (event_id, (coalesce(nullif(ltrim(robot_number, '0'), ''), '0')));
exception when unique_violation then raise notice 'scout_pits has duplicate robots that differ only by leading zeros; index not created';
end $$;

-- ---- email and password accounts ---------------------------------------------------------------------------------
-- Overdrive accounts are email and password now (Google sign-in was dropped). The Scout entry points keep calling
-- scout_is_google(); it now accepts any signed-in account, so email accounts can accept terms, create and join teams.
create or replace function public.scout_is_google() returns boolean
language sql stable set search_path = '' as $$
  select auth.uid() is not null;
$$;
