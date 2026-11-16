// Overdrive Scout's database on the phone (IndexedDB) and the loop that uploads what was filed offline.
// A classic script, not a module: scout.html loads it for the app and sw.js loads the same file with importScripts,
// so a Background Sync with the app closed runs exactly the code the app runs.
//
//   kv      what this account may see, as last read from the server: 'ev.<event id>' = { reports, pits, at },
//           'events.<team id>', 'picks.<event id>', 'pool.<event id>' (team 009), membership, and 'auth' for the worker
//   outbox  one row per unsynced create, edit or delete, keyed by account + kind + record id
//
// Conflict rule (see README, "Offline"): an edit is compared field by field with the copy it started from and the
// copy now on the server. Fields only one side changed are merged. A field both sides changed to different values
// is never overwritten: the entry is parked as a conflict with both versions until a person chooses.
(() => {
  let opening = null;
  const open = () => opening || (opening = new Promise((ok, no) => {
    const r = indexedDB.open('od-scout', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('outbox', { keyPath: 'key' }); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { opening = null; no(r.error); };
  }));
  const run = async (store, mode, fn) => {
    const db = await open();
    return new Promise((ok, no) => {
      const t = db.transaction(store, mode), req = fn(t.objectStore(store));
      t.oncomplete = () => ok(req && req.result);
      t.onerror = t.onabort = () => no(t.error || new Error('This device could not save the entry. Its storage is full or blocked.'));
    });
  };
  const get = (store, key) => run(store, 'readonly', (s) => s.get(key));
  const all = (store) => run(store, 'readonly', (s) => s.getAll());
  const keys = (store) => run(store, 'readonly', (s) => s.getAllKeys());
  const put = (store, value, key) => run(store, 'readwrite', (s) => s.put(value, key));
  const del = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
  const clear = (store) => run(store, 'readwrite', (s) => s.clear());

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
  const robotKey = (n) => String(n || '').replace(/^0+/, '') || '0';

  // the server function and arguments that replay one outbox item
  function rpcOf(item) {
    const { kind, row, base, mid } = item;
    if (kind === 'event') return ['scout_push_event', { e: row }];
    if (kind === 'report') return ['scout_push_report', { r: row, base, rev: mid }];
    if (kind === 'pit') return ['scout_push_pit', { p: row, base, rev: mid }];
    if (kind === 'picks') return ['scout_push_picks', { p: row, base, rev: mid }];
    return ['scout_push_delete', { rid: row.id, base }];
  }

  // what a record is made of, one entry per field that can be edited on its own
  const ROW_FIELDS = ['event_id', 'match_type', 'match_number', 'robot_number', 'alliance', 'station'];
  function fieldsOf(kind, row) {
    const out = {};
    if (!row) return out;
    if (kind === 'picks') { out.data = row.data; return out; }
    if (kind === 'report') for (const k of ROW_FIELDS) out[k] = row[k];
    for (const [k, v] of Object.entries(row.data || {})) if (k !== 'v') out[`data.${k}`] = v;
    return out;
  }
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  // three-way merge of an edited row against the server's newer copy: { row } when nothing collides, else { fields }
  function merge(kind, mine, snap, server) {
    const m = fieldsOf(kind, mine), b = fieldsOf(kind, snap), s = fieldsOf(kind, server);
    const row = { ...server, data: kind === 'picks' ? server.data : { ...(server.data || {}) } }, clash = [];
    for (const k of new Set([...Object.keys(m), ...Object.keys(b), ...Object.keys(s)])) {
      const mineChanged = !same(m[k], b[k]), theirsChanged = !same(s[k], b[k]);
      if (!mineChanged) continue;
      if (theirsChanged && !same(m[k], s[k])) { clash.push(k); continue; }
      if (k === 'data') row.data = m[k];
      else if (k.startsWith('data.')) { if (m[k] === undefined) delete row.data[k.slice(5)]; else row.data[k.slice(5)] = m[k]; }
      else row[k] = m[k];
    }
    if (clash.length) return { fields: clash };
    const keep = kind === 'report' ? ['id', 'team_id', ...ROW_FIELDS, 'data'] : kind === 'pit' ? ['id', 'team_id', 'event_id', 'robot_number', 'data'] : ['id', 'team_id', 'event_id', 'data'];
    return { row: Object.fromEntries(keep.map((k) => [k, k === 'id' && kind === 'picks' ? server.event_id : row[k]])) };
  }

  // keep the phone's copy of the server in step with what a push just changed there
  async function applyRow(item, row) {
    const { kind } = item, touched = [];
    const edit = async (key, fallback, fn) => { const v = (await get('kv', key)) || fallback; fn(v); await put('kv', v, key); touched.push(key); };
    if (kind === 'event' && row) {
      await edit(`events.${row.team_id}`, [], (list) => { const i = list.findIndex((e) => e.id === row.id); if (i >= 0) list[i] = row; else list.unshift(row); });
    } else if (kind === 'picks' && row) {
      await put('kv', { data: row.data, updated_at: row.updated_at }, `picks.${row.event_id}`); touched.push(`picks.${row.event_id}`);
    } else if (kind === 'report' || kind === 'pit' || kind === 'del') {
      const eventId = (row || item.row).event_id, list = kind === 'pit' ? 'pits' : 'reports', id = (row || item.row).id;
      if (eventId) await edit(`ev.${eventId}`, { reports: [], pits: [], at: null }, (c) => {
        c[list] = (c[list] || []).filter((x) => x.id !== id && !(kind === 'pit' && robotKey(x.robot_number) === robotKey(row.robot_number)));
        if (row) c[list].push(row);
      });
    }
    return touched;
  }

  // Upload one account's waiting items: events first (reports are filed to them), then oldest first.
  // send(item) resolves to the server's reply, or throws with .offline / .auth set when nothing can be sent now.
  // Items parked with an error are skipped unless retry is set; conflicts always wait for a person.
  async function push(send, { uid, team, retry = false } = {}) {
    const out = { sent: 0, stop: null, touched: new Set() };
    const items = (await all('outbox')).filter((x) => x.uid === uid).sort((a, b) => (b.kind === 'event') - (a.kind === 'event') || a.at - b.at);
    for (let item of items) {
      if (item.conflict || (item.error && !retry)) continue;
      if (item.team !== team) { item.error = 'You are no longer on the team this was filed for.'; await put('outbox', item); continue; }
      for (let attempt = 0; attempt < 3; attempt++) {
        let res;
        try { res = await send(item); } catch (e) {
          if (e.offline || e.auth) { out.stop = e.offline ? 'offline' : 'auth'; return out; }
          item.error = e.message || 'The server refused this entry.'; item.tries = (item.tries || 0) + 1; await put('outbox', item);
          break;
        }
        const now = await get('outbox', item.key);
        const current = !!now && now.mid === item.mid;       // false: edited or discarded while this was in flight
        if (res.status === 'ok') {
          if (current) await del('outbox', item.key);
          if (current || !now) for (const k of await applyRow(item, res.row)) out.touched.add(k);
          out.sent++;
          break;
        }
        if (!current) break;
        const server = res.server;
        // the server copy is this phone's own earlier attempt (its reply was lost): carry on from it
        const own = server && (item.revs || []).includes(server.client_rev);
        const merged = !server || item.kind === 'del' || own ? null : merge(item.kind, item.row, item.snap, server);
        if (own || (merged && merged.row)) {
          item = { ...item, row: merged ? merged.row : item.row, base: server.updated_at, snap: server, revs: [...(item.revs || []), item.mid], mid: uuid(), error: null };
          await put('outbox', item);
          continue;
        }
        item.conflict = { server, fields: merged ? merged.fields : [] }; item.error = null;
        await put('outbox', item);
        break;
      }
    }
    return out;
  }

  self.OdOutbox = { get, all, keys, put, del, clear, uuid, rpcOf, applyRow, push };
})();
