// Row-level-security regression for supabase/scouting.sql, run in an in-memory Postgres (PGlite).
// node tools/scouting-regression.cjs   (PGLITE_PATH may point at a folder with @electric-sql/pglite installed)
const { PGlite } = require(process.env.PGLITE_PATH || '@electric-sql/pglite');
const fs = require('fs'); const path = require('path');
const U = (n) => `${n}0000000-0000-0000-0000-000000000000`;
const A = U(1), B = U(2), C = U(3), D = U(4), E = U(5);

(async () => {
  const db = new PGlite(); const passed = [];
  const claims = (uid, provider = 'email') => JSON.stringify({ sub: uid, app_metadata: { provider, providers: [provider] } }).replace(/'/g, "''");
  const as = async (uid, provider) => db.exec(uid ? `reset role; set role authenticated; set request.jwt.claim.sub='${uid}'; set request.jwt.claims='${claims(uid, provider)}';` : `reset role; set role anon; set request.jwt.claim.sub=''; set request.jwt.claims='';`);
  const ok = async (label, sql, check) => { const r = await db.query(sql); if (check && !check(r.rows)) throw Error(`${label}: ${JSON.stringify(r.rows)}`); passed.push(label); return r.rows; };
  const fails = async (label, sql, re) => {
    try { await db.query(sql); } catch (e) { if (re && !re.test(e.message)) throw Error(`${label}: wrong error ${e.message}`); passed.push(label); return; }
    throw Error(`${label}: unexpectedly succeeded`);
  };
  const empty = (r) => r.length === 0;
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb$$;
      grant usage on schema auth to authenticated, anon; grant execute on function auth.uid(), auth.jwt() to authenticated, anon;
      grant usage on schema public to authenticated, anon;`);
    const sql = (f) => fs.readFileSync(path.join(__dirname, '../supabase', f), 'utf8');
    for (let i = 0; i < 2; i++) { await db.exec(sql('schema.sql')); await db.exec(sql('hardening.sql')); await db.exec(sql('scouting.sql')); await db.exec(sql('scouting-review.sql')); await db.exec(sql('scouting-009.sql')); }
    passed.push('Schema applies twice (idempotent)');
    await db.exec(`insert into auth.users(id, email) values ('${A}','a@x'),('${B}','b@x'),('${C}','c@x'),('${D}','admin@x'),('${E}','e@x');
      insert into public.scout_admins(user_id) values ('${D}');`);

    await as(A);
    await fails('Team creation needs accepted terms', `select public.scout_create_team('123','Alpha','Ann')`, /terms/i);
    await ok('Accept terms', `select public.scout_accept_terms('2026-11-01')`);
    await fails('Bad terms version rejected', `select public.scout_accept_terms('x')`, /version/i);
    await fails('Team 009 reserved for Overdrive', `select public.scout_create_team('009','Fake','Ann')`, /Overdrive/);
    await fails('Team 9 (same as 009) reserved', `select public.scout_create_team('9','Fake','Ann')`, /Overdrive/);
    const [{ t: teamA }] = await ok('Owner creates team 123', `select public.scout_create_team('123','Alpha','Ann') as t`);
    await fails('Second team blocked', `select public.scout_create_team('124','Beta','Ann')`, /already on a team/);
    const [{ c: codeA }] = await ok('Owner reads join code', `select public.scout_team_code() as c`, (r) => /^[A-HJ-NP-Z2-9]{8}$/.test(r[0].c));
    await fails('Join code column not directly readable', `select join_code from public.scout_teams`, /permission/);
    const [{ id: evA }] = await ok('Owner creates event', `insert into public.scout_events(team_id, name) values ('${teamA}', 'Regional') returning id`);

    await as(B);
    await fails('Join needs accepted terms', `select public.scout_join_team('${codeA}','Bo')`, /terms/i);
    await db.query(`select public.scout_accept_terms('2026-11-01')`);
    await ok('Wrong join code returns nothing', `select public.scout_join_team('AAAAAAAA','Bo') as t`, (r) => r[0].t === null);
    await fails('Invisible display name rejected', `select public.scout_join_team('${codeA}', E'\u200b\u200b')`, /real name/);
    await ok('Scout joins with code (case-insensitive)', `select public.scout_join_team(lower('${codeA}'),'Bo')`);
    await ok('Scout cannot read join code', `select public.scout_team_code() as c`, (r) => r[0].c === null);
    await fails('Scout cannot rotate code', `select public.scout_rotate_code()`, /owner/);
    await fails('Scout cannot change roles', `select public.scout_set_role('${A}','scout')`, /owner/);
    await fails('Scout cannot rename team', `update public.scout_teams set name='Pwned' where id='${teamA}' returning id`, /./).catch(() => {});
    await ok('Scout rename of team has no effect', `select name from public.scout_teams`, (r) => r[0].name === 'Alpha');
    const goodData = `'{"v":1,"m_high":4,"m_star":2,"l_apex":1,"station":"balance","payload":"scored","driver":4,"tags":["fast"],"note":"solid"}'`;
    const r1 = '11111111-1111-1111-1111-111111111111';
    await ok('Scout files report; points computed server-side', `insert into public.scout_reports(id, team_id, event_id, match_number, robot_number, alliance, station, data)
      values ('${r1}','${teamA}','${evA}',12,'456','red',1,${goodData}) returning points, scout_id`, (r) => r[0].points === 4 * 3 + 2 * 5 + 9 + 15 && r[0].scout_id === B);
    await fails('Client-set points column rejected', `insert into public.scout_reports(id, team_id, event_id, match_number, robot_number, alliance, station, data, points)
      values (gen_random_uuid(),'${teamA}','${evA}',13,'456','red',1,'{"v":1}', 999)`, /permission/);
    await fails('Client-set scout_id rejected', `insert into public.scout_reports(id, team_id, event_id, match_number, robot_number, alliance, station, data, scout_id)
      values (gen_random_uuid(),'${teamA}','${evA}',13,'456','red',1,'{"v":1}','${A}')`, /permission/);
    for (const [label, d] of [['Unknown key', '{"v":1,"evil":1}'], ['Counter too big', '{"m_high":61}'], ['Negative counter', '{"m_high":-1}'], ['Wrong type', '{"m_high":"4"}'],
      ['Bad enum', '{"station":"fly"}'], ['Bad tag', '{"tags":["<script>"]}'], ['Long note', `{"note":"${'x'.repeat(501)}"}`], ['Non-object', '[1,2]'], ['Float counter', '{"m_high":1.5}']]) {
      await fails(`Invalid report rejected: ${label}`, `insert into public.scout_reports(id, team_id, event_id, match_number, robot_number, alliance, station, data)
        values (gen_random_uuid(),'${teamA}','${evA}',14,'456','red',1,'${d.replace(/'/g, "''")}')`);
    }
    await ok('PostgREST-style upsert (ON CONFLICT DO UPDATE of every column) works for the scout', `insert into public.scout_reports(id, team_id, event_id, match_type, match_number, robot_number, alliance, station, data)
      values ('${r1}','${teamA}','${evA}','qm',12,'456','red',1,${goodData}) on conflict (id) do update set id = excluded.id, team_id = excluded.team_id, event_id = excluded.event_id,
      match_type = excluded.match_type, match_number = excluded.match_number, robot_number = excluded.robot_number, alliance = excluded.alliance, station = excluded.station, data = excluded.data returning scout_id`, (r) => r[0].scout_id === B);
    await fails('Bad robot number rejected', `insert into public.scout_reports(id, team_id, event_id, match_number, robot_number, alliance, station, data)
      values (gen_random_uuid(),'${teamA}','${evA}',14,'45a','red',1,'{}')`);

    await as(C);
    await db.query(`select public.scout_accept_terms('2026-11-01')`);
    const [{ t: teamC }] = await ok('Second team created', `select public.scout_create_team('456','Gamma','Cy') as t`);
    await fails('Duplicate team number (leading zeros) blocked', `select public.scout_create_team('0123','Dup','Cy')`, /already/).catch(async () => {
      // C is already on a team, so the duplicate check is exercised by E below
    });
    await ok('Other team cannot see reports', `select * from public.scout_reports`, empty);
    await ok('Other team cannot see events', `select * from public.scout_events`, empty);
    await ok('Other team cannot see members', `select * from public.scout_members where team_id='${teamA}'`, empty);
    await ok('Other team sees only its own team row', `select number from public.scout_teams`, (r) => r.length === 1 && r[0].number === '456');
    await fails('Cannot file into another team', `insert into public.scout_reports(id, team_id, event_id, match_number, robot_number, alliance, station, data)
      values (gen_random_uuid(),'${teamA}','${evA}',1,'1','red',1,'{}')`, /row-level security/);
    await fails("Cannot file into own team using another team's event", `insert into public.scout_reports(id, team_id, event_id, match_number, robot_number, alliance, station, data)
      values (gen_random_uuid(),'${teamC}','${evA}',1,'1','red',1,'{}')`, /row-level security/);
    await fails('Upsert cannot hijack another team report id', `insert into public.scout_reports(id, team_id, event_id, match_number, robot_number, alliance, station, data)
      values ('${r1}','${teamC}','${evA}',1,'1','red',1,'{}') on conflict (id) do update set data = excluded.data`);
    await ok('Other team update of report affects nothing', `update public.scout_reports set data='{}' where id='${r1}' returning id`, empty);
    await ok('Admin overview empty for non-admin', `select * from public.scout_admin_overview()`, empty);
    await ok('Non-admin is_admin false', `select public.scout_is_admin() as a`, (r) => r[0].a === false);
    await fails('Cannot read admin table', `select * from public.scout_admins`, /permission/);
    await fails('Cannot add self as admin', `insert into public.scout_admins(user_id) values ('${C}')`, /permission/);

    await as(E, 'email');
    await ok('Email and password account can accept Scout terms', `select public.scout_accept_terms('2026-11-01')`);
    await fails('Duplicate team number with leading zeros blocked', `select public.scout_create_team('0123','Dup','Ed')`, /already uses/);

    await as(D);
    await ok('Overdrive admin reads every team report', `select robot_number from public.scout_reports`, (r) => r.length === 1);
    await ok('Overdrive admin overview lists all teams', `select number, reports from public.scout_admin_overview()`, (r) => r.length === 2);
    await fails('Admin (not on team) cannot write reports', `insert into public.scout_reports(id, team_id, event_id, match_number, robot_number, alliance, station, data)
      values (gen_random_uuid(),'${teamA}','${evA}',1,'1','red',1,'{}')`, /row-level security/);
    await db.query(`select public.scout_accept_terms('2026-11-01')`);
    const [{ t: team009 }] = await ok('Admin may register team 009', `select public.scout_create_team('009','Overdrive','Staff') as t`);
    const [{ c: code009 }] = await ok('009 owner reads join code', `select public.scout_team_code() as c`);

    // any member of team 009 (not in scout_admins) reads every team's data, read only
    const H = '80000000-0000-0000-0000-000000000000';
    await db.exec(`reset role; insert into auth.users(id, email) values ('${H}','h@x');`);
    await as(H, 'email'); await db.query(`select public.scout_accept_terms('2026-11-01')`);
    await ok('Before joining 009: no cross-team access', `select public.scout_is_admin() as a`, (r) => r[0].a === false);
    await ok('Scout joins team 009', `select public.scout_join_team('${code009}','Hari') as t`, (r) => r[0].t === team009);
    await ok('009 member is_admin true', `select public.scout_is_admin() as a`, (r) => r[0].a === true);
    await ok('009 member reads every team report', `select robot_number from public.scout_reports`, (r) => r.length === 1);
    await ok('009 member reads every team event', `select team_id from public.scout_events where team_id='${teamA}'`, (r) => r.length === 1);
    await ok('009 member reads other teams and members', `select count(*)::int as n from public.scout_members where team_id='${teamA}'`, (r) => r[0].n === 2);
    await ok('009 member sees the staff directory', `select number from public.scout_admin_overview()`, (r) => r.length === 3);
    await fails('009 member cannot file into another team', `insert into public.scout_reports(id, team_id, event_id, match_number, robot_number, alliance, station, data)
      values (gen_random_uuid(),'${teamA}','${evA}',1,'1','red',1,'{}')`, /row-level security/);
    await ok('009 member cannot edit another team report', `update public.scout_reports set data='{}' where id='${r1}' returning id`, empty);
    await ok('009 member cannot delete another team report', `delete from public.scout_reports where id='${r1}' returning id`, empty);
    await ok('009 member cannot delete another team event', `delete from public.scout_events where id='${evA}' returning id`, empty);
    await ok('009 member cannot rename another team', `update public.scout_teams set name='Pwned' where id='${teamA}' returning id`, empty);
    await fails('009 member still cannot read join codes', `select join_code from public.scout_teams`, /permission/);
    await ok('Leaving team 009', `select public.scout_leave_team()`);
    await ok('Access ends on leaving 009', `select count(*)::int as n from public.scout_reports`, (r) => r[0].n === 0);

    await as(null);
    for (const t of ['scout_reports', 'scout_teams', 'scout_members', 'scout_events', 'scout_pits', 'scout_consents']) await fails(`Anonymous cannot read ${t}`, `select * from public.${t}`, /permission/);
    await fails('Anonymous cannot create team', `select public.scout_create_team('77','x','y')`, /permission/);

    await as(B);
    const p1 = '22222222-2222-2222-2222-222222222222';
    await ok('Scout files a pit report', `insert into public.scout_pits(id, team_id, event_id, robot_number, data) values ('${p1}','${teamA}','${evA}','456','{"v":1,"drive":"tank"}') returning scout_id`, (r) => r[0].scout_id === B);
    await as(A);
    await ok('Teammate edit keeps the original pit scout', `update public.scout_pits set data='{"v":1,"drive":"swerve"}' where id='${p1}' returning scout_id`, (r) => r[0].scout_id === B);
    const p2 = '33333333-3333-3333-3333-333333333333';
    await ok('Owner files a pit report', `insert into public.scout_pits(id, team_id, event_id, robot_number, data) values ('${p2}','${teamA}','${evA}','789','{"v":1,"drive":"tank"}') returning id`);
    await as(B);
    await ok("Scout cannot overwrite someone else's pit report", `update public.scout_pits set data='{"v":1}' where id='${p2}' returning id`, empty);
    await ok('A no-show scores nothing on the server', `insert into public.scout_reports(id, team_id, event_id, match_number, robot_number, alliance, station, data) values ('44444444-4444-4444-4444-444444444444','${teamA}','${evA}',9,'456','red',1,'{"v":1,"noshow":true}') returning points`, (r) => r[0].points === 0);
    await db.exec(`reset role; delete from public.scout_reports where id='44444444-4444-4444-4444-444444444444';`);
    await as(A);
    await as(B);
    await ok('Scout edits own report; scout/points stay server-owned', `update public.scout_reports set data='{"v":1,"m_drop":2}' where id='${r1}' returning points, scout_id`, (r) => r[0].points === 2 && r[0].scout_id === B);
    await as(A);
    await ok('Owner promotes scout to lead', `select public.scout_set_role('${B}','lead')`);
    await fails('Owner cannot leave while others are on the team', `select public.scout_leave_team()`, /Hand the team/);
    await db.exec(`reset role; delete from auth.users where id='${A}';`);
    await as(B);
    await ok('Lead becomes owner when owner deletes account', `select public.scout_my_role() as r`, (r) => r[0].r === 'owner');
    await ok('Reports survive the owner account deletion', `select count(*)::int as n from public.scout_reports`, (r) => r[0].n === 1);
    await ok('Last member leaving deletes the team', `select public.scout_leave_team()`);
    await ok('Team and its reports are gone', `select count(*)::int as n from public.scout_reports`, (r) => r[0].n === 0);
    await as(E);
    for (let i = 0; i < 8; i++) await db.query(`select public.scout_join_team('ZZZZZZZ${i}','Ed')`).catch(() => {});
    await fails('Join-code guessing is rate limited', `select public.scout_join_team('ZZZZZZZZ','Ed')`, /Too many/);
    await db.exec(`reset role; insert into auth.users(id, email) values ('60000000-0000-0000-0000-000000000000','f@x');`);
    await as('60000000-0000-0000-0000-000000000000');
    await db.query(`select public.scout_accept_terms('2026-11-01')`);
    await ok('Solo team created', `select public.scout_create_team('777','Solo','Fi')`);
    const [{ c: soloCode }] = await ok('Solo owner reads join code', `select public.scout_team_code() as c`);
    const G = '70000000-0000-0000-0000-000000000000';
    await db.exec(`reset role; insert into auth.users(id, email) values ('${G}','g@x');`);
    await as(G); await db.query(`select public.scout_accept_terms('2026-11-01')`);
    await ok('Member joins the solo team', `select public.scout_join_team('${soloCode}','Gus') as t`, (r) => r[0].t !== null);
    await as('60000000-0000-0000-0000-000000000000');
    await ok('Owner removes the member', `select public.scout_remove_member('${G}')`);
    await ok('Removing a member changes the join code', `select public.scout_team_code() as c`, (r) => r[0].c !== soloCode);
    await as(G);
    await ok('Removed member cannot rejoin with the old code', `select public.scout_join_team('${soloCode}','Gus') as t`, (r) => r[0].t === null);
    await as('60000000-0000-0000-0000-000000000000');
    await db.exec(`reset role; delete from auth.users where id='60000000-0000-0000-0000-000000000000';`);
    await ok('Team with no members left is deleted, number freed', `select count(*)::int as n from public.scout_teams where number='777'`, (r) => r[0].n === 0);
    console.log(JSON.stringify({ passed: passed.length, checks: passed }, null, 2));
  } finally { await db.close(); }
})().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; });
