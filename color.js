/* Scan Lab — Color match: tap to sample (averaged), optional white-reference correction, HEX/RGB/LAB, nearest named / paint / glass colors. */
const s2l = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const l2s = v => { v = Math.max(0, Math.min(1, v)); return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); };
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
function rgb2lab(c) {
  const [r, g, b] = c.map(s2l);
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b, Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const fx = f(X), fy = f(Y), fz = f(Z); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/* CIEDE2000 (Sharma, Wu & Dalal 2005) */
function dE2000(L1, L2) {
  const [l1, a1, b1] = L1, [l2, a2, b2] = L2, rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2, G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (a, b) => { if (a === 0 && b === 0) return 0; const t = Math.atan2(b, a) * deg; return t < 0 ? t + 360 : t; };
  const h1p = h(a1p, b1), h2p = h(a2p, b2), dLp = l2 - l1, dCp = C2p - C1p;
  let dhp = 0; if (C1p * C2p) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2 * rad), Lbp = (l1 + l2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p; if (C1p * C2p) { if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360; hbp /= 2; }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.20 * Math.cos((4 * hbp - 63) * rad);
  const dth = 30 * Math.exp(-(((hbp - 275) / 25) ** 2)), Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + 0.015 * (Lbp - 50) ** 2 / Math.sqrt(20 + (Lbp - 50) ** 2), Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T, Rt = -Math.sin(2 * dth * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}
const PAL_LAB = new Map();
function palLab(key, list, toHex) { if (!PAL_LAB.has(key)) PAL_LAB.set(key, list.map(e => ({ e, lab: rgb2lab(hex2rgb(toHex(e))) }))); return PAL_LAB.get(key); }
const PALETTES = {
  css: () => palLab('css', CSS_COLORS, e => e[1]), sw: () => palLab('sw', SW_COLORS, e => e[2]), ral: () => palLab('ral', RAL_COLORS, e => e[2]),
  glass: () => palLab('glass', GLASS_PALETTE, e => rgb2hex(e.slice(1))),
};
function nearestIn(key, lab, n = 3) { return PALETTES[key]().map(x => ({ e: x.e, d: dE2000(lab, x.lab) })).sort((a, b) => a.d - b.d).slice(0, n); }
const dEWord = d => d < 1 ? 'same to the eye' : d < 2 ? 'barely different' : d < 5 ? 'close' : d < 10 ? 'noticeably different' : 'different';
/* average sRGB over a disc in linear light */
function sampleAt(id, x, y, r) {
  const { width: W, height: H, data } = id; let n = 0, s = [0, 0, 0];
  for (let j = Math.max(0, Math.round(y - r)); j <= Math.min(H - 1, Math.round(y + r)); j++) for (let i = Math.max(0, Math.round(x - r)); i <= Math.min(W - 1, Math.round(x + r)); i++) {
    if ((i - x) ** 2 + (j - y) ** 2 > r * r) continue; const k = (j * W + i) * 4; s[0] += s2l(data[k]); s[1] += s2l(data[k + 1]); s[2] += s2l(data[k + 2]); n++; }
  return n ? s.map(v => v / n) : [0, 0, 0];
}
/* von Kries-style gains in linear RGB so the tapped reference becomes neutral (scaled to its brightest channel) */
function wbGains(refLin) { const m = Math.max(refLin[0], refLin[1], refLin[2]) || 1e-6; return refLin.map(v => m / Math.max(v, 1e-6)); }
function colorInfo(lin, gains) {
  const raw = lin.map(l2s), cor = gains ? lin.map((v, i) => l2s(v * gains[i])) : raw, lab = rgb2lab(cor);
  return { raw: rgb2hex(raw), hex: rgb2hex(cor), rgb: cor, lab: lab.map(v => Math.round(v * 10) / 10), css: nearestIn('css', lab), sw: nearestIn('sw', lab), ral: nearestIn('ral', lab), glass: nearestIn('glass', lab) };
}
const GLASS_COLORS_KEY = 'glassColors';
async function colorOpen(out, { image, saved } = {}) {
  const st = saved ? saved.result : { kind: 'color', samples: [], white: null, r: 10 }; let scan = saved || null, tool = 'sample';
  const img = await loadImg(saved ? saved.image : image), cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const g0 = cv.getContext('2d'); g0.drawImage(img, 0, 0); const id = g0.getImageData(0, 0, cv.width, cv.height);
  out.innerHTML = `<div class="card"><div class="res-head"><h2>Color match</h2><span class="badge">on-device</span></div>
    <p class="muted small" id="colHelp"></p>
    <div class="tap-wrap"><canvas id="colCanvas" aria-label="Photo — tap to sample a color"></canvas></div>
    <div class="seg" role="group" aria-label="Tap tool" style="margin-top:8px"><button data-ct="sample" aria-pressed="true">Sample color</button><button data-ct="white" aria-pressed="false">White reference</button></div>
    <div class="ctl" style="margin-top:8px"><label>Sample size <b id="colRV"></b><input type="range" id="colR" min="2" max="40" step="1"></label><div id="colWB" class="small" style="align-self:center"></div></div></div>
    <div id="colList"></div>
    <div class="card"><div class="row gap wrap"><button class="primary" id="colGlass">🪟 Send to Stained Glass</button><button class="pill" id="colSave">Save to History</button><button class="pill" id="colCSV">⇩ CSV</button></div>
    <p class="disclaimer">All matches are approximate. Camera processing, lighting and your screen all shift color — hold a real paint chip or glass sample next to the object in daylight before buying. Paint values are the screen colors the makers publish (Sherwin-Williams) or community sRGB values (RAL Classic); glass colors are a generic list, not a specific manufacturer. ΔE00: under 2 barely visible, 2–5 close, over 10 clearly different.</p></div>`;
  const c = $('#colCanvas', out), g = c.getContext('2d'); c.width = cv.width; c.height = cv.height;
  const gains = () => st.white ? wbGains(st.white.lin) : null;
  const draw = () => {
    g.drawImage(cv, 0, 0); const k = c.width / 400;
    if (st.white) { const w = st.white; g.lineWidth = 3 * k; g.strokeStyle = '#fff'; g.setLineDash([6 * k, 4 * k]); g.strokeRect(w.x - w.r, w.y - w.r, 2 * w.r, 2 * w.r); g.setLineDash([]); g.fillStyle = '#000a'; g.fillRect(w.x - w.r, w.y - w.r - 18 * k, 18 * k, 16 * k); g.fillStyle = '#fff'; g.font = `bold ${12 * k}px sans-serif`; g.fillText('W', w.x - w.r + 4 * k, w.y - w.r - 5 * k); }
    st.samples.forEach((s, i) => { g.lineWidth = 3 * k; g.strokeStyle = '#000'; g.beginPath(); g.arc(s.x, s.y, s.r + 2 * k, 0, 7); g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = 2 * k; g.beginPath(); g.arc(s.x, s.y, s.r, 0, 7); g.stroke();
      g.fillStyle = '#6ff0c4'; g.beginPath(); g.arc(s.x + s.r + 9 * k, s.y - s.r - 9 * k, 9 * k, 0, 7); g.fill(); g.fillStyle = '#000'; g.font = `bold ${11 * k}px sans-serif`; g.textAlign = 'center'; g.fillText(i + 1, s.x + s.r + 9 * k, s.y - s.r - 5 * k); g.textAlign = 'left'; });
  };
  const list = () => {
    const G = gains(); st.samples.forEach(s => Object.assign(s, colorInfo(s.lin, G)));
    $('#colWB', out).innerHTML = st.white ? `White balance: <b>on</b> <button class="pill" id="colWBoff">Remove</button>` : '<span class="muted">White balance: off</span>';
    const off = $('#colWBoff', out); if (off) off.onclick = () => { st.white = null; list(); draw(); };
    $('#colHelp', out).textContent = tool === 'white' ? 'Tap something white or neutral gray (paper, a gray card) in the same light. It corrects the color cast.' : 'Tap the photo to sample a color (up to 8). Optional: set a white reference for more accurate color.';
    const m = (arr, f) => arr.map(x => `<li><span class="sw" style="background:${f(x.e)[0]}"></span>${esc(f(x.e)[1])} <span class="muted small">ΔE ${x.d.toFixed(1)} · ${dEWord(x.d)}</span></li>`).join('');
    $('#colList', out).innerHTML = st.samples.map((s, i) => `<div class="card col-s" data-si="${i}"><div class="res-head"><div class="row gap"><span class="sw big" style="background:${s.hex}" aria-label="sample ${i + 1} color"></span><div><b>#${i + 1} ${s.hex}</b><div class="small muted">RGB ${s.rgb.join(', ')} · LAB ${s.lab.join(', ')}</div>${st.white ? `<div class="small muted">Before correction ${s.raw}</div>` : ''}</div></div></div>
      <div class="small">Nearest names: ${s.css.map(x => `<span class="chip">${esc(x.e[0])}</span>`).join('')}</div>
      <details open><summary class="small">Paint (approximate)</summary><ul class="matches">${m(s.sw, e => [e[2], 'Sherwin-Williams ' + e[0] + ' ' + e[1]])}${m(s.ral, e => [e[2], e[0] + ' ' + e[1]])}</ul></details>
      <details><summary class="small">Stained-glass sheets (generic, approximate)</summary><ul class="matches">${m(s.glass, e => [rgb2hex(e.slice(1)), e[0]])}</ul></details>
      <div class="row gap"><button class="pill" data-copy="${i}">Copy HEX</button><button class="pill danger" data-crm="${i}">Remove</button></div></div>`).join('') || '<p class="muted small" style="padding:0 4px">No samples yet — tap the photo.</p>';
    $$('[data-copy]', out).forEach(b => b.onclick = async () => { const h = st.samples[+b.dataset.copy].hex; try { await navigator.clipboard.writeText(h); toast('Copied ' + h); } catch (_) { toast(h); } });
    $$('[data-crm]', out).forEach(b => b.onclick = () => { const i = +b.dataset.crm, s = st.samples.splice(i, 1)[0]; list(); draw(); toast('Removed sample', () => { st.samples.splice(i, 0, s); list(); draw(); }); });
    $('#colGlass', out).disabled = $('#colSave', out).disabled = $('#colCSV', out).disabled = !st.samples.length;
  };
  $('#colR', out).value = st.r; $('#colRV', out).textContent = st.r + ' px';
  $('#colR', out).oninput = e => { st.r = +e.target.value; $('#colRV', out).textContent = st.r + ' px'; };
  $$('[data-ct]', out).forEach(b => b.onclick = () => { tool = b.dataset.ct; $$('[data-ct]', out).forEach(x => x.setAttribute('aria-pressed', String(x === b))); list(); });
  c.addEventListener('pointerup', e => {
    const b = c.getBoundingClientRect(), x = (e.clientX - b.left) / b.width * c.width, y = (e.clientY - b.top) / b.height * c.height, r = st.r * c.width / 800 + 1;
    const lin = sampleAt(id, x, y, r);
    if (tool === 'white') { st.white = { x, y, r, lin }; tool = 'sample'; $$('[data-ct]', out).forEach(z => z.setAttribute('aria-pressed', String(z.dataset.ct === 'sample'))); toast('White reference set'); }
    else { if (st.samples.length >= 8) return toast('8 samples max — remove one first'); st.samples.push({ x, y, r, lin }); }
    list(); draw();
  });
  $('#colGlass', out).onclick = () => {
    const cols = st.samples.map((s, i) => ({ name: `Your color ${i + 1} (${s.hex})`, hex: s.hex })); localStorage.setItem(GLASS_COLORS_KEY, JSON.stringify(cols));
    toast(`Sent ${cols.length} color${cols.length === 1 ? '' : 's'} — Stained Glass will use them in the legend`); };
  $('#colSave', out).onclick = async () => {
    if (!scan) scan = { id: uid(), at: Date.now(), mode: 'color', kind: 'color', image: saved ? saved.image : image, thumb: await thumbOf(saved ? saved.image : image) };
    scan.title = 'Colors · ' + st.samples.map(s => s.hex).slice(0, 3).join(' '); scan.result = { ...st, samples: st.samples.map(({ x, y, r, lin, hex }) => ({ x, y, r, lin, hex })) }; await DB.put('scans', scan); $('#colSave', out).textContent = 'Saved ✓'; toast('Colors saved'); };
  $('#colCSV', out).onclick = () => { const rows = [['#', 'HEX', 'R', 'G', 'B', 'L*', 'a*', 'b*', 'Nearest name', 'Closest Sherwin-Williams (approx.)', 'ΔE00', 'Closest RAL (approx.)', 'ΔE00', 'Closest glass (generic)', 'White balanced']];
    st.samples.forEach((s, i) => rows.push([i + 1, s.hex, ...s.rgb, ...s.lab, s.css[0].e[0], s.sw[0].e[0] + ' ' + s.sw[0].e[1], s.sw[0].d.toFixed(1), s.ral[0].e[0] + ' ' + s.ral[0].e[1], s.ral[0].d.toFixed(1), s.glass[0].e[0], st.white ? 'yes' : 'no']));
    shareOrDownload('colors-' + todayStr() + '.csv', rows.map(r => r.map(csvCell).join(',')).join('\r\n'), 'text/csv'); };
  draw(); list(); window.__color = { st, out };
}
function colorSummary(r) { return (r.samples || []).map(s => s.hex).slice(0, 4).join(' '); }
