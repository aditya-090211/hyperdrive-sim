// node still.cjs <outDir> '<json list of [mode,pos,tgt,fov]>'
const { chromium } = require('C:/Users/adity/AppData/Roaming/npm/node_modules/playwright');
const fs = require('fs'); const path = require('path');
const [outDir, json] = process.argv.slice(2); const shots = JSON.parse(json);
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu'] });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  p.on('pageerror', (e) => console.error('page error', e.message));
  await p.goto('http://127.0.0.1:8766/promo/update.html?samples=1');
  await p.waitForFunction(() => window.upReady, null, { timeout: 300000 });
  for (let i = 0; i < shots.length; i++) { await p.evaluate((s) => window.upStill(...s), shots[i]); await p.screenshot({ path: path.join(outDir, `f${String(i).padStart(4, '0')}.png`) }); }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
