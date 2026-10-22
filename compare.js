/* Scan Lab — Compare two scans: on-device alignment (scale/rotation/shift search), difference map, side-by-side / wipe / overlay / heatmap, Grok description, dimension comparison. */
function cmpGray(im, w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, w, h); const d = g.getImageData(0, 0, w, h).data, o = new Float32Array(w * h); for (let i = 0; i < w * h; i++) o[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; return o; }
/* sample B at A-frame pixel (x,y) under transform t = {s, r (rad), tx, ty} (fractions of width), bilinear */
function cmpMap(t, W, H) { const c = Math.cos(t.r) / t.s, s = Math.sin(t.r) / t.s, cx = W / 2, cy = H / 2, ox = t.tx * W, oy = t.ty * W; return (x, y) => { const dx = x - cx - ox, dy = y - cy - oy; return [c * dx + s * dy + cx, -s * dx + c * dy + cy]; }; }
function cmpScore(A, B, W, H, t) { // zero-mean normalised cross-correlation over overlapping pixels (robust to exposure)
  const m = cmpMap(t, W, H); let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let y = 1; y < H - 1; y += 1) for (let x = 1; x < W - 1; x += 1) { const [u, v] = m(x, y); if (u < 0 || v < 0 || u >= W - 1 || v >= H - 1) continue; const b = B[(v | 0) * W + (u | 0)], a = A[y * W + x]; n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; }
  if (n < W * H * 0.4) return -1; const va = saa - sa * sa / n, vb = sbb - sb * sb / n; return (sab - sa * sb / n) / Math.sqrt(Math.max(1e-6, va * vb)) - (1 - n / (W * H)) * 0.15;
}
function cmpGrad(G, W, H) { const o = new Float32Array(W * H); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; o[i] = Math.abs(G[i + 1] - G[i - 1]) + Math.abs(G[i + W] - G[i - W]); } return o; }
async function cmpAlign(imA, imB) {
  const ar = imA.naturalHeight / imA.naturalWidth; let best = { s: 1, r: 0, tx: 0, ty: 0 }, bs = -2;
  { const W = 72, H = Math.round(72 * ar), A = cmpGrad(cmpGray(imA, W, H), W, H), B = cmpGrad(cmpGray(imB, W, H), W, H);
    for (const s of [0.8, 0.9, 1, 1.1, 1.25]) for (const r of [-10, -5, 0, 5, 10]) for (let tx = -0.16; tx <= 0.161; tx += 0.04) for (let ty = -0.16; ty <= 0.161; ty += 0.04) { const t = { s, r: r * Math.PI / 180, tx, ty }, sc = cmpScore(A, B, W, H, t); if (sc > bs) { bs = sc; best = t; } } }
  const W = 200, H = Math.round(200 * ar), A = cmpGrad(cmpGray(imA, W, H), W, H), B = cmpGrad(cmpGray(imB, W, H), W, H); bs = cmpScore(A, B, W, H, best);
  for (let step = 1; step >= 0.124; step /= 2) { let imp = true; while (imp) { imp = false; for (const [k, d] of [['s', 0.04], ['r', 0.04], ['tx', 0.02], ['ty', 0.02]]) for (const sg of [-1, 1]) { const t = { ...best, [k]: best[k] + sg * d * step }, sc = cmpScore(A, B, W, H, t); if (sc > bs + 1e-4) { bs = sc; best = t; imp = true; } } } }
  return { ...best, score: Math.round(bs * 100) / 100 };
}
/* draw B warped into A's frame */
function cmpWarp(g, imB, t, W, H) { g.save(); g.translate(W / 2 + t.tx * W, H / 2 + t.ty * W); g.rotate(t.r); g.scale(t.s, t.s); g.drawImage(imB, -W / 2, -H / 2, W, H); g.restore(); }
function cmpDiff(imA, imB, t, W, H) {
  const ca = document.createElement('canvas'); ca.width = W; ca.height = H; const ga = ca.getContext('2d', { willReadFrequently: true }); ga.drawImage(imA, 0, 0, W, H); const a = ga.getImageData(0, 0, W, H).data;
  const cb = document.createElement('canvas'); cb.width = W; cb.height = H; const gb = cb.getContext('2d', { willReadFrequently: true }); gb.fillStyle = '#f0f'; gb.fillRect(0, 0, W, H); cmpWarp(gb, imB, t, W, H); const b = gb.getImageData(0, 0, W, H).data;
  const N = W * H, valid = new Uint8Array(N), m = cmpMap(t, W, H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [u, v] = m(x, y); valid[y * W + x] = u >= 1 && v >= 1 && u < W - 1 && v < H - 1 ? 1 : 0; }
  // per-channel mean/std normalisation over valid pixels (cancels exposure/white-balance shifts)
  const st = [a, b].map(d => [0, 1, 2].map(ch => { let s = 0, ss = 0, n = 0; for (let i = 0; i < N; i++) if (valid[i]) { const v = d[i * 4 + ch]; s += v; ss += v * v; n++; } const mu = s / Math.max(1, n); return [mu, Math.sqrt(Math.max(1, ss / Math.max(1, n) - mu * mu))]; }));
  const D = new Float32Array(N); for (let i = 0; i < N; i++) { if (!valid[i]) continue; let s = 0; for (let ch = 0; ch < 3; ch++) { const va = (a[i * 4 + ch] - st[0][ch][0]) / st[0][ch][1], vb = (b[i * 4 + ch] - st[1][ch][0]) / st[1][ch][1]; s += (va - vb) ** 2; } D[i] = Math.sqrt(s / 3) * 40; }
  const B2 = new Float32Array(N), R = 2; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) { const xx = x + i, yy = y + j; if (xx < 0 || yy < 0 || xx >= W || yy >= H || !valid[yy * W + xx]) continue; s += D[yy * W + xx]; n++; } B2[y * W + x] = n ? s / n : 0; }
  let mu = 0, n = 0; for (let i = 0; i < N; i++) if (valid[i]) { mu += B2[i]; n++; } mu /= Math.max(1, n); let sd = 0; for (let i = 0; i < N; i++) if (valid[i]) sd += (B2[i] - mu) ** 2; sd = Math.sqrt(sd / Math.max(1, n));
  const thr = Math.max(26, mu + 2 * sd), mask = new Uint8Array(N); let changed = 0; for (let i = 0; i < N; i++) if (valid[i] && B2[i] > thr) { mask[i] = 1; changed++; }
  const lab = new Int32Array(N).fill(-1), regions = [], q = new Int32Array(N);
  for (let i = 0; i < N; i++) { if (!mask[i] || lab[i] >= 0) continue; let h = 0, tl = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, s = 0; q[tl++] = i; lab[i] = regions.length;
    while (h < tl) { const p = q[h++], x = p % W, y = (p / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); s += B2[p]; for (const r of [p - 1, p + 1, p - W, p + W]) if (r >= 0 && r < N && mask[r] && lab[r] < 0 && Math.abs((r % W) - x) <= 1) { lab[r] = regions.length; q[tl++] = r; } }
    regions.push({ box: [x0 / W, y0 / H, (x1 + 1) / W, (y1 + 1) / H], area: tl / N, strength: s / tl }); }
  const keep = regions.filter(r => r.area >= 0.002).sort((p, q2) => q2.area - p.area).slice(0, 12);
  return { D: B2, thr, valid, changedPct: Math.round(changed / Math.max(1, n) * 1000) / 10, regions: keep };
}
const CMP_SCHEMA = `{"kind":"compare","summary":"2–3 sentences","same_object":"yes|no|unclear","change":"improved|worse|same|different|unclear","differences":[{"what":"","where":"","significance":"minor|notable|major"}],"confidence":"low|medium|high"}`;
function comparePrompt(kind, labels, hint) {
  return `COMPARE SCANS. Image 1 is "${labels[0]}" and image 2 is "${labels[1]}". ${kind === 'before' ? 'They are before/after photos of the same thing — describe what changed (damage, wear, repairs, cleaning, missing or added parts, position).' : 'They are two parts/objects to compare side by side — describe the visible differences (shape, size, color, finish, features, markings, damage).'}
${hint ? `User note: "${hint}"\n` : ''}Ignore differences caused only by lighting, camera angle or background unless they hide something. Answer with strict JSON only, exactly this shape: ${CMP_SCHEMA}`;
}
function validateCompare(o) {
  if (!o || typeof o !== 'object') throw Object.assign(new Error('The AI answer wasn’t a comparison.'), { kind: 'badjson' });
  const en = (v, list, d) => { v = String(v || '').toLowerCase(); return list.includes(v) ? v : d; };
  return { summary: str(o.summary, 600) || '', same: en(o.same_object, ['yes', 'no', 'unclear'], 'unclear'), change: en(o.change, ['improved', 'worse', 'same', 'different', 'unclear'], 'unclear'), confidence: conf(o.confidence),
    differences: (Array.isArray(o.differences) ? o.differences : []).filter(d => d && typeof d === 'object').slice(0, 12).map(d => ({ what: str(d.what, 200), where: str(d.where, 100), sig: en(d.significance, ['minor', 'notable', 'major'], 'notable') })).filter(d => d.what) };
}
/* dimension comparison between two saved Measure scans */
function cmpDims(ra, rb) {
  const dimsOf = r => { if (!r || r.kind !== 'measure') return null; if (r.dims) return [['Length', r.dims.L], ['Width', r.dims.W], ['Height', r.dims.H]].filter(x => x[1] > 0); return (r.lines || []).filter(l => l.mm > 0).map(l => ['Line ' + (l.tag || l.label || l.id), l.mm]); };
  const a = dimsOf(ra), b = dimsOf(rb); if (!a || !b || !a.length || !b.length) return null;
  return a.map(([k, va]) => { const m = b.find(x => x[0] === k); return m ? { k, a: va, b: m[1], d: m[1] - va, pct: (m[1] - va) / va * 100 } : null; }).filter(Boolean);
}
async function compareOpen(out, { a, b, scans = [null, null], saved, hint = '' } = {}) {
  let scan = saved || null; const st = saved ? saved.result : { kind: 'compare', labels: ['A', 'B'], purpose: 'before', align: null, diff: null, grok: null, dims: null, ids: scans.map(s => s && s.id) };
  const srcA = saved ? saved.image : a, srcB = saved ? saved.image2 : b, imA = await loadImg(srcA), imB = await loadImg(srcB);
  if (!saved) { st.labels = scans[0] && scans[1] ? [scans[0].title, scans[1].title] : ['Before', 'After']; st.dims = scans[0] && scans[1] ? cmpDims(scans[0].result, scans[1].result) : null; }
  const W = Math.min(900, imA.naturalWidth), H = Math.round(W * imA.naturalHeight / imA.naturalWidth); let view = 'side', wipe = 0.5, op = 0.5, D = null;
  out.innerHTML = `<div class="card"><div class="res-head"><h2>Compare</h2><span class="badge" id="cmpBadge">aligning…</span></div>
    <div class="seg" role="group" aria-label="Purpose"><button data-cp="before">Before / after</button><button data-cp="parts">Part A vs B</button></div>
    <div class="seg seg-grid" role="group" aria-label="View" style="margin-top:8px"><button data-cv="side" aria-pressed="true">Side by side</button><button data-cv="wipe">Slider</button><button data-cv="overlay">Overlay</button><button data-cv="diff">Differences</button><button data-cv="align">Align: on</button></div>
    <div class="tap-wrap" style="margin-top:8px"><canvas id="cmpCanvas" aria-label="Comparison view"></canvas></div>
    <label class="field" id="cmpSlW">Slider <input type="range" id="cmpSl" min="0" max="100" value="50"></label>
    <p class="small" id="cmpStat"></p></div>
  <div class="card" id="cmpDims" ${st.dims && st.dims.length ? '' : 'hidden'}></div>
  <div class="card" id="cmpGrok"></div>
  <div class="card"><div class="row gap wrap"><button class="primary" id="cmpSave">${saved ? 'Saved ✓' : 'Save to History'}</button><button class="pill" id="cmpPNG">⤓ Image</button></div>
    <p class="disclaimer">Difference highlighting is on-device and also reacts to glare, shadows and background. Grok’s description is an AI visual estimate, not a lab measurement.</p></div>`;
  const c = $('#cmpCanvas', out), g = c.getContext('2d'); let alignOn = true;
  const T = () => alignOn && st.align ? st.align : { s: 1, r: 0, tx: 0, ty: 0 };
  const boxes = (x0, w, h, col = '#ff4d4d') => { if (!st.diff) return; g.lineWidth = Math.max(2, w / 250); st.diff.regions.forEach(r => { g.strokeStyle = '#000'; g.strokeRect(x0 + r.box[0] * w, r.box[1] * h, (r.box[2] - r.box[0]) * w, (r.box[3] - r.box[1]) * h); g.strokeStyle = col; g.strokeRect(x0 + r.box[0] * w + 1, r.box[1] * h + 1, (r.box[2] - r.box[0]) * w - 2, (r.box[3] - r.box[1]) * h - 2); }); };
  const label = (t, x, y) => { g.font = `bold ${Math.round(c.width / 28)}px -apple-system,sans-serif`; const w = g.measureText(t).width + 12; g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x, y, w, c.width / 20); g.fillStyle = '#fff'; g.textBaseline = 'top'; g.fillText(t, x + 6, y + 4); };
  const draw = () => {
    $('#cmpSlW', out).hidden = !(view === 'wipe' || view === 'overlay'); $('#cmpSl', out).value = Math.round((view === 'wipe' ? wipe : op) * 100);
    if (view === 'side') { const portrait = H > W * 0.9; if (portrait) { c.width = W * 2 + 8; c.height = H; } else { c.width = W; c.height = H * 2 + 8; } g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(imA, 0, 0, W, H); boxes(0, W, H); if (portrait) { g.save(); g.translate(W + 8, 0); } else { g.save(); g.translate(0, H + 8); } const cl = new Path2D(); cl.rect(0, 0, W, H); g.clip(cl); cmpWarp(g, imB, T(), W, H); g.restore();
      if (portrait) { g.save(); g.translate(W + 8, 0); boxes(0, W, H, '#6ff0c4'); g.restore(); } else { g.save(); g.translate(0, H + 8); boxes(0, W, H, '#6ff0c4'); g.restore(); }
      label('1 · ' + st.labels[0].slice(0, 22), 6, 6); label('2 · ' + st.labels[1].slice(0, 22), portrait ? W + 14 : 6, portrait ? 6 : H + 14); return; }
    c.width = W; c.height = H; g.fillStyle = '#111'; g.fillRect(0, 0, W, H);
    if (view === 'wipe') { g.drawImage(imA, 0, 0, W, H); g.save(); const cl = new Path2D(); cl.rect(W * wipe, 0, W, H); g.clip(cl); g.fillStyle = '#111'; g.fillRect(0, 0, W, H); cmpWarp(g, imB, T(), W, H); g.restore(); g.fillStyle = '#fff'; g.fillRect(W * wipe - 1.5, 0, 3, H); label('1', 6, 6); label('2', W - 40, 6); }
    else if (view === 'overlay') { g.drawImage(imA, 0, 0, W, H); g.globalAlpha = op; cmpWarp(g, imB, T(), W, H); g.globalAlpha = 1; }
    else { g.drawImage(imA, 0, 0, W, H); const id = g.getImageData(0, 0, W, H), d = id.data, dw = st.diff ? st.diff.W : 0; if (D) { const dh = st.diff.H; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = (y * W + x) * 4, gr = 0.3 * d[k] + 0.59 * d[k + 1] + 0.11 * d[k + 2], v = D[Math.min(dh - 1, (y * dh / H) | 0) * dw + Math.min(dw - 1, (x * dw / W) | 0)] / (st.diff.thr * 1.6), t = Math.max(0, Math.min(1, v)); d[k] = gr * (1 - t) * 0.6 + 255 * t; d[k + 1] = gr * (1 - t) * 0.6 + 60 * t; d[k + 2] = gr * (1 - t) * 0.6 + 60 * t; } } g.putImageData(id, 0, 0); boxes(0, W, H); }
  };
  const stat = () => { const a = st.align; $('#cmpBadge', out).textContent = st.diff ? st.diff.changedPct + '% changed' : '—';
    $('#cmpStat', out).innerHTML = (a ? `Alignment: scale ${a.s.toFixed(2)}×, rotation ${(a.r * 180 / Math.PI).toFixed(1)}°, shift ${(a.tx * 100).toFixed(0)}% / ${(a.ty * 100).toFixed(0)}% <span class="muted">(match ${a.score})</span>${a.score < 0.25 ? ' — <b>weak match</b>: photos may be too different to overlay; use Side by side.' : ''}<br>` : '') + (st.diff ? `${st.diff.regions.length} changed region${st.diff.regions.length === 1 ? '' : 's'} highlighted.` : ''); };
  const analyse = async () => { if (!st.align) st.align = await cmpAlign(imA, imB); const dw = 240, dh = Math.round(240 * H / W), r = cmpDiff(imA, imB, T(), dw, dh); D = r.D; st.diff = { regions: r.regions, changedPct: r.changedPct, thr: r.thr, W: dw, H: dh }; stat(); draw(); };
  const renderDims = () => { const el = $('#cmpDims', out); if (!st.dims || !st.dims.length) return; const f = mm => (mm / 25.4).toFixed(2) + ' in';
    el.innerHTML = `<h3 style="margin-top:0">Dimensions</h3><table class="dims"><tr><th></th><th>1</th><th>2</th><th>Δ</th></tr>${st.dims.map(d => `<tr><td>${esc(d.k)}</td><td>${f(d.a)}</td><td>${f(d.b)}</td><td><b>${d.d >= 0 ? '+' : '−'}${(Math.abs(d.d) / 25.4).toFixed(2)} in</b> <span class="muted small">(${d.pct >= 0 ? '+' : ''}${d.pct.toFixed(1)}%)</span></td></tr>`).join('')}</table><p class="small muted">From the two saved measurements (each has its own measurement uncertainty).</p>`; };
  const renderGrok = () => { const el = $('#cmpGrok', out), r = st.grok;
    el.innerHTML = `<div class="res-head"><h3 style="margin:0">What’s different</h3>${aiHasKey() ? `<button class="pill" id="cmpAsk">✨ ${r ? 'Ask again' : 'Describe with Grok'}</button>` : ''}</div>
      ${r ? `<p class="small">${esc(r.summary)}</p><p class="small muted">${st.purpose === 'before' ? 'Change: <b>' + esc(r.change) + '</b> · ' : ''}Same object: ${esc(r.same)} · ${r.confidence} confidence</p><ul class="tight small">${r.differences.map(d => `<li><span class="badge ${d.sig === 'major' ? 'conf-low' : d.sig === 'notable' ? 'conf-medium' : 'conf-high'}">${d.sig}</span> ${esc(d.what)}${d.where ? ' <span class="muted">— ' + esc(d.where) + '</span>' : ''}</li>`).join('')}</ul>`
        : `<p class="small muted">${aiHasKey() ? 'Grok can describe the differences in words.' : 'Add a key in Settings to have Grok describe the differences. The on-device highlight works without one.'}</p>`}`;
    const bt = $('#cmpAsk', el); if (bt) bt.onclick = ask; };
  const ask = async () => { const bt = $('#cmpAsk', out); bt.disabled = true; bt.innerHTML = '<span class="spinner"></span>Comparing…';
    try { const raw = await aiChat([{ role: 'system', content: 'You compare photos carefully and answer with strict JSON only.' }, { role: 'user', content: [{ type: 'text', text: comparePrompt(st.purpose, st.labels, hint) }, imgPart(srcA), imgPart(srcB)] }]); st.grok = validateCompare(parseJSONLoose(raw)); if (scan) { scan.result = st; DB.put('scans', scan); } }
    catch (e) { toast(e.message); } renderGrok(); };
  $$('[data-cp]', out).forEach(bt => { bt.setAttribute('aria-pressed', String(bt.dataset.cp === st.purpose)); bt.onclick = () => { st.purpose = bt.dataset.cp; $$('[data-cp]', out).forEach(x => x.setAttribute('aria-pressed', String(x === bt))); if (!saved && !(scans[0] && scans[1])) st.labels = st.purpose === 'before' ? ['Before', 'After'] : ['Part A', 'Part B']; draw(); renderGrok(); }; });
  $$('[data-cv]', out).forEach(bt => bt.onclick = async () => { if (bt.dataset.cv === 'align') { alignOn = !alignOn; bt.textContent = 'Align: ' + (alignOn ? 'on' : 'off'); bt.setAttribute('aria-pressed', String(!alignOn)); await analyse(); return; } view = bt.dataset.cv; $$('[data-cv]', out).forEach(x => x.dataset.cv !== 'align' && x.setAttribute('aria-pressed', String(x === bt))); draw(); });
  $('#cmpSl', out).oninput = e => { const v = +e.target.value / 100; if (view === 'wipe') wipe = v; else op = v; draw(); };
  let dragging = false; c.addEventListener('pointerdown', e => { if (view !== 'wipe') return; dragging = true; try { c.setPointerCapture(e.pointerId); } catch (_) {} });
  c.addEventListener('pointermove', e => { if (!dragging) return; const b = c.getBoundingClientRect(); wipe = Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)); draw(); }); c.addEventListener('pointerup', () => { dragging = false; });
  $('#cmpSave', out).onclick = async () => { if (!scan) scan = { id: uid(), at: Date.now(), mode: 'compare', kind: 'compare', image: srcA, image2: srcB, thumb: await thumbOf(srcA) };
    scan.title = 'Compare · ' + st.labels.join(' vs ').slice(0, 60); scan.result = st; await DB.put('scans', scan); $('#cmpSave', out).textContent = 'Saved ✓'; toast('Comparison saved'); };
  $('#cmpPNG', out).onclick = async () => { const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9)); shareOrDownload('compare-' + todayStr() + '.jpg', blob, 'image/jpeg'); };
  renderDims(); renderGrok(); draw(); await analyse(); window.__compare = { st, out };
}
function compareSummary(r) { return (r.diff ? r.diff.changedPct + '% changed' : '') + (r.dims && r.dims.length ? ' · ' + r.dims.length + ' dims' : '') + (r.grok ? ' · ' + r.grok.differences.length + ' differences' : ''); }
/* pick two history items to compare */
async function comparePickHistory(out) {
  const all = (await DB.all('scans')).filter(s => s.image && s.kind !== 'voice' && s.kind !== 'compare').sort((a, b) => b.at - a.at), sel = [];
  out.innerHTML = `<div class="card"><h2>Compare two saved scans</h2><p class="muted small">Pick two — the first is “1”. Two Measure scans also compare by dimensions.</p>
    <div id="cmpPick">${all.map(s => `<button class="hist-open pickable" data-pk="${s.id}" aria-pressed="false"><img src="${s.thumb || ''}" alt=""><div class="meta"><b>${KIND_ICON[s.kind] || ''} ${esc(s.title)}</b><span>${fmtWhen(s.at)}</span></div></button>`).join('') || '<p class="muted">No saved scans with photos yet.</p>'}</div>
    <div class="row gap" style="margin-top:8px"><button class="primary" id="cmpGo" disabled>Compare</button></div></div>`;
  $$('[data-pk]', out).forEach(b => b.onclick = () => { const i = sel.indexOf(b.dataset.pk); if (i >= 0) sel.splice(i, 1); else { if (sel.length === 2) sel.shift(); sel.push(b.dataset.pk); }
    $$('[data-pk]', out).forEach(x => { const k = sel.indexOf(x.dataset.pk); x.setAttribute('aria-pressed', String(k >= 0)); x.dataset.n = k >= 0 ? k + 1 : ''; }); $('#cmpGo', out).disabled = sel.length !== 2; });
  $('#cmpGo', out).onclick = () => { const [a, b] = sel.map(id => all.find(s => s.id === id)); compareOpen(out, { a: a.image, b: b.image, scans: [a, b] }); };
}
