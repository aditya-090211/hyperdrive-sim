const { chromium } = require('C:/Users/adity/AppData/Roaming/npm/node_modules/playwright');
const path = require('path');
const mode = process.argv[2] || 'probe';
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--force_high_performance_gpu'] });
  for (const [tag, vp, dpr] of [['desk', { width: 1600, height: 1000 }, 1], ['phone', { width: 390, height: 844 }, 3]]) {
    const p = await b.newPage({ viewport: vp, deviceScaleFactor: dpr, isMobile: dpr > 1, hasTouch: dpr > 1 });
    await p.goto('http://127.0.0.1:8766/scout?demo=1&fresh=1'); await p.waitForTimeout(3000);
    await p.locator('input[type=checkbox]').first().check(); await p.getByRole('button', { name: 'Continue' }).click(); await p.waitForTimeout(1500);
    const reg = p.locator('form').filter({ hasText: 'Register team' });
    const ins = reg.locator('input'); await ins.nth(0).fill('009'); await ins.nth(1).fill('Overdrive'); await ins.nth(2).fill('Aditya');
    await p.getByRole('button', { name: 'Register team' }).click(); await p.waitForTimeout(2500);
    if (mode === 'probe') {
      console.log((await p.innerText('body')).slice(0, 800));
      console.log(await p.evaluate(() => [...document.querySelectorAll('button,a,[role=tab]')].map((e) => e.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 60).join(' | ')));
      break;
    }
    const shot = async (name) => { await p.waitForTimeout(1200); await p.screenshot({ path: path.join(__dirname, '..', 'shots', `scout-${name}-${tag}.png`) }); console.log(name, tag); };
    await shot('home');
    // a few match tallies on the scout form
    for (const [lab, n] of [['HIGH pole', 3], ['STAR pole', 2]]) for (let i = 0; i < n; i++) await p.getByRole('button', { name: `Add one ${lab}` }).click().catch(() => {});
    await shot('form');
    await p.click('#tabbar [data-tab=data]'); await shot('data');
    await p.click('#tabbar [data-tab=picks]'); await p.waitForTimeout(600);
    for (const t of ['2001', '009', '317', '1530', '88']) { const i = p.getByPlaceholder('Team number'); await i.fill(t); await i.press('Enter'); await p.waitForTimeout(150); }
    await shot('picks');
    await p.close();
  }
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
