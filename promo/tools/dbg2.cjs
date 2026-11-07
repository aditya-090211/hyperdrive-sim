const { chromium } = require('C:/Users/adity/AppData/Roaming/npm/node_modules/playwright');
const S = process.argv[2];
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu'] });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.goto('http://127.0.0.1:8766/promo/update.html?samples=1');
  await p.waitForFunction(() => window.upReady, null, { timeout: 300000 });
  const cam = ['venue', [-3.4, 0.75, -0.5], [3, 0.25, 0.4], 42];
  const variants = {
    base: '',
    noshadow: 'window.__up.VEN.sun.castShadow = false;',
    nofield: 'window.__cine.sim.fieldObjects.forEach(o=>o.visible=false);',
    nosweep: 'window.__up.sweep.uR.value = 1000;',
  };
  for (const [k, js] of Object.entries(variants)) {
    await p.evaluate(([js, cam]) => { eval(js); window.upStill(...cam); }, [js, cam]);
    await p.screenshot({ path: `${S}/v_${k}.png` });
  }
  await b.close();
})();
