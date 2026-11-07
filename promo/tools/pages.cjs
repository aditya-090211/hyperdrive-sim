// screenshots of the live site pages for the update reel (dev server on :8766)
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/adity/AppData/Roaming/npm/node_modules/playwright');
const path = require('path');
const out = path.join(__dirname, '..', 'shots');
const only = process.argv[2];
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu'] });
  const shots = [
    ['landing-desk', '/', { width: 1600, height: 1000 }, 1, 9000],
    ['landing-phone', '/', { width: 390, height: 844 }, 3, 9000],
    ['sim-desk', '/sim', { width: 1600, height: 1000 }, 1, 14000],
    ['sim-phone', '/sim', { width: 390, height: 844 }, 3, 14000],
    ['signin-phone', '/signin', { width: 390, height: 844 }, 3, 12000],
    ['signin-desk', '/signin', { width: 1600, height: 1000 }, 1, 12000],
    ['scout-desk', '/scout?demo=1&fresh=1', { width: 1600, height: 1000 }, 1, 6000],
    ['scout-phone', '/scout?demo=1&fresh=1', { width: 390, height: 844 }, 3, 6000],
  ].filter((s) => !only || s[0].startsWith(only));
  for (const [name, url, vp, dpr, wait] of shots) {
    const p = await b.newPage({ viewport: vp, deviceScaleFactor: dpr, isMobile: dpr > 1, hasTouch: dpr > 1 });
    p.on('pageerror', (e) => console.error(name, 'page error', e.message));
    await p.goto('http://127.0.0.1:8766' + url, { waitUntil: 'load' });
    await p.waitForTimeout(wait);
    await p.screenshot({ path: path.join(out, name + '.png') });
    console.log(name);
    await p.close();
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
