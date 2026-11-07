// Renders assets/stadium-wide.jpg and assets/stadium-tall.jpg from tools/stadium-shot.html (dev server on :8766).
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/adity/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const fs = require('fs'); const path = require('path');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const [name, w, h, angle, height, radius] of [['stadium-wide', 1920, 1080, -2.7, 5.0, 13], ['stadium-tall', 900, 1600, -2.55, 6.8, 11.5]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    p.on('pageerror', (e) => console.error('page error', e.message));
    await p.goto('http://127.0.0.1:8766/tools/stadium-shot.html');
    await p.waitForFunction(() => window.ready, null, { timeout: 120000 });
    const data = await p.evaluate(([a, hh, r]) => window.shoot(a, hh, r), [angle, height, radius]);
    fs.writeFileSync(path.join(__dirname, '..', 'assets', `${name}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
    console.log(name, Math.round(data.length * 0.75 / 1024), 'KB');
    await p.close();
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
