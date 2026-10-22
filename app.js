/* Scan Lab — core: camera, modes, food/materials analysis, food log, history, settings. */
const APP_VERSION = 'v6';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r1 = n => Math.round(n * 10) / 10;
const fmtN = (n, unit) => { const d = unit === 'kcal' || unit === 'mg' || n >= 100 ? 0 : n >= 10 ? 0 : 1; return (+n).toFixed(d).replace(/\.0$/, ''); };
const fmtR = (r, unit) => { if (!r) return '—'; const a = fmtN(r[0], unit), b = fmtN(r[1], unit); return (a === b ? a : a + '–' + b) + (unit ? ' ' + unit : ''); };
const todayStr = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const fmtWhen = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/* ---------- toast with undo ---------- */
let toastTimer;
function toast(msg, undo, ms = 6000) {
  const t = $('#toast'); $('#toastText').textContent = msg; const u = $('#toastUndo');
  u.hidden = !undo; u.onclick = async () => { t.hidden = true; clearTimeout(toastTimer); if (undo) await undo(); };
  t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, undo ? ms : 3000);
}

/* ---------- files ---------- */
function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  window.__lastDownload = { name, size: blob.size, type: blob.type };
}
async function shareOrDownload(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  try { const f = new File([blob], name, { type: blob.type || type }); if (navigator.canShare && navigator.canShare({ files: [f] }) && !window.__noShare) { await navigator.share({ files: [f], title: name }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  download(name, blob, type);
}
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Couldn’t read that image. Try a JPEG or PNG.')); i.src = src; }); }
/* Downscale any image source (File/Blob, dataURL, <video>) to a JPEG dataURL with the long side ≤ max. */
async function toJPEG(src, max = 1280, q = 0.82) {
  let el, w, h, url;
  if (src instanceof HTMLVideoElement) { el = src; w = src.videoWidth; h = src.videoHeight; }
  else { url = src instanceof Blob ? URL.createObjectURL(src) : src; el = await loadImg(url); w = el.naturalWidth; h = el.naturalHeight; }
  if (!w || !h) throw new Error('The camera hasn’t delivered a frame yet. Try again.');
  const s = Math.min(1, max / Math.max(w, h)), c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(el, 0, 0, c.width, c.height);
  if (url && src instanceof Blob) URL.revokeObjectURL(url);
  return c.toDataURL('image/jpeg', q);
}
const thumbOf = src => toJPEG(src, 200, 0.7);

/* ---------- state ---------- */
const MODES = {
  auto: { icon: '✨', name: 'Auto', desc: 'Point at anything — Grok works out if it’s food or an object.', btn: 'Analyze', ai: true, g: 0, rec: true, disc: 'AI estimate from a photo — not a lab test.' },
  food: { icon: '🍽', name: 'Food & calories', desc: 'Calories, macros and allergens as estimated ranges.', btn: 'Analyze food', ai: true, g: 0, disc: 'AI estimate from a photo — weigh portions for accuracy.' },
  materials: { icon: '🧪', name: 'What’s it made of', desc: 'Materials, compounds, properties, safety, recycling.', btn: 'Analyze materials', ai: true, g: 0, disc: 'AI estimate from a photo — not a chemical analysis.' },
  glass: { icon: '🪟', name: 'Stained glass', desc: 'Turn a photo into a stained-glass pattern you can print.', btn: 'Make stained-glass pattern', ai: false, g: 1 },
  measure: { icon: '📏', name: 'Measure size', desc: 'Size from a photo with a coin, card or paper beside it.', btn: 'Measure', ai: false, multi: true, g: 1 },
  count: { icon: '🔢', name: 'Count items', desc: 'Counts bolts, pills, tiles… tap to fix the count.', btn: 'Count', ai: false, g: 1 },
  color: { icon: '🎨', name: 'Color match', desc: 'Tap to sample colors — names, paint and glass matches.', btn: 'Match colors', ai: false, g: 1 },
  defect: { icon: '🔍', name: 'Damage check', desc: 'Cracks, rust, wear and burns — up to 4 photos.', btn: 'Check for damage', ai: true, multi: true, g: 2, disc: 'AI visual estimate — not a certified inspection.' },
  compare: { icon: '⇆', name: 'Compare photos', desc: 'Before/after or A vs B — or two saved scans.', btn: 'Compare', ai: false, multi: true, g: 2 },
  docs: { icon: '🧾', name: 'Receipts & docs', desc: 'Receipts, business cards and documents to text, CSV or contact.', btn: 'Extract text', ai: true, multi: true, g: 3 },
  voice: { icon: '🎙', name: 'Voice recorder', desc: 'Record a conversation: transcript, speakers, summary.', btn: 'Analyze', ai: false, nocam: true, g: 3 },
};
const MODE_GROUPS = ['Identify', 'Make & measure', 'Check & compare', 'Paper & audio'];
for (const m of Object.values(MODES)) m.help = m.desc;
const S = { mode: localStorage.getItem('scanMode') || 'auto', photos: [], scale: null, busy: null, live: false, stream: null, view: 'scan' };
if (!MODES[S.mode]) S.mode = 'auto';

/* ---------- camera ---------- */
const cam = () => $('#cam');
async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { camMsg('No live camera here — use the shutter (opens the camera app) or Photos.', false); return false; }
  try {
    stopCamera();
    const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
    S.stream = st; cam().srcObject = st; await Promise.race([cam().play().catch(() => {}), new Promise(r => setTimeout(r, 1500))]);
    S.live = true; localStorage.setItem('camOK', '1'); showLive(); return true;
  } catch (e) {
    S.live = false;
    camMsg(e && e.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in Settings → Safari → Camera, or use Photos.' : 'Camera unavailable (' + esc(e && e.name || e) + '). Use the shutter or Photos instead.', true);
    return false;
  }
}
function stopCamera() { if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; } S.live = false; }
function camMsg(text, retry) { if (!S.photos.length) { $('#still').hidden = true; $('#retakeHint').hidden = true; } $('#camMsg').hidden = false; $('#camMsgText').textContent = text; $('#btnStartCam').hidden = !retry; $('#btnStartCam').textContent = retry ? 'Try again' : 'Start camera'; }
function showLive() { $('#still').hidden = true; $('#retakeHint').hidden = true; $('#camMsg').hidden = true; cam().hidden = false; }
function showStill(src) { $('#still').src = src; $('#still').hidden = false; $('#camMsg').hidden = true; cam().hidden = true; }
/* one-time hints */
const hintOn = k => !localStorage.getItem('hint:' + k), hintSeen = k => { localStorage.setItem('hint:' + k, '1'); const w = $('#' + k); if (w) w.hidden = true; };

async function onShutter() {
  if (S.live && cam().videoWidth) { try { addPhoto(await toJPEG(cam())); } catch (e) { toast(e.message); } }
  else $('#fileCam').click();
}
async function onFile(input, isScale) {
  const f = input.files && input.files[0]; input.value = ''; if (!f) return;
  try { const d = await toJPEG(f); if (isScale) setScale(d); else addPhoto(d); } catch (e) { toast(e.message); }
}
function addPhoto(d) {
  const m = MODES[S.mode]; window.__adds = (window.__adds || 0) + 1;
  if (m.multi && measureWants3D()) { if (S.photos.length >= 3) S.photos[2] = d; else S.photos.push(d); }
  else if (S.mode === 'docs') { if (S.photos.length >= 10) { toast('10 pages max per document'); return; } S.photos.push(d); }
  else if (S.mode === 'defect') { if (S.photos.length >= 4) { toast('4 photos max'); return; } S.photos.push(d); }
  else if (S.mode === 'compare') { if (S.photos.length >= 2) S.photos[1] = d; else S.photos.push(d); }
  else S.photos = [d];
  stopCamera(); showStill(d); renderPages(); updateButtons(); hintSeen('welcome'); fitStage();
  $('#result').innerHTML = '';
  if (S.mode === 'docs' && S.photos.length === 1) toast('Page 1 added — tap ＋ Page for more pages, or Extract text');
  if (S.mode === 'compare' && S.photos.length === 1) toast('Photo 1 added — now take or pick photo 2');
}
function retake() {
  if (S.mode === 'docs' || S.mode === 'defect' || S.mode === 'compare' || measureWants3D()) { /* keep pages; go live to add the next page/view (✕ on a thumbnail removes one) */ }
  else S.photos = [];
  renderPages(); updateButtons(); goLive(); fitStage();
}
function camNeeded() { return !(S.mode === 'voice' || (S.mode === 'measure' && measureSub() === 'file')); }
function goLive() { if (!camNeeded()) { stopCamera(); return; } if (localStorage.getItem('camOK') || S.stream) startCamera(); else { $('#still').hidden = true; $('#retakeHint').hidden = true; cam().hidden = true; camMsg('Use the camera or pick a photo.', true); $('#btnStartCam').textContent = 'Start camera'; } }
function setScale(d) { S.scale = d; $('#scaleThumb').src = d || ''; $('#scaleRow').hidden = !d; }
function renderPages() {
  const row = $('#pagesRow'), pm = S.mode === 'docs' || S.mode === 'defect' || S.mode === 'compare'; const show = (pm || measureWants3D()) && S.photos.length > 0;
  row.hidden = !show; requestAnimationFrame(fitStage); if (!show) { row.innerHTML = ''; return; }
  const labels = S.mode === 'docs' ? S.photos.map((_, i) => 'p' + (i + 1)) : S.mode === 'defect' ? S.photos.map((_, i) => 'Photo ' + (i + 1)) : S.mode === 'compare' ? ['1', '2'] : ['Front', 'Side', 'Top'];
  row.innerHTML = S.photos.map((p, i) => `<div class="pg"><img src="${p}" alt="${labels[i]}"><em>${labels[i]}</em><button data-rm="${i}" aria-label="Remove ${labels[i]}">✕</button></div>`).join('') +
    (S.mode === 'docs' || (S.mode === 'defect' && S.photos.length < 4) ? `<button class="pill" id="btnAddPage">＋ ${S.mode === 'docs' ? 'Page' : 'Photo'}</button>` : S.mode === 'defect' ? '' : S.mode === 'compare' ? (S.photos.length < 2 ? `<span class="muted small" style="align-self:center">Next: photo 2</span>` : '') : S.photos.length < 3 ? `<span class="muted small" style="align-self:center">Next: ${labels[S.photos.length]} view</span>` : '');
  $$('[data-rm]', row).forEach(b => b.onclick = () => { S.photos.splice(+b.dataset.rm, 1); renderPages(); updateButtons(); if (S.photos.length) showStill(S.photos[S.photos.length - 1]); else goLive(); });
  const ap = $('#btnAddPage'); if (ap) ap.onclick = () => goLive();
}
function updateButtons() {
  const m = MODES[S.mode], b = $('#btnAnalyze');
  b.textContent = m.btn; b.disabled = !S.photos.length || !!S.busy || (S.mode === 'compare' && S.photos.length < 2);
  const scaleOK = S.mode === 'auto' || S.mode === 'food' || S.mode === 'materials'; $('#scaleOpt').hidden = !scaleOK; $('#btnScale').hidden = !scaleOK;
  if (!scaleOK) setScale(null);
  $('#moreOpts').hidden = !(m.ai || S.mode === 'measure') || S.mode === 'docs'; $('#hint').closest('.field').hidden = false;
  $('#aiDisclaimer').hidden = !m.disc; if (m.disc) $('#aiDisclaimer').textContent = m.disc;
  $('#keyNote').hidden = !(m.ai && !aiHasKey());
  const keep = S.mode === 'docs' || S.mode === 'defect' || S.mode === 'compare' || measureWants3D();
  $('#btnRetake').hidden = !S.photos.length; $('#ccSpacer').hidden = !!S.photos.length; $('#btnRetake').textContent = keep ? (S.mode === 'docs' ? '＋ Page' : '＋ Photo') : '↺ Retake';
  $('#modeIcon').textContent = m.icon; $('#modeName').textContent = m.name; $('#modeDesc').textContent = m.desc;
  $('.dock').hidden = !S.photos.length; // the main action appears, docked above the tab bar, once there is a photo
  if (S.mode === 'measure') { $('#modeHelp').hidden = false; measureSetupHelp(); } else { $('#modeHelp').hidden = true; $('#modeHelp').textContent = ''; }
}
function renderModeSheet() {
  $('#modeGroups').innerHTML = MODE_GROUPS.map((g, gi) => `<h3 class="mg-h">${g}</h3><div class="mode-grid">${Object.entries(MODES).filter(([, m]) => m.g === gi).map(([k, m]) => `<button class="mode-tile" data-mode="${k}" aria-pressed="${k === S.mode}"><span class="mi" aria-hidden="true">${m.icon}</span><span class="mt"><b>${m.name}${m.rec ? ' <em class="rec">Recommended</em>' : ''}</b><span>${m.desc}</span></span>${m.ai ? '<span class="tag">Grok</span>' : ''}</button>`).join('')}</div>`).join('');
  $$('#modeGroups [data-mode]').forEach(b => b.onclick = () => { closeSheet('#sheetMode'); setMode(b.dataset.mode); });
}
function openModes() { renderModeSheet(); openSheet('#sheetMode'); }
/* Keep the shutter above the tab bar, in thumb reach, without scrolling (iPhone SE → Pro Max). */
function fitStage() {
  const st = $('.stage'), tabs = $('.tabs'); if (!st || !st.offsetParent) return;
  const top = st.getBoundingClientRect().top + scrollY, cc = $('.cam-controls'), ch = cc ? cc.offsetHeight + 20 : 92;
  const dk = $('.dock'), pr = $('#pagesRow'), dh = (dk && !dk.hidden ? dk.offsetHeight + 4 : 0) + (pr && !pr.hidden ? pr.offsetHeight : 0), avail = innerHeight - top - (tabs ? tabs.offsetHeight : 60) - ch - dh - 6;
  st.style.maxHeight = Math.round(Math.max(200, Math.min(avail, innerHeight * 0.62))) + 'px';
}
addEventListener('resize', () => requestAnimationFrame(fitStage)); addEventListener('orientationchange', () => setTimeout(fitStage, 300));
function setMode(mode) {
  if (!MODES[mode]) return; const prev = S.mode; S.mode = mode; localStorage.setItem('scanMode', mode);
  $$('#modeGroups [data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  const ML = ['docs', 'measure', 'defect', 'compare'], wasMulti = ML.includes(prev), nowMulti = ML.includes(mode);
  if (wasMulti && S.photos.length > 1 && !(nowMulti && prev === mode)) S.photos = S.photos.slice(-1);
  $('#result').innerHTML = ''; renderPages(); updateButtons(); applyCamArea(); compareHistCard();
}
/* ---------- shared result action bar: Save · Share / export · New photo ---------- */
function actBar({ save = null, saved = false, auto = false, exports = [], extra = '', newLabel = 'New photo' } = {}) {
  const sv = save ? `<button class="primary" id="${save}">${saved ? 'Saved ✓' : 'Save to History'}</button>` : auto ? '<span class="saved-note">✓ Saved to History</span>' : '';
  const ex = exports.length ? `<details class="act-more"><summary class="pill">⤴ Share / export</summary><div class="act-menu">${exports.map(([id, l]) => `<button class="pill" id="${id}">${l}</button>`).join('')}</div></details>` : '';
  return `<div class="card actbar" data-actbar><div class="actbar-row">${sv}${ex}<button class="pill" data-newphoto>${S.mode === 'voice' ? '🎙 New recording' : '📷 ' + newLabel}</button></div>${extra ? `<div class="actbar-extra">${extra}</div>` : ''}</div>`;
}
function newPhoto() {
  if (!$('#sheetDetail').hidden) closeSheet('#sheetDetail');
  if (S.view !== 'scan') setView('scan');
  S.photos = []; setScale(null); $('#result').innerHTML = ''; measure3dDisposeAll(); renderPages(); updateButtons(); applyCamArea(); compareHistCard(); window.scrollTo(0, 0);
}
function compareHistCard() { if (S.mode !== 'compare' || S.photos.length >= 2 || $('#result').children.length) return; if (!camNeeded()) return; $('#result').innerHTML = `<div class="card"><div class="row gap wrap"><button class="pill" id="btnCmpHist">📚 Compare two saved scans</button><span class="muted small" style="align-self:center">e.g. two Measure scans compare by dimensions</span></div></div>`; $('#btnCmpHist').onclick = () => comparePickHistory($('#result')); }
function applyCamArea() {
  const need = camNeeded(); $('#camArea').hidden = !need;
  if (!need) { stopCamera(); if (S.mode === 'voice') voiceOpen($('#result')); else measureFileOpen($('#result')); }
  else if (S.view === 'scan' && !S.photos.length && !S.live) goLive();
  else if (S.photos.length) showStill(S.photos[S.photos.length - 1]);
  fitStage(); requestAnimationFrame(fitStage);
}

/* ---------- analysis (auto / food / materials) ---------- */
async function analyze() {
  if (!S.photos.length) return;
  if (S.mode === 'glass') return glassOpen($('#result'), { image: S.photos[0] });
  if (S.mode === 'measure') return measureOpen($('#result'), { photos: S.photos.slice(), hint: $('#hint').value.trim() });
  if (S.mode === 'docs') return docsAnalyze($('#result'), S.photos.slice());
  if (S.mode === 'defect') return defectOpen($('#result'), { photos: S.photos.slice(), hint: $('#hint').value.trim() });
  if (S.mode === 'count') return countOpen($('#result'), { image: S.photos[0], hint: $('#hint').value.trim() });
  if (S.mode === 'color') return colorOpen($('#result'), { image: S.photos[0] });
  if (S.mode === 'compare') { if (S.photos.length < 2) return toast('Add a second photo first'); return compareOpen($('#result'), { a: S.photos[0], b: S.photos[1], hint: $('#hint').value.trim() }); }
  const out = $('#result'), b = $('#btnAnalyze'), hint = $('#hint').value.trim();
  const ctl = new AbortController(); S.busy = ctl; b.disabled = true; b.innerHTML = '<span class="spinner"></span>Analyzing…';
  out.innerHTML = `<div class="card"><span class="spinner"></span>Grok is looking at your photo… <button class="pill" id="btnCancel">Cancel</button></div>`;
  $('#btnCancel').onclick = () => ctl.abort();
  try {
    const content = [{ type: 'text', text: scanPrompt(S.mode, hint, !!S.scale) }, imgPart(S.photos[0])];
    if (S.scale) content.push(imgPart(S.scale));
    const raw = await aiChat([{ role: 'system', content: 'You analyze photos and answer with strict JSON only.' }, { role: 'user', content }], { signal: ctl.signal });
    const result = validateScan(parseJSONLoose(raw));
    const scan = { id: uid(), at: Date.now(), mode: S.mode, kind: result.kind, title: result.title, hint, image: S.photos[0], image2: S.scale, thumb: await thumbOf(S.photos[0]), result, model: aiCfg().model };
    if (result.kind !== 'unknown') await DB.put('scans', scan);
    renderScan(out, scan);
  } catch (e) { renderError(out, e, analyze); }
  finally { S.busy = null; b.textContent = MODES[S.mode].btn; b.disabled = !S.photos.length; }
}
function renderError(out, e, retry) {
  const k = e && e.kind; const msg = e && e.message || String(e);
  out.innerHTML = `<div class="card err" role="alert"><b>${k === 'nokey' ? 'API key needed' : k === 'offline' ? 'Offline' : k === 'badjson' ? 'Unexpected AI answer' : k === 'cancel' ? 'Cancelled' : 'Something went wrong'}</b><p>${esc(msg)}</p>
    <div class="row gap">${k === 'nokey' || k === 'auth' || k === 'config' ? '<button class="primary" data-act="settings">Set up key (1 min)</button>' : ''}<button class="pill" data-act="retry">Try again</button></div>
    ${e && e.raw ? `<details><summary class="muted small">Show raw answer</summary><pre class="small" style="white-space:pre-wrap">${esc(e.raw)}</pre></details>` : ''}</div>`;
  const s = $('[data-act=settings]', out); if (s) s.onclick = openSettings;
  $('[data-act=retry]', out).onclick = retry;
}

const scaleItem = (it, k) => { const f = it.base_grams ? it.grams / it.base_grams : 1; return [it[k][0] * f, it[k][1] * f]; };
function foodTotals(items) { const t = {}; for (const [k] of NUTRI) t[k] = items.reduce((a, it) => { const v = scaleItem(it, k); return [a[0] + v[0], a[1] + v[1]]; }, [0, 0]); return t; }
const nutriGrid = (vals, id) => `<div class="nutri" ${id != null ? `data-ng="${id}"` : ''}>${NUTRI.map(([k, u, l]) => `<div data-k="${k}"><span>${l}</span><b>${fmtR(vals[k], u)}</b></div>`).join('')}</div>`;
const confBadge = c => `<span class="badge conf-${c}">${c} confidence</span>`;
const formula = f => esc(f).replace(/([A-Za-z)\]])(\d+)/g, '$1<sub>$2</sub>');
const pct = p => p ? (Math.round(p[0]) === Math.round(p[1]) ? Math.round(p[0]) + '%' : Math.round(p[0]) + '–' + Math.round(p[1]) + '%') : '';

function renderScan(out, scan) {
  const r = scan.result;
  if (r.kind === 'unknown') { out.innerHTML = `<div class="card warn"><b>${esc(r.title)}</b><p>${esc(r.message)}</p></div>${actBar({ newLabel: 'Try another photo' })}`; return; }
  if (r.kind === 'food') return renderFood(out, scan);
  if (r.kind === 'materials') return renderMaterials(out, scan);
  if (r.kind === 'glass') return glassOpen(out, { saved: scan });
  if (r.kind === 'measure') return measureOpen(out, { saved: scan });
  if (r.kind === 'doc') return docsRender(out, scan);
  if (r.kind === 'voice') return voiceOpen(out, scan);
  if (r.kind === 'defect') return defectRender(out, scan);
  if (r.kind === 'count') return countOpen(out, { saved: scan });
  if (r.kind === 'color') return colorOpen(out, { saved: scan });
  if (r.kind === 'compare') return compareOpen(out, { saved: scan });
}
function renderFood(out, scan) {
  const r = scan.result; let saveT;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => DB.put('scans', scan).catch(e => toast('Couldn’t save: ' + e.message)), 300); };
  out.innerHTML = `<div class="card"><div class="res-head"><h2>${esc(r.title)}</h2>${confBadge(r.confidence)}</div>
    ${r.confidence_note ? `<p class="muted small">${esc(r.confidence_note)}</p>` : ''}
    ${r.items.map((it, i) => `<div class="item" data-i="${i}"><div class="item-head"><span>${esc(it.name)}</span><span class="badge conf-${it.confidence}">${it.confidence}</span></div>
      <div class="portion"><label>Grams <input type="number" inputmode="decimal" min="0" step="5" data-g="${i}" value="${Math.round(it.grams)}" aria-label="${esc(it.name)} grams"></label>
      <label>Servings <input type="number" inputmode="decimal" min="0" step="0.25" data-s="${i}" value="${r1(it.grams / it.serving_grams)}" aria-label="${esc(it.name)} servings"></label>
      <span class="muted small">1 serving ≈ ${Math.round(it.serving_grams)} g${it.serving_desc ? ' (' + esc(it.serving_desc) + ')' : ''}</span></div>
      ${nutriGrid(Object.fromEntries(NUTRI.map(([k]) => [k, scaleItem(it, k)])), i)}
      ${it.ingredients.length ? `<div class="chips">${it.ingredients.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
      ${it.allergens.length ? `<div class="chips">${it.allergens.map(x => `<span class="chip allergen">⚠︎ ${esc(x)}</span>`).join('')}</div>` : ''}</div>`).join('')}
  </div>
  <div class="card totals"><div class="res-head"><h3 style="margin:0">Total</h3><span class="muted small" id="totG"></span></div>${nutriGrid(foodTotals(r.items), 'tot')}
    ${r.allergens.length ? `<p class="small">Likely allergens: ${r.allergens.map(esc).join(', ')}</p>` : ''}
    <button class="primary big" id="btnLogAdd">＋ Add to today’s food log</button></div>
  ${r.notes ? `<p class="muted small">${esc(r.notes)}</p>` : ''}
  <p class="disclaimer">AI estimates from a photo, not a lab analysis. Weigh portions for accuracy — editing grams rescales everything.</p>${actBar({ auto: true })}`;
  const refresh = () => {
    r.items.forEach((it, i) => { const g = $(`[data-ng="${i}"]`, out); NUTRI.forEach(([k, u]) => { $(`[data-k=${k}] b`, g).textContent = fmtR(scaleItem(it, k), u); }); });
    const tg = $('[data-ng=tot]', out), t = foodTotals(r.items); NUTRI.forEach(([k, u]) => { $(`[data-k=${k}] b`, tg).textContent = fmtR(t[k], u); });
    $('#totG', out).textContent = Math.round(r.items.reduce((a, it) => a + it.grams, 0)) + ' g';
  };
  refresh();
  $$('[data-g]', out).forEach(inp => inp.oninput = () => { const it = r.items[+inp.dataset.g], v = Math.max(0, +inp.value || 0); it.grams = v; $(`[data-s="${inp.dataset.g}"]`, out).value = r1(v / it.serving_grams); refresh(); save(); });
  $$('[data-s]', out).forEach(inp => inp.oninput = () => { const it = r.items[+inp.dataset.s], v = Math.max(0, +inp.value || 0); it.grams = v * it.serving_grams; $(`[data-g="${inp.dataset.s}"]`, out).value = Math.round(it.grams); refresh(); save(); });
  $('#btnLogAdd', out).onclick = async () => {
    const date = todayStr(), entries = r.items.filter(it => it.grams > 0).map(it => ({ id: uid(), date, at: Date.now(), scanId: scan.id, name: it.name, grams: Math.round(it.grams), ...Object.fromEntries(NUTRI.map(([k]) => [k, scaleItem(it, k)])) }));
    for (const e of entries) await DB.put('log', e);
    const t = foodTotals(r.items);
    toast(`Added ${entries.length} item${entries.length === 1 ? '' : 's'} · ${fmtR(t.calories, 'kcal')}`, async () => { for (const e of entries) await DB.del('log', e.id); renderLog(); toast('Removed from log'); });
    renderLog();
  };
}
function renderMaterials(out, scan) {
  const r = scan.result;
  out.innerHTML = `<div class="card"><div class="res-head"><h2>${esc(r.title)}</h2>${confBadge(r.confidence)}</div>
    ${r.object && r.object !== r.title ? `<p>${esc(r.object)}</p>` : ''}${r.confidence_note ? `<p class="muted small">${esc(r.confidence_note)}</p>` : ''}
    ${r.materials.length ? `<h3>Likely materials</h3><table><tr><th>Material</th><th>Share</th><th>Where</th></tr>${r.materials.map(m => `<tr><td>${esc(m.name)}</td><td>${pct(m.percent)}</td><td>${esc(m.where)}</td></tr>`).join('')}</table>` : ''}
    ${r.compounds.length ? `<h3>Main compounds</h3><table><tr><th>Compound</th><th>Formula</th><th>Approx.</th></tr>${r.compounds.map(c => `<tr><td>${esc(c.name)}${c.notes ? `<div class="muted small">${esc(c.notes)}</div>` : ''}</td><td class="formula">${formula(c.formula)}</td><td>${pct(c.percent)}</td></tr>`).join('')}</table>` : ''}
    ${r.properties.length ? `<h3>Physical properties</h3><table>${r.properties.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.value)}${p.notes ? `<div class="muted small">${esc(p.notes)}</div>` : ''}</td></tr>`).join('')}</table>` : ''}
    ${r.safety.length ? `<h3>Safety &amp; handling</h3><ul class="tight">${r.safety.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    ${r.recycling.length ? `<h3>Recycling</h3><ul class="tight">${r.recycling.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    ${r.notes ? `<p class="muted small">${esc(r.notes)}</p>` : ''}</div>
  <p class="disclaimer">AI visual estimate, not a chemical analysis — a real reading needs a spectrometer (e.g. NIR, or XRF for metals).</p>${actBar({ auto: true })}`;
}

/* ---------- food log ---------- */
let logDay = todayStr();
async function renderLog() {
  const all = (await DB.all('log')).filter(e => e.date === logDay).sort((a, b) => a.at - b.at);
  const isToday = logDay === todayStr(); const d = new Date(logDay + 'T12:00');
  $('#logDate').textContent = isToday ? 'Today' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  $('#logNext').disabled = isToday;
  const t = {}; for (const [k] of NUTRI) t[k] = all.reduce((a, e) => [a[0] + (e[k] || [0, 0])[0], a[1] + (e[k] || [0, 0])[1]], [0, 0]);
  $('#logTotals').innerHTML = `<div class="res-head"><b>${all.length} item${all.length === 1 ? '' : 's'}</b><span class="muted small">estimated ranges</span></div>${nutriGrid(t)}`;
  $('#logList').innerHTML = all.length ? all.map(e => `<div class="log-item"><div class="meta"><b>${esc(e.name)}</b><br><span>${e.grams} g · ${fmtR(e.calories, 'kcal')} · P ${fmtR(e.protein_g, 'g')} · C ${fmtR(e.carbs_g, 'g')} · F ${fmtR(e.fat_g, 'g')}</span></div><button class="pill danger" data-del="${e.id}" aria-label="Delete ${esc(e.name)}">Delete</button></div>`).join('')
    : `<div class="card empty"><p>Nothing logged ${isToday ? 'today' : 'this day'}. Scan a meal in <b>Food &amp; calories</b>, then tap “Add to today’s food log”.</p><button class="primary" data-food-scan>🍽 Scan food</button></div>`;
  const fs = $('[data-food-scan]', $('#logList')); if (fs) fs.onclick = () => { setView('scan'); setMode('food'); };
  $$('[data-del]', $('#logList')).forEach(b => b.onclick = async () => { const e = all.find(x => x.id === b.dataset.del); await DB.del('log', e.id); renderLog(); toast('Deleted ' + e.name, async () => { await DB.put('log', e); renderLog(); }); });
}
const shiftDay = n => { const d = new Date(logDay + 'T12:00'); d.setDate(d.getDate() + n); logDay = todayStr(d); renderLog(); };

/* ---------- history ---------- */
function scanSummary(s) {
  const r = s.result || {};
  if (r.kind === 'food') return fmtR(foodTotals(r.items).calories, 'kcal') + ' · ' + r.items.length + ' item' + (r.items.length === 1 ? '' : 's');
  if (r.kind === 'materials') return (r.materials[0] && r.materials[0].name) || (r.compounds[0] && r.compounds[0].name) || 'Materials';
  if (r.kind === 'glass') return r.stats ? r.stats.pieces + ' pieces · ' + r.stats.difficulty : 'Pattern';
  if (r.kind === 'measure') return measureSummary(r);
  if (r.kind === 'doc') return docSummary(r);
  if (r.kind === 'defect') return defectSummary(r);
  if (r.kind === 'count') return (r.points || []).length + ' ' + (r.item || 'items') + (r.method === 'grok' ? ' · Grok' : ' · on-device');
  if (r.kind === 'color') return colorSummary(r);
  if (r.kind === 'compare') return compareSummary(r);
  if (r.kind === 'voice') return mmss(r.durMs) + ' · ' + (r.metrics || []).length + ' speaker' + ((r.metrics || []).length === 1 ? '' : 's');
  return '';
}
const KIND_ICON = { food: '🍽', materials: '🧪', glass: '🪟', measure: '📏', doc: '📄', voice: '🎙', defect: '🔍', count: '🔢', color: '🎨', compare: '⇆' };
async function renderHistory() {
  const all = (await DB.all('scans')).sort((a, b) => b.at - a.at);
  $('#histList').innerHTML = all.length ? all.map(s => `<div class="hist-item"><button class="hist-open" data-open="${s.id}"><img src="${s.thumb || ''}" alt=""><div class="meta"><b>${KIND_ICON[s.kind] || ''} ${esc(s.title)}</b><span>${fmtWhen(s.at)} · ${esc(scanSummary(s))}</span></div></button><button class="pill danger" data-hdel="${s.id}" aria-label="Delete ${esc(s.title)}">Delete</button></div>`).join('')
    : '<div class="card empty"><p>No scans yet. Everything you scan, measure or make is saved here.</p><button class="primary" data-go="scan">📷 Start a scan</button></div>';
  $$('[data-open]').forEach(b => b.onclick = () => openDetail(all.find(s => s.id === b.dataset.open)));
  $$('[data-hdel]').forEach(b => b.onclick = async () => { const s = all.find(x => x.id === b.dataset.hdel); await DB.del('scans', s.id); renderHistory(); if (S.view === 'receipts') renderReceipts(); toast('Deleted “' + s.title + '”', async () => { await DB.put('scans', s); renderHistory(); renderReceipts(); }); });
}
function openDetail(s) {
  $('#detailTitle').textContent = s.title; $('#detailImg').src = s.image || s.thumb || ''; $('#detailImg').hidden = !(s.image || s.thumb) || ['glass', 'measure', 'voice', 'defect', 'count', 'color', 'compare'].includes(s.kind);
  openSheet('#sheetDetail'); renderScan($('#detailBody'), s);
}
async function exportJSON() {
  const scans = (await DB.all('scans')).map(({ image, image2, pages, audio, marked, ...rest }) => (rest.result && rest.result.frames ? { ...rest, result: { ...rest.result, frames: undefined } } : rest)); // photos stay on device; thumbnails included
  const data = { app: 'Scan Lab', version: APP_VERSION, exportedAt: new Date().toISOString(), note: 'Exports never include your API key or full-size photos.', scans, foodLog: await DB.all('log') };
  const txt = JSON.stringify(data, null, 2);
  if (/xai-|sk-/.test(aiCfg().key) && aiCfg().key && txt.includes(aiCfg().key)) throw new Error('refusing to export key');
  await shareOrDownload('scan-lab-export-' + todayStr() + '.json', txt, 'application/json'); toast('Exported ' + scans.length + ' scans');
}

/* ---------- sheets / settings ---------- */
function openSheet(sel) { const s = $(sel); s.hidden = false; s.onclick = e => { if (e.target === s || e.target.closest('[data-close]')) closeSheet(sel); }; }
function closeSheet(sel) { $(sel).hidden = true; if (sel === '#sheetDetail') { $('#detailBody').innerHTML = ''; measure3dDisposeAll(); $$('audio').forEach(x => x.pause()); } }
function openSettings() {
  const c = aiCfg(); $('#setProvider').value = c.provider || 'xai'; $('#setBase').value = c.base; $('#setModel').value = c.model; $('#setKey').value = c.key; $('#setWhisper').value = c.whisperKey || '';
  $('#pnKeyBox').hidden = !pencilNotesKey(); $('#testResult').hidden = true; $('#btnClearAI').hidden = !c.key; $('#verLine').textContent = 'Scan Lab ' + APP_VERSION; openSheet('#sheetSettings');
}
const readSettings = () => ({ provider: $('#setProvider').value, base: $('#setBase').value.trim(), model: $('#setModel').value.trim(), key: $('#setKey').value.trim(), whisperKey: $('#setWhisper').value.trim() });
async function testAI() {
  const out = $('#testResult'); out.hidden = false; out.textContent = 'Testing…';
  try {
    const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); g.fillStyle = '#e33'; g.fillRect(0, 0, 32, 32);
    const raw = await aiChat([{ role: 'user', content: [{ type: 'text', text: 'Reply with JSON {"ok":true,"color":"<main color of the image>"}' }, imgPart(c.toDataURL('image/jpeg'))] }], { cfg: readSettings(), timeout: 45000 });
    const j = parseJSONLoose(raw); out.textContent = '✅ Works — the model can see images' + (j.color ? ' (it saw “' + String(j.color).slice(0, 20) + '”)' : '') + '.';
  } catch (e) { out.textContent = '❌ ' + e.message; }
}

/* ---------- views ---------- */
function setView(v) {
  S.view = v; $$('.view').forEach(s => s.hidden = s.id !== 'view-' + v);
  const tv = v === 'receipts' ? 'history' : v; $$('.tabs button').forEach(b => b.dataset.view === tv ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  if (v === 'scan') requestAnimationFrame(fitStage);
  if (v === 'scan') { if (!S.photos.length) goLive(); } else { stopCamera(); voiceStopIfIdle(); }
  if (v === 'log') renderLog(); if (v === 'history') renderHistory(); if (v === 'receipts') renderReceipts();
  window.scrollTo(0, 0);
}

function init() {
  document.addEventListener('click', e => { const v = e.target.closest('[data-go]'); if (v) setView(v.dataset.go); const n = e.target.closest('[data-newphoto]'); if (n) newPhoto(); });
  $$('.tabs button').forEach(b => b.onclick = () => setView(b.dataset.view));
  $('#btnMode').onclick = openModes; $('#btnRetake').onclick = retake; $('#btnKeyNote').onclick = openSettings;
  if (hintOn('welcome')) $('#welcome').hidden = false;
  $('#btnStartCam').onclick = startCamera; $('#btnShutter').onclick = onShutter; $('#still').onclick = retake;
  $('#btnLibrary').onclick = () => $('#fileLib').click(); $('#btnScale').onclick = () => $('#fileScale').click();
  $('#fileLib').onchange = e => onFile(e.target, false); $('#fileCam').onchange = e => onFile(e.target, false); $('#fileScale').onchange = e => onFile(e.target, true);
  $('#btnScaleRemove').onclick = () => setScale(null);
  $('#btnAnalyze').onclick = analyze;
  $('#logPrev').onclick = () => shiftDay(-1); $('#logNext').onclick = () => shiftDay(1);
  $('#btnExport').onclick = () => exportJSON().catch(e => toast(e.message));
  $('#btnReceiptsCSV').onclick = () => exportReceiptsCSV();
  $('#btnSettings').onclick = openSettings;
  $('#setProvider').onchange = () => { const p = AI_PRESETS[$('#setProvider').value]; if (p && p.base) { $('#setBase').value = p.base; $('#setModel').value = p.model; } };
  $('#btnSaveAI').onclick = () => { const v = readSettings(); if (v.key && (!AI_URL_OK.test(v.base) || !v.model)) { $('#testResult').hidden = false; $('#testResult').textContent = 'Add an https base URL and a model name.'; return; } aiSave(v); closeSheet('#sheetSettings'); updateButtons(); toast(v.key ? 'Saved — AI is ready (' + v.model + ')' : 'Saved'); };
  $('#btnTestAI').onclick = testAI;
  $('#btnClearAI').onclick = () => { localStorage.removeItem(AI_KEY); $('#setKey').value = ''; toast('API key removed from this device'); };
  $('#btnUsePN').onclick = () => { const p = pencilNotesKey(); if (!p) return; const prov = AI_PRESETS[p.provider] ? p.provider : 'xai'; $('#setProvider').value = prov; $('#setBase').value = p.base || AI_PRESETS[prov].base; $('#setModel').value = p.model || AI_PRESETS[prov].model; $('#setKey').value = p.key; aiSave(readSettings()); toast('Using your Pencil Notes key'); $('#pnKeyBox').hidden = true; };
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); else if (S.view === 'scan' && camNeeded() && !S.photos.length && localStorage.getItem('camOK')) startCamera(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.sheet').forEach(s => !s.hidden && closeSheet('#' + s.id)); });
  setView('scan'); setMode(S.mode);
  if ('serviceWorker' in navigator && location.protocol === 'https:' || location.hostname === 'localhost') navigator.serviceWorker && navigator.serviceWorker.register('sw.js').catch(() => {});
}
document.addEventListener('DOMContentLoaded', init);
