/* Scan Lab — Damage & defect check: optional tap-to-circle markup, Grok visual assessment, report PDF. AI visual estimate, not a certified inspection. */
const DEFECT_TYPES = ['crack', 'corrosion', 'wear', 'deformation', 'burn', 'contamination', 'fracture', 'pitting', 'dent', 'discoloration', 'leak', 'other'];
const SEV = ['none', 'minor', 'moderate', 'severe', 'critical'];
const DEFECT_SCHEMA = `{"kind":"defect","object":"what the part/object is","material":"likely material","defects":[{"type":"${DEFECT_TYPES.join('|')}","name":"short description","location":"where on the part","photo":1,"box":[x0,y0,x1,y1],"severity":"minor|moderate|severe|critical","confidence":"low|medium|high","likely_causes":["max 3"],"corrective_actions":["max 4"],"prevention":["max 3"]}],"overall_severity":"none|minor|moderate|severe|critical","safe_to_use":"yes|caution|no|unknown","safety_reason":"one sentence","next_steps":["max 4"],"limits":"what photos cannot show (internal cracks, hardness, wall thickness…)"}`;
function defectPrompt(n, marked, hint) {
  return `DEFECT CHECK. You are a careful failure-analysis and maintenance engineer. Inspect ${n > 1 ? `these ${n} photos of the same part/object` : 'this photo of a part/object'} for damage or defects: cracks, corrosion, wear, deformation, burn/heat damage, contamination, fractures, pitting, dents, discoloration, leaks.
${marked ? 'Red circles drawn on the photos mark areas the user is worried about — look there closely, but report other defects too, and say so if a circled area looks fine.\n' : ''}${hint ? `User note: "${hint}"\n` : ''}For each defect give a box as fractions of that photo's width/height (0–1, origin top-left) and the 1-based photo number. Be honest about uncertainty; do not invent defects. "safe_to_use" must be "no" if anything is severe or critical, and "unknown" when the photos can't tell.
Answer with strict JSON only, exactly this shape: ${DEFECT_SCHEMA}`;
}
function validateDefect(o, nPhotos = 1) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.defects)) throw Object.assign(new Error('The AI answer wasn’t a defect report.'), { kind: 'badjson', raw: JSON.stringify(o || '').slice(0, 800) });
  const sev = v => { v = String(v || '').toLowerCase(); return SEV.includes(v) ? v : 'moderate'; };
  const defects = o.defects.filter(d => d && typeof d === 'object').slice(0, 12).map(d => {
    const t = String(d.type || '').toLowerCase(), b = Array.isArray(d.box) && d.box.length === 4 ? d.box.map(v => { v = num(v); return v == null ? null : v > 1.5 ? v / 1000 : v; }) : null;
    return { type: DEFECT_TYPES.includes(t) ? t : 'other', name: str(d.name, 120) || t || 'Defect', location: str(d.location, 120), photo: Math.min(nPhotos, Math.max(1, Math.round(num(d.photo) || 1))),
      box: b && b.every(v => v != null) ? [Math.max(0, Math.min(b[0], b[2])), Math.max(0, Math.min(b[1], b[3])), Math.min(1, Math.max(b[0], b[2])), Math.min(1, Math.max(b[1], b[3]))] : null,
      severity: sev(d.severity) === 'none' ? 'minor' : sev(d.severity), confidence: conf(d.confidence), causes: strs(d.likely_causes, 4), actions: strs(d.corrective_actions, 5), prevention: strs(d.prevention, 4) };
  });
  const worst = defects.reduce((m, d) => Math.max(m, SEV.indexOf(d.severity)), 0);
  let overall = sev(o.overall_severity); if (SEV.indexOf(overall) < worst) overall = SEV[worst]; if (!defects.length && !o.overall_severity) overall = 'none';
  let safe = String(o.safe_to_use || '').toLowerCase(); if (!['yes', 'caution', 'no', 'unknown'].includes(safe)) safe = 'unknown';
  let reason = str(o.safety_reason, 300);
  if (worst >= 3 && safe !== 'no') { safe = 'no'; reason = (reason ? reason + ' ' : '') + '(Set to “no” because a severe or critical defect was reported.)'; }
  else if (worst === 2 && safe === 'yes') { safe = 'caution'; reason = (reason ? reason + ' ' : '') + '(Set to “caution” because a moderate defect was reported.)'; }
  return { kind: 'defect', object: str(o.object, 100) || 'Part', material: str(o.material, 80), defects, overall, safe, reason, next: strs(o.next_steps, 5), limits: str(o.limits, 400) };
}
const SAFE_LABEL = { yes: 'Looks OK to use', caution: 'Use with caution', no: 'Do not use', unknown: 'Can’t tell from photos' };
const SEV_CLS = { none: 'conf-high', minor: 'conf-high', moderate: 'conf-medium', severe: 'conf-low', critical: 'conf-low' };
const DEFECT_DISCLAIMER = 'AI visual estimate from photos — not a certified inspection or lab analysis. Photos can’t show internal cracks, material properties or hidden damage. For anything load-bearing, pressurised, electrical, a vehicle or otherwise safety-critical, have a qualified person inspect it before use.';
/* burn markup circles into a JPEG copy */
async function defectBurn(src, marks) {
  const im = await loadImg(src), c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
  const k = Math.max(c.width, c.height) / 600; for (const m of marks) { g.lineWidth = 4 * k; g.strokeStyle = '#ff2020'; g.beginPath(); g.arc(m.x * c.width, m.y * c.height, m.r * c.width, 0, 7); g.stroke(); }
  return c.toDataURL('image/jpeg', 0.88);
}
/* photo with numbered defect boxes */
async function defectAnnotated(src, defects, pi, max = 1280) {
  const im = await loadImg(src), s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
  const g = c.getContext('2d'); g.drawImage(im, 0, 0, c.width, c.height); const k = Math.max(c.width, c.height) / 600;
  defects.forEach((d, i) => { if (d.photo !== pi + 1 || !d.box) return; const col = SEV.indexOf(d.severity) >= 3 ? '#ff4d4d' : d.severity === 'moderate' ? '#ffb020' : '#6ff0c4';
    const [x0, y0, x1, y1] = d.box.map((v, j) => v * (j % 2 ? c.height : c.width)); g.lineWidth = 3 * k; g.strokeStyle = '#000'; g.strokeRect(x0, y0, x1 - x0, y1 - y0); g.lineWidth = 2 * k; g.strokeStyle = col; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    g.fillStyle = col; const r = 11 * k; g.beginPath(); g.arc(x0, y0, r, 0, 7); g.fill(); g.fillStyle = '#000'; g.font = `bold ${13 * k}px -apple-system,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), x0, y0 + k); });
  return c.toDataURL('image/jpeg', 0.85);
}
async function defectOpen(out, { photos, hint = '', saved } = {}) {
  if (saved) return defectRender(out, saved);
  const marks = photos.map(() => []); let rad = 0.08, cur = 0;
  out.innerHTML = `<div class="card"><div class="res-head"><h2>Damage &amp; defect check</h2><span class="badge">${photos.length} photo${photos.length === 1 ? '' : 's'}</span></div>
    <p class="muted small">Optional: tap to circle the area you’re worried about (tap a circle to remove it). Then run the check.</p>
    ${photos.length > 1 ? `<div class="seg" role="group" aria-label="Photo">${photos.map((_, i) => `<button data-dp="${i}" aria-pressed="${i === 0}">Photo ${i + 1}</button>`).join('')}</div>` : ''}
    <div class="tap-wrap" style="margin-top:8px"><canvas id="dCanvas" aria-label="Photo — tap to circle an area"></canvas></div>
    <label class="field">Circle size <input type="range" id="dR" min="3" max="25" value="8"></label>
    <div class="row gap wrap"><button class="primary" id="dRun">🔍 Check for damage</button><button class="pill" id="dClear">Clear circles</button></div>
    <p class="disclaimer">${DEFECT_DISCLAIMER}</p></div>`;
  const c = $('#dCanvas', out), g = c.getContext('2d'); let im;
  const draw = async () => { im = await loadImg(photos[cur]); const s = Math.min(1, 1000 / Math.max(im.naturalWidth, im.naturalHeight)); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s); g.drawImage(im, 0, 0, c.width, c.height);
    const k = c.width / 400; for (const m of marks[cur]) { g.lineWidth = 3.5 * k; g.strokeStyle = '#ff2020'; g.beginPath(); g.arc(m.x * c.width, m.y * c.height, m.r * c.width, 0, 7); g.stroke(); } };
  c.addEventListener('pointerup', e => { const b = c.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height, ms = marks[cur];
    const hit = ms.findIndex(m => Math.hypot((m.x - x) * b.width, (m.y - y) * b.height) <= Math.max(22, m.r * b.width)); if (hit >= 0) ms.splice(hit, 1); else if (ms.length < 6) ms.push({ x, y, r: rad }); else toast('6 circles per photo max'); draw(); });
  $('#dR', out).oninput = e => { rad = +e.target.value / 100; };
  $$('[data-dp]', out).forEach(b => b.onclick = () => { cur = +b.dataset.dp; $$('[data-dp]', out).forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw(); });
  $('#dClear', out).onclick = () => { marks.forEach(m => m.length = 0); draw(); };
  const run = async () => {
    const ctl = new AbortController(); S.busy = ctl; const marked = marks.some(m => m.length);
    out.innerHTML = `<div class="card"><span class="spinner"></span>Grok is inspecting ${photos.length > 1 ? 'the photos' : 'the photo'}… <button class="pill" id="btnCancel">Cancel</button></div>`; $('#btnCancel', out).onclick = () => ctl.abort();
    try {
      const sent = await Promise.all(photos.map((p, i) => marks[i].length ? defectBurn(p, marks[i]) : p));
      const raw = await aiChat([{ role: 'system', content: 'You inspect parts for damage from photos and answer with strict JSON only.' }, { role: 'user', content: [{ type: 'text', text: defectPrompt(photos.length, marked, hint) }, ...sent.map(imgPart)] }], { signal: ctl.signal });
      const result = validateDefect(parseJSONLoose(raw), photos.length); result.marks = marks;
      const scan = { id: uid(), at: Date.now(), mode: 'defect', kind: 'defect', title: 'Defect check · ' + result.object, hint, image: photos[0], pages: photos.length > 1 ? photos.slice() : undefined, marked: marked ? sent : undefined, thumb: await thumbOf(photos[0]), result, model: aiCfg().model };
      await DB.put('scans', scan); defectRender(out, scan);
    } catch (e) { renderError(out, e, run); } finally { S.busy = null; }
  };
  $("#dRun", out).onclick = run; window.__defect = { marks }; await draw();
}
async function defectRender(out, scan) {
  const r = scan.result, photos = scan.pages || [scan.image], icon = { yes: '✅', caution: '⚠️', no: '⛔', unknown: '❔' }[r.safe];
  const ann = await Promise.all(photos.map((p, i) => defectAnnotated((scan.marked && scan.marked[i]) || p, r.defects, i)));
  out.innerHTML = `<div class="card"><div class="res-head"><h2>${esc(r.object)}</h2><span class="badge ${SEV_CLS[r.overall]}">${r.overall === 'none' ? 'no defects seen' : r.overall}</span></div>
    ${r.material ? `<p class="muted small">Likely material: ${esc(r.material)}</p>` : ''}
    <div class="safe-banner safe-${r.safe}" role="status"><b>${icon} Safe to use? ${SAFE_LABEL[r.safe]}</b>${r.reason ? `<span>${esc(r.reason)}</span>` : ''}</div>
    ${ann.map((a, i) => `<img class="d-ann" src="${a}" alt="Photo ${i + 1} with numbered defect boxes">`).join('')}</div>
  ${r.defects.length ? r.defects.map((d, i) => `<div class="card defect"><div class="res-head"><b>${i + 1}. ${esc(d.name)}</b><span class="badge ${SEV_CLS[d.severity]}">${d.severity}</span></div>
    <p class="small muted">${esc(d.type)}${d.location ? ' · ' + esc(d.location) : ''}${photos.length > 1 ? ' · photo ' + d.photo : ''} · ${d.confidence} confidence</p>
    ${d.causes.length ? `<h3>Likely root cause</h3><ul class="tight small">${d.causes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${d.actions.length ? `<h3>Corrective actions</h3><ul class="tight small">${d.actions.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${d.prevention.length ? `<h3>Prevention</h3><ul class="tight small">${d.prevention.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`).join('')
    : '<div class="card"><p>No visible defects found in these photos.</p></div>'}
  ${r.next.length ? `<div class="card"><h3 style="margin-top:0">Next steps</h3><ul class="tight small">${r.next.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
  <div class="card">${actBar({ auto: true, exports: [['dPDF', '⤓ Report PDF']] })}
    ${r.limits ? `<p class="small muted">What photos can’t show: ${esc(r.limits)}</p>` : ''}<p class="disclaimer">${DEFECT_DISCLAIMER}</p></div>`;
  $('#dPDF', out).onclick = async () => shareOrDownload(`defect-report-${todayStr(new Date(scan.at))}.pdf`, (await defectPDF(scan, ann)).blob(), 'application/pdf');
}
async function defectPDF(scan, ann) {
  const r = scan.result, doc = new PDFDoc(), M = 40, W = 532; let p = doc.page(), y = M;
  const need = h => { if (y + h > 752) { p = doc.page(); y = M; } };
  p.text(M, y, 18, 'Damage & defect report', true); y += 24; p.text(M, y, 9.5, 'Scan Lab · ' + new Date(scan.at).toLocaleString() + ' · AI visual estimate', false, [90, 90, 90]); y += 20;
  p.text(M, y, 13, r.object + (r.material ? ' (' + r.material + ')' : ''), true); y += 20;
  const sc = { yes: [0, 130, 80], caution: [190, 120, 0], no: [190, 30, 30], unknown: [90, 90, 90] }[r.safe];
  p.text(M, y, 12, 'Safe to use? ' + SAFE_LABEL[r.safe] + '   ·   Overall severity: ' + r.overall, true, sc); y += 18; if (r.reason) y = p.para(M, y, W, 9.5, r.reason) + 6;
  for (const a of ann.slice(0, 4)) { const im = doc.addJPEG(a), w = ann.length > 1 ? 250 : 330, h = w * im.h / im.w; need(h + 10); p.image(im, M, 792 - y - h, w, h); y += h + 10; }
  r.defects.forEach((d, i) => { need(60); p.text(M, y, 11.5, `${i + 1}. ${d.name} — ${d.severity}`, true); y += 15; p.text(M, y, 9, `${d.type}${d.location ? ' · ' + d.location : ''} · ${d.confidence} confidence`, false, [90, 90, 90]); y += 13;
    for (const [h, arr] of [['Likely root cause', d.causes], ['Corrective actions', d.actions], ['Prevention', d.prevention]]) if (arr.length) { need(14 + arr.length * 13); p.text(M + 8, y, 9.5, h, true); y += 12; for (const x of arr) { need(13); y = p.para(M + 16, y, W - 16, 9, '• ' + x); } } y += 6; });
  if (!r.defects.length) { p.text(M, y, 10.5, 'No visible defects found in these photos.'); y += 16; }
  if (r.next.length) { need(20); p.text(M, y, 11, 'Next steps', true); y += 14; for (const x of r.next) { need(13); y = p.para(M + 8, y, W - 8, 9, '• ' + x); } }
  if (r.limits) { need(30); y = p.para(M, y + 6, W, 8.5, 'What photos can’t show: ' + r.limits, false, [90, 90, 90]); }
  need(40); p.para(M, y + 8, W, 8.5, DEFECT_DISCLAIMER, false, [150, 60, 0]);
  return doc;
}
function defectSummary(r) { return (SAFE_LABEL[r.safe] || '') + ' · ' + r.defects.length + ' defect' + (r.defects.length === 1 ? '' : 's'); }
