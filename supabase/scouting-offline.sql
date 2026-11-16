-- Overdrive Scout: offline sync. Idempotent; run after scouting-009.sql.
--
-- Every write a phone makes offline is replayed through one of the scout_push_* functions below. They run as the
-- caller (SECURITY INVOKER), so the row-level-security policies and column grants in scouting.sql still decide who
-- may write what. On top of those they add two things a plain upsert cannot:
--   * idempotency: each attempt carries a client revision id. A retry of a write the server already applied (the
--     reply was lost on bad Wi-Fi) is recognised by that id and answered "ok" without writing again.
--   * conflict detection: an edit carries the updated_at of the copy it was made from. If the row has changed since,
--     nothing is written and the current row comes back as a "conflict" for the phone to merge or show the scout.
-- Reply: {"status": "ok", "row": {...}} or {"status": "conflict", "server": {...} | null}. null means the row was
-- deleted on the server while it was being edited on the phone.

alter table public.scout_reports add column if not exists client_rev uuid;
alter table public.scout_pits    add column if not exists client_rev uuid;
grant insert (client_rev), update (client_rev) on public.scout_reports to authenticated;
grant insert (client_rev), update (client_rev) on public.scout_pits to authenticated;
-- events made offline keep the id the phone gave them, so a retried create cannot make a second event
grant insert (id) on public.scout_events to authenticated;

-- ------------------------------------------------------------------ pick lists (one per event, shared by the team)
create or replace function public.scout_valid_picks(d jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select d is not null and jsonb_typeof(d) = 'array' and jsonb_array_length(d) <= 200 and pg_column_size(d) <= 16384
     and not exists (select 1 from jsonb_array_elements(d) e
                      where jsonb_typeof(e) <> 'object' or coalesce(e ->> 'robot', '') !~ '^[0-9]{1,6}$'
                         or jsonb_typeof(coalesce(e -> 'dnp', 'false'::jsonb)) <> 'boolean'
                         or exists (select 1 from jsonb_object_keys(e) k where k not in ('robot', 'dnp')));
$$;
revoke all on function public.scout_valid_picks(jsonb) from public, anon;
grant execute on function public.scout_valid_picks(jsonb) to authenticated;

create table if not exists public.scout_picklists (
  event_id   uuid primary key references public.scout_events (id) on delete cascade,
  team_id    uuid not null references public.scout_teams (id) on delete cascade,
  data       jsonb not null check (public.scout_valid_picks(data)),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  client_rev uuid
);
create or replace function public.scout_picklists_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now(); new.updated_by := (select auth.uid());
  if tg_op = 'UPDATE' then new.team_id := old.team_id; new.event_id := old.event_id; end if;
  return new;
end $$;
drop trigger if exists scout_picklists_stamp on public.scout_picklists;
create trigger scout_picklists_stamp before insert or update on public.scout_picklists for each row execute function public.scout_picklists_stamp();

alter table public.scout_picklists enable row level security;
revoke all on public.scout_picklists from anon, authenticated;
drop policy if exists "picklists: read" on public.scout_picklists;
create policy "picklists: read" on public.scout_picklists for select to authenticated using (public.scout_can_read(team_id));
drop policy if exists "picklists: create" on public.scout_picklists;
create policy "picklists: create" on public.scout_picklists for insert to authenticated
  with check (team_id = public.scout_my_team()
              and exists (select 1 from public.scout_events e where e.id = event_id and e.team_id = public.scout_my_team()));
drop policy if exists "picklists: edit" on public.scout_picklists;
create policy "picklists: edit" on public.scout_picklists for update to authenticated
  using (team_id = public.scout_my_team()) with check (team_id = public.scout_my_team());
grant select on public.scout_picklists to authenticated;
grant insert (event_id, team_id, data, client_rev) on public.scout_picklists to authenticated;
grant update (data, client_rev) on public.scout_picklists to authenticated;

-- ------------------------------------------------------------------ push functions
create or replace function public.scout_push_event(e jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare cur public.scout_events;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.scout_events (id, team_id, name, starts_on, created_by)
  values ((e ->> 'id')::uuid, (e ->> 'team_id')::uuid, btrim(e ->> 'name'), nullif(e ->> 'starts_on', '')::date, auth.uid())
  on conflict (id) do nothing;
  select * into cur from public.scout_events where id = (e ->> 'id')::uuid;
  if not found then raise exception 'That event id belongs to another team'; end if;
  return jsonb_build_object('status', 'ok', 'row', to_jsonb(cur));
end $$;

create or replace function public.scout_push_report(r jsonb, base timestamptz, rev uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare cur public.scout_reports; rid uuid := (r ->> 'id')::uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into cur from public.scout_reports where id = rid;
  if not found then
    if base is not null then return jsonb_build_object('status', 'conflict', 'server', null); end if;
    insert into public.scout_reports (id, team_id, event_id, match_type, match_number, robot_number, alliance, station, data, client_rev)
    values (rid, (r ->> 'team_id')::uuid, (r ->> 'event_id')::uuid, coalesce(r ->> 'match_type', 'qm'), (r ->> 'match_number')::smallint,
            r ->> 'robot_number', r ->> 'alliance', (r ->> 'station')::smallint, r -> 'data', rev)
    returning * into cur;
    return jsonb_build_object('status', 'ok', 'row', to_jsonb(cur));
  end if;
  if cur.client_rev = rev then return jsonb_build_object('status', 'ok', 'row', to_jsonb(cur)); end if;
  if base is null or cur.updated_at <> base then return jsonb_build_object('status', 'conflict', 'server', to_jsonb(cur)); end if;
  update public.scout_reports
     set event_id = (r ->> 'event_id')::uuid, match_type = coalesce(r ->> 'match_type', 'qm'), match_number = (r ->> 'match_number')::smallint,
         robot_number = r ->> 'robot_number', alliance = r ->> 'alliance', station = (r ->> 'station')::smallint, data = r -> 'data', client_rev = rev
   where id = rid and updated_at = base
  returning * into cur;
  if not found then
    select * into cur from public.scout_reports where id = rid;
    if found and cur.updated_at <> base then return jsonb_build_object('status', 'conflict', 'server', to_jsonb(cur)); end if;
    raise exception 'Only the scout who filed this report, or a team lead, can change it';
  end if;
  return jsonb_build_object('status', 'ok', 'row', to_jsonb(cur));
end $$;

-- one pit report per robot per event: a second scout's report for the same robot comes back as a conflict to merge
create or replace function public.scout_push_pit(p jsonb, base timestamptz, rev uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare cur public.scout_pits;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into cur from public.scout_pits x
   where x.event_id = (p ->> 'event_id')::uuid
     and coalesce(nullif(ltrim(x.robot_number, '0'), ''), '0') = coalesce(nullif(ltrim(p ->> 'robot_number', '0'), ''), '0');
  if not found then
    if base is not null then return jsonb_build_object('status', 'conflict', 'server', null); end if;
    insert into public.scout_pits (id, team_id, event_id, robot_number, data, client_rev)
    values ((p ->> 'id')::uuid, (p ->> 'team_id')::uuid, (p ->> 'event_id')::uuid, p ->> 'robot_number', p -> 'data', rev)
    returning * into cur;
    return jsonb_build_object('status', 'ok', 'row', to_jsonb(cur));
  end if;
  if cur.client_rev = rev then return jsonb_build_object('status', 'ok', 'row', to_jsonb(cur)); end if;
  if base is null or cur.updated_at <> base then return jsonb_build_object('status', 'conflict', 'server', to_jsonb(cur)); end if;
  update public.scout_pits set data = p -> 'data', client_rev = rev where id = cur.id and updated_at = base returning * into cur;
  if not found then raise exception 'Only the scout who filed this pit report, or a team lead, can change it'; end if;
  return jsonb_build_object('status', 'ok', 'row', to_jsonb(cur));
end $$;

create or replace function public.scout_push_picks(p jsonb, base timestamptz, rev uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare cur public.scout_picklists; ev uuid := (p ->> 'event_id')::uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into cur from public.scout_picklists where event_id = ev;
  if not found then
    insert into public.scout_picklists (event_id, team_id, data, client_rev) values (ev, (p ->> 'team_id')::uuid, p -> 'data', rev) returning * into cur;
    return jsonb_build_object('status', 'ok', 'row', to_jsonb(cur));
  end if;
  if cur.client_rev = rev then return jsonb_build_object('status', 'ok', 'row', to_jsonb(cur)); end if;
  if base is null or cur.updated_at <> base then return jsonb_build_object('status', 'conflict', 'server', to_jsonb(cur)); end if;
  update public.scout_picklists set data = p -> 'data', client_rev = rev where event_id = ev and updated_at = base returning * into cur;
  if not found then raise exception 'You do not have access to this pick list'; end if;
  return jsonb_build_object('status', 'ok', 'row', to_jsonb(cur));
end $$;

-- deleting a report that someone changed after this phone last saw it is a conflict, not a delete
create or replace function public.scout_push_delete(rid uuid, base timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare cur public.scout_reports;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into cur from public.scout_reports where id = rid;
  if not found then return jsonb_build_object('status', 'ok', 'row', null); end if;
  if base is not null and cur.updated_at <> base then return jsonb_build_object('status', 'conflict', 'server', to_jsonb(cur)); end if;
  delete from public.scout_reports where id = rid;
  if not found then raise exception 'Only the scout who filed this report, or a team lead, can delete it'; end if;
  return jsonb_build_object('status', 'ok', 'row', null);
end $$;

revoke all on function public.scout_push_event(jsonb), public.scout_push_report(jsonb, timestamptz, uuid), public.scout_push_pit(jsonb, timestamptz, uuid),
  public.scout_push_picks(jsonb, timestamptz, uuid), public.scout_push_delete(uuid, timestamptz) from public, anon;
grant execute on function public.scout_push_event(jsonb), public.scout_push_report(jsonb, timestamptz, uuid), public.scout_push_pit(jsonb, timestamptz, uuid),
  public.scout_push_picks(jsonb, timestamptz, uuid), public.scout_push_delete(uuid, timestamptz) to authenticated;
