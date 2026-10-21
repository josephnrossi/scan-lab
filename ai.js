/* Scan Lab — AI client (OpenAI-compatible chat completions with images) + strict JSON parsing/validation. */
const AI_PRESETS = {
  xai: { label: 'xAI Grok', base: 'https://api.x.ai/v1', model: 'grok-4.7' },
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-6-luna' },
  custom: { label: 'Custom', base: '', model: '' },
};
const AI_KEY = 'scanLabAI';
const AI_URL_OK = /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.local)(:\d+)?(\/|$))/i;
function aiCfg() { try { return { provider: 'xai', base: AI_PRESETS.xai.base, model: AI_PRESETS.xai.model, key: '', ...JSON.parse(localStorage.getItem(AI_KEY) || '{}') }; } catch (_) { return { provider: 'xai', base: AI_PRESETS.xai.base, model: AI_PRESETS.xai.model, key: '' }; } }
function aiSave(c) { localStorage.setItem(AI_KEY, JSON.stringify({ provider: c.provider, base: c.base, model: c.model, key: c.key, whisperKey: c.whisperKey || '' })); }
function aiHasKey() { const c = aiCfg(); return !!(c.key && c.base && c.model); }
/* Pencil Notes (same origin) keeps its assistant settings in localStorage 'assistAI' = {on, provider, base, model, key}. */
function pencilNotesKey() { try { const p = JSON.parse(localStorage.getItem('assistAI') || 'null'); return p && typeof p.key === 'string' && p.key.length > 8 ? p : null; } catch (_) { return null; } }

class AIError extends Error { constructor(kind, msg, raw) { super(msg); this.kind = kind; this.raw = raw; } }

async function aiChat(messages, { json = true, signal, timeout = 120000, cfg = aiCfg() } = {}) {
  if (!cfg.key) throw new AIError('nokey', 'Add your Grok API key in Settings first.');
  if (!AI_URL_OK.test(cfg.base || '')) throw new AIError('config', 'The base URL must start with https://');
  if (!navigator.onLine) throw new AIError('offline', 'You’re offline. Your photo is kept — tap again when you’re back online.');
  const url = cfg.base.replace(/\/+$/, '') + '/chat/completions';
  const body = { model: cfg.model, temperature: 0.2, messages };
  if (json) body.response_format = { type: 'json_object' };
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort('timeout'), timeout);
  if (signal) signal.addEventListener('abort', () => ctl.abort('cancel'));
  const go = async (b) => {
    let r;
    try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key }, body: JSON.stringify(b), signal: ctl.signal }); }
    catch (e) {
      if (ctl.signal.aborted) throw new AIError(ctl.signal.reason === 'cancel' ? 'cancel' : 'timeout', ctl.signal.reason === 'cancel' ? 'Cancelled.' : 'The AI took too long to answer. Try again.');
      throw new AIError(navigator.onLine ? 'network' : 'offline', navigator.onLine ? 'Couldn’t reach ' + new URL(url).host + '. Check your connection and try again.' : 'You’re offline. Your photo is kept — tap again when you’re back online.');
    }
    return r;
  };
  try {
    let r = await go(body);
    if (r.status === 400 && json) { r = await go({ ...body, response_format: undefined }); } // some models reject response_format
    if (!r.ok) {
      let detail = ''; try { const j = await r.json(); detail = (j.error && (j.error.message || j.error)) || j.message || ''; } catch (_) {}
      if (r.status === 401 || r.status === 403) throw new AIError('auth', 'The API key was rejected (' + r.status + '). Check it in Settings.');
      if (r.status === 429) throw new AIError('rate', 'Rate limit or out of credit (429). Check billing at console.x.ai, then retry.');
      if (r.status === 404) throw new AIError('config', 'Model or URL not found (404). Check the model name in Settings.');
      throw new AIError('http', 'The AI service returned an error (' + r.status + ')' + (detail ? ': ' + String(detail).slice(0, 160) : '.'));
    }
    const j = await r.json().catch(() => { throw new AIError('badjson', 'The AI service sent an unreadable reply.'); });
    let c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (Array.isArray(c)) c = c.map(p => p.text || '').join('');
    if (typeof c !== 'string' || !c.trim()) throw new AIError('badjson', 'The AI returned an empty answer. Try again.');
    return c;
  } finally { clearTimeout(t); }
}

function parseJSONLoose(s) {
  if (s && typeof s === 'object') return s;
  let t = String(s || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch (_) {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) {} }
  throw new AIError('badjson', 'The AI answer wasn’t valid JSON. Tap Analyze to try again.', String(s).slice(0, 2000));
}

/* ---------- normalizers ---------- */
const num = v => { if (typeof v === 'number' && isFinite(v)) return v; if (typeof v === 'string') { const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; } return null; };
function rng(v) {
  if (v == null) return null;
  let a, b;
  if (Array.isArray(v)) { a = num(v[0]); b = num(v.length > 1 ? v[1] : v[0]); }
  else if (typeof v === 'object') { a = num(v.low ?? v.min ?? v.lo ?? v.value); b = num(v.high ?? v.max ?? v.hi ?? v.value); }
  else if (typeof v === 'string' && /[-–]/.test(v.replace(/^-/, ''))) { const p = v.split(/[-–]|to/).map(num).filter(x => x != null); a = p[0]; b = p[1] ?? p[0]; }
  else { a = b = num(v); }
  if (a == null && b == null) return null; if (a == null) a = b; if (b == null) b = a;
  a = Math.max(0, a); b = Math.max(0, b); return a <= b ? [a, b] : [b, a];
}
const str = (v, max = 400) => (v == null ? '' : String(v)).slice(0, max).trim();
const strs = (v, max = 30) => (Array.isArray(v) ? v : v ? [v] : []).map(x => typeof x === 'object' && x ? str(x.name || x.text || JSON.stringify(x)) : str(x)).filter(Boolean).slice(0, max);
const conf = v => { const s = String(v || '').toLowerCase(); if (/high/.test(s)) return 'high'; if (/low/.test(s)) return 'low'; const n = num(v); if (n != null) { const p = n > 1 ? n / 100 : n; return p >= 0.75 ? 'high' : p >= 0.45 ? 'medium' : 'low'; } return 'medium'; };
const NUTRI = [['calories', 'kcal', 'Calories'], ['protein_g', 'g', 'Protein'], ['carbs_g', 'g', 'Carbs'], ['fat_g', 'g', 'Fat'], ['fiber_g', 'g', 'Fiber'], ['sugar_g', 'g', 'Sugar'], ['sodium_mg', 'mg', 'Sodium']];

function validateFood(o) {
  const items = (Array.isArray(o.items) ? o.items : []).slice(0, 25).map(it => {
    const grams = num(it.grams ?? it.portion_g ?? it.weight_g) || null, sg = num(it.serving_grams) || grams || 100;
    const n = it.nutrition && typeof it.nutrition === 'object' ? { ...it, ...it.nutrition } : it;
    const out = { name: str(it.name, 80) || 'Item', grams: grams || sg, base_grams: grams || sg, serving_grams: sg, serving_desc: str(it.serving_desc || it.portion, 80), ingredients: strs(it.ingredients), allergens: strs(it.allergens), confidence: conf(it.confidence) };
    for (const [k] of NUTRI) out[k] = rng(n[k] ?? n[k.replace(/_(g|mg)$/, '')]) || [0, 0];
    return out;
  }).filter(it => it.name);
  if (!items.length) throw new AIError('badjson', 'The AI didn’t list any food items. Try a clearer photo or add a hint.');
  return { kind: 'food', title: str(o.title, 80) || items.map(i => i.name).slice(0, 3).join(', '), confidence: conf(o.confidence), confidence_note: str(o.confidence_note), items, allergens: strs(o.allergens), notes: str(o.notes, 600) };
}
function validateMaterials(o) {
  const pct = v => rng(v);
  const r = {
    kind: 'materials', title: str(o.title || o.object, 80) || 'Object', object: str(o.object || o.title, 120), confidence: conf(o.confidence), confidence_note: str(o.confidence_note),
    materials: (Array.isArray(o.materials) ? o.materials : []).slice(0, 15).map(m => typeof m === 'string' ? { name: str(m, 80), percent: null, where: '' } : { name: str(m.name, 80), percent: pct(m.percent), where: str(m.where || m.part, 120) }).filter(m => m.name),
    compounds: (Array.isArray(o.compounds) ? o.compounds : []).slice(0, 20).map(c => typeof c === 'string' ? { name: str(c, 80), formula: '', percent: null, notes: '' } : { name: str(c.name, 80), formula: str(c.formula, 40).replace(/[^A-Za-z0-9()[\]·.+\-–]/g, ''), percent: pct(c.percent), notes: str(c.notes, 160) }).filter(c => c.name),
    properties: (Array.isArray(o.properties) ? o.properties : o.properties && typeof o.properties === 'object' ? Object.entries(o.properties).map(([name, value]) => ({ name, value })) : []).slice(0, 20).map(p => ({ name: str(p.name, 50), value: str(typeof p.value === 'object' ? JSON.stringify(p.value) : p.value, 120), notes: str(p.notes, 120) })).filter(p => p.name && p.value),
    safety: strs(o.safety), recycling: strs(o.recycling), notes: str(o.notes, 600),
  };
  if (!r.materials.length && !r.compounds.length) throw new AIError('badjson', 'The AI didn’t identify any materials. Try a closer photo or add a hint.');
  return r;
}
function validateScan(o) {
  o = o && typeof o === 'object' ? o : {};
  const k = String(o.kind || o.type || '').toLowerCase();
  if (k === 'unknown' || k === 'none') return { kind: 'unknown', title: 'Couldn’t identify', message: str(o.message || o.notes, 300) || 'Try a sharper, closer photo with good light.' };
  if (k.startsWith('food') || (!k && Array.isArray(o.items))) return validateFood(o);
  if (k.startsWith('material') || k === 'object' || (!k && (o.materials || o.compounds))) return validateMaterials(o);
  throw new AIError('badjson', 'The AI answer was missing required fields. Tap Analyze to try again.', JSON.stringify(o).slice(0, 2000));
}

const SCHEMA_FOOD = `{"kind":"food","title":"short meal name","confidence":"low|medium|high","confidence_note":"why","items":[{"name":"","grams":number,"serving_grams":number,"serving_desc":"e.g. 1 cup","calories":[low,high],"protein_g":[low,high],"carbs_g":[low,high],"fat_g":[low,high],"fiber_g":[low,high],"sugar_g":[low,high],"sodium_mg":[low,high],"ingredients":["likely ingredients"],"allergens":["e.g. gluten, dairy, egg, soy, peanut, tree nut, fish, shellfish, sesame"],"confidence":"low|medium|high"}],"allergens":["union"],"notes":"short tips/caveats"}`;
const SCHEMA_MAT = `{"kind":"materials","title":"short name","object":"what it is","confidence":"low|medium|high","confidence_note":"why","materials":[{"name":"e.g. 304 stainless steel","percent":[low,high],"where":"which part"}],"compounds":[{"name":"","formula":"e.g. Fe2O3","percent":[low,high],"notes":""}],"properties":[{"name":"Density|Hardness|Melting point|Thermal conductivity|Electrical conductivity|...","value":"with units","notes":""}],"safety":["handling notes"],"recycling":["how to recycle/dispose"],"notes":""}`;
function scanPrompt(mode, hint, hasScale) {
  const rules = `Return ONLY one JSON object, no prose, no markdown. Ranges are [low, high] numbers for the portion shown. Be honest: this is a visual estimate; widen ranges and lower confidence when unsure. Portions: estimate grams from visual cues${hasScale ? ' and the second photo, which shows a reference object for scale' : ''}. Nutrition values apply to the estimated grams of each item.`;
  const h = hint ? `\nUser hint (trust it for identity/size): """${hint.slice(0, 200)}"""` : '';
  if (mode === 'food') return `You are a nutrition estimator. Identify each food/drink item in the photo.\n${rules}\nSchema: ${SCHEMA_FOOD}${h}`;
  if (mode === 'materials') return `You are a materials scientist. Identify the object, its likely materials, main chemical compounds with formulas and approximate composition %, meaningful physical properties, safety/handling and recycling notes.\n${rules}\nSchema: ${SCHEMA_MAT}${h}`;
  return `Decide whether the photo mainly shows food/drink (use the food schema) or a non-food object/material (use the materials schema). If nothing identifiable, return {"kind":"unknown","message":"why"}.\n${rules}\nFood schema: ${SCHEMA_FOOD}\nMaterials schema: ${SCHEMA_MAT}${h}`;
}
function imgPart(dataURL) { return { type: 'image_url', image_url: { url: dataURL, detail: 'high' } }; }
