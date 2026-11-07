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
