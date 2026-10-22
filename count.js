/* Scan Lab — Count items: Grok count with points, or on-device blob counting; tap markers to correct. */
const COUNT_SCHEMA = `{"kind":"count","item":"what was counted, e.g. M8 hex bolts","count":number,"points":[[x,y],...],"confidence":"low|medium|high","notes":"overlaps, partly hidden items, what you excluded"}`;
function countPrompt(item) {
  return `COUNT ITEMS. Count every separate ${item ? `"${item}"` : 'instance of the main repeated object (bolts, parts, pieces, pills, coins…)'} visible in the photo. Include partly hidden ones you are confident about; do not count reflections or shadows.
Return one point per counted item at its visual centre, as [x,y] fractions of the image width and height (0–1, origin top-left). "count" must equal the number of points.
Answer with strict JSON only, exactly this shape: ${COUNT_SCHEMA}`;
}
function validateCount(o) {
  if (!o || typeof o !== 'object') throw Object.assign(new Error('The AI answer wasn’t a count.'), { kind: 'badjson' });
  const pts = (Array.isArray(o.points) ? o.points : []).map(p => Array.isArray(p) ? p : p && typeof p === 'object' ? [p.x, p.y] : null).filter(Boolean)
    .map(([x, y]) => [num(x), num(y)]).filter(([x, y]) => x != null && y != null).map(([x, y]) => (x > 1.5 || y > 1.5 ? [x / 1000, y / 1000] : [x, y])).map(([x, y]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]).slice(0, 2000);
  const n = num(o.count); if (n == null && !pts.length) throw Object.assign(new Error('The AI answer had no count.'), { kind: 'badjson', raw: JSON.stringify(o).slice(0, 800) });
  return { kind: 'count', item: str(o.item, 80) || 'items', aiCount: n == null ? pts.length : Math.round(n), points: pts, confidence: conf(o.confidence), notes: str(o.notes, 600) };
}
/* On-device: separate foreground from the border-estimated background, open, label blobs, split touching blobs by area. */
function countBlobs(imgData) {
  const { width: W, height: H, data } = imgData, N = W * H, bg = [0, 0, 0]; let nb = 0;
  for (let x = 0; x < W; x++) for (const y of [0, 1, H - 2, H - 1]) { const k = (y * W + x) * 4; bg[0] += data[k]; bg[1] += data[k + 1]; bg[2] += data[k + 2]; nb++; }
  for (let y = 0; y < H; y++) for (const x of [0, 1, W - 2, W - 1]) { const k = (y * W + x) * 4; bg[0] += data[k]; bg[1] += data[k + 1]; bg[2] += data[k + 2]; nb++; }
  bg.forEach((v, i) => bg[i] = v / nb);
  const d = new Float32Array(N); for (let i = 0; i < N; i++) { const k = i * 4; d[i] = Math.hypot(data[k] - bg[0], data[k + 1] - bg[1], data[k + 2] - bg[2]); }
  const b = new Float32Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += d[yy * W + xx]; n++; } } b[y * W + x] = s / n; }
  const hist = new Array(256).fill(0); for (let i = 0; i < N; i++) hist[Math.min(255, b[i] | 0)]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i]; let sB = 0, wB = 0, best = 0, t = 40;
  for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = N - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; t = i; } }
  t = Math.max(t, 28);
  let m = new Uint8Array(N); for (let i = 0; i < N; i++) m[i] = b[i] > t ? 1 : 0;
  const morph = (src, er) => { const o = new Uint8Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let any = 0, all = 1; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j, s = xx >= 0 && yy >= 0 && xx < W && yy < H ? src[yy * W + xx] : 0; any |= s; all &= s; } o[y * W + x] = er ? all : any; } return o; };
  m = morph(morph(m, true), false);
  const lab = new Int32Array(N).fill(-1), comps = []; const q = new Int32Array(N);
  for (let i = 0; i < N; i++) { if (!m[i] || lab[i] >= 0) continue; let h = 0, tl = 0; q[tl++] = i; lab[i] = comps.length; const px = [];
    while (h < tl) { const p = q[h++]; px.push(p); const x = p % W, y = (p / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const r = yy * W + xx; if (m[r] && lab[r] < 0) { lab[r] = comps.length; q[tl++] = r; } } }
    comps.push(px); }
  const minA = Math.max(6, N * 0.00015), big = comps.filter(c => c.length >= minA); if (!big.length) return { points: [], blobs: 0 };
  const areas = big.map(c => c.length).sort((a, b) => a - b), med = areas[Math.floor(areas.length / 2)];
  const pts = [];
  for (const c of big) {
    if (c.length < med * 0.3) continue;
    const k = c.length > med * 1.6 ? Math.max(1, Math.round(c.length / med)) : 1;
    const xy = c.map(p => [p % W, (p / W) | 0]);
    if (k === 1) { const cx = xy.reduce((a, p) => a + p[0], 0) / xy.length, cy = xy.reduce((a, p) => a + p[1], 0) / xy.length; pts.push([cx / W, cy / H]); continue; }
    // k-means on pixel coordinates (deterministic farthest-point seeds)
    let cen = [xy[0]]; while (cen.length < k) { let bd = -1, bp = xy[0]; for (const p of xy) { const dd = Math.min(...cen.map(c2 => (p[0] - c2[0]) ** 2 + (p[1] - c2[1]) ** 2)); if (dd > bd) { bd = dd; bp = p; } } cen.push(bp); }
    for (let it = 0; it < 12; it++) { const acc = cen.map(() => [0, 0, 0]); for (const p of xy) { let bi = 0, bd = 1e18; cen.forEach((c2, j) => { const dd = (p[0] - c2[0]) ** 2 + (p[1] - c2[1]) ** 2; if (dd < bd) { bd = dd; bi = j; } }); acc[bi][0] += p[0]; acc[bi][1] += p[1]; acc[bi][2]++; } cen = acc.map((a, j) => a[2] ? [a[0] / a[2], a[1] / a[2]] : cen[j]); }
    cen.forEach(c2 => pts.push([c2[0] / W, c2[1] / H]));
  }
  return { points: pts, blobs: big.length, threshold: t };
}
async function countOpen(out, { image, saved, hint = '' } = {}) {
  let scan = saved || null; const st = saved ? saved.result : { kind: 'count', item: hint || '', points: [], method: aiHasKey() ? 'grok' : 'local', aiCount: null, confidence: null, notes: '', edits: 0 };
  const src = saved ? saved.image : image, img = await loadImg(src);
  out.innerHTML = `<div class="card"><div class="res-head"><h2>Count</h2><span class="badge" id="cBadge"></span></div>
    <label class="field">What to count <input id="cItem" placeholder="e.g. bolts, washers, tiles (optional)" value="${esc(st.item)}"></label>
    <div class="seg" role="group" aria-label="Method"><button data-cm="grok" aria-pressed="${st.method === 'grok'}">Grok</button><button data-cm="local" aria-pressed="${st.method === 'local'}">On-device</button></div>
    <div class="count-big"><b id="cN">–</b> <span id="cWhat" class="muted"></span></div>
    <div class="tap-wrap"><canvas id="cCanvas" aria-label="Photo with numbered markers — tap a marker to remove it, tap empty space to add one"></canvas></div>
    <p class="muted small" id="cNote">Tap a marker to remove it, tap an uncounted item to add one.</p>
    <div class="row gap wrap"><button class="pill" id="cRerun">↻ Count again</button><button class="pill" id="cUndo" disabled>Undo</button></div></div>
    <div class="card">${actBar({ save: 'cSave', exports: [['cCSV', '⤓ CSV (all counts)']] })}
    <p class="disclaimer">Counts from a photo can miss stacked, overlapping or hidden items — spread parts out on a plain contrasting surface for the best result, and check the markers.</p></div>`;
  const c = $('#cCanvas', out), g = c.getContext('2d'), sc = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight)); c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
  const hist = [];
  const draw = () => { g.drawImage(img, 0, 0, c.width, c.height); const k = Math.max(1, c.width / 500), R = Math.max(9, Math.min(16, c.width / (8 + Math.sqrt(st.points.length) * 4))) * k / 1.4 + 4;
    st.points.forEach(([x, y], i) => { const px = x * c.width, py = y * c.height; g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.arc(px, py, R + 2, 0, 7); g.fill(); g.fillStyle = '#6ff0c4'; g.beginPath(); g.arc(px, py, R, 0, 7); g.fill();
      g.fillStyle = '#04241a'; g.font = `bold ${Math.round(R * (i >= 99 ? 0.8 : 1.05))}px -apple-system,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), px, py + 1); });
    $('#cN', out).textContent = st.points.length; $('#cWhat', out).textContent = st.item || 'items';
    $('#cBadge', out).textContent = st.method === 'grok' ? (st.confidence ? st.confidence + ' confidence' : 'Grok') : 'on-device';
    $('#cUndo', out).disabled = !hist.length;
    const parts = []; if (st.aiCount != null && st.method === 'grok' && st.aiCount !== st.points.length) parts.push(`Grok said ${st.aiCount}.`); if (st.edits) parts.push(`${st.edits} manual correction${st.edits === 1 ? '' : 's'}.`); if (st.notes) parts.push(st.notes);
    $('#cNote', out).textContent = (parts.length ? parts.join(' ') + ' ' : '') + 'Tap a marker to remove it, tap an uncounted item to add one.'; };
  const run = async () => {
    st.item = $('#cItem', out).value.trim(); hist.length = 0; st.edits = 0;
    if (st.method === 'grok') {
      if (!aiHasKey()) { st.method = 'local'; $$('[data-cm]', out).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cm === 'local'))); toast('No API key — counting on this device'); }
      else {
        $('#cN', out).innerHTML = '<span class="spinner"></span>'; 
        try { const raw = await aiChat([{ role: 'system', content: 'You count objects in photos precisely and answer with strict JSON only.' }, { role: 'user', content: [{ type: 'text', text: countPrompt(st.item) }, imgPart(src)] }]);
          const r = validateCount(parseJSONLoose(raw)); Object.assign(st, { points: r.points, aiCount: r.aiCount, confidence: r.confidence, notes: r.notes }); if (!st.item) { st.item = r.item; $('#cItem', out).value = r.item; } draw(); return;
        } catch (e) { if (e.kind === 'cancel') return; toast((e.kind === 'offline' ? 'Offline' : 'Grok count failed') + ' — counted on this device instead'); st.method = 'local'; $$('[data-cm]', out).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cm === 'local'))); }
      }
    }
    const s = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s), cc = document.createElement('canvas'); cc.width = w; cc.height = h; const gg = cc.getContext('2d'); gg.drawImage(img, 0, 0, w, h);
    const r = countBlobs(gg.getImageData(0, 0, w, h)); Object.assign(st, { points: r.points, aiCount: null, confidence: null, notes: r.points.length ? 'On-device count: works best with separated items on a plain background.' : 'Nothing stood out from the background — try a plain contrasting surface.' }); draw();
  };
  c.addEventListener('pointerup', e => {
    const b = c.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height, R = 0.035 * Math.max(1, 500 / b.width);
    let bi = -1, bd = 1e9; st.points.forEach(([px, py], i) => { const d = Math.hypot((px - x) * b.width, (py - y) * b.height); if (d < bd) { bd = d; bi = i; } });
    hist.push(st.points.map(p => p.slice())); if (hist.length > 50) hist.shift();
    if (bi >= 0 && bd <= Math.max(22, R * b.width)) st.points.splice(bi, 1); else st.points.push([x, y]);
    st.edits++; draw();
  });
  $('#cUndo', out).onclick = () => { if (!hist.length) return; st.points = hist.pop(); st.edits = Math.max(0, st.edits - 1); draw(); };
  $$('[data-cm]', out).forEach(b => b.onclick = () => { st.method = b.dataset.cm; $$('[data-cm]', out).forEach(x => x.setAttribute('aria-pressed', String(x === b))); run(); });
  $('#cRerun', out).onclick = run; $('#cItem', out).onchange = () => { st.item = $('#cItem', out).value.trim(); draw(); };
  $('#cSave', out).onclick = async () => { st.item = $('#cItem', out).value.trim() || st.item; if (!scan) scan = { id: uid(), at: Date.now(), mode: 'count', kind: 'count', image: src, thumb: await thumbOf(src) };
    scan.title = `Count · ${st.points.length} ${st.item || 'items'}`; scan.result = { ...st, count: st.points.length }; await DB.put('scans', scan); $('#cSave', out).textContent = 'Saved ✓'; toast('Count saved'); };
  $('#cCSV', out).onclick = exportCountsCSV;
  if (saved) draw(); else await run();
  window.__count = { st, out };
}
async function exportCountsCSV() {
  const list = (await DB.all('scans')).filter(s => s.kind === 'count').sort((a, b) => a.at - b.at); if (!list.length) return toast('Save a count first');
  const rows = [['Date', 'Time', 'Item', 'Count', 'Method', 'Grok count', 'Manual corrections', 'Confidence', 'Notes']];
  list.forEach(s => { const r = s.result, d = new Date(s.at); rows.push([todayStr(d), d.toTimeString().slice(0, 5), r.item, r.points.length, r.method === 'grok' ? 'Grok' : 'On-device', r.aiCount ?? '', r.edits || 0, r.confidence || '', r.notes]); });
  shareOrDownload('counts-' + todayStr() + '.csv', rows.map(r => r.map(csvCell).join(',')).join('\r\n'), 'text/csv');
}
