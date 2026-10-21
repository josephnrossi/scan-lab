/* Scan Lab — Stained Glass mode UI */
const GLASS_PREFILL = 'glassPrefill';
async function glassOpen(out, { image, saved } = {}) {
  let o = { ...glassDefaults(), ...(saved ? saved.result.settings : {}) }, scan = saved || null, P = saved ? saved.result : null, tips = saved ? saved.tips || null : null, img = saved ? saved.image : image;
  if (!saved) { try { const pf = JSON.parse(localStorage.getItem(GLASS_PREFILL) || 'null'); if (pf && pf.widthIn) { o.widthIn = pf.widthIn; o.heightIn = pf.heightIn; localStorage.removeItem(GLASS_PREFILL); toast(`Using measured size ${pf.widthIn} × ${pf.heightIn} in`); } } catch (_) {} }
  const cm = () => o.unit === 'cm', toU = v => cm() ? r1(v * 2.54) : r2(v), fromU = v => cm() ? v / 2.54 : v;
  out.innerHTML = `<div class="card">
    <div class="res-head"><h2>Stained-glass pattern</h2><span class="badge" id="gDiffBadge"></span></div>
    <p class="muted small">Made on this device — no key needed. Every piece is a closed shape sized for a beginner.</p>
    <div class="glass-preview" id="gPrev"></div>
    <div class="seg" role="group" aria-label="Preview" style="margin-top:8px"><button data-pv="color" aria-pressed="true">Colors</button><button data-pv="cut" aria-pressed="false">Cut lines</button></div>
    <div class="ctl" style="margin-top:10px">
      <label>Colors <b id="gColV"></b><input type="range" id="gCol" min="3" max="10" step="1"></label>
      <label>Simplicity <b id="gSimV"></b><input type="range" id="gSim" min="1" max="10" step="1" title="Higher = fewer, larger pieces"></label>
      <label>Finished width <input type="number" id="gW" inputmode="decimal" min="2" step="0.5"></label>
      <label>Height <input type="number" id="gH" inputmode="decimal" min="2" step="0.5" placeholder="auto"></label>
      <label>Units <span class="seg"><button data-u="in">in</button><button data-u="cm">cm</button></span></label>
      <label>Lines <select id="gLine">${Object.entries(GLASS_LINES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
      <label class="toggle"><input type="checkbox" id="gFocus"> Focus on subject</label>
      <label class="toggle"><input type="checkbox" id="gFrame"> Border frame</label>
      <label>Frame width <input type="number" id="gFW" inputmode="decimal" min="0.5" max="4" step="0.25"></label>
      <label>Frame glass <select id="gFG"><option value="">Auto (darkest)</option>${GLASS_PALETTE.map(p => `<option>${p[0]}</option>`).join('')}</select></label>
    </div>
  </div>
  <div class="card" id="gStats"></div>
  <div class="card"><h3 style="margin-top:0">Glass to buy</h3><div class="legend" id="gLegend"></div></div>
  <div class="card"><div class="export-row">
    <button class="primary" id="gSave">${saved ? 'Saved ✓' : 'Save to History'}</button>
    <button class="pill" id="gSVG">⤓ SVG</button><button class="pill" id="gPDF">⤓ Pattern PDF</button><button class="pill" id="gCut">⤓ Cut-line PDF</button>
  </div><p class="muted small">PDFs print at real size (tiled on Letter pages with ⊕ alignment marks when larger). Print at 100% / Actual size.</p></div>
  <div class="card" id="gTips"></div>`;
  const prev = $('#gPrev', out); let view = 'color', t;
  const fill = () => {
    $('#gCol', out).value = o.colors; $('#gColV', out).textContent = o.colors; $('#gSim', out).value = o.simplicity; $('#gSimV', out).textContent = o.simplicity;
    $('#gW', out).value = toU(o.widthIn); $('#gH', out).value = o.heightIn ? toU(o.heightIn) : ''; $('#gH', out).placeholder = P ? 'auto ' + toU(P.heightIn) : 'auto';
    $$('[data-u]', out).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.u === o.unit))); $('#gLine', out).value = o.line; $('#gFocus', out).checked = o.focus; $('#gFrame', out).checked = o.frame; $('#gFW', out).value = toU(o.frameIn); $('#gFW', out).disabled = !o.frame; $('#gFG', out).value = o.frameGlass || '';
  };
  const draw = () => {
    if (!P) return; prev.innerHTML = glassSVG(P, { cut: view === 'cut' }).replace(/width="[^"]+in" height="[^"]+in"/, `width="100%" preserveAspectRatio="xMidYMid meet"`);
    const s = P.stats, U = cm() ? 'cm' : 'in', sq = cm() ? ' cm²' : ' sq in', A = v => cm() ? (v * 6.4516).toFixed(0) : v.toFixed(1);
    $('#gDiffBadge', out).innerHTML = `<span class="diff ${s.difficulty === 'Beginner' ? 'beg' : 'int'}">${s.difficulty}</span>`;
    $('#gStats', out).innerHTML = `<div class="res-head"><b>${s.pieces} pieces · ${toU(P.widthIn)} × ${toU(P.heightIn)} ${U}</b><span class="diff ${s.difficulty === 'Beginner' ? 'beg' : 'int'}">${s.difficulty}</span></div>
      <ul class="tight small">${s.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      <p class="small muted">Rules: pieces ≥ ${A(s.minAreaIn)}${sq}, ≥ ${cm() ? (s.minWidthIn * 2.54).toFixed(1) + ' cm' : fracIn(s.minWidthIn)} wide, narrow necks and sharp points auto-merged, no piece encloses another. Smallest piece: ${A(s.smallestIn)}${sq}. ${esc(P.lineLabel)}.</p>
      ${P.notes.map(n => `<p class="small muted">ℹ︎ ${esc(n)}</p>`).join('')}`;
    $('#gLegend', out).innerHTML = P.legend.map(e => `<div><span class="sw" style="background:${e.hex}"></span><span><b>${esc(e.glass)}</b><br>${e.count} pc · ${A(e.areaIn)}${sq}</span></div>`).join('');
    renderTips();
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
    try { const id = await glassImageData(img, o); P = glassBuild(id, o); draw(); if (scan) { scan.result = P; scan.title = 'Stained glass · ' + P.stats.pieces + ' pieces'; await DB.put('scans', scan); } }
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
  $('#gW', out).onchange = e => { const v = fromU(+e.target.value); if (v >= 2 && v <= 120) { o.widthIn = r2(v); rebuild(); } else fill(); };
  $('#gH', out).onchange = e => { const v = e.target.value === '' ? 0 : fromU(+e.target.value); o.heightIn = v >= 2 && v <= 120 ? r2(v) : 0; rebuild(); };
  $$('[data-u]', out).forEach(b => b.onclick = () => { o.unit = b.dataset.u; fill(); draw(); });
  $$('[data-pv]', out).forEach(b => b.onclick = () => { view = b.dataset.pv; $$('[data-pv]', out).forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw(); });
  $('#gLine', out).onchange = e => { o.line = e.target.value; rebuild(); };
  $('#gFocus', out).onchange = e => { o.focus = e.target.checked; rebuild(); };
  $('#gFrame', out).onchange = e => { o.frame = e.target.checked; $('#gFW', out).disabled = !o.frame; rebuild(); };
  $('#gFW', out).onchange = e => { const v = fromU(+e.target.value); if (v >= 0.5 && v <= 4) { o.frameIn = r2(v); rebuild(); } };
  $('#gFG', out).onchange = e => { o.frameGlass = e.target.value; rebuild(); };
  const fname = ext => `stained-glass-${P.stats.pieces}pc-${P.widthIn}x${P.heightIn}in.${ext}`;
  $('#gSVG', out).onclick = () => P && shareOrDownload(fname('svg'), glassSVG(P), 'image/svg+xml');
  $('#gPDF', out).onclick = () => P && shareOrDownload(fname('pdf'), glassPDF(P, { guide: tips }).blob(), 'application/pdf');
  $('#gCut', out).onclick = () => P && shareOrDownload(fname('cutlines.pdf').replace('.cutlines.pdf', '-cutlines.pdf'), glassPDF(P, { cut: true, guide: tips }).blob(), 'application/pdf');
  $('#gSave', out).onclick = async () => {
    if (!P) return; if (!scan) scan = { id: uid(), at: Date.now(), mode: 'glass', kind: 'glass', image: img, thumb: await thumbOf(img) };
    scan.title = 'Stained glass · ' + P.stats.pieces + ' pieces'; scan.result = P; scan.tips = tips; await DB.put('scans', scan); $('#gSave', out).textContent = 'Saved ✓'; toast('Pattern saved to History');
  };
  if (P) draw(); else rebuild();
  window.__glass = () => P;
}
