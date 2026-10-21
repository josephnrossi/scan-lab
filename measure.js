/* Scan Lab — Measure mode: flat (one photo + reference), 3D from photos (front/side/top), and 3D scan files. */
const MREFS = {
  quarter: { label: 'US quarter — 24.26 mm across', mm: 24.26 },
  card: { label: 'Credit card — long edge 85.60 mm', mm: 85.6 },
  cardShort: { label: 'Credit card — short edge 53.98 mm', mm: 53.98 },
  letter: { label: 'Letter paper — long edge 11 in', mm: 279.4 },
  letterShort: { label: 'Letter paper — short edge 8.5 in', mm: 215.9 },
  custom: { label: 'Custom known length…', mm: 0 },
};
const MCOL = { ref: '#4da3ff', a: '#6ff0c4', b: '#ff9a5a', c: '#e48cff', d: '#ffd166' };
const VIEWS3D = { front: ['Front', ['L', 'Length (left–right)', 'h'], ['H', 'Height', 'v']], side: ['Side', ['W', 'Width (front–back)', 'h'], ['H', 'Height', 'v']], top: ['Top', ['L', 'Length (left–right)', 'h'], ['W', 'Width (front–back)', 'v']] };
const VORDER = ['front', 'side', 'top'];
const mmFmt = mm => mm == null || !isFinite(mm) ? '—' : `${(mm / 25.4).toFixed(mm < 254 ? 2 : 1)} in · ${(mm / 10).toFixed(1)} cm`;
const measureSub = () => { const v = localStorage.getItem('measureSub'); return v === '3d' || v === 'file' ? v : 'flat'; };
const measureWants3D = () => S.mode === 'measure' && measureSub() === '3d';
let M3D = null; const m3d = async () => M3D || (M3D = await import('./measure3d.js'));
const VIEWERS = new Set();
function measure3dDisposeAll() { for (const v of VIEWERS) { try { v.dispose(); } catch (_) {} } VIEWERS.clear(); }
function measureSetupHelp() {
  const sub = measureSub(), h = $('#modeHelp');
  h.innerHTML = `<span class="seg" role="group" aria-label="Measure type"><button data-ms="flat" aria-pressed="${sub === 'flat'}">Flat</button><button data-ms="3d" aria-pressed="${sub === '3d'}">3D photos</button><button data-ms="file" aria-pressed="${sub === 'file'}">3D scan file</button></span>
    <span style="display:block;margin-top:4px">${sub === 'flat' ? 'Put a quarter, card or sheet of paper flat beside the object, shoot straight down/on, then mark both.' : sub === '3d' ? 'Take Front, Side and Top photos, each with the same reference object. One 3/4 photo works too (Grok estimates depth, lower confidence).' : 'Open a scan from Reality Composer, KIRI Engine, Scaniverse or Polycam (GLB, OBJ, STL, PLY, USDZ).'}</span>`;
  $$('[data-ms]', h).forEach(b => b.onclick = () => { localStorage.setItem('measureSub', b.dataset.ms); if (b.dataset.ms !== '3d' && S.photos.length > 1) S.photos = S.photos.slice(-1); $('#result').innerHTML = ''; measure3dDisposeAll(); renderPages(); updateButtons(); applyCamArea(); });
  $('#btnAnalyze').textContent = sub === '3d' ? (S.photos.length < 3 ? `Measure (${S.photos.length}/3 photos)` : 'Measure 3D') : 'Measure';
}
function measureSummary(r) { if (r.sub === 'file') return 'Scan · ' + [r.dims.L, r.dims.W, r.dims.H].map(v => (v / 25.4).toFixed(1)).join(' × ') + ' in'; if (r.dims) return [r.dims.L, r.dims.W, r.dims.H].map(v => (v / 25.4).toFixed(1)).join(' × ') + ' in · ' + r.shape; const a = (r.lines || []).find(l => l.id === 'a'); return a && a.mm ? (a.mm / 25.4).toFixed(2) + ' in' : 'Measurement'; }

/* ---------- point marker on a photo ---------- */
function markerCanvas(host, src, lines, onChange) {
  const wrap = document.createElement('div'); wrap.className = 'measure-wrap'; const cv = document.createElement('canvas'); wrap.appendChild(cv); host.appendChild(wrap);
  const img = new Image(); let drag = null, W = 0, H = 0, loupe = null;
  const px = p => [p[0] * cv.width, p[1] * cv.height];
  const draw = () => {
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0, cv.width, cv.height); const s = cv.width / 600;
    for (const l of lines) { const a = px(l.p1), b = px(l.p2); g.strokeStyle = '#000'; g.lineWidth = 6 * s; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); g.strokeStyle = l.color; g.lineWidth = 3 * s; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
      for (const p of [a, b]) { g.fillStyle = l.color; g.beginPath(); g.arc(...p, 9 * s, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 2 * s; g.stroke(); }
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; g.font = `600 ${15 * s}px -apple-system,system-ui`; const t = l.tag || l.label; const tw = g.measureText(t).width; g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(m[0] + 10 * s, m[1] - 22 * s, tw + 12 * s, 22 * s); g.fillStyle = l.color; g.fillText(t, m[0] + 16 * s, m[1] - 6 * s); }
    if (loupe) { const r = 70 * s, z = 3, [x, y] = loupe; g.save(); g.beginPath(); g.arc(r + 8, r + 8, r, 0, 7); g.clip(); g.drawImage(img, x / cv.width * img.naturalWidth - r / z * img.naturalWidth / cv.width, y / cv.height * img.naturalHeight - r / z * img.naturalHeight / cv.height, 2 * r / z * img.naturalWidth / cv.width, 2 * r / z * img.naturalHeight / cv.height, 8, 8, 2 * r, 2 * r); g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.moveTo(r + 8 - 10, r + 8); g.lineTo(r + 18, r + 8); g.moveTo(r + 8, r - 2); g.lineTo(r + 8, r + 18); g.stroke(); g.restore(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(r + 8, r + 8, r, 0, 7); g.stroke(); }
  };
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  cv.addEventListener('pointerdown', e => { const p = pos(e), r = cv.getBoundingClientRect(), tol = 34 / r.width; let best = null, bd = tol;
    for (const l of lines) for (const k of ['p1', 'p2']) { const d = Math.hypot((l[k][0] - p[0]), (l[k][1] - p[1]) * r.height / r.width); if (d < bd) { bd = d; best = [l, k]; } }
    if (best) { drag = best; cv.setPointerCapture(e.pointerId); e.preventDefault(); loupe = px(drag[0][drag[1]]); draw(); } });
  cv.addEventListener('pointermove', e => { if (!drag) return; const p = pos(e).map(v => Math.max(0, Math.min(1, v))); drag[0][drag[1]] = p; loupe = px(p); draw(); onChange(); });
  const up = () => { if (drag) { drag = null; loupe = null; draw(); onChange(true); } }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  img.onload = () => { W = img.naturalWidth; H = img.naturalHeight; cv.width = Math.min(1200, W); cv.height = Math.round(cv.width * H / W); draw(); onChange(); }; img.src = src;
  return { redraw: draw, natural: () => [W || 1, H || 1], canvas: cv };
}
const lineLenPx = (l, nat) => Math.hypot((l.p2[0] - l.p1[0]) * nat[0], (l.p2[1] - l.p1[1]) * nat[1]);
function refSelect(id, val, customMM) { return `<label class="field"><span>Reference object</span><select id="${id}">${Object.entries(MREFS).map(([k, v]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
  <label class="field" id="${id}C" ${val === 'custom' ? '' : 'hidden'}><span>Known length of the reference</span><span class="row gap"><input type="number" inputmode="decimal" id="${id}V" value="${customMM ? r2(customMM / 25.4) : ''}" placeholder="e.g. 6" style="flex:1"> <span class="seg"><button data-cu="in" aria-pressed="true">in</button><button data-cu="cm" aria-pressed="false">cm</button></span></span></label>`; }
function bindRef(root, id, st, onChange) {
  const sel = $('#' + id, root), cbox = $('#' + id + 'C', root), inp = $('#' + id + 'V', root); let unit = 'in';
  sel.onchange = () => { st.ref = sel.value; cbox.hidden = st.ref !== 'custom'; onChange(); };
  inp.oninput = () => { const v = +inp.value; st.customMM = v > 0 ? v * (unit === 'in' ? 25.4 : 10) : 0; onChange(); };
  $$('[data-cu]', cbox).forEach(b => b.onclick = () => { unit = b.dataset.cu; $$('[data-cu]', cbox).forEach(x => x.setAttribute('aria-pressed', String(x === b))); inp.oninput(); });
}
const refMM = st => st.ref === 'custom' ? st.customMM || 0 : MREFS[st.ref].mm;
const defLines = (labels) => [{ id: 'ref', label: 'Reference', tag: 'Ref', color: MCOL.ref, p1: [0.12, 0.85], p2: [0.3, 0.85] }, ...labels.map((l, i) => ({ id: 'abcd'[i], label: l.label, tag: l.tag || l.label, color: MCOL['abcd'[i]], p1: l.dir === 'v' ? [0.6 + i * 0.05, 0.2] : [0.35, 0.3 + i * 0.12], p2: l.dir === 'v' ? [0.6 + i * 0.05, 0.7] : [0.8, 0.3 + i * 0.12] }))];

/* ---------- entry ---------- */
function measureOpen(out, { photos, hint, saved } = {}) {
  measure3dDisposeAll();
  if (saved) { const r = saved.result; if (r.sub === 'file') return measureFileOpen(out, saved); if (r.sub === '3d') return measure3DOpen(out, { saved }); return measureFlatOpen(out, { saved }); }
  if (measureSub() === '3d') return measure3DOpen(out, { photos, hint });
  return measureFlatOpen(out, { photo: photos[photos.length - 1], hint });
}

/* ---------- flat ---------- */
function measureFlatOpen(out, { photo, hint, saved }) {
  const st = saved ? saved.result : { kind: 'measure', sub: 'flat', ref: localStorage.getItem('mRef') || 'quarter', customMM: 0, lines: defLines([{ label: 'A', tag: 'A' }, { label: 'B', tag: 'B', dir: 'v' }]), grok: null };
  let scan = saved || null; const img = saved ? saved.image : photo;
  out.innerHTML = `<div class="card"><div class="res-head"><h2>Measure</h2><span class="badge">on-device</span></div>
    ${refSelect('mRef', st.ref, st.customMM)}
    <p class="muted small">Drag the <b style="color:${MCOL.ref}">blue</b> ends across the reference (edge to edge), then the other lines across what you want to measure. A magnifier appears while you drag.</p>
    <div id="mCanvas"></div>
    <div class="row gap" style="margin-top:8px"><button class="pill" id="mAddLine">＋ Line</button>${aiHasKey() ? '<button class="pill" id="mGrok">✨ Auto-detect with Grok</button>' : ''}</div>
    <div id="mVals"></div>
    <p class="muted small">Accuracy: keep the camera straight-on (parallel to the surface) with the reference in the same plane as what you measure. Tilt, lens distortion and depth differences cause errors — typically ±2–5% when done carefully, more at an angle.</p></div>
    <div id="mGrokOut"></div>
    <div class="card"><div class="export-row"><button class="primary" id="mSave">${saved ? 'Saved ✓' : 'Save to History'}</button><button class="pill" id="mGlass">🪟 Use as stained glass finished size</button></div></div>`;
  let mk;
  const calc = () => { const nat = mk ? mk.natural() : [1, 1], ref = st.lines.find(l => l.id === 'ref'), rp = lineLenPx(ref, nat), mmpp = refMM(st) && rp > 2 ? refMM(st) / rp : 0; st.lines.forEach(l => { l.mm = l.id === 'ref' ? refMM(st) : mmpp ? lineLenPx(l, nat) * mmpp : null; }); return mmpp; };
  const vals = () => { const mmpp = calc(), ms = st.lines.filter(l => l.id !== 'ref'), a = ms[0], b = ms[1];
    $('#mVals', out).innerHTML = !mmpp ? `<p class="card warn small">${st.ref === 'custom' && !st.customMM ? 'Enter the reference’s known length.' : 'Place the blue line across the reference.'}</p>` :
      `<table>${ms.map(l => `<tr><td><b style="color:${l.color}">${esc(l.label)}</b></td><td class="mt-result" data-len="${l.id}">${mmFmt(l.mm)}</td></tr>`).join('')}
      ${a && b ? `<tr><td>A × B area</td><td>${((a.mm * b.mm) / 645.16).toFixed(1)} sq in · ${((a.mm * b.mm) / 100).toFixed(0)} cm²</td></tr>` : ''}</table>`; };
  mk = markerCanvas($('#mCanvas', out), img, st.lines, done => { vals(); if (done && scan) DB.put('scans', scan); });
  bindRef(out, 'mRef', st, () => { localStorage.setItem('mRef', st.ref); vals(); });
  $('#mAddLine', out).onclick = () => { const i = st.lines.length - 1; if (i >= 4) return toast('4 lines max'); const id = 'abcd'[i]; st.lines.push({ id, label: id.toUpperCase(), tag: id.toUpperCase(), color: MCOL[id], p1: [0.3, 0.5 + i * 0.05], p2: [0.7, 0.5 + i * 0.05] }); mk.redraw(); vals(); };
  const g = $('#mGrok', out); if (g) g.onclick = () => grokMeasure(out, st, [img], hint, () => { mk.redraw(); vals(); });
  if (st.grok) renderGrokMeasure(out, st.grok);
  $('#mSave', out).onclick = async () => { calc(); if (!scan) scan = { id: uid(), at: Date.now(), mode: 'measure', kind: 'measure', image: img, thumb: await thumbOf(img) }; const a = st.lines.find(l => l.id === 'a'); scan.title = 'Measure · ' + (a && a.mm ? (a.mm / 25.4).toFixed(2) + ' in' : 'photo'); scan.result = st; await DB.put('scans', scan); $('#mSave', out).textContent = 'Saved ✓'; toast('Measurement saved'); };
  $('#mGlass', out).onclick = () => { calc(); const ms = st.lines.filter(l => l.id !== 'ref' && l.mm); if (!ms.length) return toast('Measure at least one line first'); const w = ms[0].mm / 25.4, h = ms[1] ? ms[1].mm / 25.4 : 0; useAsGlass(w, h, img); };
  window.__measure = st;
}
function useAsGlass(wIn, hIn, img) {
  const w = Math.max(2, Math.round(wIn * 4) / 4), h = hIn ? Math.max(2, Math.round(hIn * 4) / 4) : 0;
  localStorage.setItem(GLASS_PREFILL, JSON.stringify({ widthIn: w, heightIn: h })); closeSheet('#sheetDetail');
  setView('scan'); if (img) { S.photos = [img]; } setMode('glass'); if (S.photos.length) { showStill(S.photos[0]); updateButtons(); analyze(); }
  toast(`Stained glass size set to ${w}${h ? ' × ' + h : ''} in`);
}

/* ---------- Grok auto-detect ---------- */
async function grokMeasure(out, st, imgs, hint, after, views) {
  const box = $('#mGrokOut', out); box.innerHTML = '<div class="card"><span class="spinner"></span>Grok is finding the reference and measuring…</div>';
  const refTxt = st.ref === 'custom' ? `a reference of known length ${st.customMM} mm` : MREFS[st.ref].label;
  const pt = '[x,y] normalized 0-1 from the image top-left';
  const ask = views ? `Photos are views of the same object: ${views.map((v, i) => `image ${i + 1} = ${v}`).join(', ')}. Each shows ${refTxt} for scale. For each image, return the reference endpoints across its known dimension and the endpoints of the object's extents: front: L (left-right) and H; side: W (front-back) and H; top: L and W. If only one photo, it's a 3/4 view: estimate the hidden depth and set "depth_estimated": true.`
    : `The photo shows an object with ${refTxt} for scale. Return the reference endpoints across its known dimension and endpoints of the object's main length (a) and width/height (b).`;
  const schema = views ? `{"views":[{"view":"front|side|top","ref":{"p1":${pt},"p2":${pt}},"a":{"p1":[],"p2":[]},"b":{"p1":[],"p2":[]}}],"object":{"name":"","shape":"box|cylinder|sphere|combination","proportions":"e.g. 3:2:1","parts":["for combination"],"L_mm":0,"W_mm":0,"H_mm":0},"depth_estimated":false,"confidence":"low|medium|high","notes":""}`
    : `{"reference":{"found":true,"p1":${pt},"p2":${pt}},"a":{"p1":[],"p2":[]},"b":{"p1":[],"p2":[]},"object":{"name":"","shape":"box|cylinder|sphere|combination","length_mm":0,"width_mm":0,"height_mm":0,"area_cm2":0,"volume_cm3":0},"confidence":"low|medium|high","notes":""}`;
  try {
    const raw = await aiChat([{ role: 'system', content: 'You measure objects in photos using a reference object. Answer with strict JSON only.' }, { role: 'user', content: [{ type: 'text', text: `${ask}\nReturn ONLY JSON: ${schema}${hint ? '\nUser hint: ' + hint.slice(0, 200) : ''}` }, ...imgs.map(imgPart)] }]);
    const j = parseJSONLoose(raw), P = v => Array.isArray(v) && v.length === 2 && v.every(x => typeof x === 'number') ? v.map(x => Math.max(0, Math.min(x > 1 ? x / 100 : x, 1))) : null, setL = (lines, id, o) => { const l = lines.find(x => x.id === id); if (l && o && P(o.p1) && P(o.p2)) { l.p1 = P(o.p1); l.p2 = P(o.p2); } };
    if (views) (Array.isArray(j.views) ? j.views : []).forEach((v, i) => { const vs = st.views.find(x => x.view === String(v.view).toLowerCase()) || st.views[i]; if (!vs) return; setL(vs.lines, 'ref', v.ref); setL(vs.lines, 'a', v.a); setL(vs.lines, 'b', v.b); });
    else { setL(st.lines, 'ref', j.reference); setL(st.lines, 'a', j.a); setL(st.lines, 'b', j.b); }
    const o = j.object || {}; st.grok = { name: str(o.name, 80), shape: ['box', 'cylinder', 'sphere', 'combination'].includes(o.shape) ? o.shape : 'box', proportions: str(o.proportions, 40), parts: strs(o.parts, 6), L: num(o.L_mm ?? o.length_mm), W: num(o.W_mm ?? o.width_mm), H: num(o.H_mm ?? o.height_mm), area: num(o.area_cm2), volume: num(o.volume_cm3), depthEstimated: !!j.depth_estimated || (views && imgs.length === 1), confidence: conf(j.confidence), notes: str(j.notes, 300), found: !(j.reference && j.reference.found === false) };
    renderGrokMeasure(out, st.grok); after && after();
  } catch (e) { box.innerHTML = ''; renderError(box, e, () => grokMeasure(out, st, imgs, hint, after, views)); }
}
function renderGrokMeasure(out, g) {
  $('#mGrokOut', out).innerHTML = `<div class="card"><div class="res-head"><b>✨ Grok’s estimate${g.name ? ': ' + esc(g.name) : ''}</b>${confBadge(g.depthEstimated ? 'low' : g.confidence)}</div>
    ${!g.found ? '<p class="small conf-low">Grok couldn’t find the reference object — place the blue line yourself.</p>' : '<p class="small muted">Lines were placed for you — drag to fine-tune; the on-device numbers above use your lines.</p>'}
    <table>${g.L ? `<tr><td>Length</td><td>${mmFmt(g.L)}</td></tr>` : ''}${g.W ? `<tr><td>Width</td><td>${mmFmt(g.W)}</td></tr>` : ''}${g.H ? `<tr><td>Height</td><td>${mmFmt(g.H)}</td></tr>` : ''}${g.area ? `<tr><td>Area</td><td>${(g.area / 6.4516).toFixed(1)} sq in · ${g.area.toFixed(0)} cm²</td></tr>` : ''}${g.volume ? `<tr><td>Rough volume</td><td>${(g.volume / 16.387).toFixed(1)} cu in · ${g.volume.toFixed(0)} cm³</td></tr>` : ''}
    <tr><td>Shape</td><td>${esc(g.shape)}${g.proportions ? ' · ' + esc(g.proportions) : ''}${g.parts.length ? '<div class="muted small">' + g.parts.map(esc).join(', ') + '</div>' : ''}</td></tr></table>
    ${g.depthEstimated ? '<p class="small conf-low">Depth was estimated from a single 3/4 view — lower confidence. Add Side and Top photos for real measurements.</p>' : ''}${g.notes ? `<p class="muted small">${esc(g.notes)}</p>` : ''}</div>`;
}

/* ---------- 3D from photos ---------- */
function shapeCalc(shape, d) { const { L, W, H } = d; if (shape === 'cylinder') { const r = (L + W) / 4; return { volume: Math.PI * r * r * H, area: 2 * Math.PI * r * r + 2 * Math.PI * r * H }; } if (shape === 'sphere') { const r = (L + W + H) / 6; return { volume: 4 / 3 * Math.PI * r ** 3, area: 4 * Math.PI * r * r }; } return { volume: L * W * H, area: 2 * (L * W + L * H + W * H) }; }
const volFmt = mm3 => `${(mm3 / 16387.064).toFixed(1)} cu in · ${(mm3 / 1000).toFixed(0)} cm³${mm3 > 1e6 ? ' (' + (mm3 / 1e6).toFixed(2) + ' L)' : ''}`;
const areaFmt = mm2 => `${(mm2 / 645.16).toFixed(1)} sq in · ${(mm2 / 100).toFixed(0)} cm²`;
function measure3DOpen(out, { photos, hint, saved }) {
  let scan = saved || null;
  const st = saved ? saved.result : { kind: 'measure', sub: '3d', ref: localStorage.getItem('mRef') || 'card', customMM: 0, shape: 'box', dims: null, manual: false, unit: 'in', grok: null,
    views: photos.map((p, i) => { const v = photos.length === 1 ? 'front' : VORDER[i], d = VIEWS3D[v]; return { view: v, image: p, lines: defLines([{ label: d[1][1], tag: d[1][0], dir: d[1][2] }, { label: d[2][1], tag: d[2][0], dir: d[2][2] }]) }; }) };
  out.innerHTML = `<div class="card"><div class="res-head"><h2>3D dimensions</h2><span class="badge">${st.views.length} photo${st.views.length > 1 ? 's' : ''}</span></div>
    ${refSelect('mRef3', st.ref, st.customMM)}
    <p class="muted small">On each photo, drag the blue line across the reference, then the two lines across the object’s full extents.${st.views.length === 1 ? ' With one photo, depth comes from Grok (lower confidence) or type it below.' : ''}</p>
    <div id="m3Views"></div>
    ${aiHasKey() ? '<button class="pill" id="m3Grok">✨ Auto-detect, estimate depth &amp; shape with Grok</button>' : ''}
  </div><div id="mGrokOut"></div>
  <div class="card"><h3 style="margin-top:0">Approximate model</h3>
    <div class="ctl"><label>Shape <select id="m3Shape"><option value="box">Box</option><option value="cylinder">Cylinder</option><option value="sphere">Sphere</option><option value="combination">Combination (shown as box)</option></select></label>
      <label>Units <span class="seg"><button data-u3="in">in</button><button data-u3="cm">cm</button></span></label>
      <label>L (length) <input type="number" inputmode="decimal" id="m3L" step="0.1"></label><label>W (width) <input type="number" inputmode="decimal" id="m3W" step="0.1"></label>
      <label>H (height) <input type="number" inputmode="decimal" id="m3H" step="0.1"></label><label class="toggle"><input type="checkbox" id="m3Wire"> Wireframe</label></div>
    <div id="m3Sum" class="small" style="margin:8px 0"></div>
    <div id="m3Viewer" style="margin-top:6px"></div>
    <div class="row gap" style="margin-top:6px"><button class="pill" data-vw="iso">3/4</button><button class="pill" data-vw="front">Front</button><button class="pill" data-vw="side">Side</button><button class="pill" data-vw="top">Top</button></div>
    <p class="muted small">Rotate with a finger or Pencil, pinch to zoom, two fingers to pan. This is an approximate shape from photos, not a 3D scan — Safari web apps can’t use the iPhone LiDAR scanner. For a true scan, use a scanner app and open the file in “3D scan file”.</p>
    <div class="export-row"><button class="primary" id="m3Save">${saved ? 'Saved ✓' : 'Save to History'}</button><button class="pill" id="m3PNG">⤓ PNG</button><button class="pill" id="m3PDF">⤓ Dimension sheet PDF</button><button class="pill" id="m3OBJ">⤓ OBJ</button><button class="pill" id="m3STL">⤓ STL</button><button class="pill" id="m3GLB">⤓ GLB</button><button class="pill" id="m3Glass">🪟 Use as stained glass size</button></div></div>`;
  const mks = []; let viewer = null;
  const host = $('#m3Views', out);
  st.views.forEach((v, i) => { const h = document.createElement('div'); h.innerHTML = `<h3>${VIEWS3D[v.view][0]} view</h3>`; host.appendChild(h); mks[i] = markerCanvas(h, v.image, v.lines, done => { if (!st.manual) recompute(); if (done) refreshModel(); }); });
  const U = () => st.unit === 'cm' ? 10 : 25.4;
  const computeFromPhotos = () => {
    const acc = { L: [], W: [], H: [] }, rmm = refMM(st);
    st.views.forEach((v, i) => { const nat = mks[i] ? mks[i].natural() : [1, 1], rp = lineLenPx(v.lines[0], nat); if (!rmm || rp < 2) return; const k = rmm / rp, d = VIEWS3D[v.view]; acc[d[1][0]].push(lineLenPx(v.lines[1], nat) * k); acc[d[2][0]].push(lineLenPx(v.lines[2], nat) * k); });
    const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; const d = { L: avg(acc.L), W: avg(acc.W), H: avg(acc.H) };
    if (d.W == null && st.grok && st.grok.W) { d.W = st.grok.W * (d.L && st.grok.L ? d.L / st.grok.L : 1); st.depthEstimated = true; }
    return d;
  };
  const recompute = () => { const d = computeFromPhotos(); if (d.L && d.H) st.dims = { L: d.L, W: d.W || st.dims && st.dims.W || d.L * 0.5, H: d.H }; if (!d.W && !(st.grok && st.grok.W)) st.depthGuess = true; fillDims(); };
  const fillDims = () => {
    $$('[data-u3]', out).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.u3 === st.unit))); $('#m3Shape', out).value = st.shape;
    if (!st.dims) { $('#m3Sum', out).innerHTML = '<span class="conf-low">Place the reference and object lines to get dimensions.</span>'; return; }
    for (const k of ['L', 'W', 'H']) { const el = $('#m3' + k, out); if (document.activeElement !== el) el.value = (st.dims[k] / U()).toFixed(st.unit === 'cm' ? 1 : 2); }
    const c = shapeCalc(st.shape, st.dims);
    $('#m3Sum', out).innerHTML = `<b>${['L', 'W', 'H'].map(k => (st.dims[k] / U()).toFixed(st.unit === 'cm' ? 1 : 2)).join(' × ')} ${st.unit}</b> &nbsp;(${['L', 'W', 'H'].map(k => (st.dims[k] / (st.unit === 'cm' ? 25.4 : 10)).toFixed(1)).join(' × ')} ${st.unit === 'cm' ? 'in' : 'cm'})<br>Volume ${volFmt(c.volume)}<br>Surface ${areaFmt(c.area)}${st.shape === 'combination' ? '<br><span class="muted">Combination shapes are approximated by their bounding box.</span>' : ''}${(st.depthEstimated || st.depthGuess) && st.views.length < 2 ? '<br><span class="conf-low">Depth (W) is estimated — lower confidence.</span>' : ''}`;
  };
  const crop = (v) => new Promise(res => { const im = new Image(); im.onload = () => { const pts = v.lines.slice(1).flatMap(l => [l.p1, l.p2]), x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1])); const c = document.createElement('canvas'), w = Math.max(8, (x1 - x0) * im.naturalWidth), h = Math.max(8, (y1 - y0) * im.naturalHeight); c.width = Math.min(512, w); c.height = Math.round(c.width * h / w); c.getContext('2d').drawImage(im, x0 * im.naturalWidth, y0 * im.naturalHeight, w, h, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.8)); }; im.src = v.image; });
  let tex = {};
  const refreshModel = async () => { if (!st.dims || !viewer) return; tex = {}; for (const v of st.views) tex[v.view] = await crop(v); viewer.setShape({ shape: st.shape === 'combination' ? 'box' : st.shape, ...st.dims, textures: tex }); };
  bindRef(out, 'mRef3', st, () => { localStorage.setItem('mRef', st.ref); st.manual = false; recompute(); refreshModel(); });
  $('#m3Shape', out).onchange = e => { st.shape = e.target.value; fillDims(); refreshModel(); };
  $$('[data-u3]', out).forEach(b => b.onclick = () => { st.unit = b.dataset.u3; fillDims(); });
  for (const k of ['L', 'W', 'H']) $('#m3' + k, out).onchange = e => { const v = +e.target.value; if (v > 0) { st.dims = st.dims || { L: 100, W: 100, H: 100 }; st.dims[k] = v * U(); st.manual = true; fillDims(); refreshModel(); if (scan) DB.put('scans', scan); } };
  $('#m3Wire', out).onchange = e => viewer && viewer.setWire(e.target.checked);
  $$('[data-vw]', out).forEach(b => b.onclick = () => viewer && viewer.view(b.dataset.vw));
  const g = $('#m3Grok', out); if (g) g.onclick = () => grokMeasure(out, st, st.views.map(v => v.image), hint, () => { mks.forEach(m => m.redraw()); st.manual = false; if (st.grok && st.grok.shape) st.shape = st.grok.shape; recompute(); refreshModel(); }, st.views.map(v => v.view));
  if (st.grok) renderGrokMeasure(out, st.grok);
  const base = () => `object-${st.dims ? ['L', 'W', 'H'].map(k => (st.dims[k] / 25.4).toFixed(1)).join('x') : 'model'}in`;
  $('#m3PNG', out).onclick = () => viewer && fetch(viewer.png()).then(r => r.blob()).then(b => shareOrDownload(base() + '.png', b, 'image/png'));
  $('#m3OBJ', out).onclick = () => viewer && shareOrDownload(base() + '.obj', viewer.exportOBJ(), 'model/obj');
  $('#m3STL', out).onclick = () => viewer && shareOrDownload(base() + '.stl', new Blob([viewer.exportSTL()], { type: 'model/stl' }), 'model/stl');
  $('#m3GLB', out).onclick = async () => { if (!viewer) return; try { shareOrDownload(base() + '.glb', new Blob([await viewer.exportGLB()], { type: 'model/gltf-binary' }), 'model/gltf-binary'); } catch (e) { toast('GLB export failed: ' + e.message); } };
  $('#m3PDF', out).onclick = () => { if (!viewer || !st.dims) return; shareOrDownload(base() + '-dimensions.pdf', dimSheetPDF({ title: (st.grok && st.grok.name) || 'Object', dims: st.dims, shape: st.shape, snap: viewer.jpeg(), source: st.views.length + ' photo(s) with ' + (st.ref === 'custom' ? 'custom reference' : MREFS[st.ref].label), note: 'Approximate shape from photos — not a 3D scan.' }).blob(), 'application/pdf'); };
  $('#m3Glass', out).onclick = () => { if (!st.dims) return toast('Measure first'); useAsGlass(st.dims.L / 25.4, st.dims.H / 25.4, st.views[0].image); };
  $('#m3Save', out).onclick = async () => { if (!scan) scan = { id: uid(), at: Date.now(), mode: 'measure', kind: 'measure', image: st.views[0].image, thumb: await thumbOf(st.views[0].image) }; scan.title = '3D · ' + ((st.grok && st.grok.name) || st.shape); scan.result = st; await DB.put('scans', scan); $('#m3Save', out).textContent = 'Saved ✓'; toast('3D measurement saved'); };
  m3d().then(M => { viewer = M.createViewer($('#m3Viewer', out)); VIEWERS.add(viewer); window.__viewer = viewer; if (st.dims) fillDims(); else recompute(); refreshModel(); }).catch(e => { $('#m3Viewer', out).innerHTML = `<p class="card err small">3D viewer unavailable: ${esc(e.message)}</p>`; });
  fillDims(); window.__measure = st;
}

/* ---------- dimension sheet PDF ---------- */
function dimSheetPDF({ title, dims, shape, snap, source, note, stats }) {
  const doc = new PDFDoc(), p = doc.page(), M = 40; let y = M; const fmt = mm => `${(mm / 25.4).toFixed(2)} in (${(mm / 10).toFixed(1)} cm)`;
  p.text(M, y, 18, 'Dimension sheet — ' + title, true); y += 26; p.text(M, y, 9.5, 'Scan Lab · ' + new Date().toLocaleDateString() + ' · ' + source, false, [90, 90, 90]); y += 18;
  const c = stats || shapeCalc(shape, dims);
  for (const [k, v] of [['Length (L)', fmt(dims.L)], ['Width (W)', fmt(dims.W)], ['Height (H)', fmt(dims.H)], ['Shape', shape], ['Volume', (c.volume / 16387.064).toFixed(1) + ' cu in (' + (c.volume / 1000).toFixed(0) + ' cm³)' + (c.volumeNote ? ' — ' + c.volumeNote : '')], ['Surface area', (c.area / 645.16).toFixed(1) + ' sq in (' + (c.area / 100).toFixed(0) + ' cm²)']]) { p.text(M, y, 11, k, true); p.text(M + 110, y, 11, v); y += 16; }
  y += 8; p.para(M, y, 530, 9, note, false, [150, 60, 0]); y += 22;
  // orthographic views
  const box = 150, views = [['Front', dims.L, dims.H], ['Side', dims.W, dims.H], ['Top', dims.L, dims.W]], s = box / Math.max(dims.L, dims.W, dims.H);
  views.forEach(([n, a, b], i) => { const x = M + i * (box + 30), w = a * s, h = b * s, by = 792 - y - box; p.stroke(30, 30, 30).lw(1.2); if (shape === 'sphere' || (shape === 'cylinder' && n === 'Top')) { const r = Math.min(w, h) / 2, cx = x + w / 2, cy = by + box - h / 2, k = 0.5523 * r; p.op(`${f2(cx + r)} ${f2(cy)} m ${f2(cx + r)} ${f2(cy + k)} ${f2(cx + k)} ${f2(cy + r)} ${f2(cx)} ${f2(cy + r)} c ${f2(cx - k)} ${f2(cy + r)} ${f2(cx - r)} ${f2(cy + k)} ${f2(cx - r)} ${f2(cy)} c ${f2(cx - r)} ${f2(cy - k)} ${f2(cx - k)} ${f2(cy - r)} ${f2(cx)} ${f2(cy - r)} c ${f2(cx + k)} ${f2(cy - r)} ${f2(cx + r)} ${f2(cy - k)} ${f2(cx + r)} ${f2(cy)} c S`); } else p.rect(x, by + box - h, w, h);
    p.stroke(0, 140, 110).lw(0.6).line(x, by + box - h - 10, x + w, by + box - h - 10).line(x, by + box - h - 14, x, by + box - h - 6).line(x + w, by + box - h - 14, x + w, by + box - h - 6);
    p.line(x + w + 10, by + box - h, x + w + 10, by + box).line(x + w + 6, by + box - h, x + w + 14, by + box - h).line(x + w + 6, by + box, x + w + 14, by + box);
    p.text(x, y + box + 6, 10, n + ' view', true); p.text(x, y + box + 20, 8.5, `${(a / 25.4).toFixed(2)} × ${(b / 25.4).toFixed(2)} in`); });
  y += box + 44;
  if (snap) { const im = doc.addJPEG(snap), w = 300, h = w * im.h / im.w; if (y + h < 760) { p.image(im, M, 792 - y - h, w, h); p.text(M + w + 12, y, 9, '3D view with dimension lines', false, [90, 90, 90]); } }
  return doc;
}

/* ---------- 3D scan files ---------- */
const SCAN_HOWTO = [
  ['Reality Composer (Apple, free)', 'Object Capture → scan → share/export the USDZ to Files. If it won’t open here, re-export as OBJ or GLB with a converter app.'],
  ['KIRI Engine (free exports)', 'Scan → Export → choose GLB (or OBJ/STL) → Save to Files.'],
  ['Scaniverse (free)', 'Open the scan → Share → Export Model → GLB or OBJ → Save to Files.'],
  ['Polycam', 'Free plan exports GLB only: open the capture → Export → GLB → Save to Files.'],
];
function measureFileOpen(out, saved) {
  measure3dDisposeAll();
  const st = saved ? saved.result : { kind: 'measure', sub: 'file', unit: localStorage.getItem('mFileUnit') || 'mm', scale: 1, dims: null, measures: [] };
  out.innerHTML = `<div class="card"><div class="res-head"><h2>3D scan file</h2><span class="badge">on-device</span></div>
    <div class="row gap"><button class="primary" id="mfOpen">📂 Open 3D file</button><label class="small muted">Units for OBJ/STL/PLY <select id="mfUnit" style="min-height:44px">${['mm', 'cm', 'm', 'in'].map(u => `<option ${u === st.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></label></div>
    <input type="file" id="mfFile" hidden accept=".glb,.gltf,.obj,.stl,.ply,.usdz,.usda,.usdc,model/gltf-binary,model/obj,model/stl,model/vnd.usdz+zip,application/octet-stream">
    <p class="muted small">GLB/glTF and USDZ carry real-world scale (metres). OBJ, STL and PLY have no units — pick the unit the app exported, or use “Set scale”.</p>
    ${saved ? `<p class="small">Saved scan: <b>${esc(saved.title)}</b> — reopen the file to view it in 3D again.</p>` : ''}
    <details ${saved ? '' : 'open'}><summary class="small"><b>How to get a scan into Scan Lab</b></summary><ol class="small" style="padding-left:20px">${SCAN_HOWTO.map(([a, b]) => `<li><b>${a}:</b> ${b}</li>`).join('')}<li>Then tap <b>Open 3D file</b> here and pick it from Files.</li></ol></details></div>
  <div id="mfBody"></div>`;
  $('#mfOpen', out).onclick = () => $('#mfFile', out).click();
  $('#mfUnit', out).onchange = e => { st.unit = e.target.value; localStorage.setItem('mFileUnit', st.unit); if (st.file) loadIt(st.file); };
  $('#mfFile', out).onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) { st.file = f; loadIt(f); } };
  if (saved && st.dims) renderFileStats(out, st, null, saved);
  async function loadIt(f) {
    const body = $('#mfBody', out); body.innerHTML = '<div class="card"><span class="spinner"></span>Loading ' + esc(f.name) + '…</div>'; measure3dDisposeAll();
    try {
      const M = await m3d(), r = await M.loadModelFile(f, st.unit); st.name = f.name; st.format = r.format; st.unitsKnown = r.unitsKnown; st.points = !!r.points; st.scale = 1; st.measures = [];
      body.innerHTML = `<div class="card"><div id="mfStats"></div><div id="mfViewer" style="margin-top:6px"></div>
        <div class="row gap" style="margin-top:6px"><button class="pill" data-vw="iso">3/4</button><button class="pill" data-vw="front">Front</button><button class="pill" data-vw="side">Side</button><button class="pill" data-vw="top">Top</button><label class="small"><input type="checkbox" id="mfWire"> Wireframe</label></div>
        <div class="row gap" style="margin-top:6px"><button class="pill" id="mfPt" aria-pressed="false">📍 Measure 2 points</button><button class="pill" id="mfScale" aria-pressed="false">📏 Set scale</button></div>
        <p class="small muted" id="mfPickHelp"></p><div id="mfMeasures"></div>
        <div class="export-row" style="margin-top:8px"><button class="primary" id="mfSave">Save to History</button><button class="pill" id="mfPNG">⤓ PNG</button><button class="pill" id="mfPDF">⤓ Dimension sheet PDF</button><button class="pill" id="mfOBJ">⤓ OBJ</button><button class="pill" id="mfSTL">⤓ STL</button><button class="pill" id="mfGLB">⤓ GLB</button><button class="pill" id="mfGlass">🪟 Use as stained glass size</button></div></div>`;
      let mode = null; const help = $('#mfPickHelp', out);
      const viewer = M.createViewer($('#mfViewer', out), { onPick: (n, mm) => {
        if (n < 2) { help.textContent = mode === 'scale' ? 'Now tap the second point of the known length.' : 'Tap the second point.'; return; }
        if (mode === 'scale') { const v = prompt('Real length between the two points (e.g. 12 in or 30 cm):', ''); const m = v && v.match(/([\d.]+)\s*(mm|cm|m|in|"|inch|inches)?/i); if (m && +m[1] > 0) { const u = (m[2] || 'in').toLowerCase(), real = +m[1] * (u === 'mm' ? 1 : u === 'cm' ? 10 : u === 'm' ? 1000 : 25.4), k = real / mm; viewer.rescale(k); st.scale *= k; st.scaled = true; toast('Model rescaled ×' + k.toFixed(3)); refresh(); } setMode2(null); }
        else { st.measures.push(mm); help.textContent = 'Distance: ' + mmFmt(mm) + ' — tap two more points for another.'; refresh(); }
      } });
      VIEWERS.add(viewer); window.__viewer = viewer; viewer.setObject(r.object, r.mmPerUnit);
      const setMode2 = m => { mode = m; viewer.setPick(!!m); $('#mfPt', out).setAttribute('aria-pressed', String(m === 'pt')); $('#mfScale', out).setAttribute('aria-pressed', String(m === 'scale')); help.textContent = m === 'pt' ? 'Tap two points on the model.' : m === 'scale' ? 'Tap two points whose real distance you know.' : ''; };
      $('#mfPt', out).onclick = () => setMode2(mode === 'pt' ? null : 'pt'); $('#mfScale', out).onclick = () => setMode2(mode === 'scale' ? null : 'scale');
      $('#mfWire', out).onchange = e => viewer.setWire(e.target.checked); $$('[data-vw]', out).forEach(b => b.onclick = () => viewer.view(b.dataset.vw));
      const refresh = () => renderFileStats(out, st, viewer);
      refresh(); window.__mfApi = { viewer, setMode: setMode2 };
      const base = () => (st.name || 'scan').replace(/\.[^.]+$/, '') + '-scanlab';
      $('#mfPNG', out).onclick = () => fetch(viewer.png()).then(r => r.blob()).then(b => shareOrDownload(base() + '.png', b, 'image/png'));
      $('#mfOBJ', out).onclick = () => shareOrDownload(base() + '.obj', viewer.exportOBJ(), 'model/obj');
      $('#mfSTL', out).onclick = () => shareOrDownload(base() + '.stl', new Blob([viewer.exportSTL()]), 'model/stl');
      $('#mfGLB', out).onclick = async () => { try { shareOrDownload(base() + '.glb', new Blob([await viewer.exportGLB()]), 'model/gltf-binary'); } catch (e) { toast('GLB export failed: ' + e.message); } };
      $('#mfPDF', out).onclick = () => shareOrDownload(base() + '-dimensions.pdf', dimSheetPDF({ title: st.name, dims: st.dims, shape: 'scanned mesh', snap: viewer.jpeg(), source: st.format + (st.scaled ? ', rescaled by you' : st.unitsKnown ? '' : ', units: ' + st.unit), note: 'Dimensions are the scan’s bounding box. Accuracy depends on the scanner app.', stats: st.stats }).blob(), 'application/pdf');
      $('#mfGlass', out).onclick = () => useAsGlass(st.dims.L / 25.4, st.dims.H / 25.4, null);
      $('#mfSave', out).onclick = async () => { const snap = viewer.jpeg(); const sc = { id: uid(), at: Date.now(), mode: 'measure', kind: 'measure', title: 'Scan · ' + st.name, image: snap, thumb: await thumbOf(snap), result: { ...st, file: undefined } }; await DB.put('scans', sc); toast('Scan measurements saved'); $('#mfSave', out).textContent = 'Saved ✓'; };
    } catch (e) { body.innerHTML = `<div class="card err" role="alert"><b>Couldn’t open that file</b><p>${esc(e.message)}</p></div>`; }
  }
}
function renderFileStats(out, st, viewer, saved) {
  if (viewer) { const s = viewer.size(), t = viewer.stats(); st.dims = { L: s.L, W: s.W, H: s.H }; const bb = s.L * s.W * s.H; st.stats = { area: t.area, volume: !st.points && t.watertight ? t.volume : bb, volumeNote: !st.points && t.watertight ? 'mesh volume (watertight)' : 'bounding box (mesh not watertight)', watertight: t.watertight, tris: t.tris }; }
  const el = viewer ? $('#mfStats', out) : $('#mfBody', out); if (!el || !st.dims) return;
  el.innerHTML = `<div class="res-head"><b>${esc(st.name || 'Scan')}</b><span class="badge">${esc(st.format || '')}</span></div>
    <table><tr><td>L × W × H</td><td><b>${['L', 'W', 'H'].map(k => (st.dims[k] / 25.4).toFixed(2)).join(' × ')} in</b><br>${['L', 'W', 'H'].map(k => (st.dims[k] / 10).toFixed(1)).join(' × ')} cm</td></tr>
    <tr><td>Volume</td><td>${volFmt(st.stats.volume)}<div class="muted small">${esc(st.stats.volumeNote)}</div></td></tr>
    <tr><td>Surface area</td><td>${st.points ? 'n/a (point cloud)' : areaFmt(st.stats.area)}</td></tr>
    ${st.measures.length ? `<tr><td>Point-to-point</td><td>${st.measures.map(m => mmFmt(m)).join('<br>')}</td></tr>` : ''}</table>
    ${!st.unitsKnown && !st.scaled ? `<p class="small conf-medium">This format has no units — assumed ${esc(st.unit)}. If the size looks wrong, change the unit or use “Set scale”.</p>` : ''}`;
}
