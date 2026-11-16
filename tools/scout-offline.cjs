// Overdrive Scout offline and sync, in a real browser with the network actually switched off (Playwright, Chrome).
// Needs the dev server: python tools/devserver.py 8766. Run: node tools/scout-offline.cjs
// Uses the localhost demo backend (?demo=1), which answers like the scout_push_* functions in scouting-offline.sql.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE = process.env.SCOUT_URL || 'http://localhost:8766';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  // nothing leaves the machine: the fonts and Supabase are blocked, as on a venue with no signal at all
  await ctx.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const passed = [], errors = [];
  const ok = (label, cond, info) => { if (!cond) throw new Error(`${label}${info === undefined ? '' : `: ${JSON.stringify(info)}`}`); passed.push(label); };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (page, fn, label, ms = 15000) => { try { await page.waitForFunction(fn, null, { timeout: ms, polling: 100 }); } catch { throw new Error(`Timed out: ${label}`); } };
  let page;
  const open = async (query) => {
    page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/scout?demo=1&sw=1${query || ''}`);
    await until(page, () => window.__scoutStore, 'Scout started');
    return page;
  };
  const status = () => page.evaluate(() => ({ ...window.__scoutStore.status(), label: document.querySelector('#tb-sync-l')?.textContent, count: document.querySelector('#tb-sync-n')?.textContent }));
  const server = () => page.evaluate(() => JSON.parse(localStorage.getItem('od-demo-server')));
  const outbox = () => page.evaluate(() => window.OdOutbox.all('outbox'));
  const click = async (text, scope = 'body') => page.locator(scope).getByRole('button', { name: text, exact: true }).first().click();
  const synced = (label) => until(page, () => { const s = window.__scoutStore.status(); return s.state === 'synced' && !s.unsynced; }, label, 30000);

  try {
    // ---- first visit, online: sign in, register a team, the service worker keeps a copy of Scout
    await open('&fresh=1');
    await page.locator('#agree').check(); await click('Continue');
    await page.getByPlaceholder('009').fill('4242'); await page.getByPlaceholder('Overdrive').fill('Demo Robotics');
    await page.getByPlaceholder('Your name').nth(1).fill('Asha'); await click('Register team');
    await until(page, () => document.body.dataset.stage === 'app', 'app open');
    await until(page, async () => (await caches.keys()).length > 0 && !!(await caches.match('/scout', { ignoreSearch: true })), 'shell cached');
    await synced('first sync');
    ok('Status reads Synced with no count', (await status()).label === 'Synced' && !(await status()).count);

    // ---- airplane mode
    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await until(page, () => document.querySelector('#tb-sync-l').textContent === 'Offline', 'offline label');
    ok('Status reads Offline', true);
    await page.getByPlaceholder('e.g. 1002').first().fill('7777');
    await page.locator('.counters .inc').first().click(); await page.locator('.counters .inc').first().click();
    await click('Submit report');
    if (await page.getByRole('button', { name: 'File as 7777' }).count()) await click('File as 7777');
    await until(page, () => document.querySelector('#tb-sync-n').textContent === '1', 'one unsynced');
    ok('Offline report is saved on the phone and counted', (await status()).unsynced === 1);
    const filedId = (await outbox())[0].row.id;
    ok('Client generated a uuid for the report', /^[0-9a-f-]{36}$/.test(filedId));

    // edit it while still offline: still one entry, now carrying the edit
    await page.evaluate(async (id) => {
      const s = window.__scoutStore, item = s.queue.find((q) => q.row.id === id);
      await s.enqueue('report', { ...item.row, data: { ...item.row.data, note: 'edited offline' } });
    }, filedId);
    ok('Editing an unsynced entry replaces it, no second entry', (await outbox()).length === 1 && (await outbox())[0].row.data.note === 'edited offline');

    // pick list and a pit report, offline
    await page.evaluate(async () => {
      const s = window.__scoutStore, ev = [...s.kv.keys()].find((k) => k.startsWith('ev.')).slice(3), team = s.team;
      await s.enqueue('picks', { id: ev, event_id: ev, team_id: team, data: [{ robot: '7777', dnp: false }] });
      await s.enqueue('pit', { id: crypto.randomUUID(), team_id: team, event_id: ev, robot_number: '7777', data: { drive: 'tank', motors: 4 } });
    });
    ok('Pick list and pit report queue offline too', (await status()).unsynced === 3);

    // analytics are computed from the phone's data while offline
    await page.locator('#tabbar .tab[data-tab="data"]').click();
    await until(page, () => [...document.querySelectorAll('.rank .rt b')].some((b) => b.textContent === '7777'), 'offline report in rankings');
    ok('Rankings include the offline report with no connection', true);

    // ---- close the app and open it again, still offline (cold start from the service worker's copy)
    await page.close();
    await open();
    await until(page, () => document.body.dataset.stage === 'app', 'app reopened offline', 20000);
    ok('Scout opens offline after closing the tab', true);
    ok('Unsynced entries survive closing the app', (await outbox()).length === 3 && (await status()).unsynced === 3);
    ok('Still signed in offline', await page.evaluate(() => !!window.__scoutStore.uid));

    // ---- the token expired while offline; the connection comes back
    await page.evaluate(() => { const d = window.__scoutDemo; d.db.expired = true; d.persist(); });
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await synced('sync after reconnect');
    const srv = await server();
    ok('Expired token was refreshed and the queue uploaded', srv.expired === false);
    ok('Report reached the server exactly once', srv.reports.filter((r) => r.id === filedId).length === 1 && srv.reports.find((r) => r.id === filedId).data.note === 'edited offline');
    ok('Pick list and pit report reached the server', srv.picks?.[0]?.data?.[0]?.robot === '7777' && srv.pits.some((p) => p.robot_number === '7777'));
    ok('Status back to Synced', (await status()).label === 'Synced');

    // ---- a lost reply: the server applied the write but the phone never heard back, then the scout edits again
    const lost = await page.evaluate(async (id) => {
      const s = window.__scoutStore, d = window.__scoutDemo, real = d.push.bind(d);
      const ev = [...s.kv.keys()].find((k) => k.startsWith('ev.'));
      const row = s.cacheGet(ev).reports.find((r) => r.id === id);
      d.push = async (item) => { await real(item); d.push = real; throw new Error('Failed to fetch'); };
      await s.enqueue('report', { id: row.id, team_id: row.team_id, event_id: row.event_id, match_type: row.match_type, match_number: row.match_number, robot_number: row.robot_number, alliance: row.alliance, station: row.station, data: { ...row.data, m_high: 9 } });
      const item = s.queue.find((q) => q.row.id === id);
      await s.enqueue('report', { ...item.row, data: { ...item.row.data, driver: 5 } });
      await s.flush({ retry: true });
      return { left: s.queue.length, conflicts: s.queue.filter((q) => q.conflict).length };
    }, filedId);
    const srv2 = await server();
    const r2 = srv2.reports.find((r) => r.id === filedId);
    ok('Lost reply then a new edit: no duplicate, no false conflict', lost.left === 0 && lost.conflicts === 0 && srv2.reports.filter((r) => r.id === filedId).length === 1, lost);
    ok('Both edits are on the server', r2.data.m_high === 9 && r2.data.driver === 5, r2.data);

    // ---- two scouts edit the same report: different fields merge, the same field is held for a person
    const seeded = srv2.reports.find((r) => r.id !== filedId && !r.data.note);
    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.evaluate(async (r) => {
      const s = window.__scoutStore, base = { id: r.id, team_id: r.team_id, event_id: r.event_id, match_type: r.match_type, match_number: r.match_number, robot_number: r.robot_number, alliance: r.alliance, station: r.station };
      await s.enqueue('report', { ...base, data: { ...r.data, note: 'from this phone', m_star: 11 } });
      const d = window.__scoutDemo, x = d.db.reports.find((y) => y.id === r.id);
      x.data = { ...x.data, defense: 3, m_star: 12 }; x.updated_at = d.stamp(); d.persist();
    }, seeded);
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await until(page, () => window.__scoutStore.status().state === 'attention', 'conflict flagged', 20000);
    const st = await status();
    ok('Same field edited on both sides: Needs attention, nothing overwritten', st.label === 'Needs attention' && (await server()).reports.find((r) => r.id === seeded.id).data.m_star === 12, st);
    await page.locator('#tb-sync').click();
    await page.getByText('Yours: 11').waitFor();
    ok('Sync sheet shows both versions of the clashing field', await page.getByText('Server: 12').count() === 1);
    await click('Keep mine');
    await synced('conflict resolved');
    const r3 = (await server()).reports.find((r) => r.id === seeded.id);
    ok('Keep mine: the scout\'s value wins, the other scout\'s other field is kept', r3.data.m_star === 11 && r3.data.defense === 3 && r3.data.note === 'from this phone', r3.data);

    const other = (await server()).reports.find((r) => r.id !== filedId && r.id !== seeded.id);
    await page.evaluate(async (r) => {
      const s = window.__scoutStore, d = window.__scoutDemo, base = { id: r.id, team_id: r.team_id, event_id: r.event_id, match_type: r.match_type, match_number: r.match_number, robot_number: r.robot_number, alliance: r.alliance, station: r.station };
      const x = d.db.reports.find((y) => y.id === r.id); x.data = { ...x.data, speed: 4 }; x.updated_at = d.stamp(); d.persist();
      await s.enqueue('report', { ...base, data: { ...r.data, note: 'merge me' } });
    }, other);
    await synced('merge');
    const r4 = (await server()).reports.find((r) => r.id === other.id);
    ok('Different fields edited on both sides merge by themselves', r4.data.speed === 4 && r4.data.note === 'merge me', r4.data);

    // ---- a deletion made offline, of a report someone else has not touched
    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.evaluate(async (r) => { await window.__scoutStore.enqueue('del', { id: r.id, team_id: r.team_id, event_id: r.event_id }); }, other);
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await synced('delete');
    ok('Offline deletion reaches the server', !(await server()).reports.some((r) => r.id === other.id));

    // ---- the queue never writes for another team
    const foreign = await page.evaluate(async () => {
      const s = window.__scoutStore;
      await window.OdOutbox.put('outbox', { key: `${s.uid}|report|x`, kind: 'report', row: { id: crypto.randomUUID(), team_id: 'team-1530' }, at: Date.now(), team: 'team-1530', uid: s.uid, mid: crypto.randomUUID(), revs: [] });
      await s.reload(); await s.flush({ retry: true });
      return s.queue.find((q) => q.team === 'team-1530');
    });
    ok('An entry for another team is refused on the phone and shown, not sent', foreign && /no longer on the team/.test(foreign.error));
    await page.evaluate(async () => { const s = window.__scoutStore; s.dropWhere((q) => q.team === 'team-1530'); });

    // ---- sign out forgets what this account could see
    await page.locator('#tabbar .tab[data-tab="team"]').click();
    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await until(page, () => document.body.dataset.stage === 'gate', 'signed out');
    const left = await page.evaluate(async () => ({ kv: (await window.OdOutbox.keys('kv')).length, ls: Object.keys(localStorage).filter((k) => k.startsWith('od.scout.')).length }));
    ok('Sign out clears the local copy of team data', left.kv === 0 && left.ls === 0, left);

    ok('No page errors', errors.length === 0, errors);
    console.log(JSON.stringify({ passed: passed.length, checks: passed }, null, 2));
  } catch (e) {
    console.error('FAILED:', e.message, '\npassed so far:', passed.join(' | '), errors.length ? `\npage errors: ${errors.join(' | ')}` : '');
    if (page) await page.screenshot({ path: 'scout-offline-failure.png' }).catch(() => {});
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
