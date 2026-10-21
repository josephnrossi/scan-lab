/* Scan Lab end-to-end tests: WebKit (iPhone 15, iPad Pro 11 portrait) + Chromium. Mocks the AI APIs and the camera/mic. */
const { webkit, chromium, devices } = require('/workspace/tools/node_modules/playwright');
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const { installMocks, VOICE } = require('./mocks');
const BASE = process.env.BASE || 'http://localhost:8765/scan-lab/index.html', FX = path.join(__dirname, 'fixtures'), SHOTS = '/workspace/scan-lab-shots', TMP = '/tmp/scanlab-dl';
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(TMP, { recursive: true });
const KEY = 'xai-TESTKEY-1234567890';
const results = []; const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null, onlyDev = process.env.DEV ? new RegExp(process.env.DEV) : null;
const assert = (c, m) => { if (!c) throw new Error('Assertion failed: ' + m); };
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m}: ${a} not within ${tol} of ${b}`);
const fx = f => path.join(FX, f);
const DEVS = [
  { name: 'webkit-iphone15', type: webkit, ctx: { ...devices['iPhone 15'] } },
  { name: 'webkit-iphonese', type: webkit, ctx: { ...devices['iPhone SE (3rd gen)'] } },
  { name: 'webkit-ipadpro11', type: webkit, ctx: { ...devices['iPad Pro 11'] } },
  { name: 'chromium', type: chromium, ctx: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: false, hasTouch: true }, launch: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'] } },
];
const camMock = () => { // WebKit has no fake camera: feed a moving canvas through getUserMedia
  const real = navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {} });
  navigator.mediaDevices.getUserMedia = async (c) => { if (c && c.audio && !c.video && real) return real.call(navigator.mediaDevices, c); const cv = document.createElement('canvas'); cv.width = 640; cv.height = 480; const g = cv.getContext('2d'); let t = 0; setInterval(() => { g.fillStyle = '#334'; g.fillRect(0, 0, 640, 480); g.fillStyle = '#e44'; g.beginPath(); g.arc(320 + 100 * Math.sin(t += 0.1), 240, 80, 0, 7); g.fill(); }, 33); return cv.captureStream(30); };
};
async function newPage(browser, dev, { key = false, sw = false, pn = null } = {}) {
  const ctx = await browser.newContext({ ...dev.ctx, serviceWorkers: sw ? 'allow' : 'block', acceptDownloads: true, ...(dev.type === chromium ? { permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'] } : {}) });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (dev.type === webkit) await page.addInitScript(camMock);
  await page.addInitScript(([k, pn]) => { window.__noShare = true; if (k && !localStorage.getItem('scanLabAI')) localStorage.setItem('scanLabAI', JSON.stringify({ provider: 'xai', base: 'https://api.x.ai/v1', model: 'grok-4.7', key: k })); if (pn) localStorage.setItem('assistAI', JSON.stringify(pn)); localStorage.setItem('voiceConsent', localStorage.getItem('voiceConsent') || ''); }, [key ? KEY : '', pn]);
  const mock = await installMocks(page);
  await page.goto(BASE); await page.waitForSelector('.modes button');
  return { ctx, page, errors, mock };
}
const shot = (page, dev, name) => page.screenshot({ path: path.join(SHOTS, `${dev.name}-${name}.png`), fullPage: false });
const shotEl = (loc, dev, name) => loc.screenshot({ path: path.join(SHOTS, `${dev.name}-${name}.png`) });
async function photo(page, file, input = '#fileLib') { await page.setInputFiles(input, fx(file)); await page.waitForSelector('#still:not([hidden])'); }
async function mode(page, m) { await page.click(`[data-mode=${m}]`); }
async function dl(page, sel) { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click(sel)]); const p = path.join(TMP, Date.now() + '-' + d.suggestedFilename()); await d.saveAs(p); return { name: d.suggestedFilename(), path: p, buf: fs.readFileSync(p) }; }
const text = page => page.evaluate(() => document.body.innerText);

const T = {};
/* ---------- shell ---------- */
T['loads with no errors, manifest, dark theme'] = async ({ page, errors }) => {
  assert(await page.title() === 'Scan Lab', 'title'); assert(await page.$eval('link[rel=manifest]', l => l.href.endsWith('manifest.json')), 'manifest');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor); assert(bg === 'rgb(15, 16, 19)', 'dark bg ' + bg);
  const small = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 43.5 && !b.closest('.pages-row')).map(b => b.textContent.trim()).slice(0, 5)); assert(!small.length, '44pt targets: ' + small.join('|'));
  assert(!errors.length, errors.join('; '));
};
T['service worker caches shell and works offline'] = { sw: true, fn: async ({ page, ctx }) => {
  await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForFunction(async () => (await caches.keys()).includes('scan-lab-v2'), null, { timeout: 15000 });
  const n = await page.evaluate(async () => (await (await caches.open('scan-lab-v2')).keys()).length); assert(n >= 20, 'cached ' + n);
  await ctx.setOffline(true); await page.reload(); await page.waitForSelector('.modes button'); assert((await page.title()) === 'Scan Lab', 'offline reload'); await ctx.setOffline(false);
} };
/* ---------- camera ---------- */
T['live camera preview, capture, tap to retake'] = async ({ page, dev }) => {
  await page.evaluate(() => { const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = c => { window.__gum = c; return g(c); }; });
  await page.click('#btnStartCam'); await page.waitForFunction(() => S.live, null, { timeout: 10000 });
  assert(await page.evaluate(() => window.__gum.video.facingMode.ideal === 'environment' && !!document.querySelector('#cam').srcObject && document.querySelector('#cam').playsInline), 'rear camera stream, playsinline');
  const frames = await page.waitForFunction(() => document.querySelector('#cam').videoWidth > 0, null, { timeout: 4000 }).then(() => true, () => false);
  if (frames) { await page.waitForTimeout(300); await page.click('#btnShutter'); }
  else { assert(dev.type === webkit, 'chromium fake camera must deliver frames'); // headless WebKit's canvas stream delivers no frames: the shutter falls back to the native camera picker
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btnShutter')]); assert(await fc.element().evaluate(e => e.id === 'fileCam' && e.getAttribute('capture') === 'environment'), 'capture=environment input'); await fc.setFiles(fx('food.jpg')); }
  await page.waitForSelector('#still:not([hidden])');
  const w = await page.evaluate(() => S.photos[0].length); assert(w > 1000, 'captured'); assert(!(await page.isDisabled('#btnAnalyze')), 'analyze enabled');
  await shot(page, dev, '01-captured'); await page.click('#still'); await page.waitForFunction(() => S.photos.length === 0 && document.querySelector('#still').hidden);
};
T['photo library fallback downscales to ≤1280px JPEG'] = async ({ page }) => {
  await photo(page, 'measure.jpg'); const d = await page.evaluate(async () => { const i = await loadImg(S.photos[0]); return [i.naturalWidth, i.naturalHeight, S.photos[0].slice(0, 15)]; });
  assert(Math.max(d[0], d[1]) === 1280, 'long side ' + d); assert(d[2].startsWith('data:image/jpe'), 'jpeg');
};
/* ---------- food / materials / auto ---------- */
T['food: items, ranges, portion edits recompute, log add + undo'] = { key: true, fn: async ({ page, dev, mock }) => {
  await mode(page, 'food'); await photo(page, 'food.jpg'); await page.fill('#hint', 'this is a 12oz steak'); await page.click('#btnAnalyze'); await page.waitForSelector('#btnLogAdd');
  assert(mock.log.some(l => JSON.stringify(l.body).includes('12oz steak') && JSON.stringify(l.body).includes('image_url')), 'hint+image sent');
  const kcal = () => page.$eval('[data-ng="0"] [data-k=calories] b', e => e.textContent), tot = () => page.$eval('[data-ng=tot] [data-k=calories] b', e => e.textContent);
  assert(await kcal() === '480–560 kcal', 'item kcal ' + await kcal()); assert(await tot() === '510–600 kcal', 'total ' + await tot());
  assert((await text(page)).includes('dairy') && (await text(page)).includes('medium confidence'), 'allergen/conf');
  await shotEl(page.locator('#result'), dev, '02-food-result');
  await page.fill('[data-g="0"]', '400'); await page.dispatchEvent('[data-g="0"]', 'input');
  assert(await kcal() === '960–1120 kcal', 'scaled ' + await kcal()); assert(await page.inputValue('[data-s="0"]') === '4', 'servings synced');
  assert(await tot() === '990–1160 kcal', 'total rescaled ' + await tot());
  await page.fill('[data-s="1"]', '2'); await page.dispatchEvent('[data-s="1"]', 'input'); assert(await page.inputValue('[data-g="1"]') === '180', 'grams from servings');
  await page.click('#btnLogAdd'); await page.waitForSelector('#toast:not([hidden])');
  await page.click('[data-view=log]'); await page.waitForSelector('.log-item'); assert((await page.$$('.log-item')).length === 2, '2 log items');
  assert((await page.textContent('#logTotals')).includes('1014–1192 kcal'), 'log total ' + await page.textContent('#logTotals'));
  await shot(page, dev, '03-food-log');
  await page.click('.log-item [data-del]'); await page.waitForFunction(() => document.querySelectorAll('.log-item').length === 1); await page.click('#toastUndo'); await page.waitForFunction(() => document.querySelectorAll('.log-item').length === 2);
  await page.waitForTimeout(600); const saved = await page.evaluate(async () => (await DB.all('scans'))[0].result.items[0].grams); assert(saved === 400, 'edit persisted');
} };
T['materials: compounds with formulas, properties, honest note'] = { key: true, fn: async ({ page, dev }) => {
  await mode(page, 'materials'); await photo(page, 'object.jpg'); await page.click('#btnAnalyze'); await page.waitForSelector('.formula');
  assert(await page.$eval('#result', e => e.innerHTML.includes('Fe<sub>2</sub>O<sub>3</sub>')), 'formula subscripts');
  const t = await page.textContent('#result'); for (const s of ['Gray cast iron', '95–98%', 'Density', '7.2 g/cm³', 'Handle hot', 'Scrap metal', 'spectrometer']) assert(t.includes(s), 'missing ' + s);
  await shotEl(page.locator('#result'), dev, '04-materials');
} };
T['auto mode lets Grok pick the kind'] = { key: true, fn: async ({ page, mock }) => {
  mock.state.auto = 'materials'; await mode(page, 'auto'); await photo(page, 'object.jpg'); await page.click('#btnAnalyze'); await page.waitForSelector('.formula');
  assert(mock.log.some(l => JSON.stringify(l.body).includes('Decide whether the photo')), 'auto prompt');
} };
T['errors: no key, bad JSON, offline, 401'] = async ({ page, mock, ctx, dev }) => {
  await mode(page, 'food'); await photo(page, 'food.jpg'); await page.click('#btnAnalyze'); await page.waitForSelector('.card.err'); assert((await page.textContent('.card.err')).includes('API key needed'), 'nokey');
  await page.click('[data-act=settings]'); await page.waitForSelector('#sheetSettings:not([hidden])'); await page.fill('#setKey', KEY); await page.click('#btnSaveAI');
  mock.state.bad = true; await page.click('#btnAnalyze'); await page.waitForSelector('.card.err >> text=Unexpected AI answer'); await shot(page, dev, '05-error-badjson'); mock.state.bad = false;
  await ctx.setOffline(true); await page.click('#btnAnalyze'); await page.waitForSelector('.card.err >> text=Offline'); await ctx.setOffline(false);
  mock.state.status = 401; await page.click('#btnAnalyze'); await page.waitForSelector('.card.err >> text=rejected'); mock.state.status = 200;
  await page.click('[data-act=retry]'); await page.waitForSelector('#btnLogAdd');
};
/* ---------- history / settings ---------- */
T['history: thumbnails, open, delete + undo, export JSON without key'] = { key: true, fn: async ({ page, dev }) => {
  await mode(page, 'food'); await photo(page, 'food.jpg'); await page.click('#btnAnalyze'); await page.waitForSelector('#btnLogAdd');
  await mode(page, 'materials'); await photo(page, 'object.jpg'); await page.click('#btnAnalyze'); await page.waitForSelector('.formula');
  await page.click('[data-view=history]'); await page.waitForFunction(() => document.querySelectorAll('.hist-item').length === 2);
  assert(await page.$eval('.hist-item img', i => i.src.startsWith('data:image/jpeg')), 'thumb'); await shot(page, dev, '06-history');
  await page.click('.hist-item [data-open]'); await page.waitForSelector('#sheetDetail:not([hidden]) .formula'); await page.click('#sheetDetail [data-close]');
  await page.click('.hist-item [data-hdel]'); await page.waitForFunction(() => document.querySelectorAll('.hist-item').length === 1); await page.click('#toastUndo'); await page.waitForFunction(() => document.querySelectorAll('.hist-item').length === 2);
  const f = await dl(page, '#btnExport'); const s = f.buf.toString(); const j = JSON.parse(s);
  assert(j.scans.length === 2 && j.app === 'Scan Lab', 'export'); assert(!s.includes(KEY) && !s.includes('xai-TEST'), 'no key in export'); assert(!s.includes('"image"'), 'no full photos');
} };
T['settings: Pencil Notes key one-tap, Test button'] = { pn: { on: true, provider: 'xai', base: 'https://api.x.ai/v1', model: 'grok-4.7', key: 'xai-PENCILNOTES-KEY-999' }, fn: async ({ page, dev }) => {
  await page.click('#btnSettings'); await page.waitForSelector('#pnKeyBox:not([hidden])'); await shot(page, dev, '07-settings');
  await page.click('#btnUsePN'); const c = await page.evaluate(() => JSON.parse(localStorage.getItem('scanLabAI'))); assert(c.key === 'xai-PENCILNOTES-KEY-999' && c.model === 'grok-4.7', 'copied key');
  await page.click('#btnTestAI'); await page.waitForSelector('#testResult >> text=Works'); assert((await page.textContent('#testResult')).includes('red'), 'vision test');
} };
/* ---------- stained glass (unit) ---------- */
T['glass: k-means quantization finds the true colors'] = async ({ page }) => {
  const r = await page.evaluate(() => { const cols = [[200, 30, 30], [30, 160, 60], [40, 60, 200], [240, 220, 60]], pts = []; for (let i = 0; i < 4000; i++) { const c = cols[i % 4]; pts.push(c[0] + (i * 7 % 11) - 5, c[1] + (i * 13 % 11) - 5, c[2] + (i * 3 % 11) - 5); } const C = kmeans(new Float32Array(pts), 4); return cols.map(c => Math.min(...C.map(k => Math.hypot(k[0] - c[0], k[1] - c[1], k[2] - c[2])))); });
  assert(r.every(d => d < 4), 'centers ' + r);
};
const buildFlower = (o) => async () => { const im = await loadImg(document.querySelector('#__fx').src); const P = glassBuild(await glassImageData(im, o), o); window.__P = P; return true; };
async function flower(page, o) { await page.evaluate(src => { const i = new Image(); i.id = '__fx'; i.src = src; i.hidden = true; document.body.appendChild(i); return new Promise(r => i.onload = r); }, 'data:image/jpeg;base64,' + fs.readFileSync(fx('flower.jpg')).toString('base64')); return page.evaluate(async o => { const im = document.querySelector('#__fx'); const P = glassBuild(await glassImageData(im, o), o); window.__P = P; return { n: P.pieces.length, stats: P.stats, W: P.gridW, H: P.gridH, ppi: P.ppi, area: P.pieces.reduce((a, p) => a + p.poly.reduce((s, r) => s + Math.abs(ringArea(r)) * (r === p.poly[0] ? 1 : -1), 0), 0), rings: P.pieces.map(p => p.poly.length), minArea: Math.min(...P.pieces.filter(p => !p.frame).map(p => p.areaIn)), dZ: P.pieces.every(p => p.segs.every(s => s[s.length - 1][0] === 'Z' && s[0][0] === 'M')), frames: P.pieces.filter(p => p.frame).length, minW: Math.min(...P.pieces.filter(p => !p.frame).map(p => p.widthIn)) }; }, o); }
T['glass: closed gap-free paths, min piece size, no enclosed pieces'] = async ({ page }) => {
  for (const o of [{ colors: 6, simplicity: 3, widthIn: 12 }, { colors: 8, simplicity: 1, widthIn: 10, frame: false }, { colors: 4, simplicity: 9, widthIn: 16 }]) {
    const r = await flower(page, o);
    assert(r.dZ, 'every subpath M…Z'); near(r.area, r.W * r.H, r.W * r.H * 0.002, 'pieces tile the panel with no gaps/overlaps');
    assert(r.rings.every(n => n === 1), 'no piece encloses another: ' + r.rings.join(','));
    assert(r.minArea >= r.stats.minAreaIn * 0.999 || r.stats.flagged.small.length, 'min piece size ' + r.minArea + ' < ' + r.stats.minAreaIn);
    assert(r.stats.flagged.small.length === 0, 'no small pieces left: ' + r.stats.flagged.small);
    assert(r.frames === (o.frame === false ? 0 : 4), 'frame pieces ' + r.frames);
  }
  const a = await flower(page, { colors: 6, simplicity: 2, widthIn: 12 }), b = await flower(page, { colors: 6, simplicity: 9, widthIn: 12 }); assert(b.n <= a.n, `simplicity reduces pieces ${a.n}→${b.n}`);
};
T['glass: SVG and PDF export at real scale, tiled with marks'] = async ({ page }) => {
  await flower(page, { colors: 5, simplicity: 5, widthIn: 20, heightIn: 24, line: 'came316' });
  const r = await page.evaluate(() => { const P = window.__P, svg = glassSVG(P), d = glassPDF(P), c = glassPDF(P, { cut: true }), bytes = d.output(); let s = ''; for (const b of bytes) s += String.fromCharCode(b); return { svg, P: { w: P.widthIn, h: P.heightIn, gw: P.gridW, gh: P.gridH, ppi: P.ppi, lineIn: P.lineIn }, meta: d.meta, cmeta: c.meta, pdf: btoa(s), cut: btoa(Array.from(c.output(), x => String.fromCharCode(x)).join('')) }; });
  assert(r.svg.includes(`width="${r.P.w}in" height="${r.P.h}in"`), 'svg inches'); assert(r.svg.includes(`viewBox="0 0 ${r.P.gw} ${r.P.gh}"`), 'viewBox');
  const sw = +r.svg.match(/id="lead"[^>]*stroke-width="([\d.]+)"/)[1]; near(sw, r.P.lineIn * r.P.ppi, 0.01, '3/16" came stroke'); near(r.P.lineIn, 0.1875, 1e-9, 'came width');
  near(r.P.gw / r.P.ppi, 20, 0.05, 'grid width = 20in');
  assert(r.meta.cols === 3 && r.meta.rows === 3 && r.meta.pages === 10, 'tiles ' + JSON.stringify(r.meta));
  const pdf = Buffer.from(r.pdf, 'base64'), pf = path.join(TMP, 'glass-pattern.pdf'), cf = path.join(TMP, 'glass-cut.pdf'); fs.writeFileSync(pf, pdf); fs.writeFileSync(cf, Buffer.from(r.cut, 'base64'));
  const info = execSync(`pdfinfo ${pf}`).toString(); assert(/Pages:\s+10/.test(info) && /612 x 792/.test(info), 'pdfinfo ' + info);
  const sc = (72 / r.P.ppi).toFixed(3).replace(/0+$/, ''); assert(new RegExp(`(^|\\s)${+sc} 0 0 -${+sc} `, 'm').test(pdf.toString('latin1')), 'real-scale cm ' + sc);
  assert(/Pages:\s+10/.test(execSync(`pdfinfo ${cf}`).toString()), 'cut sheet pages');
  assert((pdf.toString('latin1').match(/ l S/g) || []).length > 20, 'alignment marks');
  execSync(`pdftoppm -r 40 -png -f 1 -l 2 ${pf} ${SHOTS}/pdf-glass-pattern && pdftoppm -r 40 -png -f 2 -l 2 ${cf} ${SHOTS}/pdf-glass-cutlines`);
  // single page when it fits
  await flower(page, { colors: 5, simplicity: 5, widthIn: 6 }); const m = await page.evaluate(() => glassPDF(window.__P).meta); assert(m.pages === 2, 'fits on one tile + overview');
};
/* ---------- stained glass (UI) ---------- */
T['glass UI: live preview, legend, difficulty, exports, save'] = async ({ page, dev }) => {
  await mode(page, 'glass'); await photo(page, 'flower.jpg'); await page.click('#btnAnalyze'); await page.waitForSelector('#gPrev svg [data-piece]', { timeout: 20000 });
  const n1 = await page.$$eval('#gPrev [data-piece]', x => x.length); assert(n1 > 4, 'pieces ' + n1);
  assert(await page.$$eval('#gLegend .sw', x => x.length) >= 3, 'legend swatches'); assert(/Beginner|Intermediate/.test(await page.textContent('#gDiffBadge')), 'difficulty');
  await shotEl(page.locator('#result'), dev, '08-glass-pattern');
  await page.$eval('#gSim', e => { e.value = 10; e.dispatchEvent(new Event('input')); }); await page.waitForFunction(() => !document.querySelector('#gPrev').classList.contains('busy') && window.__glass().settings.simplicity === 10, null, { timeout: 20000 });
  const n2 = await page.$$eval('#gPrev [data-piece]', x => x.length); assert(n2 <= n1, `simpler ${n1}→${n2}`);
  await page.click('[data-u=cm]'); assert((await page.inputValue('#gW')) === '30.5', 'cm ' + await page.inputValue('#gW')); await page.click('[data-pv=cut]'); await page.waitForTimeout(100); await shotEl(page.locator('#gPrev'), dev, '09-glass-cutlines');
  const svg = await dl(page, '#gSVG'); assert(svg.buf.toString().startsWith('<svg') && svg.name.endsWith('.svg'), 'svg dl');
  const pdf = await dl(page, '#gPDF'); assert(pdf.buf.slice(0, 5).toString() === '%PDF-', 'pdf dl'); const cut = await dl(page, '#gCut'); assert(cut.name.includes('cutlines'), 'cut dl ' + cut.name);
  await page.click('#gSave'); await page.click('[data-view=history]'); await page.waitForSelector('.hist-item >> text=Stained glass');
};
T['glass UI: Grok tips are optional'] = { key: true, fn: async ({ page }) => {
  await mode(page, 'glass'); await photo(page, 'flower.jpg'); await page.click('#btnAnalyze'); await page.waitForSelector('#gGrok'); await page.click('#gGrok'); await page.waitForSelector('#gTips >> text=Merge the small dark specks');
} };
/* ---------- measure ---------- */
async function dragNorm(page, sel, from, to) { await page.locator(sel).scrollIntoViewIfNeeded(); const b = await page.locator(sel).boundingBox(); await page.mouse.move(b.x + from[0] * b.width, b.y + from[1] * b.height); await page.mouse.down(); await page.mouse.move(b.x + to[0] * b.width, b.y + to[1] * b.height, { steps: 6 }); await page.mouse.up(); }
T['measure flat: drag points with reference → inches & cm, use as glass size'] = async ({ page, dev }) => {
  await mode(page, 'measure'); await page.click('[data-ms=flat]'); await photo(page, 'measure.jpg'); await page.click('#btnAnalyze'); await page.waitForSelector('#mCanvas canvas');
  await page.selectOption('#mRef', 'card'); await page.waitForTimeout(200); const c = '#mCanvas canvas';
  await dragNorm(page, c, [0.12, 0.85], [100 / 1600, 1570 / 2000]); await dragNorm(page, c, [0.3, 0.85], [956 / 1600, 1570 / 2000]);
  await dragNorm(page, c, [0.35, 0.3], [300 / 1600, 0.3]); await dragNorm(page, c, [0.8, 0.3], [1300 / 1600, 0.3]);
  await dragNorm(page, c, [0.65, 0.2], [0.5, 300 / 2000]); await dragNorm(page, c, [0.65, 0.7], [0.5, 900 / 2000]);
  const st = await page.evaluate(() => window.__measure.lines.map(l => l.mm)); near(st[1], 100, 2, 'A mm'); near(st[2], 60, 1.5, 'B mm');
  assert((await page.textContent('[data-len=a]')).includes('cm'), 'in+cm'); await shotEl(page.locator('#result'), dev, '10-measure-flat');
  await page.click('#mGlass'); await page.waitForSelector('#gW'); near(+await page.inputValue('#gW'), 4, 0.01, 'glass width prefilled (3.94→4 in)');
};
T['measure flat: Grok auto-detects the reference'] = { key: true, fn: async ({ page }) => {
  await mode(page, 'measure'); await page.click('[data-ms=flat]'); await photo(page, 'measure.jpg'); await page.click('#btnAnalyze'); await page.selectOption('#mRef', 'card'); await page.click('#mGrok'); await page.waitForSelector('#mGrokOut >> text=Red block');
  const st = await page.evaluate(() => window.__measure.lines.map(l => l.mm)); near(st[1], 100, 0.5, 'A'); near(st[2], 60, 0.5, 'B');
} };
T['measure 3D photos: guided views, Grok shape, model, edits, exports'] = { key: true, fn: async ({ page, dev }) => {
  await mode(page, 'measure'); await page.click('[data-ms="3d"]');
  for (const v of ['front', 'side', 'top']) { await page.setInputFiles('#fileLib', fx(`view-${v}.jpg`)); await page.waitForFunction(n => S.photos.length === n, ['front', 'side', 'top'].indexOf(v) + 1); }
  assert((await page.textContent('#pagesRow')).includes('Top'), 'view labels'); assert((await page.textContent('#btnAnalyze')).includes('Measure 3D'), 'btn');
  await page.click('#btnAnalyze'); await page.waitForSelector('#m3Views canvas'); assert((await page.$$('#m3Views canvas')).length === 3, '3 views');
  await page.selectOption('#mRef3', 'card'); await page.click('#m3Grok'); await page.waitForSelector('#mGrokOut >> text=Wooden box');
  await page.waitForFunction(() => window.__measure.dims && Math.abs(window.__measure.dims.L - 100) < 1);
  const d = await page.evaluate(() => window.__measure.dims); near(d.L, 100, 1, 'L'); near(d.W, 40, 1, 'W'); near(d.H, 60, 1, 'H');
  await page.waitForSelector('#m3Viewer canvas', { timeout: 15000 }); await page.waitForTimeout(800);
  assert((await page.textContent('#m3Sum')).includes('cm³'), 'volume'); near(+await page.inputValue('#m3H'), 2.36, 0.02, 'H input inches');
  await page.selectOption('#m3Shape', 'cylinder'); await page.fill('#m3H', '4'); await page.dispatchEvent('#m3H', 'change'); await page.waitForTimeout(500);
  const v = await page.evaluate(() => { const d = window.__measure.dims; return [d.H, shapeCalc('cylinder', d).volume]; }); near(v[0], 101.6, 0.01, 'edited H'); near(v[1], Math.PI * 35 * 35 * 101.6, 1, 'cylinder volume');
  await shotEl(page.locator('#result'), dev, '11-measure-3d-model');
  await page.selectOption('#m3Shape', 'box'); await page.waitForTimeout(300);
  const stl = await dl(page, '#m3STL'); assert(stl.buf.length === 84 + 12 * 50, 'STL 12 triangles ' + stl.buf.length);
  const obj = await dl(page, '#m3OBJ'); assert((obj.buf.toString().match(/^f /gm) || []).length === 12, 'OBJ faces');
  const glb = await dl(page, '#m3GLB'); assert(glb.buf.readUInt32LE(0) === 0x46546C67, 'GLB magic');
  const png = await dl(page, '#m3PNG'); assert(png.buf.slice(1, 4).toString() === 'PNG', 'png');
  const pdf = await dl(page, '#m3PDF'); const pp = path.join(TMP, 'dims.pdf'); fs.writeFileSync(pp, pdf.buf); assert(/Pages:\s+1/.test(execSync('pdfinfo ' + pp).toString()), 'dims pdf'); execSync(`pdftoppm -r 50 -png -f 1 -l 1 ${pp} ${SHOTS}/pdf-dimension-sheet`);
} };
T['measure 3D: single 3/4 photo marks depth as estimated'] = { key: true, fn: async ({ page }) => {
  await mode(page, 'measure'); await page.click('[data-ms="3d"]'); await page.setInputFiles('#fileLib', fx('view-front.jpg')); await page.waitForFunction(() => S.photos.length === 1); await page.click('#btnAnalyze');
  await page.waitForSelector('#m3Views canvas'); assert((await page.textContent('#result')).includes('lower confidence'), 'single-photo warning');
} };
async function openModel(page, file, unit) { await mode(page, 'measure'); await page.click('[data-ms=file]'); await page.waitForSelector('#mfOpen'); if (unit) await page.selectOption('#mfUnit', unit); await page.setInputFiles('#mfFile', fx(file)); }
T['3D scan files: GLB true scale, watertight volume, 2-point measure, set scale'] = async ({ page, dev }) => {
  await openModel(page, 'box-10x20x30cm.glb'); await page.waitForSelector('#mfStats >> text=L × W × H', { timeout: 20000 });
  const t = await page.textContent('#mfStats'); assert(t.includes('10.0 × 30.0 × 20.0 cm'), 'dims ' + t); assert(t.includes('6000 cm³') && t.includes('watertight'), 'mesh volume'); assert(t.includes('2200 cm²'), 'surface');
  await page.waitForTimeout(600); await shotEl(page.locator('#result'), dev, '12-scan-file-glb');
  await page.click('#mfPt'); await page.evaluate(() => { const V = window.__mfApi.viewer.THREE.Vector3; window.__mfApi.viewer.pickAt(new V(-50, -100, 150)); window.__mfApi.viewer.pickAt(new V(50, -100, 150)); });
  await page.waitForSelector('#mfStats >> text=Point-to-point'); assert((await page.textContent('#mfStats')).includes('10.0 cm'), '2-point 100mm');
  page.once('dialog', d => d.accept('20 cm')); await page.click('#mfPt'); await page.click('#mfScale');
  await page.evaluate(() => { const V = window.__mfApi.viewer.THREE.Vector3; window.__mfApi.viewer.pickAt(new V(-50, 0, 0)); window.__mfApi.viewer.pickAt(new V(50, 0, 0)); });
  await page.waitForFunction(() => document.querySelector('#mfStats').textContent.includes('20.0 × 60.0 × 40.0 cm'), null, { timeout: 5000 });
};
T['3D scan files: OBJ/STL/PLY with unit picker, USDZ message'] = async ({ page }) => {
  await openModel(page, 'cube-5.obj', 'cm'); await page.waitForSelector('#mfStats >> text=5.0 × 5.0 × 5.0 cm'); assert((await page.textContent('#mfStats')).includes('125 cm³'), 'obj volume');
  await page.selectOption('#mfUnit', 'in'); await page.setInputFiles('#mfFile', fx('box-1x2x3.stl')); await page.waitForSelector('#mfStats >> text=1.00 × 3.00 × 2.00 in');
  assert((await page.textContent('#mfStats')).includes('no units'), 'unit note');
  await page.selectOption('#mfUnit', 'cm'); await page.setInputFiles('#mfFile', fx('box-1x2x3.ply')); await page.waitForSelector('#mfStats >> text=1.0 × 3.0 × 2.0 cm');
  const ply = await dl(page, '#mfSTL'); assert(ply.buf.length === 84 + 12 * 50, 'stl re-export');
  await page.setInputFiles('#mfFile', fx('broken.usdz')); await page.waitForSelector('.card.err >> text=export as GLB');
  assert((await page.textContent('#result')).includes('Polycam'), 'how-to');
};
/* ---------- docs ---------- */
T['docs: receipt extraction, enhance/crop, CSV, receipts by month'] = { key: true, fn: async ({ page, dev, mock }) => {
  await mode(page, 'docs'); await photo(page, 'receipt.jpg'); await page.click('#still'); await page.setInputFiles('#fileLib', fx('receipt.jpg')); await page.waitForFunction(() => S.photos.length === 2);
  await page.click('#btnAnalyze'); await page.waitForSelector('[data-f="receipt.total"]');
  const req = mock.log.find(l => JSON.stringify(l.body).includes('receipts, business cards')); assert((JSON.stringify(req.body).match(/"type":"image_url"/g) || []).length === 2, 'two pages sent');
  assert(await page.inputValue('[data-f="receipt.total"]') === '12.25', 'total'); assert((await page.textContent('#result')).includes('Screws'), 'items');
  const crop = await page.evaluate(async () => { const r = await docEnhance(S.photos[0]); const i = await loadImg(r.image); return [r.cropped, i.naturalWidth, i.naturalHeight]; }); assert(crop[0] && crop[1] < 1000, 'cropped to paper ' + crop);
  await shotEl(page.locator('#result'), dev, '13-docs-receipt');
  const csv = await dl(page, '#docCSV'); assert(csv.buf.toString().includes('Home Depot,2026-10-14,Screws,1,7.47,USD') && csv.buf.toString().includes('TOTAL,,12.25'), 'csv ' + csv.buf);
  const txt = await dl(page, '#docTXT'); assert(txt.buf.toString().includes('Total: 12.25'), 'txt');
  await page.fill('[data-f="receipt.total"]', '13.00'); await page.dispatchEvent('[data-f="receipt.total"]', 'input'); await page.waitForTimeout(500);
  await page.click('[data-view=receipts]'); await page.waitForSelector('[data-month="2026-10"]'); assert((await page.textContent('[data-month="2026-10"]')).includes('13.00'), 'month total');
  await shot(page, dev, '14-receipts-list'); const all = await dl(page, '#btnReceiptsCSV'); assert(all.buf.toString().split('\n').length === 2, 'receipts csv');
} };
T['docs: business card → VCF contact'] = { key: true, fn: async ({ page, mock }) => {
  mock.state.doc = 'card'; await mode(page, 'docs'); await photo(page, 'card.jpg'); await page.click('#btnAnalyze'); await page.waitForSelector('#docVCF');
  const v = (await dl(page, '#docVCF')).buf.toString(); for (const s of ['BEGIN:VCARD', 'FN:Jane Q. Smith', 'N:Smith;Jane Q.;;;', 'ORG:Acme Glass Co.', 'TEL;TYPE=WORK:(555) 123-4567', 'EMAIL;TYPE=INTERNET:jane@acmeglass.com', 'END:VCARD']) assert(v.includes(s), 'vcf missing ' + s);
} };
T['docs: no key → image kept, manual entry, saved receipt'] = async ({ page, dev }) => {
  await mode(page, 'docs'); await photo(page, 'receipt.jpg'); await page.click('#btnAnalyze'); await page.waitForSelector('#docSave');
  await page.fill('[data-f="receipt.merchant"]', 'Corner Store'); await page.dispatchEvent('[data-f="receipt.merchant"]', 'input'); await page.fill('[data-f="receipt.total"]', '4.50'); await page.dispatchEvent('[data-f="receipt.total"]', 'input'); await page.fill('#docText', 'Milk 4.50'); await page.dispatchEvent('#docText', 'input');
  await shotEl(page.locator('#result'), dev, '15-docs-manual'); await page.click('#docSave'); await page.click('[data-view=receipts]'); await page.waitForSelector('#rcptList >> text=Corner Store');
  assert(await page.evaluate(async () => (await DB.all('scans'))[0].image.startsWith('data:image/jpeg')), 'image saved');
};
/* ---------- voice ---------- */
const VERDICT = /\b(lie|lies|lied|lying|liar|deceptive|deceiving|deception|truthful|untruthful|dishonest|dishonesty)\b|telling the truth/i;
T['voice: consent gate, import, diarized transcript, metrics, rename, analysis, fact-check, no verdicts'] = { key: true, fn: async ({ page, dev }) => {
  await mode(page, 'voice'); await page.waitForSelector('#vConsent'); assert(await page.isDisabled('#vRec'), 'record disabled before consent'); await shot(page, dev, '16-voice-consent');
  await page.click('#vOK'); await page.waitForSelector('#vRec:not([disabled])');
  await page.setInputFiles('#vFile', fx('conversation.wav')); await page.waitForSelector('#vChart', { timeout: 30000 });
  const sc = await page.evaluate(() => window.__voice.result); const m = Object.fromEntries(sc.metrics.map(x => [x.sp, x]));
  assert(sc.metrics.length === 2, 'two speakers'); near(m['1'].pitchMean, 120, 10, 'speaker 1 pitch'); near(m['2'].pitchMean, 220, 15, 'speaker 2 pitch');
  assert(m['1'].fillers.um === 1 && m['1'].fillers['you know'] === 1 && m['2'].fillers.uh === 1 && m['2'].fillers.basically === 1, 'fillers ' + JSON.stringify([m['1'].fillers, m['2'].fillers]));
  assert(m['1'].hedges['i think'] === 1 && m['1'].hedges.maybe === 1, 'hedges'); assert(m['2'].interruptions === 1, 'interruption'); assert(m['1'].wpm > 50, 'wpm');
  assert(m['1'].talkMs > m['2'].talkMs && Math.abs(m['1'].share + m['2'].share - 1) < 1e-6, 'talk share');
  await page.fill('[data-spk="1"]', 'Alice'); await page.dispatchEvent('[data-spk="1"]', 'change'); await page.waitForSelector('#result >> text=Alice:');
  const t = await page.textContent('#result'); assert(t.includes('Recount the units') && t.includes('40 to 35'), 'analysis'); assert(t.includes('Supported by sources') && (await page.$('a[href="https://polb.com/port-info/port-facts-faqs/"]')), 'fact-check source');
  await page.evaluate(() => window.scrollTo(0, 0)); await shotEl(page.locator('#result'), dev, '17-voice-report'); await shotEl(page.locator('#vChart'), dev, '18-voice-timeline');
  const strip = s => s.split(VOICE_NOTE_TXT).join('');
  assert(!VERDICT.test(strip(t)), 'verdict words in report: ' + (strip(t).match(VERDICT) || [])[0]);
  const txt = (await dl(page, '#vTXT')).buf.toString(); assert(txt.includes('TRANSCRIPT') && txt.includes('Alice'), 'txt'); assert(!VERDICT.test(strip(txt)), 'verdict in TXT: ' + (strip(txt).match(VERDICT) || [])[0]);
  const pdf = await dl(page, '#vPDF'); const pp = path.join(TMP, 'voice.pdf'); fs.writeFileSync(pp, pdf.buf); const pt = execSync(`pdftotext ${pp} -`).toString().replace(/\s+/g, ' ');
  assert(pt.includes('Alice') && !VERDICT.test(pt.split(VOICE_NOTE_TXT.replace(/\s+/g, ' ')).join('').replace(/Voice analysis cannot detect deception\./g, '')), 'pdf verdict-free');
  execSync(`pdftoppm -r 50 -png -f 1 -l 1 ${pp} ${SHOTS}/pdf-voice-report`);
  assert(t.includes('cannot detect deception'), 'fixed note shown');
} };
const VOICE_NOTE_TXT = 'Voice analysis cannot detect deception. Studies of voice-stress analysis find it performs near chance. Pitch, pace, pauses and filler words change with nerves, fatigue, accent, topic and setting, so they are shown here only as neutral speaking patterns, not judgments about anyone.';
T['voice: sanitizer strips verdict sentences'] = async ({ page }) => {
  const r = await page.evaluate(() => [neutral('They met at noon. He is lying about it.'), neutral('She seemed deceptive.'), neutral('Plain sentence.')]);
  assert(r[0] === 'They met at noon.' && !VERDICT.test(r[1]) && r[2] === 'Plain sentence.', JSON.stringify(r));
  assert(await page.evaluate(() => VOICE_NOTE) === VOICE_NOTE_TXT, 'note text');
};
T['voice: no key → on-device metrics + paste transcript'] = async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('voiceConsent', '1')); await mode(page, 'voice'); await page.setInputFiles('#vFile', fx('conversation.wav')); await page.waitForSelector('#vPaste', { timeout: 30000 });
  assert((await page.textContent('#result')).includes('Speaking patterns'), 'metrics without key');
  await page.fill('#vPaste', 'Alice: Um we shipped 40 units.\nBob: I think it was 30.'); await page.click('#vUsePaste'); await page.waitForSelector('#result >> text=Bob:');
};
T['voice: records with MediaRecorder, chunks saved every 2s'] = { only: 'chromium', fn: async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('voiceConsent', '1')); await mode(page, 'voice'); await page.click('#vRec'); await page.waitForSelector('#vStop');
  await page.waitForTimeout(4600); const n = await page.evaluate(async () => (await DB.all('chunks')).length); assert(n >= 2, 'chunks ' + n);
  await page.click('#vStop'); await page.waitForSelector('#vChart', { timeout: 30000 }); assert(await page.evaluate(async () => (await DB.all('chunks')).length) === 0, 'chunks cleaned');
} };

/* ---------- iPhone portrait layout ---------- */
const phoneOnly = 'iphone';
async function layoutCheck(page, where) {
  const r = await page.evaluate(() => {
    const W = innerWidth, over = [...document.querySelectorAll('body *')].filter(e => { if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') return false; const b = e.getBoundingClientRect(); return b.width && (b.right > W + 1 || b.left < -1) && !e.closest('.pages-row,.hscroll,svg'); }).map(e => e.tagName + (e.id ? '#' + e.id : '') + '.' + e.className).slice(0, 4);
    const small = [...document.querySelectorAll('button,select,input:not([type=range]):not([type=checkbox]):not([type=file]):not([type=radio]),[role=tab]')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 43.5 && !b.closest('.pages-row')).map(b => (b.id || b.textContent.trim()).slice(0, 20)).slice(0, 5);
    return { sw: document.documentElement.scrollWidth, W, over, small };
  });
  assert(r.sw <= r.W, `${where}: horizontal overflow ${r.sw}>${r.W} ${r.over.join(' ')}`); assert(!r.over.length, `${where}: off-screen ${r.over.join(' ')}`); assert(!r.small.length, `${where}: <44pt ${r.small.join('|')}`);
}
T['iPhone: every mode fits portrait, no overflow, 44pt, safe areas, one-handed shutter'] = { only: phoneOnly, fn: async ({ page, dev }) => {
  const css = await page.evaluate(() => [...document.styleSheets].flatMap(s => [...s.cssRules].map(r => r.cssText)).join('\n'));
  for (const side of ['top', 'bottom', 'left', 'right']) assert(css.includes('safe-area-inset-' + side), 'safe-area ' + side);
  assert((await page.getAttribute('meta[name=viewport]', 'content')).includes('viewport-fit=cover'), 'viewport-fit');
  const mb = await page.$$eval('.modes button', bs => bs.map(b => { const r = b.getBoundingClientRect(); return [r.left, r.right, r.height, b.scrollWidth <= b.clientWidth + 1, innerWidth]; }));
  assert(mb.every(([l, r, h, fit, W]) => l >= 0 && r <= W && h >= 44 && fit), 'mode switcher fits ' + JSON.stringify(mb));
  const modes = await page.$$eval('.modes button', bs => bs.map(b => b.dataset.mode));
  let i = 0;
  for (const m of modes) {
    if (m === 'voice') await page.evaluate(() => localStorage.setItem('voiceConsent', '1'));
    await mode(page, m); await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(150);
    await layoutCheck(page, m);
    if (!(await page.evaluate(() => MODES[S.mode].nocam))) {
      const g = await page.$eval('#btnShutter', b => { const r = b.getBoundingClientRect(), tab = document.querySelector('.tabs').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, tabTop: tab.top, H: innerHeight, w: r.width }; });
      assert(g.bottom <= g.tabTop - 2 && g.top >= g.H * 0.4, `${m}: shutter one-handed, above tab bar without scrolling ${JSON.stringify(g)}`); assert(g.w >= 60, 'big shutter');
    }
    await shot(page, dev, `mode-${String(++i).padStart(2, '0')}-${m}`);
  }
  await page.click('[data-view=log]').catch(() => {}); await page.click('#btnSettings').catch(() => {}); await page.waitForTimeout(200); await layoutCheck(page, 'settings'); await shot(page, dev, 'mode-settings');
} };
T['iPhone: stained-glass preview + 3D viewer usable at phone size, exports via iOS share sheet'] = { only: phoneOnly, key: true, fn: async ({ page, dev }) => {
  await page.evaluate(() => { window.__noShare = false; window.__shared = []; navigator.canShare = d => !!(d && d.files); navigator.share = async d => { window.__shared.push(...d.files.map(f => ({ name: f.name, type: f.type, size: f.size }))); }; });
  await mode(page, 'glass'); await photo(page, 'flower.jpg'); await page.click('#btnAnalyze'); await page.waitForSelector('#gPrev svg [data-piece]', { timeout: 20000 });
  await layoutCheck(page, 'glass result');
  const pv = await page.$eval('#gPrev', e => { const r = e.getBoundingClientRect(); return [r.width, innerWidth]; }); assert(pv[0] >= pv[1] * 0.8 && pv[0] <= pv[1], 'glass preview near full width ' + pv);
  await page.locator('#gPrev').scrollIntoViewIfNeeded(); await page.locator('#gPrev [data-piece]').first().tap().catch(() => {});
  await shot(page, dev, 'phone-glass-preview');
  for (const b of ['#gSVG', '#gPDF', '#gCut']) { await page.click(b); }
  await page.waitForFunction(() => window.__shared.length >= 3, null, { timeout: 20000 });
  const sh = await page.evaluate(() => window.__shared); assert(sh.some(f => f.name.endsWith('.svg') && f.type === 'image/svg+xml') && sh.filter(f => f.name.endsWith('.pdf') && f.type === 'application/pdf').length === 2, 'shared ' + JSON.stringify(sh));
  assert(!(await page.evaluate(() => window.__lastDownload)), 'no download fallback when share is available');
  await openModel(page, 'box-10x20x30cm.glb'); await page.waitForSelector('#mfStats >> text=L × W × H', { timeout: 20000 }); await page.waitForTimeout(500);
  await layoutCheck(page, '3D viewer');
  const cv = await page.$eval('#mfViewer canvas', c => { const r = c.getBoundingClientRect(); return { w: r.width, h: r.height, W: innerWidth, ta: getComputedStyle(c).touchAction }; });
  assert(cv.w >= cv.W * 0.8 && cv.w <= cv.W && cv.h >= 250, '3D viewer size ' + JSON.stringify(cv)); assert(cv.ta === 'none', 'viewer owns touch gestures');
  await page.locator('#mfViewer').scrollIntoViewIfNeeded(); await shot(page, dev, 'phone-3d-viewer');
  await page.click('#mfPDF'); await page.waitForFunction(() => window.__shared.some(f => f.name.endsWith('.pdf') && /dim|scan|model/i.test(f.name)) || window.__shared.length >= 4, null, { timeout: 20000 });
} };

(async () => {
  const t0 = Date.now();
  for (const dev of DEVS) {
    if (onlyDev && !onlyDev.test(dev.name)) continue;
    const browser = await dev.type.launch(dev.launch || {});
    for (const [name, def] of Object.entries(T)) {
      if (only && !only.test(name)) continue; const d = typeof def === 'function' ? { fn: def } : def; if (d.only && !dev.name.includes(d.only)) continue;
      let env; const st = Date.now();
      try { env = await newPage(browser, dev, d); await d.fn({ ...env, dev, browser }); if (env.errors.length) throw new Error('page errors: ' + env.errors.join(' | ')); results.push({ dev: dev.name, name, ok: true, ms: Date.now() - st }); process.stdout.write(`✓ ${dev.name} · ${name} (${Date.now() - st} ms)\n`); }
      catch (e) { results.push({ dev: dev.name, name, ok: false, err: e.message }); process.stdout.write(`✗ ${dev.name} · ${name}\n   ${e.message.split('\n').slice(0, 4).join('\n   ')}\n`); try { env && await env.page.screenshot({ path: `/tmp/fail-${dev.name}-${name.replace(/\W+/g, '_').slice(0, 40)}.png` }); } catch (_) {} }
      finally { try { env && await env.ctx.close(); } catch (_) {} }
    }
    await browser.close();
  }
  const pass = results.filter(r => r.ok).length; console.log(`\n${pass}/${results.length} passed in ${Math.round((Date.now() - t0) / 1000)} s`);
  fs.writeFileSync('/tmp/scanlab-results.json', JSON.stringify(results, null, 1)); process.exit(pass === results.length ? 0 : 1);
})();
