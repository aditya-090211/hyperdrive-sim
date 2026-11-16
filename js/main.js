import { gpuTier, prCap, createGovernor, compileAll } from './governor.js';
import * as THREE from 'three';
import { OrbitControls } from '../lib/OrbitControls.js';
import { createWorld, RAPIER } from './physics.js';
import { buildField, loadFieldModel } from './field.js';
import { loadRobotModel, Robot } from './robot.js';
import { Game } from './game.js';
import { Input, HP_KEYS, applyKeyBindings } from './input.js';
import { Online, hostRoomFor } from './online.js';
import { UI } from './ui.js';
import { RobotCode } from './auto.js';
import { AI } from './ai.js';
import { Planner } from './tools/planner.js';
import { Trainer } from './tools/trainer.js';
import { Strategy } from './tools/strategy.js';
import { Designer } from './tools/designer.js';
import { Account } from './account.js';
import { Settings, isTouch } from './settings.js';
import { TEAMS, HALF, WALL, COLORS } from './config.js';
import { buildArena, buildPlinth, daylight, cloneDivision, SUN_DIR, HERO, HERO_YAW, homeShot } from './arena.js';
import { buildRobotVisual } from './robot-model.js';
import { takeHandoff } from './handoff.js';

// arriving from the landing page: keep its last frame on screen while the simulator loads
const handoffImg = takeHandoff('sim');
if (handoffImg) { document.getElementById('loading').classList.add('handoff'); document.documentElement.classList.add('handoff-in'); document.documentElement.style.setProperty('--handoff', `url("${handoffImg}")`); }


const STEP = 1 / 240;
const MAX_STEPS = 12;

// ---------------------------------------------------------------- audio
class Audio {
  constructor() {
    this.ctx = null; this.enabled = true;
    // created while the simulator loads (it starts suspended): creating it inside the Play click stalled the camera
    // fly-in by ~200 ms on Windows. The first key or tap only resumes it.
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no audio */ }
    const unlock = () => { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); };
    window.addEventListener('keydown', unlock); window.addEventListener('pointerdown', unlock);
  }
  tone(f, d, type = 'square', vol = 0.06, when = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + when, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = f; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + d + 0.02);
  }
  beep(f, d) { this.tone(f, d, 'sine', 0.05); }
  buzzer(kind) {
    if (kind === 'start') { this.tone(330, 0.9, 'sawtooth', 0.08); this.tone(440, 0.9, 'sawtooth', 0.05); }
    else if (kind === 'end') { this.tone(196, 1.4, 'sawtooth', 0.09); this.tone(147, 1.4, 'sawtooth', 0.06); }
    else if (kind === 'levelup') { [523, 659, 784].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.08, i * 0.18)); }
    else if (kind === 'starburst') { [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.06, i * 0.09)); }
  }
}

function setLoad(pct, text) {
  const bar = document.getElementById('load-bar'), st = document.getElementById('loading-status');
  if (bar) bar.style.width = `${pct}%`;
  if (st && text) st.textContent = text;
}

// ---------------------------------------------------------------- boot
// the interface faces are also drawn into canvas textures, so wait (briefly) for them
function fontsReady() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const faces = ['700 32px "Instrument Sans"', '600 32px "Instrument Sans"', '400 32px "Instrument Serif"'];
  return Promise.race([Promise.all(faces.map((f) => document.fonts.load(f))).catch(() => {}), new Promise((r) => setTimeout(r, 2500))]);
}

async function boot() {
  setLoad(8, 'Starting renderer…');
  // download both CAD models while everything else starts up
  const modelPromise = loadRobotModel();
  const fieldPromise = loadFieldModel();
  modelPromise.catch(() => {}); fieldPromise.catch(() => {});
  Account.init();
  // no separate WebGL probe: a throwaway context costs as much as the real one (over a second on some laptops)
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }); }
  catch { throw new Error('this browser has WebGL turned off. Enable hardware acceleration and reload.'); }
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // soft PCF costs ~2x the frame time on integrated GPUs
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.getElementById('view').appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); const s = document.getElementById('toast'); if (s) { s.textContent = 'Graphics were reset by the browser. Reload the page to continue.'; s.classList.add('show'); } });

  const scene = new THREE.Scene();
  // the venue is the Open Air Theatre at IIT Bombay, late afternoon
  daylight(scene, renderer);
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.02, 80);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0); controls.maxPolarAngle = Math.PI * 0.495; controls.enableDamping = true; controls.minDistance = 0.3; controls.maxDistance = 26;

  scene.add(new THREE.HemisphereLight(0xd3e2f5, 0x6d6152, 0.95));
  const sun = new THREE.DirectionalLight(0xffdcb4, 2.5);
  sun.position.copy(SUN_DIR).multiplyScalar(9); sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -3.8, right: 3.8, top: 3.8, bottom: -3.8, near: 1, far: 20 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.01;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xc8d4ff, 0.3); fill.position.set(3, 4, 2.5); scene.add(fill);

  setLoad(22, 'Starting the physics engine…');
  const [{ world, events }] = await Promise.all([createWorld(), fontsReady()]);

  const sim = {
    world, events, scene, renderer, camera, simTime: 0, showLabels: true, showGuides: true,
    audio: new Audio(), input: new Input(),
    owners: new Map(),
    registerCollider(c, info) { this.owners.set(c.handle, info); },
    registerBody(body, colliders, info) { for (const c of colliders) this.owners.set(c.handle, info); },
    unregisterBody(body) {
      const n = body.numColliders();
      for (let i = 0; i < n; i++) {
        const h = body.collider(i).handle;
        this.owners.delete(h);
        for (const r of this.robots || []) { r.contacts.delete(h); r.pairContacts.delete(h); }
      }
    },
  };

  setLoad(40, 'Loading the field CAD…');
  const fieldModel = await fieldPromise;
  setLoad(52, 'Building the HYPERDRIVE field…');
  await new Promise((r) => setTimeout(r, 0));
  const beforeField = new Set(scene.children);
  sim.field = buildField(scene, world, renderer, fieldModel, RAPIER);
  const fieldObjects = scene.children.filter((o) => !beforeField.has(o));
  sim.registerCollider(sim.field.floorCollider, { type: 'floor' });
  for (const s of ['red', 'blue']) for (const c of sim.field.stations[s].colliders) sim.registerCollider(c, { type: 'station', station: sim.field.stations[s] });
  // let the hinged ramps settle onto their floor plates once, so every reset starts from rest
  for (let i = 0; i < 480; i++) {
    for (const s of ['red', 'blue']) { const st = sim.field.stations[s]; st.deckBody.resetTorques(false); st.step(STEP); }
    world.step();
  }
  for (const s of ['red', 'blue']) { sim.field.stations[s].captureRest(); sim.field.stations[s].reset(); }
  // the venue around the field and the plinth the home screen shows your robot on
  sim.arena = buildArena(scene, { crowd: !isTouch || window.innerWidth > 900 });
  const plinth = buildPlinth();
  plinth.position.copy(HERO); scene.add(plinth);

  setLoad(65, 'Loading the robot CAD…');
  const model = await modelPromise;
  sim.robots = TEAMS.map((t) => new Robot(sim, t, model));
  setLoad(85, 'Staging the match…');
  sim.game = new Game(sim);
  const game = sim.game, input = sim.input;
  sim.ai = new AI(sim);
  // the second division's field (BRAVO): a still copy of this one with its own robots and COREs
  for (const s of ['red', 'blue']) sim.field.stations[s].sync();
  for (const c of game.cores) c.sync?.();
  const bravo = cloneDivision(scene, [...fieldObjects, ...game.cores.map((c) => c.mesh)]);
  [['1201', 0], ['1730', 1], ['2049', 2], ['2210', 3]].forEach(([num, i]) => {
    const r = sim.robots[i], p = r.startPose();
    const v = buildRobotVisual(model, { squadCol: r.squad === 'red' ? COLORS.red : COLORS.blue, number: num });
    v.root.position.set(p.x, 0, p.z); v.root.rotation.y = p.yaw; bravo.add(v.root);
  });
  const net = sim.net = new Online(sim);

  // ------------------------------------------------------------ cameras
  const CAMS = [
    // the drivers' own view (Fig 3.0): standing in the 25 in Driver Area right behind their start-zone wall, eye height
    // eyes 5.5 ft above the platform the drivers stand on, in the middle of the 25 in Driver Area
    { name: 'Red driver station', pos: [0, WALL.ground + 5.5 * 0.3048, -HALF - 0.36], target: [0, -0.3, 0.1], fov: 56 },
    { name: 'Blue driver station', pos: [0, WALL.ground + 5.5 * 0.3048, HALF + 0.36], target: [0, -0.3, -0.1], fov: 56 },
    // audience side chosen so Red is on the left of the screen, matching the HUD
    { name: 'Audience', pos: [-4.15, 3.25, 0.0], target: [0, -0.42, 0] },
    { name: 'Top-down', pos: [0, 6.6, 0.001], target: [0, -0.3, 0] },
  ];
  // local match: which robots the drivers at this computer control (the rest stay parked)
  const LOCAL_SEATS = { 0: [], 1: [0], 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
  // a robot-code run: the program drives, nobody at the keyboard does
  const inTutorial = () => { try { return !!ui.tutorial; } catch { return false; } };   // ui is created further down
  // who this computer drives: the tutorial is always Red 1; on a phone, the robot picked with the switch button
  const localSeats = () => (sim.game && sim.game.mode === 'robotcode' ? [] : inTutorial() ? [0] : isTouch ? [Settings.get('touchRobot') || 0] : LOCAL_SEATS[Settings.get('drivers')] || [0, 1, 2, 3]);
  // robots the AI drives: off in robot-code runs and the tutorial; online only seats nobody has taken
  const botSeats = (mine, isOnline) => {
    if (sim.game.mode === 'robotcode' || inTutorial()) return [];
    if (sim.ai.spectate && !isOnline) return sim.ai.only || sim.robots.map((r) => r.id);      // AI vs AI: every robot
    if (!Settings.get('bots')) return [];
    return sim.robots.map((r) => r.id).filter((i) => !mine.includes(i) && (!isOnline || (net.lobby && !net.lobby.seats[i])));
  };
  // default view: your squad's driver station (Red for a local match, the audience view for spectators)
  const defaultCam = () => {
    if (isTouch) { const mine = net.active ? net.mySeats() : []; return CAMS.length + (mine.length ? mine[0] : Settings.get('touchRobot')); }
    if (!net.active) return sim.game.mode === 'robotcode' && robotCode?.robot?.squad === 'blue' ? 1 : 0;
    const sq = net.mySquads();
    return sq.length === 1 ? (sq[0] === 'red' ? 0 : 1) : 2;
  };
  const camNames = [...CAMS.map((c) => c.name), ...sim.robots.map((r) => `Follow ${r.name}`)];
  let camMode = 0, view = 'menu';
  const followPos = new THREE.Vector3(), followTgt = new THREE.Vector3();
  function setCamera(m) {
    camMode = m;
    const lbl = document.getElementById('cam-label'); if (lbl) lbl.textContent = camNames[m];
    if (m < CAMS.length) { const c = CAMS[m]; camera.position.set(...c.pos); controls.target.set(...c.target); controls.enabled = true; controls.update(); }
    else controls.enabled = false;
    camera.fov = (m < CAMS.length && CAMS[m].fov) || 45;
    camera.filmOffset = 0;
    if (m < 2 && window.innerHeight > window.innerWidth) camera.fov = 80;   // portrait: widen the driver-station lens to fit the field's width
    camera.updateProjectionMatrix();
  }
  sim.setCamera = setCamera;
  sim.controls = controls;

  // ------------------------------------------------------------ home-screen showcase and the fly-in
  // On the home screen Red 1 (your team number, 009 by default) stands on a plinth behind the red wall with the
  // field and the arena behind it. Press Play and it lifts off, arcs over the wall and drops onto its start
  // position while the camera glides to the driver station; the other robots drop in from above.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const hero = { yaw: HERO_YAW, vel: 0, t: 0, drag: null };
  const menuTgt = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const tmpPose = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  let trans = null;
  // camera pose for the home screen (sways slowly): writes pos and tgt, returns the lens
  function menuPose(pos, tgt, t) {
    const sh = homeShot(window.innerWidth, window.innerHeight, t, camera.filmGauge);
    pos.set(...sh.pos); tgt.set(...sh.tgt);
    return { fov: sh.fov, film: sh.film };
  }
  function heroPose(t, out) {
    out.p.set(HERO.x, HERO.y + 0.05 + Math.sin(t * 1.3) * 0.004, HERO.z);
    out.q.setFromAxisAngle(_up, hero.yaw);
    return out;
  }
  function snapCam() {
    const t = view === 'menu' ? menuTgt : camMode >= CAMS.length ? followTgt : controls.target;
    return { p: camera.position.clone(), t: t.clone(), fov: camera.fov, film: camera.filmOffset };
  }
  // dust rings where robots land
  const dust = Array.from({ length: 4 }, () => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.visible = false; m.userData.t = 9; scene.add(m); return m;
  });
  function puff(x, z) {
    const d = dust.find((m) => m.userData.t > 0.7) || dust[0];
    d.position.set(x, 0.003, z); d.userData.t = 0; d.visible = true;
  }
  function followPose(r, posOut, tgtOut) {
    const portrait = window.innerHeight > window.innerWidth;
    const behind = r.toWorld(portrait ? { x: -1.05, y: 1.35, z: 0 } : { x: -0.62, y: 0.78, z: 0 });
    const ahead = r.toWorld(portrait ? { x: 0.7, y: -0.1, z: 0 } : { x: 0.55, y: 0.0, z: 0 });
    posOut.set(behind.x, behind.y, behind.z); tgtOut.set(ahead.x, ahead.y, ahead.z);
  }
  // fly from the home screen into the match (called once the game view and its camera are set)
  function flyIn(from) {
    const to = { p: camera.position.clone(), t: new THREE.Vector3(), fov: camera.fov };
    if (camMode >= CAMS.length) { followPose(sim.robots[camMode - CAMS.length], to.p, to.t); followPos.copy(to.p); followTgt.copy(to.t); }
    else to.t.copy(controls.target);
    const r0 = sim.robots[0];
    trans = { kind: 'in', t: 0, D: reduceMotion.matches ? 0.001 : 2.7, from, to, start: { p: r0.root.position.clone(), q: r0.root.quaternion.clone() }, landed: new Set() };
    controls.enabled = false;
    document.getElementById('hud').classList.add('intro');
    sim.audio.tone(180, 0.5, 'sine', 0.035); sim.audio.tone(90, 1.2, 'sine', 0.05, 0.05);
  }
  function flyOut(from) {
    const r0 = sim.robots[0];
    trans = { kind: 'out', t: 0, D: reduceMotion.matches ? 0.001 : 1.7, from, start: { p: r0.root.position.clone(), q: r0.root.quaternion.clone() } };
    plinth.visible = true; plinth.scale.setScalar(1);
    document.getElementById('hud').classList.remove('intro');
  }
  let autoStartPending = false;
  function finishTrans() {
    const k = trans.kind; trans = null;
    for (const r of sim.robots) { r.root.visible = !r.benched; r.root.scale.set(1, 1, 1); }
    try { gov.hold(1.5); } catch { /* not created yet */ }
    if (k === 'in') {
      document.getElementById('hud').classList.remove('intro');
      if (autoStartPending && game.state === 'pre') game.start();
      autoStartPending = false;
      plinth.visible = false;
      setCamera(camMode);
      if (camMode >= CAMS.length) followPos.copy(camera.position);
    }
  }
  sim.isFlying = () => !!trans;
  // drag the home-screen robot to spin it on its plinth
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (view !== 'menu' || trans) return;
    hero.drag = { x: e.clientX, t: performance.now() }; hero.vel = 0;
    try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!hero.drag) return;
    const dx = e.clientX - hero.drag.x, now = performance.now(), dt = Math.max(8, now - hero.drag.t) / 1000;
    hero.yaw += dx * 0.012; hero.vel = Math.max(-12, Math.min(12, (dx * 0.012) / dt)); hero.drag.x = e.clientX; hero.drag.t = now;
  });
  const endDrag = () => { hero.drag = null; };
  renderer.domElement.addEventListener('pointerup', endDrag);
  renderer.domElement.addEventListener('pointercancel', endDrag);

  // ------------------------------------------------------------ settings
  let quality = null;
  // render scale: stepped down (never back up) when a laptop cannot hold ~45 fps; see js/governor.js
  const tier = gpuTier(renderer);
  const gov = createGovernor({ key: 'sim' });
  const effQuality = () => (quality === 'auto' ? tier : quality);
  const wantPixelRatio = () => Math.max(0.6, (effQuality() === 'high' ? prCap('high') : prCap('low')) * gov.scale);
  function applySettings() {
    const s = Settings.data;
    applyKeyBindings(s.keys);
    sim.showLabels = s.labels; sim.showGuides = s.guides; sim.audio.enabled = s.sound;
    if (sim.ai) sim.ai.level = s.botLevel;
    input.tank = s.tank; input.padAssign = [...s.pads];
    if (s.quality !== quality) {
      if (quality !== null) gov.reset();                  // a new graphics choice starts from full resolution
      quality = s.quality;
      const hi = effQuality() === 'high';
      renderer.setPixelRatio(wantPixelRatio());
      sun.shadow.mapSize.set(hi ? 2048 : 1024, hi ? 2048 : 1024);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
  }
  function applyTeams() {
    if (net.active && net.isGuest) return;   // online guests show the host's team numbers
    const t = [...Settings.get('teams')];
    if (Account.team?.number && t[0] === '009') t[0] = Account.team.number;   // signed in: your Scout team's number on Red 1
    sim.robots.forEach((r, i) => { r.setNumber(t[i]); game.payloads[i].setNumber(t[i]); });
    const chip = document.getElementById('menu-team'); if (chip) chip.textContent = t[0];
  }
  Settings.onChange(applySettings);
  applySettings(); applyTeams();

  // ------------------------------------------------------------ UI context
  let autoPaused = false;
  const online = () => net.active && view === 'game';
  function resetField() { if (net.active && net.isGuest) net.guestReset(); else { game.reset(); applyTeams(); } }
  function doHp(a, squad, robotId) {
    if (a === 'core') game.placeCore(squad);
    else if (a === 'pl') game.payloadAction(robotId);
    else if (a === 'sb') game.pressStarburst(squad);
  }
  const ctx = {
    // autoStart: the Local match dialog already asked "ready?", so the clock starts as the camera lands
    startGame(mode, { autoStart = false } = {}) {
      ui.closeAll(); ui.stopCoach(); robotCode.disarm();
      game.mode = mode; game.reset(); applyTeams();
      autoStartPending = autoStart && !net.active;
      enterGame();
      if (autoStartPending && !trans) { autoStartPending = false; game.start(); }
    },
    restart() {
      if (net.active) { if (net.isHost) net.restartMatch(); return; }
      game.reset(); applyTeams();
      if (game.mode === 'robotcode') robotCode.arm();
      if (ui.tutorial) { tutorialCore(); game.start(); ui.startCoach(); }   // restarting the tutorial starts it over
      ui.setView('game');
    },
    toMenu() {
      ui.toggleHud(true); ui.detailsPinned = false; ui.stopCoach(); robotCode.disarm();
      if (net.active && view === 'game') { if (net.isHost) net.backToLobby(); else net.leave(); return; }
      game.mode = 'match'; game.reset(); applyTeams(); toMenuView();
    },
    // Space / Start / the centre button: online, only the host runs the clock
    toggleStart() {
      if (online() && net.isGuest) { ui.toast('Only the host can start or pause the match'); return; }
      game.start();
    },
    // Human Player actions (keys, HUD buttons, gamepad X / Y)
    hp(a, squad, robotId) {
      if (online()) {
        if (!net.canAct(squad)) { ui.toast('Human Player actions are for your own squad'); return; }
        if (net.isGuest) { net.requestHp(a, squad, robotId); return; }
      }
      doHp(a, squad, robotId);
    },
    isOnline: online,
    localSeats,
    // coached practice: one driver, a red CORE placed in front of Red 1, and the HUD coach takes over
    startTutorial() {
      if (isTouch && input.touch) input.touch.slot = 0;
      ctx.startGame('practice');
      tutorialCore();
      game.start();
      ui.startCoach();
    },
    // run imported robot code (an AUTO or TELEOP OpMode) on the field
    startRobotCode() {
      ui.closeAll(); ui.stopCoach();
      game.mode = 'robotcode'; game.reset(); applyTeams();
      robotCode.arm();
      enterGame();
    },
    cameras: () => camNames,
    cameraIndex: () => camMode,
    setCamera,
    applyTeams,
    followRobot(slot) { setCamera(CAMS.length + slot); },
    onModal(open) {
      document.body.classList.toggle('modal-open', !!open);
      if (view !== 'game' || net.active) return;   // online matches never pause because someone opened a menu
      if (open && game.state === 'running') { game.start(); autoPaused = true; }
      else if (!open && autoPaused) { autoPaused = false; if (game.state === 'paused') game.start(); }
    },
  };
  function tutorialCore() { const p = sim.robots[0].toWorld({ x: 0.62, y: 0, z: 0 }); game.addCore('red', 'red', { x: p.x, y: 0.0151, z: p.z }); }
  // switching away from a local match pauses it; online matches keep running for everyone else
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && view === 'game' && !net.active && game.state === 'running') game.start();
  });
  function enterGame() {
    const from = view === 'menu' ? snapCam() : null;
    view = 'game'; ui.setView('game');
    setCamera(defaultCam());
    if (from) flyIn(from); else if (trans) finishTrans();
  }
  function toMenuView() {
    const from = view === 'game' ? snapCam() : null;
    view = 'menu'; ui.setView('menu'); controls.enabled = false;
    if (from) flyOut(from);
  }
  const ui = new UI(sim, ctx);
  sim.hud = ui;
  const robotCode = new RobotCode(sim, ui);
  sim.robotCode = robotCode;
  game.onSignal((type) => robotCode.onSignal(type));
  sim.ui = ui;
  // Team tools: each owns its module under js/tools/ and gets the per-frame hook below
  sim.frameHooks = [];
  sim.tools = { planner: new Planner(sim, ui), trainer: new Trainer(sim, ui), strategy: new Strategy(sim, ui), designer: new Designer(sim, ui) };
  input.active = () => view === 'game' && ui.modals.length === 0 && !trans;
  net.hooks = {
    begin(mode) {
      ui.closeAll();
      game.mode = mode; resetField();
      const mine = net.mySeats();
      if (isTouch && input.touch && mine.length) input.touch.slot = mine[0];
      enterGame();
    },
    restart() { ui.closeAll(); resetField(); ui.setView('game'); },
    menu() {
      ui.closeAll(); game.mode = 'match'; resetField();
      toMenuView();
      ui.openOnline();
    },
    left(reason) {
      if (view === 'game') { ui.closeAll(); toMenuView(); }
      game.mode = 'match'; game.reset(); applyTeams();
      ui.onOnlineLeft(reason);
    },
    hpAction: doHp,
  };
  window.addEventListener('beforeunload', () => { if (net.active && net.isGuest) net.room.close(); });

  window.addEventListener('resize', () => {
    if (camMode < 2) camera.fov = window.innerHeight > window.innerWidth ? 80 : CAMS[camMode].fov;
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ------------------------------------------------------------ collision bookkeeping
  function drainEvents() {
    events.drainCollisionEvents((h1, h2, started) => {
      for (const [a, b] of [[h1, h2], [h2, h1]]) {
        const info = sim.owners.get(a);
        if (!info || info.type !== 'robot') continue;
        const r = info.robot;
        let set = r.pairContacts.get(b);
        if (started) { if (!set) { set = new Set(); r.pairContacts.set(b, set); } set.add(a); }
        else if (set) { set.delete(a); if (!set.size) r.pairContacts.delete(b); }
        const n = r.pairContacts.get(b)?.size || 0;
        if (n) r.contacts.set(b, n); else r.contacts.delete(b);
      }
    });
  }

  // ------------------------------------------------------------ loop
  const stationBodies = ['red', 'blue'].flatMap((s) => [sim.field.stations[s].deckBody, ...sim.field.stations[s].ramps.map((r) => r.body)]);
  let last = performance.now(), acc = 0, hudT = 0, detailsOn = false, arenaT = 1, lastTotal = 0;
  const endP = new THREE.Vector3(), endQ = new THREE.Quaternion();
  const size = new THREE.Vector2();
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

  function frame(now) {
    const elapsed = Math.max(0, (now - last) / 1000); last = now;
    tick(Math.min(0.05, elapsed), true, elapsed);
    requestAnimationFrame(frame);
  }
  // an online host keeps simulating while its tab is hidden (rAF stops there): a worker timer drives the loop
  const bgTimer = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 1000 / 30);'], { type: 'text/javascript' })));
  bgTimer.onmessage = () => {
    if (!document.hidden || !(net.active && net.isHost && view === 'game')) return;
    const now = performance.now();
    const elapsed = Math.max(0, (now - last) / 1000);
    tick(Math.min(0.05, elapsed), false, elapsed); last = now;
  };
  function tick(dtReal, render, elapsed = dtReal) {
    input.update(dtReal);
    renderer.getSize(size);
    if (render && !document.hidden && quality === 'auto' && !trans) gov.frame(dtReal);   // an explicit choice is respected
    const wantPR = wantPixelRatio();
    if (Math.abs(renderer.getPixelRatio() - wantPR) > 1e-3) renderer.setPixelRatio(wantPR);
    if (size.x !== window.innerWidth || size.y !== window.innerHeight) {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / Math.max(1, window.innerHeight); camera.updateProjectionMatrix();
    }
    const inGame = view === 'game', modalOpen = ui.modals.length > 0;
    // global keys
    const isOnline = net.active && inGame, guest = isOnline && net.isGuest;
    const mine = isOnline ? net.mySeats() : localSeats();
    if (inGame && !modalOpen && !trans) {
      if (input.hit('Space')) ctx.toggleStart();
      if (input.hit('Escape')) ui.openPause();
      if (input.hit('KeyC')) setCamera((camMode + 1) % camNames.length);
      if (input.hit('KeyH') && !robotCode.wantsKeys()) ui.openHowTo();
      if (input.hit('KeyV')) ui.toggleHud();
      // Human Player keys. Online, a driver whose robots are all in one squad can use either key row.
      const squads = [...new Set(mine.map((i) => sim.robots[i].squad))];
      const rows = squads.length === 1 ? [[squads[0], HP_KEYS.red], [squads[0], HP_KEYS.blue]] : squads.map((s) => [s, HP_KEYS[s]]);
      for (const [s, k] of rows) {
        if (input.hit(k.core)) ctx.hp('core', s);
        if (input.hit(k.starburst)) ctx.hp('sb', s);
        const ids = sim.robots.filter((r) => r.squad === s).map((r) => r.id);
        k.payload.forEach((code, j) => { if (input.hit(code) && ids[j] !== undefined) ctx.hp('pl', s, ids[j]); });
      }
    }
    // AI drivers take every robot nobody drives (locally; online, the host runs them for empty seats)
    const aiSeats = inGame && !guest && !trans ? botSeats(mine, isOnline) : [];
    const wantDetails = inGame && !modalOpen && input.down.has('Tab');
    if (wantDetails !== detailsOn) { detailsOn = wantDetails; ui.showDetails(wantDetails || ui.detailsPinned); }
    // robot controls
    sim.robots.forEach((r, i) => {
      if (!inGame) { r.cmd = { throttle: 0, turn: 0, arm: 0 }; return; }
      if (aiSeats.includes(i)) return;                           // driven by sim.ai below
      if (!mine.includes(i)) {                                   // someone else's seat, or a robot nobody drives
        if (isOnline && !guest) net.applyRemote(r); else if (!isOnline) r.cmd = { throttle: 0, turn: 0, arm: 0 };
        return;
      }
      const c = input.robot(i, mine.length === 1);
      if (c.start && !modalOpen && !trans) ctx.toggleStart();
      if (c.hpCore && !modalOpen) ctx.hp('core', r.squad);
      if (c.hpPayload && !modalOpen) ctx.hp('pl', r.squad, r.id);
      if (guest) { net.queueInput(i, c, modalOpen); return; }
      if (r.enabled && !modalOpen) {
        r.cmd = { throttle: c.throttle, turn: c.turn, arm: c.arm };
        if (c.grip) r.toggleGrip();
        if (c.cargo) r.cargoAction();
      } else r.cmd = { throttle: 0, turn: 0, arm: 0 };
    });
    if (guest) net.sendInputs();
    if (!guest) sim.ai.update(aiSeats);
    input.endFrame();

    // physics
    if (!guest && game.state !== 'paused' && game.state !== 'final') {
      acc += dtReal;
      let n = 0;
      while (acc >= STEP && n < MAX_STEPS) {
        for (const b of stationBodies) { b.resetForces(false); b.resetTorques(false); }
        robotCode.step(STEP);
        for (const r of sim.robots) if (!r.benched) r.step(STEP);
        for (const s of ['red', 'blue']) sim.field.stations[s].step(STEP);
        world.step(events);
        drainEvents();
        // safety net: a robot can never physically exceed these (guards against deep-overlap explosions)
        for (const r of sim.robots) {
          const pos = r.body.translation();
          if (!r.benched && (pos.y < -0.5 || Math.abs(pos.x) > 3.2 || Math.abs(pos.z) > 3.2 || !Object.values(pos).every(Number.isFinite))) {
            // Preserve the current arm/cargo state but recover the chassis safely.
            const start = r.startPose();
            r.teleport(start.x, start.z, start.yaw);
            r.contacts.clear(); r.pairContacts.clear();
          }
          const v = r.body.linvel(), w = r.body.angvel();
          const sv = Math.hypot(v.x, v.y, v.z), sw = Math.hypot(w.x, w.y, w.z);
          if (sv > 3) r.body.setLinvel({ x: v.x * 3 / sv, y: v.y * 3 / sv, z: v.z * 3 / sv }, true);
          if (sw > 25) r.body.setAngvel({ x: w.x * 25 / sw, y: w.y * 25 / sw, z: w.z * 25 / sw }, true);
        }
        sim.simTime += STEP;
        acc -= STEP; n++;
      }
      if (n === MAX_STEPS) acc = 0;
    } else acc = 0;
    // the match clock is wall time (the audit's call) online; locally one frame carries no more time than physics can
    // step, so robots never move in slow motion against the clock and a stalled tab does not burn the match
    if (guest) net.guestFrame(); else game.update(game.state === 'paused' || game.state === 'final' ? 0 : isOnline ? elapsed : Math.min(elapsed, MAX_STEPS * STEP));
    if (isOnline && net.isHost) net.hostFrame();

    for (const f of sim.frameHooks) f(dtReal, inGame);
    // visuals
    for (const r of sim.robots) { r.sync(); r.label.visible = inGame && sim.showLabels && camMode !== CAMS.length + r.id; }
    for (const c of game.cores) c.sync();
    for (const p of game.payloads) p.sync();
    for (const s of ['red', 'blue']) sim.field.stations[s].sync();
    for (const s of ['red', 'blue']) sim.field.trifrons[s].group.rotation.y += dtReal * 0.25;

    sim.arena.update(dtReal);
    arenaT += dtReal;
    if (arenaT > 0.25) {
      arenaT = 0;
      const sc = game.score || {}, tot = (sc.red?.total ?? 0) + (sc.blue?.total ?? 0);
      if (inGame && tot > lastTotal) sim.arena.excite = Math.min(1, sim.arena.excite + 0.6);
      lastTotal = tot;
      sim.arena.setScore(sc.red?.total ?? 0, sc.blue?.total ?? 0, inGame ? document.getElementById('clock')?.textContent || '' : '2:30', inGame ? (game.state === 'final' ? 'FINAL' : 'HYPERDRIVE') : 'OVERDRIVE 009');
    }
    sim.arena.setBeams(!(inGame && camMode === 3));
    for (const d of dust) if (d.visible) {
      d.userData.t += dtReal; const k = d.userData.t / 0.7;
      if (k >= 1) d.visible = false; else { d.scale.setScalar(1 + k * 2.6); d.material.opacity = 0.55 * (1 - k) * (1 - k); }
    }
    hero.t += dtReal;
    plinth.userData.ticks.rotation.y += dtReal * 0.06;
    if (!hero.drag) { hero.yaw += hero.vel * dtReal; hero.vel *= Math.exp(-dtReal * 2.2); if (Math.abs(hero.vel) < 0.05) hero.yaw += dtReal * 0.12 * Math.sin(hero.t * 0.21 + 0.6); }
    const r0 = sim.robots[0];
    if (trans) {
      trans.t += dtReal;
      const k = clamp01(trans.t / trans.D), e = ease(k);
      if (trans.kind === 'in') {
        // camera: ease across with a gentle rise in the middle of the move
        tmpA.lerpVectors(trans.from.p, trans.to.p, e); tmpA.y += Math.sin(Math.PI * e) * 0.55;
        tmpB.lerpVectors(trans.from.t, trans.to.t, e);
        camera.position.copy(tmpA); camera.lookAt(tmpB);
        camera.fov = trans.from.fov + (trans.to.fov - trans.from.fov) * e; camera.filmOffset = trans.from.film * (1 - e); camera.updateProjectionMatrix();
        // Red 1: lift off the plinth, arc over the wall and drop onto its start pose
        const tFly = trans.D * 0.72, u = clamp01((trans.t - 0.15) / tFly), eu = ease(u);
        endP.copy(r0.root.position); endQ.copy(r0.root.quaternion);
        r0.root.position.lerpVectors(trans.start.p, endP, eu); r0.root.position.y += u < 1 ? Math.sin(Math.PI * Math.pow(u, 0.8)) * 0.55 : 0;
        r0.root.quaternion.slerpQuaternions(trans.start.q, endQ, eu);
        if (u >= 1 && !trans.landed.has(0)) { trans.landed.add(0); puff(endP.x, endP.z); sim.audio.tone(70, 0.25, 'sine', 0.08); }
        const land = trans.t - 0.15 - tFly;
        r0.root.scale.set(1, land > 0 && land < 0.35 ? 1 - Math.sin(land / 0.35 * Math.PI) * 0.06 : 1, 1);
        r0.vis.pose(Math.sin(Math.PI * u) * 0.5, -0.17, 0);
        plinth.scale.setScalar(Math.max(0.01, 1 - clamp01(trans.t / 1.4)));
        // the other robots drop in from above, one after another
        sim.robots.forEach((r, i) => {
          if (i === 0) return;
          const t0 = 0.55 + i * 0.22, f = clamp01((trans.t - t0) / 0.55);
          r.root.position.y += (1 - f * f) * 1.8;
          r.root.visible = !r.benched && trans.t > t0 - 0.05;
          if (f >= 1 && !trans.landed.has(i)) { trans.landed.add(i); puff(r.root.position.x, r.root.position.z); sim.audio.tone(60 + i * 6, 0.2, 'sine', 0.05); }
        });
      } else {
        const mp = menuPose(tmpA, menuTgt, hero.t);
        camera.position.lerpVectors(trans.from.p, tmpA, e); tmpB.lerpVectors(trans.from.t, menuTgt, e); camera.lookAt(tmpB);
        camera.fov = trans.from.fov + (mp.fov - trans.from.fov) * e; camera.filmOffset = trans.from.film + (mp.film - trans.from.film) * e; camera.updateProjectionMatrix();
        heroPose(hero.t, tmpPose);
        r0.root.position.lerpVectors(trans.start.p, tmpPose.p, e); r0.root.position.y += Math.sin(Math.PI * e) * 0.5;
        r0.root.quaternion.slerpQuaternions(trans.start.q, tmpPose.q, e);
        r0.vis.pose(Math.sin(Math.PI * e) * 0.5, -0.17, 0);
      }
      if (trans.t >= trans.D) finishTrans();
    } else if (!inGame) {
      // home screen: your robot on its plinth, the field and the arena behind it
      const mp = menuPose(tmpA, menuTgt, hero.t);
      camera.position.copy(tmpA); camera.lookAt(menuTgt);
      if (camera.fov !== mp.fov || camera.filmOffset !== mp.film) { camera.fov = mp.fov; camera.filmOffset = mp.film; camera.updateProjectionMatrix(); }
      heroPose(hero.t, tmpPose);
      r0.root.position.copy(tmpPose.p); r0.root.quaternion.copy(tmpPose.q);
      // idle: every ten seconds the arm rises and the claw opens
      const cyc = 0.5 - 0.5 * Math.cos(hero.t * Math.PI * 2 / 10);
      r0.vis.pose(cyc * 0.75, -0.17 + cyc * 0.45, hero.t * 0.6);
      plinth.visible = true; plinth.scale.setScalar(1);
      followPos.copy(camera.position);
    } else if (camMode >= CAMS.length) {
      followPose(sim.robots[camMode - CAMS.length], tmpA, tmpB);
      followPos.lerp(tmpA, Math.min(1, dtReal * 5));
      followTgt.lerp(tmpB, Math.min(1, dtReal * 8));
      camera.position.copy(followPos); camera.lookAt(followTgt);
    } else {
      controls.update();
      followPos.copy(camera.position); followTgt.copy(controls.target);
    }
    if (render) renderer.render(scene, camera);
    hudT += dtReal;
    if (hudT > 0.1) { hudT = 0; ui.update(); if (detailsOn || (ui.detailsPinned && inGame)) ui.showDetails(true); }
  }
  // test hook: advance the simulation without requestAnimationFrame
  sim.advance = (seconds, render = false) => { for (let t = 0; t < seconds - 1e-9; t += 1 / 60) tick(1 / 60, render); };
  sim.tick = tick;
  sim.ctx = ctx;

  setLoad(97, 'Preparing shaders…');
  await compileAll(renderer, scene, camera);   // no shader compiles mid-match
  setLoad(100, 'Ready');
  ui.setView('menu');
  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) setTimeout(() => ui.openOnline({ code: roomParam, restore: hostRoomFor(roomParam.toUpperCase()) }), 300);
  controls.enabled = false;
  requestAnimationFrame(frame);
  setTimeout(() => {
    const l = document.getElementById('loading');
    // the loading wordmark glides onto the menu's own wordmark while the screens cross-fade: one continuous logo
    // first it lands exactly on the menu's wordmark, then that one takes over and the loading screen fades away
    const from = l.querySelector('.logo'), to = document.querySelector('#menu .logo');
    let glide = 0;
    if (from && to && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.body.classList.add('logo-handed');           // the menu's own wordmark holds still (no entrance)
      const textBox = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
      const a = textBox(from), b = textBox(to);                // the glyphs, not the full-width heading boxes
      if (a.width && b.width) {
        glide = 560;
        from.style.transformOrigin = '0 0';
        from.style.transition = `transform ${glide}ms cubic-bezier(0.65, 0, 0.35, 1)`;
        from.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width})`;
      }
    }
    setTimeout(() => { document.body.classList.add('logo-done'); l.classList.add('done'); setTimeout(() => l.remove(), 900); }, glide);
  }, 150);
  window.__sim = sim; // handy for debugging in the console
}

boot().catch((e) => {
  console.error(e);
  const s = document.getElementById('loading-status');
  const offline = navigator.onLine === false;
  if (s) s.textContent = offline ? 'You appear to be offline. Reconnect and reload.' : `Could not start: ${e.message}`;
  const b = document.getElementById('loading-retry');
  if (b) { b.classList.remove('hidden'); b.addEventListener('click', () => location.reload()); }
});
