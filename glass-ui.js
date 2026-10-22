/* Scan Lab — Stained Glass mode UI */
const GLASS_PREFILL = 'glassPrefill';
const GLASS_VIEWS = [['original', 'Original'], ['pattern', 'Pattern'], ['overlay', 'Overlay'], ['side', 'Side by side'], ['cut', 'Cut lines']];
function svgFit(s) { return s.replace(/width="[^"]+in" height="[^"]+in"/, 'width="100%" preserveAspectRatio="xMidYMid meet"'); }
/* render pattern SVG → JPEG data URL (for the recognisability check) */
async function glassRenderJPEG(P, max = 900) {
  const svg = glassSVG(P, { numbers: false, scaleBar: false }).replace(/width="[^"]+in" height="[^"]+in"/, `width="${P.gridW}" height="${P.gridH}"`);
  const im = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)), s = Math.min(1, max / Math.max(P.gridW, P.gridH)) * 2;
  const c = document.createElement('canvas'); c.width = Math.round(P.gridW * s); c.height = Math.round(P.gridH * s); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.85);
}
const boxN = b => Array.isArray(b) && b.length === 4 ? b.map(v => { v = num(v); return v == null ? null : v > 1.5 ? v / 1000 : v; }) : null;
const boxOK = b => b && b.every(v => v != null && v >= 0 && v <= 1) && b[2] - b[0] > 0.02 && b[3] - b[1] > 0.02;
function validateSubject(j) {
  if (!j || typeof j !== 'object') throw Object.assign(new Error('The AI answer wasn’t a subject.'), { kind: 'badjson' });
  const box = boxN(j.box || j.bbox); if (!boxOK(box)) throw Object.assign(new Error('The AI answer had no usable subject box.'), { kind: 'badjson', raw: JSON.stringify(j).slice(0, 600) });
  const features = (Array.isArray(j.features) ? j.features : []).map(f => ({ name: str(f && f.name, 40), box: boxN(f && (f.box || f.bbox)) })).filter(f => f.name && boxOK(f.box)).slice(0, 8);
  return { subject: str(j.subject, 80) || 'subject', box, features };
}
async function glassOpen(out, { image, saved } = {}) {
  let o = { ...glassDefaults(), ...(saved ? saved.result.settings : {}) }, scan = saved || null, P = saved ? saved.result : null, tips = saved ? saved.tips || null : null, img = saved ? saved.image : image, recog = saved ? saved.recog || null : null;
  if (!saved) { try { const pf = JSON.parse(localStorage.getItem(GLASS_PREFILL) || 'null'); if (pf && pf.widthIn) { o.widthIn = pf.widthIn; o.heightIn = pf.heightIn; localStorage.removeItem(GLASS_PREFILL); toast(`Using measured size ${pf.widthIn} × ${pf.heightIn} in`); } } catch (_) {} }
  if (!saved) { try { const uc = JSON.parse(localStorage.getItem('glassColors') || 'null'); if (Array.isArray(uc) && uc.length) o.userColors = uc.filter(c => /^#[0-9a-f]{6}$/i.test(c.hex)).slice(0, 10); } catch (_) {} }
  const cm = () => o.unit === 'cm', toU = v => cm() ? r1(v * 2.54) : r2(v), fromU = v => cm() ? v / 2.54 : v;
  out.innerHTML = `<div class="card">
    <div class="res-head"><h2>Stained-glass pattern</h2><span class="badge" id="gDiffBadge"></span></div>
    <p class="muted small">Made on this device — no key needed. Lead lines follow the photo’s real outlines; every piece is a closed shape sized for a beginner.</p>
    <div class="glass-preview" id="gPrev"></div>
    <div class="seg seg-grid" role="group" aria-label="View" style="margin-top:8px">${GLASS_VIEWS.map(([k, l]) => `<button data-pv="${k}" aria-pressed="${k === 'pattern'}">${l}</button>`).join('')}</div>
    <div class="row gap wrap" style="margin-top:6px"><div class="seg" role="group" aria-label="Piece colours"><button data-fill="photo" aria-pressed="true">Photo colors</button><button data-fill="glass" aria-pressed="false">Glass colors</button></div></div>
    <label class="field" id="gOpWrap" hidden>Pattern opacity <b id="gOpV"></b><input type="range" id="gOp" min="0" max="100" step="5" value="45"></label>
    <div id="gSubj" class="small"></div>
    <div class="ctl" style="margin-top:10px">
      <label>Detail on subject <b id="gDetV"></b><input type="range" id="gDet" min="1" max="10" step="1" title="Higher = more, smaller pieces on the subject"></label>
      <label>Simplicity <b id="gSimV"></b><input type="range" id="gSim" min="1" max="10" step="1" title="Higher = fewer, larger pieces (sets the minimum piece size)"></label>
      <label>Glass colors <b id="gColV"></b><input type="range" id="gCol" min="2" max="10" step="1"></label>
      <label>Lines <select id="gLine">${Object.entries(GLASS_LINES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
      <label>Finished width <input type="number" id="gW" inputmode="decimal" min="2" step="0.5"></label>
      <label>Height <input type="number" id="gH" inputmode="decimal" min="2" step="0.5" placeholder="auto"></label>
      <label>Units <span class="seg"><button data-u="in">in</button><button data-u="cm">cm</button></span></label>
      <label class="toggle"><input type="checkbox" id="gFocus"> Focus on subject</label>
      <label class="toggle"><input type="checkbox" id="gFull"> Keep full scene</label>
      <label>Style <select id="gStyle"><option value="auto">Auto</option><option value="organic">Organic (curves)</option><option value="geometric">Geometric (straight lines)</option></select></label>
      <label>Small features <select id="gSmall"><option value="pieces">Pieces + paint</option><option value="paint">Paint only</option><option value="off">Off (simplest)</option></select></label>
      <label class="toggle"><input type="checkbox" id="gPaint"> Painted detail lines</label>
      <label class="toggle"><input type="checkbox" id="gFrame"> Border frame</label>
      <label>Frame width <input type="number" id="gFW" inputmode="decimal" min="0.5" max="4" step="0.25"></label>
      <label>Frame glass <select id="gFG"><option value="">Auto (darkest)</option>${GLASS_PALETTE.map(p => `<option>${p[0]}</option>`).join('')}</select></label>
    </div>
  </div>
  <div class="card" id="gStats"></div>
  <div class="card" id="gRecogCard"></div>
  <div class="card"><h3 style="margin-top:0">Glass to buy</h3><div id="gUC"></div><div class="legend" id="gLegend"></div></div>
  <div class="card"><div class="export-row">
    <button class="primary" id="gSave">${saved ? 'Saved ✓' : 'Save to History'}</button>
    <button class="pill" id="gSVG">⤓ SVG</button><button class="pill" id="gPDF">⤓ Pattern PDF</button><button class="pill" id="gCut">⤓ Cut-line PDF</button>
  </div><p class="muted small">PDFs print at real size (tiled on Letter pages with ⊕ alignment marks when larger). Print at 100% / Actual size. The original photo is saved with the pattern.</p></div>
  <div class="card" id="gTips"></div>`;
  const prev = $('#gPrev', out); let view = 'pattern', fillMode = 'photo', op = 0.45, t, picking = false;
  const fill = () => {
    $('#gCol', out).value = o.colors; $('#gColV', out).textContent = o.colors; $('#gSim', out).value = o.simplicity; $('#gSimV', out).textContent = o.simplicity; $('#gDet', out).value = o.detail; $('#gDetV', out).textContent = o.detail;
    $('#gW', out).value = toU(o.widthIn); $('#gH', out).value = o.heightIn ? toU(o.heightIn) : ''; $('#gH', out).placeholder = P ? 'auto ' + toU(P.heightIn) : 'auto';
    $$('[data-u]', out).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.u === o.unit))); $('#gLine', out).value = o.line; $('#gFocus', out).checked = o.focus; $('#gFull', out).checked = !o.zoom; $('#gFull', out).disabled = !o.focus; $('#gStyle', out).value = o.style || 'auto'; $('#gSmall', out).value = o.smallFeat || 'pieces'; $('#gPaint', out).checked = o.paint !== false; $('#gPaint', out).disabled = o.smallFeat === 'off';
    $('#gFrame', out).checked = o.frame; $('#gFW', out).value = toU(o.frameIn); $('#gFW', out).disabled = !o.frame; $('#gFG', out).value = o.frameGlass || '';
  };
  const subjLine = () => {
    const b = o.subjectBox; $('#gSubj', out).innerHTML = `<div class="row gap wrap" style="margin-top:8px"><span class="muted">Subject: <b>${b ? esc(o.subjectName || 'your selection') : P && P.subject && P.subject.how !== 'none' && P.subject.how !== 'off' ? 'found automatically' : o.focus ? 'not clear — whole photo' : 'off'}</b>${o.features && o.features.length ? ' · keeping ' + o.features.map(f => esc(f.name)).join(', ') : ''}</span></div>
      <div class="row gap wrap" style="margin-top:6px"><button class="pill" id="gPick">⬚ Choose subject</button>${aiHasKey() ? '<button class="pill" id="gFind">✨ Find subject with Grok</button>' : ''}${b ? '<button class="pill" id="gClearSubj">Clear subject</button>' : ''}</div>`;
    $('#gPick', out).onclick = pickSubject; const f = $('#gFind', out); if (f) f.onclick = findSubject; const c = $('#gClearSubj', out); if (c) c.onclick = () => { delete o.subjectBox; delete o.features; delete o.subjectName; rebuild(); };
  };
  const draw = () => {
    if (!P || picking) return;
    const pattern = (x = {}) => svgFit(glassSVG(P, { fill: fillMode, ...x }));
    $('#gOpWrap', out).hidden = view !== 'overlay'; $('#gOpV', out).textContent = Math.round(op * 100) + '%';
    if (view === 'original') prev.innerHTML = pattern({ photo: img, opacity: 0, numbers: false, lines: false });
    else if (view === 'overlay') prev.innerHTML = pattern({ photo: img, opacity: op });
    else if (view === 'side') prev.innerHTML = `<div class="side2"><figure>${pattern({ photo: img, opacity: 0, numbers: false, lines: false })}<figcaption>Original</figcaption></figure><figure>${pattern({ numbers: false })}<figcaption>Pattern</figcaption></figure></div>`;
    else prev.innerHTML = pattern({ cut: view === 'cut' });
    const s = P.stats, U = cm() ? 'cm' : 'in', sq = cm() ? ' cm²' : ' sq in', A = v => cm() ? (v * 6.4516).toFixed(0) : v.toFixed(1);
    $('#gDiffBadge', out).innerHTML = `<span class="diff ${s.difficulty === 'Beginner' ? 'beg' : 'int'}">${s.difficulty}</span>`;
    $('#gStats', out).innerHTML = `<div class="res-head"><b>${s.pieces} pieces · ${toU(P.widthIn)} × ${toU(P.heightIn)} ${U}</b><span class="diff ${s.difficulty === 'Beginner' ? 'beg' : 'int'}">${s.difficulty}</span></div>
      ${s.outlineKept != null ? `<p class="small"><b>Outline kept: ${s.outlineKept}%</b> <span class="muted">— share of the subject’s main outlines that became lead lines${P.silhouette && P.silhouette.length ? '; the silhouette is one continuous, slightly bolder lead line' : ''}.</span></p>` : ''}
      ${s.advanced || s.detailLines || s.dots ? `<p class="small muted">${s.advanced ? `${s.advanced} advanced feature piece${s.advanced === 1 ? '' : 's'} (marked ★ in the cut list). ` : ''}${s.detailLines || s.dots ? `Thin lines and dots are <b>painted detail</b> (glass paint, or a soldered foil overlay) — not cut lines.` : ''}</p>` : ''}
      ${P.style === 'geometric' ? '<p class="small muted">Straight-line style: windows and doors become rectangles.</p>' : ''}
      <ul class="tight small">${s.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      <p class="small muted">Rules: pieces ≥ ${A(s.minAreaIn)}${sq}, ≥ ${cm() ? (s.minWidthIn * 2.54).toFixed(1) + ' cm' : fracIn(s.minWidthIn)} wide, narrow necks and sharp points auto-merged, no piece encloses another. Smallest piece: ${A(s.smallestIn)}${sq}. ${esc(P.lineLabel)}.</p>
      ${P.notes.map(n => `<p class="small muted">ℹ︎ ${esc(n)}</p>`).join('')}`;
    $('#gLegend', out).innerHTML = P.legend.map(e => `<div><span class="sw" style="background:${e.hex}"></span><span><b>${esc(e.glass)}</b><br>${e.count} pc · ${A(e.areaIn)}${sq}</span></div>`).join('');
    $('#gUC', out).innerHTML = o.userColors && o.userColors.length ? `<div class="row gap wrap small" style="margin-bottom:8px"><span>Using ${o.userColors.length} color${o.userColors.length === 1 ? '' : 's'} from Color match</span><button class="pill" id="gUCx">Use generic glass</button></div>` : '';
    const ux = $('#gUCx', out); if (ux) ux.onclick = () => { delete o.userColors; localStorage.removeItem('glassColors'); rebuild(); };
    subjLine(); renderRecog(); renderTips();
  };
  const renderRecog = () => {
    const c = $('#gRecogCard', out), r = recog;
    c.innerHTML = `<div class="res-head"><h3 style="margin:0">Recognizability check</h3>${aiHasKey() ? `<button class="pill" id="gRecog">✨ ${r ? 'Check again' : 'Check with Grok'}</button>` : ''}</div>
      ${r ? `<p class="small">Seen from the pattern alone: <b>${esc(r.depicts)}</b> <span class="muted">(${esc(r.confidence)} confidence)</span></p>
        <p class="small"><span class="badge ${r.match === 'yes' ? 'conf-high' : r.match === 'partly' ? 'conf-medium' : 'conf-low'}">${r.match === 'yes' ? 'Matches the photo' : r.match === 'partly' ? 'Partly matches' : 'Doesn’t match yet'}</span> ${esc(r.explanation)}</p>
        ${r.add.length ? `<p class="small" style="margin-bottom:2px"><b>To make it more recognizable</b></p><ul class="tight small">${r.add.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`
      : `<p class="small muted">${aiHasKey() ? 'Grok looks at the flat pattern only (not your photo), says what it depicts, then compares with the photo.' : 'Add a key in Settings to have Grok check whether the pattern still reads as your subject. Meanwhile use Side by side, and watch “Outline kept”.'}</p>`}`;
    const b = $('#gRecog', out); if (b) b.onclick = checkRecog;
  };
  const checkRecog = async () => {
    const b = $('#gRecog', out); b.disabled = true; b.innerHTML = '<span class="spinner"></span>Checking…';
    try {
      const pat = await glassRenderJPEG(P);
      const raw1 = await aiChat([{ role: 'system', content: 'You describe images briefly and answer with strict JSON only.' }, { role: 'user', content: [{ type: 'text', text: 'RECOGNIZABILITY BLIND. This is a flat stained-glass pattern (colored pieces with dark lead lines). What does it depict? Return JSON {"depicts":"short answer, e.g. a cat’s face","confidence":"low|medium|high","cues":["what in the pattern tells you"]}' }, imgPart(pat)] }]);
      const j1 = parseJSONLoose(raw1); const depicts = str(j1.depicts, 80) || 'unclear';
      const raw2 = await aiChat([{ role: 'system', content: 'You help beginners design stained glass and answer with strict JSON only.' }, { role: 'user', content: [{ type: 'text', text: `RECOGNIZABILITY COMPARE. Image 1 is the original photo; image 2 is the stained-glass pattern made from it (${P.stats.pieces} pieces, minimum piece ${P.stats.minAreaIn} sq in). Someone who saw only the pattern said it depicts: "${depicts}". Return JSON {"photo_subject":"","match":"yes|partly|no","explanation":"one sentence","add_detail":["max 4 concrete suggestions, e.g. keep the eyes as separate pieces, raise Detail on subject, make the panel larger"]}` }, imgPart(img), imgPart(pat)] }]);
      const j2 = parseJSONLoose(raw2), m = String(j2.match || '').toLowerCase();
      recog = { depicts, confidence: conf(j1.confidence), photo: str(j2.photo_subject, 80), match: /yes/.test(m) ? 'yes' : /part/.test(m) ? 'partly' : 'no', explanation: str(j2.explanation, 300), add: strs(j2.add_detail, 5), at: Date.now() };
      if (scan) { scan.recog = recog; DB.put('scans', scan); }
    } catch (e) { toast(e.message); }
    renderRecog();
  };
  const findSubject = async () => {
    const b = $('#gFind', out); if (b) { b.disabled = true; b.innerHTML = '<span class="spinner"></span>Looking…'; } else prev.innerHTML = '<p style="padding:14px"><span class="spinner"></span>Grok is finding the subject…</p>';
    try {
      const raw = await aiChat([{ role: 'system', content: 'You locate subjects in photos and answer with strict JSON only.' }, { role: 'user', content: [{ type: 'text', text: 'GLASS SUBJECT. I want to turn this photo into a simple stained-glass panel that is still recognizable. Find the main subject and the few features that make it recognizable (e.g. eyes, ears, beak, petals, windows, door). Coordinates are fractions of image width/height (0–1, origin top-left). Return JSON {"subject":"short name","box":[x0,y0,x1,y1],"features":[{"name":"","box":[x0,y0,x1,y1]}]} with at most 6 features.' }, imgPart(img)] }]);
      const s = validateSubject(parseJSONLoose(raw)); o.subjectBox = s.box; o.features = s.features; o.subjectName = s.subject; toast('Grok found: ' + s.subject); rebuild();
    } catch (e) { toast(e.message); if (P) subjLine(); else rebuild(); }
  };
  const pickSubject = async () => {
    picking = true; const im = await loadImg(img), ar = im.naturalHeight / im.naturalWidth; let box = o.subjectBox ? o.subjectBox.slice() : null, st = null;
    prev.innerHTML = `<div class="pick-wrap" style="aspect-ratio:${1 / ar}"><img src="${img}" alt="" draggable="false"><div class="pick-box" ${box ? '' : 'hidden'}></div></div><p class="small muted" style="margin:6px 2px">Drag a box around the subject.</p><div class="row gap"><button class="primary" id="gPickOK" ${box ? '' : 'disabled'}>Use this subject</button><button class="pill" id="gPickX">Cancel</button></div>`;
    const wrap = $('.pick-wrap', prev), bx = $('.pick-box', prev);
    const show = () => { if (!box) return; bx.hidden = false; Object.assign(bx.style, { left: box[0] * 100 + '%', top: box[1] * 100 + '%', width: (box[2] - box[0]) * 100 + '%', height: (box[3] - box[1]) * 100 + '%' }); $('#gPickOK', prev).disabled = !(box[2] - box[0] > 0.03 && box[3] - box[1] > 0.03); };
    const pt = e => { const r = wrap.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
    wrap.onpointerdown = e => { try { wrap.setPointerCapture(e.pointerId); } catch (_) {} st = pt(e); box = [st[0], st[1], st[0], st[1]]; show(); };
    wrap.onpointermove = e => { if (!st) return; const q = pt(e); box = [Math.min(st[0], q[0]), Math.min(st[1], q[1]), Math.max(st[0], q[0]), Math.max(st[1], q[1])]; show(); };
    wrap.onpointerup = () => { st = null; };
    show();
    $('#gPickOK', prev).onclick = () => { picking = false; o.subjectBox = box.map(v => Math.round(v * 1000) / 1000); o.subjectName = 'your selection'; delete o.features; o.focus = true; fill(); rebuild(); };
    $('#gPickX', prev).onclick = () => { picking = false; draw(); };
  };
  const renderTips = () => {
    const g = tips || glassGuideLocal(P || { lineIn: 1 / 16, frameIn: 1 });
    $('#gTips', out).innerHTML = `<div class="res-head"><h3 style="margin:0">${tips ? 'Grok’s beginner guide' : 'Beginner build guide'}</h3>${aiHasKey() ? `<button class="pill" id="gGrok">✨ ${tips ? 'Ask again' : 'Grok tips'}</button>` : ''}</div>
      ${tips && tips.simplify && tips.simplify.length ? `<h3>Simplify first</h3><ul class="tight small">${tips.simplify.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <h3>Tools</h3><ul class="tight small">${g.tools.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <h3>Cutting &amp; build order</h3><ol class="small" style="padding-left:20px">${g.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
      <h3>Tips</h3><ul class="tight small">${g.tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      ${aiHasKey() ? '' : '<p class="muted small">Add a Grok key in Settings for photo-specific simplification tips (optional).</p>'}`;
    const b = $('#gGrok', out); if (b) b.onclick = askGrok;
  };
  const rebuild = () => { clearTimeout(t); prev.classList.add('busy'); t = setTimeout(async () => {
    try { const id = await glassImageData(img, o); P = glassBuild(id, o); recog = null; fill(); draw(); if (scan) { scan.result = P; scan.recog = null; scan.title = 'Stained glass · ' + P.stats.pieces + ' pieces'; await DB.put('scans', scan); } }
    catch (e) { prev.innerHTML = `<p style="color:#900;padding:10px">Couldn’t build the pattern: ${esc(e.message)}</p>`; }
    finally { prev.classList.remove('busy'); } }, 220); };
  const askGrok = async () => {
    const b = $('#gGrok', out); b.disabled = true; b.innerHTML = '<span class="spinner"></span>Asking…';
    try {
      const raw = await aiChat([{ role: 'system', content: 'You are a patient stained-glass teacher for complete beginners. Answer with strict JSON only.' }, { role: 'user', content: [{ type: 'text', text: `I turned this photo into a ${P.widthIn}×${P.heightIn} in stained-glass pattern with ${P.stats.pieces} pieces in ${P.legend.length} glass colors (${P.legend.map(l => l.glass).join(', ')}), ${P.lineLabel}. Issues found: ${P.stats.reasons.join(' ')}\nReturn JSON {"simplify":["which details of the subject to simplify or leave out, max 5"],"tools":["max 7"],"steps":["cutting and build order, max 9"],"tips":["max 5 beginner tips"]}` }, imgPart(img)] }]);
      const j = parseJSONLoose(raw); tips = { simplify: strs(j.simplify, 6), tools: strs(j.tools, 8), steps: strs(j.steps, 10), tips: strs(j.tips, 6) };
      if (!tips.tools.length || !tips.steps.length) { const l = glassGuideLocal(P); tips.tools = tips.tools.length ? tips.tools : l.tools; tips.steps = tips.steps.length ? tips.steps : l.steps; tips.tips = tips.tips.length ? tips.tips : l.tips; }
      if (scan) { scan.tips = tips; DB.put('scans', scan); } renderTips();
    } catch (e) { toast(e.message); renderTips(); }
  };
  fill();
  $('#gCol', out).oninput = e => { o.colors = +e.target.value; $('#gColV', out).textContent = o.colors; rebuild(); };
  $('#gSim', out).oninput = e => { o.simplicity = +e.target.value; $('#gSimV', out).textContent = o.simplicity; rebuild(); };
  $('#gDet', out).oninput = e => { o.detail = +e.target.value; $('#gDetV', out).textContent = o.detail; rebuild(); };
  $('#gW', out).onchange = e => { const v = fromU(+e.target.value); if (v >= 2 && v <= 120) { o.widthIn = r2(v); rebuild(); } else fill(); };
  $('#gH', out).onchange = e => { const v = e.target.value === '' ? 0 : fromU(+e.target.value); o.heightIn = v >= 2 && v <= 120 ? r2(v) : 0; rebuild(); };
  $$('[data-u]', out).forEach(b => b.onclick = () => { o.unit = b.dataset.u; fill(); draw(); });
  $$('[data-pv]', out).forEach(b => b.onclick = () => { view = b.dataset.pv; $$('[data-pv]', out).forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw(); });
  $$('[data-fill]', out).forEach(b => b.onclick = () => { fillMode = b.dataset.fill; $$('[data-fill]', out).forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw(); });
  $('#gOp', out).oninput = e => { op = +e.target.value / 100; draw(); };
  $('#gLine', out).onchange = e => { o.line = e.target.value; rebuild(); };
  $('#gFocus', out).onchange = e => { o.focus = e.target.checked; fill(); rebuild(); };
  $('#gFull', out).onchange = e => { o.zoom = !e.target.checked; rebuild(); };
  $('#gStyle', out).onchange = e => { o.style = e.target.value; rebuild(); };
  $('#gSmall', out).onchange = e => { o.smallFeat = e.target.value; fill(); rebuild(); };
  $('#gPaint', out).onchange = e => { o.paint = e.target.checked; rebuild(); };
  $('#gFrame', out).onchange = e => { o.frame = e.target.checked; $('#gFW', out).disabled = !o.frame; rebuild(); };
  $('#gFW', out).onchange = e => { const v = fromU(+e.target.value); if (v >= 0.5 && v <= 4) { o.frameIn = r2(v); rebuild(); } };
  $('#gFG', out).onchange = e => { o.frameGlass = e.target.value; rebuild(); };
  const fname = ext => `stained-glass-${P.stats.pieces}pc-${P.widthIn}x${P.heightIn}in.${ext}`;
  $('#gSVG', out).onclick = () => P && shareOrDownload(fname('svg'), glassSVG(P), 'image/svg+xml');
  $('#gPDF', out).onclick = () => P && shareOrDownload(fname('pdf'), glassPDF(P, { guide: tips }).blob(), 'application/pdf');
  $('#gCut', out).onclick = () => P && shareOrDownload(fname('cutlines.pdf').replace('.cutlines.pdf', '-cutlines.pdf'), glassPDF(P, { cut: true, guide: tips }).blob(), 'application/pdf');
  $('#gSave', out).onclick = async () => {
    if (!P) return; if (!scan) scan = { id: uid(), at: Date.now(), mode: 'glass', kind: 'glass', image: img, thumb: await thumbOf(img) };
    scan.title = 'Stained glass · ' + P.stats.pieces + ' pieces'; scan.result = P; scan.tips = tips; scan.recog = recog; await DB.put('scans', scan); $('#gSave', out).textContent = 'Saved ✓'; toast('Pattern and original photo saved to History');
  };
  const tapFirst = () => { picking = true;
    prev.innerHTML = `<div class="pick-wrap tap-first" id="gTapWrap"><img src="${img}" alt="" draggable="false"><div class="tap-dot" hidden></div></div>
      <p class="small" style="margin:8px 2px 4px"><b>Tap your subject</b> <span class="muted">— the bird, face, flower or building you want people to recognise. Its detail is kept; the background is simplified.</span></p>
      <div class="row gap wrap"><button class="pill" id="gTapSkip">Skip — detect automatically</button>${aiHasKey() ? '<button class="pill" id="gTapGrok">✨ Let Grok find it</button>' : ''}</div>`;
    loadImg(img).then(im => { const w = $('#gTapWrap', prev); if (w) { w.style.aspectRatio = String(im.naturalWidth / im.naturalHeight); if (w.scrollIntoView) w.scrollIntoView({ block: 'center' }); } });
    $('#gTapWrap', prev).onclick = async e => { const r = e.currentTarget.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height, d = $('.tap-dot', prev); Object.assign(d.style, { left: fx * 100 + '%', top: fy * 100 + '%' }); d.hidden = false;
      o.subjectBox = await glassTapBox(img, fx, fy); o.subjectName = 'your tap'; o.focus = true; picking = false; fill(); rebuild(); };
    $('#gTapSkip', prev).onclick = () => { picking = false; rebuild(); };
    const gb = $('#gTapGrok', prev); if (gb) gb.onclick = () => { picking = false; findSubject(); };
  };
  if (P) draw(); else if (o.subjectBox) rebuild(); else tapFirst();
  window.__glass = () => P; window.__glassO = () => o;
}
