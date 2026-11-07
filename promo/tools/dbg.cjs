const { chromium } = require('C:/Users/adity/AppData/Roaming/npm/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu'] });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.goto('http://127.0.0.1:8766/promo/update.html?samples=1');
  await p.waitForFunction(() => window.upReady, null, { timeout: 300000 });
  const r = await p.evaluate(async () => {
    window.upStill('venue', [-3.4, 0.75, -0.5], [3, 0.25, 0.4], 42);
    const THREE = await import('three');
    const C = window.__cine, cam = C.camera, sc = C.scene;
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(0, -0.1), cam);
    const hits = rc.intersectObjects(sc.children, true).filter((h) => !h.object.isPoints && !h.object.isLine).filter((h) => { for (let o = h.object; o; o = o.parent) if (!o.visible) return false; return true; }).slice(0, 5);
    return hits.map((h) => { const path = []; for (let o = h.object; o; o = o.parent) path.push(o.name || o.type); return h.distance.toFixed(2) + ' ' + path.join('<') + ' ' + (h.object.material?.type) + ' ' + JSON.stringify(h.object.material?.color); });
  });
  console.log(r.join('\n'));
  await b.close();
})();
