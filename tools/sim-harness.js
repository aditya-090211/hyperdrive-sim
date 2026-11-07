// Physics test harness for the browser console (not deployed): `await import('/tools/sim-harness.js')`
// then window.H.run(seconds, (t, robots) => { robots[0].cmd = { throttle: 1, turn: 0, arm: 0 }; }).
const s = window.__sim;
const STEP = 1 / 240;
const H = {
  s,
  // advance physics only (no input, no rendering); ctrl sets each robot's cmd every substep
  run(secs, ctrl) {
    const st = ['red', 'blue'].map((q) => s.field.stations[q]);
    for (let t = 0; t < secs; t += STEP) {
      if (ctrl) ctrl(t, s.robots);
      for (const x of st) for (const b of [x.deckBody, ...x.ramps.map((r) => r.body)]) { b.resetForces(false); b.resetTorques(false); }
      for (const r of s.robots) if (!r.benched) r.step(STEP);
      for (const x of st) x.step(STEP);
      s.world.step(s.events);
      s.events.drainCollisionEvents(() => {});
      s.simTime += STEP;
      if (Math.round(t / STEP) % 4 === 0) s.game.update(4 * STEP);
    }
  },
  // render one frame from a given camera into an overlay image (works while the page is in the background)
  shot(pos, tgt) {
    s.camera.position.set(...pos); s.controls.target.set(...tgt); s.controls.update(); s.tick(0, true);
    let img = document.getElementById('dbgshot');
    if (!img) { img = document.createElement('img'); img.id = 'dbgshot'; img.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;object-fit:cover;pointer-events:none'; document.body.appendChild(img); }
    img.src = s.renderer.domElement.toDataURL('image/jpeg', 0.85); img.style.display = '';
  },
  hide() { const img = document.getElementById('dbgshot'); if (img) img.style.display = 'none'; },
  pose(r) {
    const t = r.body.translation(), q = r.body.rotation();
    const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (q.w * q.z - q.x * q.y)))) * 57.3;
    return { x: +t.x.toFixed(3), y: +t.y.toFixed(3), z: +t.z.toFixed(3), pitch: +pitch.toFixed(1), wheels: r.wheels.map((w) => (w.ground !== null ? 1 : 0)).join('') };
  },
  fresh(mode = 'practice') { s.ctx.startGame(mode); s.game.start(); },
};
window.H = H;
export default H;
