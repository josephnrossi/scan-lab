/* Renders the Stained Glass pattern for each sample photo on iPhone 15 (WebKit) and saves screenshots: node tests/glass-compare.js <prefix> */
const { webkit, devices } = require('/workspace/tools/node_modules/playwright'); const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8765/scan-lab/index.html', PRE = process.argv[2] || 'new', SHOTS = '/workspace/scan-lab-shots';
(async () => {
  const b = await webkit.launch(); const ctx = await b.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' }); const page = await ctx.newPage();
  await page.addInitScript(() => { localStorage.setItem('scanMode', 'glass'); });
  await page.goto(BASE); await page.waitForSelector('.modes button'); await page.addStyleTag({ content: '.top{visibility:hidden}' });
  for (const n of ['bird', 'tulip', 'cat', 'house']) {
    await page.setInputFiles('#fileLib', path.join(__dirname, 'fixtures/photos', n + '.jpg')); await page.waitForSelector('#still:not([hidden])');
    await page.click('#btnAnalyze');
    if (PRE !== 'old') { await page.waitForSelector('#gTapWrap'); await page.waitForFunction(() => document.querySelector('#gTapWrap').getBoundingClientRect().height > 100); if (n === 'bird') { await page.waitForTimeout(300); const r = await page.$eval('#gTapWrap', e => { e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }); await page.mouse.click(r[0] + r[2] * 0.515, r[1] + r[3] * 0.43); } else await page.click('#gTapSkip'); }
    await page.waitForSelector('#gPrev svg [data-piece]', { timeout: 60000 }); await page.waitForTimeout(400);
    const pv = page.locator('#gPrev'); await pv.scrollIntoViewIfNeeded();
    if (await page.$('[data-pv=pattern]')) await page.click('[data-pv=pattern]');
    await pv.screenshot({ path: path.join(SHOTS, `v3-glass-${PRE}-${n}.png`) });
    if (PRE !== 'old') {
      for (const v of ['side', 'overlay']) { await page.click(`[data-pv=${v}]`); await page.waitForTimeout(250); await pv.screenshot({ path: path.join(SHOTS, `v3-glass-${PRE}-${n}-${v}.png`) }); }
      await page.click('[data-pv=pattern]');
    }
    const st = await page.textContent('#gStats'); console.log(PRE, n, st.replace(/\s+/g, ' ').slice(0, 120));
    await page.click('[data-view=scan]'); await page.evaluate(() => { S.photos = []; });
  }
  await b.close();
})();
