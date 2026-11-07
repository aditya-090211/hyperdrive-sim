const { chromium } = require('C:/Users/adity/AppData/Roaming/npm/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu'] });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.goto('http://127.0.0.1:8766/promo/update.html?samples=1');
  await p.waitForFunction(() => window.upReady, null, { timeout: 300000 });
  const r = await p.evaluate(() => {
    const cam = ['venue', [-3.4, 0.75, -0.5], [3, 0.25, 0.4], 42];
    const gl = window.__cine.renderer.getContext();
    const px = () => { const a = new Uint8Array(4); gl.readPixels(540, 1920 - 800, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a); return a[0] + a[1] + a[2]; };
    window.upStill(...cam); const base = px();
    const objs = window.__cine.sim.fieldObjects, out = [];
    objs.forEach((o, i) => { o.visible = false; window.upStill(...cam); const v = px(); o.visible = true; let tris = 0; o.traverse((m) => { if (m.isMesh) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); out.push(`${i} ${o.type} ${o.name} ${o.material?.type || ''} tris=${tris} px=${v}`); });
    return 'base ' + base + '\n' + out.join('\n');
  });
  console.log(r);
  await b.close();
})();
