// node grab.cjs <page> <readyVar> <renderFn> <outDir> <frames: a-b or list> [samples]
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/adity/AppData/Roaming/npm/node_modules/playwright');
const fs = require('fs'); const path = require('path');
const [page, readyVar, fn, outDir, spec, samples = '8'] = process.argv.slice(2);
const frames = spec.includes('-') ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(spec.split('-').map(Number)) : spec.split(',').map(Number);
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu'] });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => console.error('page error', e.message));
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text().slice(0, 300)); });
  const sep = page.includes('?') ? '&' : '?';
  await p.goto(`http://127.0.0.1:8766/promo/${page}${sep}samples=${samples}`);
  await p.waitForFunction((v) => window[v], readyVar, { timeout: 300000 });
  console.log('ready', await p.evaluate(() => { const gl = document.querySelector('canvas').getContext('webgl2'); const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?'; }));
  const t0 = Date.now();
  for (const f of frames) {
    const info = await p.evaluate(([fn, f]) => window[fn](f), [fn, f]);
    await p.screenshot({ path: path.join(outDir, `f${String(f).padStart(4, '0')}.png`) });
    if (f % 30 === 0 || frames.length < 20) console.log(f, JSON.stringify(info), ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
  fs.writeFileSync(path.join(outDir, 'events.json'), JSON.stringify(await p.evaluate(() => window.upEvents || window.adEvents || []), null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
