// robot-3d.js: lazy loader for the /robot page's 3D model. three.js and the team's CAD
// (assets/aryan.json + aryan.bin, Overdrive 009's own robot; the simulator uses the NRL kit robot) are only fetched when
// the page asks for them, and everything can be handed back to the GPU when the page goes away.

let kit = null;
export function loadKit() {
  if (!kit) kit = Promise.all([import('three'), import('/js/robot-model.js')]).then(([THREE, rm]) => ({ THREE, ...rm }));
  return kit;
}

// swap the CAD's metal materials for flat two-step toon ones so it sits with the poster look
export function toonify(THREE, root) {
  const ramp = new THREE.DataTexture(new Uint8Array([90, 160, 220, 255]), 4, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.generateMipmaps = false; ramp.needsUpdate = true;
  const toon = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.material || !o.material.isMeshStandardMaterial) return;
    const m = o.material;
    if (!toon.has(m)) {
      toon.set(m, new THREE.MeshToonMaterial({ color: m.color, gradientMap: ramp, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite }));
      m.dispose();
    }
    o.material = toon.get(m);
  });
}

// free every geometry, material and texture under `scene`, then the renderer and its context
export function disposeAll(scene, renderer) {
  const seen = new Set();
  const free = (x) => { if (x && !seen.has(x) && typeof x.dispose === 'function') { seen.add(x); x.dispose(); } };
  if (scene) scene.traverse((o) => {
    free(o.geometry);
    for (const m of [].concat(o.material || [])) {
      for (const k in m) if (m[k] && m[k].isTexture) free(m[k]);
      free(m);
    }
  });
  if (renderer) {
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch (e) { /* already gone */ }
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }
}
