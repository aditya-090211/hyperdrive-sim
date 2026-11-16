// Auto planner: headless runs of a generated OpMode through the Robot code machinery (js/auto.js + nrl.js).
// The robot-code state is swapped for the planner's program while the batch runs and restored afterwards.
// Each run is stepped with sim.advance() in 1 s chunks; between chunks the match is paused so the page's own
// frame loop adds no physics, and the batch yields so the dialog can show progress (and be cancelled).
import { TYPICAL_ERRORS, DEFAULT_WIRING, AUTO_SECONDS } from '../nrl.js';
import { toDiag } from './planner-gen.js';

const CHUNK = 1;           // simulated seconds per slice
const SETTLE = 1.5;        // after the last step: let the robot and any released CORE come to rest

const yieldUI = () => new Promise((res) => {
  // a hidden tab gets no animation frames and throttles timers; a message is never throttled
  if (document.hidden) { const ch = new MessageChannel(); ch.port1.onmessage = () => res(); ch.port2.postMessage(0); return; }
  // wait for a painted frame, but never longer than 40 ms (a page that is not being composited gets none)
  let done = false;
  const fin = () => { if (!done) { done = true; res(); } };
  requestAnimationFrame(() => setTimeout(fin, 0));
  setTimeout(fin, 40);
});

export function poseOf(robot) {
  const t = robot.body.translation(), q = robot.body.rotation();
  const [X, Y] = toDiag(t.x, t.z);
  return { X, Y, th: -2 * Math.atan2(q.y, q.w) * 180 / Math.PI };
}

// opts: { text, fileName, op, robot (index), runs, errors (bool), seed, steps (count), onRun(i, result), cancelled() }
// returns the list of per-run results; throws if the program does not compile
export async function runBatch(sim, opts) {
  const rc = sim.robotCode, g = sim.game;
  const saved = { state: rc.state, mode: g.mode, audio: sim.audio ? sim.audio.enabled : true };
  const results = [];
  rc.disarm();
  rc.state = { ...saved.state, files: [{ name: opts.fileName, text: opts.text }], op: opts.op, robot: opts.robot, pose: { side: 0, fwd: 0, heading: 0 }, wiring: JSON.parse(JSON.stringify(saved.state.wiring)) };
  rc.recompile();
  try {
    if (rc.compileError) throw new Error(`Does not compile: ${rc.compileError.message}${rc.compileError.line ? ` (line ${rc.compileError.line})` : ''}`);
    if (sim.audio) sim.audio.enabled = false;
    for (let i = 0; i < opts.runs; i++) {
      if (opts.cancelled()) break;
      rc.state.wiring.errors = opts.errors ? { ...TYPICAL_ERRORS, seed: opts.seed + i } : { ...DEFAULT_WIRING.errors };
      const res = await oneRun(sim, opts);
      if (!res) break;          // cancelled mid-run
      results.push(res);
      opts.onRun(i, res);
      await yieldUI();
    }
  } finally {
    rc.disarm();
    rc.state = saved.state;
    rc.recompile();
    if (sim.audio) sim.audio.enabled = saved.audio;
    // back to how the field was: the menu's idle field, or a fresh start of whatever was being played
    if (sim.ui.view === 'menu') sim.ctx.toMenu();
    else { g.mode = saved.mode; if (saved.mode === 'robotcode') sim.ctx.restart(); else g.reset(); }
  }
  return results;
}

async function oneRun(sim, opts) {
  const rc = sim.robotCode, g = sim.game;
  g.mode = 'robotcode'; g.reset(); rc.arm();
  const rt = rc.rt, robot = rc.robot;
  const marks = [];
  rt.onLog = (text) => {
    const m = /^STEP (\d+)$/.exec(String(text));
    if (m) marks[Number(m[1]) - 1] = { ...poseOf(robot), t: rt.elapsed };
  };
  const res = { marks, err: rt.err };
  if (rt.error) return finish(res, sim, robot);
  g.start();                      // pre -> running: start() runs on the robot
  let doneAt = null;
  for (;;) {
    sim.advance(CHUNK);
    if (doneAt === null && marks.length >= opts.steps && marks[opts.steps - 1]) doneAt = rt.elapsed;
    if (g.state !== 'running' || rt.error || rt.stopped || (doneAt !== null && rt.elapsed >= doneAt + SETTLE) || rt.elapsed >= AUTO_SECONDS) break;
    g.start();                    // pause while the page gets a frame
    await yieldUI();
    if (opts.cancelled()) { if (g.state === 'paused') g.start(); return null; }
    if (g.state === 'paused') g.start();
  }
  return finish(res, sim, robot);
}

function finish(res, sim, robot) {
  const g = sim.game, rt = sim.robotCode.rt;
  const sc = g.score[robot.squad];
  return Object.assign(res, {
    final: poseOf(robot), cores: sc.squadCores, points: sc.total, station: robot.stationState,
    time: rt ? rt.elapsed : 0, error: rt && rt.error ? `${rt.error.where}: ${rt.error.message}` : null,
  });
}
