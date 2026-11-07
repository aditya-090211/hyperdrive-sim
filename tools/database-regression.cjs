const {PGlite}=require(process.env.PGLITE_PATH || '../../tmp/audit-db/node_modules/@electric-sql/pglite');
const fs=require('fs');const path=require('path');
(async()=>{const db=new PGlite();const checks=[];try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}'::jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/schema.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/hardening.sql'),'utf8'));checks.push('Fresh schema and repeated migration apply');
 await db.exec(`insert into auth.users(id,raw_user_meta_data) values ('00000000-0000-0000-0000-000000000001','{"username":"tester"}');set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';`);
 await db.exec(`insert into public.matches(red_score,blue_score,winner,red_rp,blue_rp,star_map,details) values(5000,0,'red',6,0,'CGG','{"balances":"bad","red_maps":1e1000,"blue_maps":2}');`);
 const board=await db.query('select * from public.leaderboard()');if(board.rows.length)throw Error('Forged score reached leaderboard');checks.push('Forged 5000-point browser result excluded from leaderboard');
 const stats=(await db.query('select public.my_stats() as stats')).rows[0].stats;if(stats.balances!==0||stats.star_maps!==2)throw Error(JSON.stringify(stats));checks.push('Malformed and oversized legacy counters do not break statistics');
 try{await db.exec(`insert into public.matches(red_score,blue_score,winner,red_rp,blue_rp,star_map,verified) values(5000,0,'red',6,0,'CGG',true)`);throw Error('Unexpected success')}catch(e){if(e.message==='Unexpected success')throw e;checks.push('Browser cannot set verified status')}
 try{await db.exec(`insert into public.matches(user_id,red_score,blue_score,winner,red_rp,blue_rp,star_map) values('00000000-0000-0000-0000-000000000002',1,0,'red',1,0,'CGG')`);throw Error('Unexpected success')}catch(e){if(e.message==='Unexpected success')throw e;checks.push('Another user match insert blocked')}
 await db.exec(`reset role;update public.matches set verified=true;set role authenticated`);if((await db.query('select * from public.leaderboard()')).rows.length!==1)throw Error('Verified score missing');checks.push('Trusted verified score appears on leaderboard');
 console.log(JSON.stringify({passed:checks},null,2));fs.writeFileSync('database-regression-results.json',JSON.stringify({passed:checks},null,2));
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
