-- Overdrive Scout: every member of team 009 can READ every team's scouting data (teams, members, events, match and
-- pit reports), as set out in Privacy Policy section 2 and Terms section 5. Idempotent; run after scouting-review.sql.
--
-- Why membership of team 009 is safe to trust: scout_create_team refuses the number 009 (or 9) to anyone who is not
-- already in scout_admins, and joining an existing team needs its join code from a 009 lead. Leaving or being
-- removed from team 009 ends the access at once.
--
-- Read only: scout_is_admin() is used by the read policies (through scout_can_read), the staff directory
-- (scout_admin_overview) and the 009 reservation. No insert, update or delete policy consults it, so team 009 can
-- see other teams' data but never change it.
create or replace function public.scout_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.scout_admins a where a.user_id = (select auth.uid()))
      or exists (select 1 from public.scout_members m join public.scout_teams t on t.id = m.team_id
                  where m.user_id = (select auth.uid()) and coalesce(nullif(ltrim(t.number, '0'), ''), '0') = '9');
$$;
revoke all on function public.scout_is_admin() from public, anon;
grant execute on function public.scout_is_admin() to authenticated;
