// Driver trainer drills. Every drill runs on Red 1 with the driver's usual controls. A drill sets its field up
// after the game reset (setup), is stepped every frame while its clock runs (update) and reports splits and the
// finish through the session (s.split / s.finish, see trainer.js). status() feeds the overlay.
import * as THREE from 'three';
import { pointInPoly } from '../physics.js';
import { CORE, wx, wz } from '../config.js';
import { LEVELS } from '../ai.js';

const SOLO = { drivers: 1, bots: false };
const OTHERS = [1, 2, 3];
const HOLD = 3;                       // Balance: seconds to hold the deck level
const ROUNDS = 5;                     // Precision rounds

// Red poles named as the Red driver sees them: the driver station looks toward +z, so +x is on the left
export function poleName(p) {
  const kind = p.type === 'star' ? 'Star Pole' : p.type === 'high' ? 'High Pole' : 'Apex Pole';
  const x = p.squad === 'red' ? p.x : -p.x;
  return `${kind}, ${Math.abs(x) < 0.05 ? 'centre' : x > 0 ? 'left' : 'right'}`;
}
const redPoles = (sim) => sim.field.poles.filter((p) => p.squad === 'red' && p.type !== 'apex');
const onPoles = (sc) => sc.high + sc.star + sc.apex;

// the pole a scored CORE is threaded on
function poleOf(sim, c) {
  const t = c.pos();
  let best = null, bd = 0.03;
  for (const p of sim.field.poles) { const d = Math.hypot(t.x - p.x, t.z - p.z); if (d < bd) { bd = d; best = p; } }
  return best;
}

// a free spot for a loose CORE: clear of poles, stations, other rings, the robot and zones Red may not enter
function freeSpot(sim) {
  const F = sim.field, g = sim.game, r = sim.robots[0].body.translation();
  const vz = F.vaultZones.blue;
  for (let k = 0; k < 400; k++) {
    const X = 20 + Math.random() * 104, Y = 22 + Math.random() * 98;     // field inches, 20 in off the walls
    if ((X < 34 || X > 110) && Y > 34 && Y < 110) continue;              // the Space Stations and their ramps
    const x = wx(X), z = wz(Y);
    if (F.poles.some((p) => Math.hypot(p.x - x, p.z - z) < 0.2)) continue;
    if (g.cores.some((c) => { const t = c.pos(); return Math.hypot(t.x - x, t.z - z) < 0.2; })) continue;
    if (Math.hypot(r.x - x, r.z - z) < 0.5) continue;
    if (pointInPoly([x, z], F.sourceZones.blue) || pointInPoly([x, z], F.dropZones.red)) continue;
    if (Math.hypot(x - vz.c[0], z - vz.c[1]) < vz.r + 0.15) continue;
    return { x, z };
  }
  return { x: 0, z: wz(64) };
}

// highlight for the Precision target: a soft column over the pole and a ring under the drill CORE
function marks(scene) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffc23d, transparent: true, opacity: 0.22, depthWrite: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.6, 24, 1, true), mat);
  beam.renderOrder = 4;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc23d, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.058, 0.07, 48), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.renderOrder = 4;
  scene.add(beam, ring);
  return {
    beam, ring,
    dispose() { scene.remove(beam, ring); beam.geometry.dispose(); ring.geometry.dispose(); mat.dispose(); ringMat.dispose(); },
  };
}

export const DRILLS = [
  {
    id: 'cycle', name: 'Cycle sprint', metric: 'time', mode: 'practice',
    blurb: 'Score COREs on any pole as fast as you can. The Human Player keeps two COREs ready in the Source Zone.',
    options: [{ key: 'n', label: 'COREs', values: [[3, '3'], [5, '5'], [10, '10']], def: 5 }],
    key: (o) => `cycle-${o.n}`,
    title: (o) => `Cycle sprint, ${o.n} COREs`,
    settings: () => SOLO, bench: () => OTHERS,
    setup(s) { s.data = { max: 0, feedT: 0 }; },
    update(s, dt) {
      const g = s.game, D = s.data, n = s.opts.n;
      const count = onPoles(g.score.red);
      while (count > D.max && D.max < n) { D.max++; s.split(`CORE ${D.max}`); }
      if (D.max >= n) { s.finish(s.clock); return; }
      // Human Player: keep two COREs waiting, using the same call (and rules) as the HP key
      D.feedT += dt;
      if (D.feedT < 0.4 || g.state !== 'running') return;
      D.feedT = 0;
      const F = s.sim.field;
      if (g.hp.red.cores <= 0 || s.sim.robots.some((r) => r.squad === 'red' && r.zone && r.zone.ownSource)) return;
      const waiting = g.cores.filter((c) => c.color === 'red' && !c.heldBy && !c.scored && pointInPoly([c.pos().x, c.pos().z], F.sourceZones.red)).length;
      if (waiting < 2) g.placeCore('red');
    },
    status(s) { return { progress: `${s.data.max} / ${s.opts.n} COREs`, hint: s.game.hp.red.cores <= 0 ? 'The Human Player is out of COREs' : 'Any Star or High Pole counts' }; },
  },
  {
    id: 'precision', name: 'Precision', metric: 'time', mode: 'practice',
    blurb: `A CORE appears somewhere new each round. Score it on the pole named in the overlay. ${ROUNDS} rounds, timed per round.`,
    options: [],
    key: () => `precision-${ROUNDS}`,
    title: () => 'Precision',
    settings: () => SOLO, bench: () => OTHERS,
    setup(s) {
      s.data = { round: 0, core: null, target: null, wrongT: 0, lostT: 0, fx: marks(s.sim.scene) };
      this.spawn(s, true);
    },
    spawn(s, newTarget) {
      const D = s.data, sim = s.sim;
      if (newTarget) {
        const list = redPoles(sim).filter((p) => p !== D.target);
        D.target = list[Math.floor(Math.random() * list.length)];
      }
      const p = freeSpot(sim);
      D.core = s.addCore('red', { x: p.x, y: CORE.h / 2 + 0.002, z: p.z });
      D.wrongT = 0; D.lostT = 0;
      const T = D.target;
      D.fx.beam.position.set(T.x, T.top + 0.3, T.z);
    },
    update(s, dt) {
      const D = s.data, c = D.core, g = s.game;
      if (!g.cores.includes(c) || c.pos().y < -1) { D.lostT += dt; if (D.lostT > 0.5) { s.toast('The CORE left the field. A new one is out.'); this.spawn(s, false); } return; }
      if (c.scored !== 'pole' || c.heldBy) { D.wrongT = 0; return; }
      if (poleOf(s.sim, c) === D.target) {
        D.round++;
        s.split(`Round ${D.round}`);
        if (D.round >= ROUNDS) { s.finish(s.clock); return; }
        this.spawn(s, true);
        return;
      }
      // threaded on another pole: it stays there and a fresh CORE comes out for the same round (the clock runs on)
      D.wrongT += dt;
      if (D.wrongT > 0.6) { s.toast(`Wrong pole. Score it on the ${poleName(D.target)}.`); this.spawn(s, false); }
    },
    frame(s) {
      const D = s.data; if (!D || !D.fx) return;
      const c = D.core, loose = c && s.game.cores.includes(c) && !c.scored;
      D.fx.ring.visible = !!loose && !c.heldBy;
      if (loose) { const t = c.pos(); D.fx.ring.position.set(t.x, 0.003, t.z); }
      D.fx.beam.material.opacity = 0.16 + 0.08 * Math.sin(performance.now() / 300);
    },
    teardown(s) { if (s.data && s.data.fx) s.data.fx.dispose(); },
    status(s) { const D = s.data; return { progress: `Round ${Math.min(ROUNDS, D.round + 1)} / ${ROUNDS}`, hint: D.target ? `Score on the ${poleName(D.target)}` : '' }; },
  },
  {
    id: 'payload', name: 'Payload run', metric: 'time', mode: 'practice',
    blurb: 'Drive into the Source Zone, where the Human Player loads the Payload into your Cargo Bay, then tip it into the Drop Zone.',
    options: [],
    key: () => 'payload',
    title: () => 'Payload run',
    settings: () => SOLO, bench: () => OTHERS,
    setup(s) { s.data = { loaded: false, dumped: false }; },
    update(s) {
      const g = s.game, r = s.robot, p = g.payloads[0], D = s.data;
      // Human Player: loads the moment the robot is in the Source Zone with room in the bay (R9.2)
      if (g.state === 'running' && p.where === 'hp' && r.zone && r.zone.ownSource && !r.payloadJoint && r.tray < 2) g.payloadAction(0);
      if (p.where === 'cargo' && !D.loaded) { D.loaded = true; s.split('Loaded'); }
      if (p.where === 'field' && D.loaded && !D.dumped) { D.dumped = true; s.split('Tipped out'); }
      if (p.where === 'hp' && D.loaded) { D.loaded = false; D.dumped = false; }     // returned: load it again
      if (p.scored) { s.split('Scored'); s.finish(s.clock); }
    },
    status(s) {
      const p = s.game.payloads[0];
      const hint = p.where === 'hp' ? 'Drive into your Source Zone to load' : p.where === 'cargo' ? 'Back into the Drop Zone, then work the Cargo Bay' : p.invalid ? 'Not scorable: it goes back to the Human Player' : 'Let it settle fully inside the Drop Zone';
      return { progress: p.where === 'cargo' ? 'Loaded' : p.where === 'field' ? 'On the field' : 'With the Human Player', hint };
    },
  },
  {
    id: 'balance', name: 'Balance', metric: 'time', mode: 'practice',
    blurb: `From the start position, climb your own Space Station and hold it BALANCED (deck level) for ${HOLD} seconds.`,
    options: [],
    key: () => 'balance',
    title: () => 'Balance',
    settings: () => SOLO, bench: () => OTHERS,
    setup(s) { s.data = { hold: 0, state: 'none', seen: new Set() }; },
    update(s, dt) {
      const r = s.robot, D = s.data;
      const st = r.stationSquad === 'red' ? r.stationState : 'none';
      D.state = st;
      const once = (k, label) => { if (!D.seen.has(k)) { D.seen.add(k); s.split(label); } };
      if (st !== 'none') once('engage', 'Engaged');
      if (st === 'dock' || st === 'balance') once('dock', 'Docked');
      if (st === 'balance') {
        if (D.hold === 0) once('balance', 'First balance');
        D.hold += dt;
        if (D.hold >= HOLD) { s.split(`Held ${HOLD} s`); s.finish(s.clock); }
      } else D.hold = 0;
    },
    status(s) {
      const D = s.data, names = { none: 'Off the station', engage: 'Engaged', dock: 'Docked, not level', balance: 'Balanced' };
      return { progress: names[D.state] || '', hint: D.state === 'balance' ? `Hold ${D.hold.toFixed(1)} / ${HOLD.toFixed(1)} s` : 'Park over the pivot to bring the deck level', meter: Math.min(1, D.hold / HOLD) };
    },
  },
  {
    id: 'bot', name: 'Beat the bot', metric: 'margin', mode: 'match',
    blurb: 'A full 2:30 match against the AI drivers. Scored on the final margin, Red minus Blue.',
    options: [
      { key: 'format', label: 'Format', values: [['2v2', 'With an AI partner'], ['1v1', '1 v 1']], def: '2v2' },
      { key: 'level', label: 'AI level', values: Object.entries(LEVELS).map(([k, v]) => [k, v.label]), def: 'normal' },
    ],
    key: (o) => `bot-${o.format}-${o.level}`,
    title: (o) => `Beat the bot, ${o.format === '1v1' ? '1 v 1' : '2 v 2'} ${LEVELS[o.level].label}`,
    settings: (o) => ({ drivers: 1, bots: true, botLevel: o.level }),
    bench: (o) => (o.format === '1v1' ? [1, 3] : []),
    // 1 v 1: only Blue 1 is an AI driver; the other two robots sit out
    spectate: (o) => (o.format === '1v1' ? [2] : null),
    setup(s) { s.data = { next: 30 }; },
    update(s) {
      const g = s.game, D = s.data, sc = g.score;
      while (s.clock >= D.next && D.next < g.length) { s.split(clockLabel(D.next), { red: sc.red.total, blue: sc.blue.total, v: sc.red.total - sc.blue.total }); D.next += 30; }
      if (g.state === 'final' && g.final) {
        const F = g.final;
        s.split(clockLabel(g.length), { red: F.red.total, blue: F.blue.total, v: F.red.total - F.blue.total });
        s.finish(F.red.total - F.blue.total, { red: F.red.total, blue: F.blue.total, rp: F.red.rpTotal });
      }
    },
    status(s) {
      const sc = s.game.score;
      return { progress: `Red ${sc.red.total}  Blue ${sc.blue.total}`, hint: s.game.state === 'post' ? 'Match over' : s.game.isLevelUp() ? 'Level up: Space Station and Apex count now' : '' };
    },
  },
];

function clockLabel(t) { return `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`; }
