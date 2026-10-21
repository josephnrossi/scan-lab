/* Scan Lab — Receipts & Documents: on-device crop/enhance, Grok extraction, manual entry, TXT/CSV/VCF export, receipts list. */
async function docEnhance(src) {
  const im = await loadImg(src), W = im.naturalWidth, H = im.naturalHeight, s = Math.min(1, 200 / Math.max(W, H)), w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, L = new Float32Array(w * h); for (let i = 0; i < w * h; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  // Otsu threshold → bright "paper" mask; take the bounding box of the largest bright blob
  const hist = new Array(256).fill(0); L.forEach(v => hist[v | 0]++); let sum = 0; hist.forEach((c2, i) => sum += i * c2); let sB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = w * h - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; thr = t; } }
  const lab = new Int32Array(w * h).fill(-1); let bestBlob = null;
  for (let i = 0; i < w * h; i++) { if (lab[i] >= 0 || L[i] <= thr) continue; const st = [i]; lab[i] = i; let n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0; while (st.length) { const p = st.pop(), x = p % w, y = (p - x) / w; n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) if (q >= 0 && lab[q] < 0 && L[q] > thr) { lab[q] = i; st.push(q); } } if (!bestBlob || n > bestBlob.n) bestBlob = { n, x0, y0, x1, y1 }; }
  let crop = [0, 0, W, H];
  if (bestBlob && bestBlob.n > w * h * 0.12 && (bestBlob.x1 - bestBlob.x0) * (bestBlob.y1 - bestBlob.y0) < w * h * 0.97) { const m = 3; crop = [Math.max(0, (bestBlob.x0 - m) / s), Math.max(0, (bestBlob.y0 - m) / s), Math.min(W, (bestBlob.x1 + m + 1) / s), Math.min(H, (bestBlob.y1 + m + 1) / s)]; }
  const cw = crop[2] - crop[0], ch = crop[3] - crop[1], k = Math.min(1, 1600 / Math.max(cw, ch)), o = document.createElement('canvas'); o.width = Math.round(cw * k); o.height = Math.round(ch * k);
  const og = o.getContext('2d', { willReadFrequently: true }); og.drawImage(im, crop[0], crop[1], cw, ch, 0, 0, o.width, o.height);
  // auto-levels on luminance (2%–98%) with mild contrast boost
  const id = og.getImageData(0, 0, o.width, o.height), a = id.data, hh = new Array(256).fill(0), N = o.width * o.height; for (let i = 0; i < N; i++) hh[(0.299 * a[i * 4] + 0.587 * a[i * 4 + 1] + 0.114 * a[i * 4 + 2]) | 0]++;
  let lo = 0, hi = 255, acc = 0; for (; lo < 255; lo++) { acc += hh[lo]; if (acc > N * 0.02) break; } acc = 0; for (; hi > 0; hi--) { acc += hh[hi]; if (acc > N * 0.02) break; }
  if (hi - lo > 20) { const sc = 255 / (hi - lo); for (let i = 0; i < N * 4; i++) { if (i % 4 === 3) continue; a[i] = Math.max(0, Math.min(255, (a[i] - lo) * sc)); } og.putImageData(id, 0, 0); }
  return { image: o.toDataURL('image/jpeg', 0.85), cropped: crop[2] - crop[0] < W - 2 || crop[3] - crop[1] < H - 2 };
}
const DOC_SCHEMA = `{"doc_type":"receipt|business_card|document","title":"short title","text":"all text, cleaned, in reading order, with line breaks",
"receipt":{"merchant":"","date":"YYYY-MM-DD","time":"","items":[{"desc":"","qty":1,"price":0.00}],"subtotal":0,"tax":0,"tip":0,"total":0,"currency":"USD","payment":"e.g. Visa ••1234 / cash","category":"e.g. groceries, fuel, dining, hardware"},
"card":{"name":"","title":"","company":"","phones":[{"type":"work|mobile|fax","number":""}],"emails":[""],"website":"","address":""},
"document":{"title":"","summary":"2-4 sentences","specs":[{"key":"","value":""}]}}`;
function validateDoc(o) {
  o = o && typeof o === 'object' ? o : {}; let t = String(o.doc_type || o.type || '').toLowerCase();
  t = /receipt|invoice/.test(t) ? 'receipt' : /card/.test(t) ? 'business_card' : 'document';
  const r = o.receipt || {}, c = o.card || o.business_card || {}, d = o.document || {}, money = v => { const n = num(v); return n == null ? null : Math.round(n * 100) / 100; };
  const out = { kind: 'doc', doc_type: t, title: str(o.title, 100), text: str(o.text, 20000) };
  if (t === 'receipt') out.receipt = { merchant: str(r.merchant, 100), date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')) ? r.date : str(r.date, 20), time: str(r.time, 10), items: (Array.isArray(r.items) ? r.items : []).slice(0, 200).map(i => ({ desc: str(i.desc || i.name, 120), qty: num(i.qty) ?? 1, price: money(i.price ?? i.amount) })).filter(i => i.desc), subtotal: money(r.subtotal), tax: money(r.tax), tip: money(r.tip), total: money(r.total), currency: str(r.currency, 5) || 'USD', payment: str(r.payment, 60), category: str(r.category, 40) };
  if (t === 'business_card') out.card = { name: str(c.name, 100), title: str(c.title, 100), company: str(c.company, 100), phones: (Array.isArray(c.phones) ? c.phones : c.phone ? [c.phone] : []).map(p => typeof p === 'string' ? { type: 'work', number: str(p, 40) } : { type: str(p.type, 10) || 'work', number: str(p.number, 40) }).filter(p => p.number), emails: strs(c.emails || c.email, 5), website: str(c.website, 120), address: str(c.address, 200) };
  if (t === 'document') out.document = { title: str(d.title || o.title, 120), summary: str(d.summary, 1200), specs: (Array.isArray(d.specs) ? d.specs : []).slice(0, 80).map(s => ({ key: str(s.key || s.name, 80), value: str(s.value, 200) })).filter(s => s.key) };
  if (!out.text && !(out.receipt && out.receipt.total) && !(out.card && out.card.name)) throw new AIError('badjson', 'The AI didn’t return any text. Try a sharper photo.');
  out.title = out.title || (out.receipt && out.receipt.merchant) || (out.card && out.card.name) || (out.document && out.document.title) || 'Document';
  return out;
}
function docSummary(r) { if (r.doc_type === 'receipt' && r.receipt) return (r.receipt.total != null ? moneyFmt(r.receipt.total, r.receipt.currency) : 'Receipt') + (r.receipt.date ? ' · ' + r.receipt.date : ''); if (r.doc_type === 'business_card') return 'Business card'; return (r.pages || 1) + ' page' + ((r.pages || 1) > 1 ? 's' : ''); }
const moneyFmt = (n, cur = 'USD') => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'USD' }).format(n || 0); } catch (_) { return (n || 0).toFixed(2); } };

async function docsAnalyze(out, pages) {
  out.innerHTML = '<div class="card"><span class="spinner"></span>Cropping and enhancing ' + pages.length + ' page' + (pages.length > 1 ? 's' : '') + '…</div>';
  const enh = []; for (const p of pages) { try { enh.push((await docEnhance(p)).image); } catch (_) { enh.push(p); } }
  if (!aiHasKey()) return docsManual(out, enh, 'No API key — the pages are kept; type or paste the text below (or add a key in Settings for automatic extraction).');
  const ctl = new AbortController(); S.busy = ctl; const b = $('#btnAnalyze'); b.disabled = true;
  out.innerHTML = `<div class="card"><span class="spinner"></span>Grok is reading ${enh.length} page${enh.length > 1 ? 's' : ''}… <button class="pill" id="btnCancel">Cancel</button></div>`; $('#btnCancel').onclick = () => ctl.abort();
  try {
    const raw = await aiChat([{ role: 'system', content: 'You extract text and structured data from photos of receipts, business cards and documents. Strict JSON only. Never invent values: use null or "" when unreadable.' }, { role: 'user', content: [{ type: 'text', text: `Read these ${enh.length} page image(s) as one document. Classify it, transcribe the text cleanly, and fill the matching section. Return ONLY JSON: ${DOC_SCHEMA}` }, ...enh.map(imgPart)] }], { signal: ctl.signal, timeout: 180000 });
    const r = validateDoc(parseJSONLoose(raw)); r.pages = enh.length;
    const scan = { id: uid(), at: Date.now(), mode: 'docs', kind: 'doc', title: r.title, image: enh[0], pages: enh, thumb: await thumbOf(enh[0]), result: r, model: aiCfg().model };
    await DB.put('scans', scan); docsRender(out, scan);
  } catch (e) { if (e.kind === 'offline' || e.kind === 'nokey') docsManual(out, enh, e.message); else renderError(out, e, () => docsAnalyze(out, pages)); }
  finally { S.busy = null; b.disabled = !S.photos.length; b.textContent = MODES[S.mode].btn; }
}
function docsManual(out, enh, why) {
  const scan = { id: uid(), at: Date.now(), mode: 'docs', kind: 'doc', title: 'Document', image: enh[0], pages: enh, thumb: null, result: { kind: 'doc', doc_type: 'receipt', title: '', text: '', pages: enh.length, manual: true, receipt: { merchant: '', date: todayStr(), items: [], subtotal: null, tax: null, tip: null, total: null, currency: 'USD', payment: '', category: '' } } };
  out.innerHTML = `<div class="card warn small">${esc(why)}</div><div id="docBody"></div>`;
  thumbOf(enh[0]).then(t => { scan.thumb = t; }); docsRender($('#docBody', out), scan, true);
}
function docsRender(out, scan, unsaved = false) {
  const r = scan.result; let saveT;
  const save = () => { if (unsaved) return; clearTimeout(saveT); saveT = setTimeout(() => { scan.title = r.title || (r.receipt && r.receipt.merchant) || (r.card && r.card.name) || 'Document'; DB.put('scans', scan); }, 300); };
  const field = (path, label, val, type = 'text') => `<label class="field kv"><span>${label}</span><input data-f="${path}" type="${type}" value="${esc(val ?? '')}" ${type === 'number' ? 'step="0.01" inputmode="decimal"' : ''}></label>`;
  const typeSel = `<label class="field"><span>Type</span><select id="docType">${[['receipt', 'Receipt'], ['business_card', 'Business card'], ['document', 'Document / spec sheet']].map(([k, l]) => `<option value="${k}" ${k === r.doc_type ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
  let sec = '';
  if (r.doc_type === 'receipt') { const x = r.receipt = r.receipt || { items: [] }; sec = `<h3>Receipt</h3><div class="ctl">${field('receipt.merchant', 'Merchant', x.merchant)}${field('receipt.date', 'Date', x.date, 'date')}${field('receipt.subtotal', 'Subtotal', x.subtotal, 'number')}${field('receipt.tax', 'Tax', x.tax, 'number')}${field('receipt.tip', 'Tip', x.tip, 'number')}${field('receipt.total', 'Total', x.total, 'number')}${field('receipt.payment', 'Payment', x.payment)}${field('receipt.category', 'Category', x.category)}</div>
    ${x.items.length ? `<table><tr><th>Item</th><th>Qty</th><th>Price</th></tr>${x.items.map(i => `<tr><td>${esc(i.desc)}</td><td>${i.qty ?? ''}</td><td>${i.price != null ? moneyFmt(i.price, x.currency) : ''}</td></tr>`).join('')}</table>` : ''}
    ${x.items.length && x.total != null ? (() => { const s = x.items.reduce((a, i) => a + (i.price || 0) * (1), 0); const d = Math.abs((x.subtotal ?? x.total) - s); return d > 0.02 && x.subtotal != null ? `<p class="small conf-medium">Line items add up to ${moneyFmt(s, x.currency)} vs subtotal ${moneyFmt(x.subtotal, x.currency)} — double-check.</p>` : ''; })() : ''}`; }
  if (r.doc_type === 'business_card') { const c = r.card = r.card || { phones: [], emails: [] }; sec = `<h3>Contact</h3><div class="ctl">${field('card.name', 'Name', c.name)}${field('card.title', 'Title', c.title)}${field('card.company', 'Company', c.company)}${field('card.phone0', 'Phone', (c.phones[0] || {}).number)}${field('card.phone1', 'Phone 2', (c.phones[1] || {}).number)}${field('card.email0', 'Email', c.emails[0], 'email')}${field('card.website', 'Website', c.website)}${field('card.address', 'Address', c.address)}</div>`; }
  if (r.doc_type === 'document') { const d = r.document = r.document || { specs: [] }; sec = `<h3>Document</h3>${field('document.title', 'Title', d.title)}${d.summary ? `<p class="small">${esc(d.summary)}</p>` : ''}${d.specs.length ? `<table><tr><th>Spec</th><th>Value</th></tr>${d.specs.map(s => `<tr><td>${esc(s.key)}</td><td>${esc(s.value)}</td></tr>`).join('')}</table>` : ''}`; }
  out.innerHTML = `<div class="card"><div class="res-head"><h2>${r.doc_type === 'receipt' ? '🧾' : r.doc_type === 'business_card' ? '👤' : '📄'} ${esc(r.title || 'Document')}</h2><span class="badge">${r.pages || 1} page${(r.pages || 1) > 1 ? 's' : ''}${r.manual ? ' · manual' : ''}</span></div>
    ${scan.pages && scan.pages.length ? `<div class="pages-row">${scan.pages.map((p, i) => `<div class="pg"><img src="${p}" alt="Page ${i + 1}"><em>p${i + 1}</em></div>`).join('')}</div>` : ''}
    ${typeSel}${sec}
    <h3>Text</h3><textarea class="doc-text" id="docText" spellcheck="false" placeholder="Type or paste the text here">${esc(r.text)}</textarea>
    <div class="export-row" style="margin-top:8px">${unsaved ? '<button class="primary" id="docSave">Save</button>' : ''}<button class="pill" id="docCopy">⧉ Copy text</button><button class="pill" id="docTXT">⤓ TXT</button>${r.doc_type === 'receipt' ? '<button class="pill" id="docCSV">⤓ CSV</button>' : ''}${r.doc_type === 'business_card' ? '<button class="primary" id="docVCF">＋ Contact (.vcf)</button>' : ''}</div>
    <p class="muted small">${r.manual ? 'Saved on this device.' : 'Extracted by Grok from the photo — check numbers before relying on them.'}</p></div>`;
  $('#docType', out).onchange = e => { r.doc_type = e.target.value; save(); docsRender(out, scan, unsaved); };
  $('#docText', out).oninput = e => { r.text = e.target.value; save(); };
  $$('[data-f]', out).forEach(inp => inp.oninput = () => { const [sec2, k] = inp.dataset.f.split('.'), o = r[sec2]; const v = inp.type === 'number' ? (inp.value === '' ? null : +inp.value) : inp.value;
    if (sec2 === 'card' && /^phone\d$/.test(k)) { const i = +k.slice(-1); o.phones[i] = { type: i ? 'mobile' : 'work', number: v }; o.phones = o.phones.filter(Boolean); }
    else if (sec2 === 'card' && k === 'email0') o.emails = [v]; else o[k] = v;
    if (sec2 === 'document' && k === 'title') r.title = v; if (sec2 === 'receipt' && k === 'merchant') r.title = v; if (sec2 === 'card' && k === 'name') r.title = v; save(); });
  const sv = $('#docSave', out); if (sv) sv.onclick = async () => { unsaved = false; r.title = r.title || (r.receipt && r.receipt.merchant) || 'Document'; scan.title = r.title; scan.thumb = scan.thumb || await thumbOf(scan.image); await DB.put('scans', scan); toast('Saved'); docsRender(out, scan); };
  const nm = ext => (r.title || 'document').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) + '.' + ext;
  $('#docCopy', out).onclick = async () => { try { await navigator.clipboard.writeText(docTXT(r)); toast('Copied'); } catch (_) { $('#docText', out).select(); document.execCommand && document.execCommand('copy'); toast('Copied'); } };
  $('#docTXT', out).onclick = () => shareOrDownload(nm('txt'), docTXT(r), 'text/plain');
  const c = $('#docCSV', out); if (c) c.onclick = () => shareOrDownload(nm('csv'), receiptCSV(r), 'text/csv');
  const v = $('#docVCF', out); if (v) v.onclick = () => shareOrDownload(nm('vcf'), vcard(r.card), 'text/vcard');
}
function docTXT(r) {
  const L = [];
  if (r.doc_type === 'receipt' && r.receipt) { const x = r.receipt; L.push(`${x.merchant || 'Receipt'}${x.date ? ' — ' + x.date : ''}`); x.items.forEach(i => L.push(`  ${i.desc}${i.qty && i.qty !== 1 ? ' ×' + i.qty : ''}  ${i.price != null ? i.price.toFixed(2) : ''}`)); for (const k of ['subtotal', 'tax', 'tip', 'total']) if (x[k] != null) L.push(`${k[0].toUpperCase() + k.slice(1)}: ${x[k].toFixed(2)}`); if (x.payment) L.push('Payment: ' + x.payment); L.push(''); }
  if (r.doc_type === 'business_card' && r.card) { const c = r.card; L.push(...[c.name, c.title, c.company, ...c.phones.map(p => p.type + ': ' + p.number), ...c.emails, c.website, c.address].filter(Boolean), ''); }
  if (r.doc_type === 'document' && r.document) { const d = r.document; if (d.title) L.push(d.title); if (d.summary) L.push(d.summary); d.specs.forEach(s => L.push(`${s.key}: ${s.value}`)); L.push(''); }
  L.push(r.text || ''); return L.join('\n');
}
const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
function receiptCSV(r) { const x = r.receipt, rows = [['Merchant', 'Date', 'Item', 'Qty', 'Price', 'Currency']]; x.items.forEach(i => rows.push([x.merchant, x.date, i.desc, i.qty, i.price, x.currency])); rows.push([x.merchant, x.date, 'SUBTOTAL', '', x.subtotal, x.currency], [x.merchant, x.date, 'TAX', '', x.tax, x.currency], [x.merchant, x.date, 'TIP', '', x.tip, x.currency], [x.merchant, x.date, 'TOTAL', '', x.total, x.currency]); return rows.map(r2 => r2.map(csvCell).join(',')).join('\r\n'); }
function vcard(c) {
  const e = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m), parts = String(c.name || '').trim().split(/\s+/), last = parts.length > 1 ? parts.pop() : '', first = parts.join(' ');
  return ['BEGIN:VCARD', 'VERSION:3.0', `N:${e(last)};${e(first)};;;`, `FN:${e(c.name)}`, c.company && `ORG:${e(c.company)}`, c.title && `TITLE:${e(c.title)}`, ...c.phones.map(p => `TEL;TYPE=${/mob|cell/i.test(p.type) ? 'CELL' : /fax/i.test(p.type) ? 'FAX' : 'WORK'}:${e(p.number)}`), ...c.emails.filter(Boolean).map(m => `EMAIL;TYPE=INTERNET:${e(m)}`), c.website && `URL:${e(c.website)}`, c.address && `ADR;TYPE=WORK:;;${e(c.address)};;;;`, 'NOTE:Scanned with Scan Lab', 'END:VCARD'].filter(Boolean).join('\r\n') + '\r\n';
}
/* ---------- receipts list ---------- */
async function receiptScans() { return (await DB.all('scans')).filter(s => s.kind === 'doc' && s.result && s.result.doc_type === 'receipt').map(s => ({ s, x: s.result.receipt || {}, month: (/^\d{4}-\d{2}/.test(s.result.receipt && s.result.receipt.date || '') ? s.result.receipt.date.slice(0, 7) : todayStr(new Date(s.at)).slice(0, 7)) })).sort((a, b) => ((b.x.date || '') + b.s.at).localeCompare((a.x.date || '') + a.s.at)); }
async function renderReceipts() {
  const list = await receiptScans(), months = new Map(); for (const r of list) { const m = months.get(r.month) || { total: 0, n: 0, cur: r.x.currency || 'USD' }; m.total += r.x.total || 0; m.n++; months.set(r.month, m); }
  $('#rcptMonths').innerHTML = months.size ? `<div class="card"><h3 style="margin-top:0">By month</h3>${[...months].sort((a, b) => b[0].localeCompare(a[0])).map(([m, v]) => `<div class="month"><span>${new Date(m + '-15').toLocaleDateString([], { month: 'long', year: 'numeric' })} · ${v.n}</span><b data-month="${m}">${moneyFmt(v.total, v.cur)}</b></div>`).join('')}</div>` : '';
  $('#rcptList').innerHTML = list.length ? list.map(({ s, x }) => `<div class="hist-item"><button class="hist-open" data-ro="${s.id}"><img src="${s.thumb || ''}" alt=""><div class="meta"><b>${esc(x.merchant || s.title)}</b><span>${esc(x.date || fmtWhen(s.at))}${x.category ? ' · ' + esc(x.category) : ''}</span></div></button><b>${x.total != null ? moneyFmt(x.total, x.currency) : '—'}</b></div>`).join('') : '<p class="muted">No receipts yet. Choose Docs mode and photograph a receipt.</p>';
  $$('[data-ro]').forEach(b => b.onclick = () => openDetail(list.find(r => r.s.id === b.dataset.ro).s));
}
async function exportReceiptsCSV() { const list = await receiptScans(); if (!list.length) return toast('No receipts yet'); const rows = [['Date', 'Merchant', 'Category', 'Subtotal', 'Tax', 'Tip', 'Total', 'Currency', 'Payment']]; list.forEach(({ x, s }) => rows.push([x.date || todayStr(new Date(s.at)), x.merchant, x.category, x.subtotal, x.tax, x.tip, x.total, x.currency, x.payment])); shareOrDownload('receipts-' + todayStr() + '.csv', rows.map(r => r.map(csvCell).join(',')).join('\r\n'), 'text/csv'); }
