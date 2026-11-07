select
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='matches' and column_name='verified') as verification_column,
  has_column_privilege('authenticated', 'public.matches', 'verified', 'INSERT') as browser_can_verify,
  has_column_privilege('authenticated', 'public.matches', 'red_score', 'INSERT') as browser_can_save_history,
  position('where m.verified' in pg_get_functiondef('public.leaderboard(integer)'::regprocedure)) > 0 as leaderboard_filters_verified,
  public.safe_match_counter(to_jsonb('bad'::text)) as malformed_counter,
  public.safe_match_counter('1e1000'::jsonb) as oversized_counter;
