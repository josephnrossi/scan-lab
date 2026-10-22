/* API mocks for Scan Lab tests (xAI chat completions, STT, Responses web search). */
const FOOD = { kind: 'food', title: 'Steak plate', confidence: 'medium', confidence_note: 'Portion judged from plate size', items: [
  { name: 'Ribeye steak', grams: 200, serving_grams: 100, serving_desc: '3.5 oz', calories: [480, 560], protein_g: [44, 50], carbs_g: [0, 0], fat_g: [32, 40], fiber_g: [0, 0], sugar_g: [0, 0], sodium_mg: [100, 140], ingredients: ['beef', 'salt', 'butter'], allergens: ['dairy'], confidence: 'medium' },
  { name: 'Broccoli', grams: 100, serving_grams: 90, serving_desc: '1 cup', calories: [30, 40], protein_g: [2, 3], carbs_g: [6, 7], fat_g: [0, 1], fiber_g: [2, 3], sugar_g: [1, 2], sodium_mg: [30, 40], ingredients: ['broccoli'], allergens: [], confidence: 'high' }], allergens: ['dairy'], notes: 'Weigh the steak for accuracy.' };
const MATS = { kind: 'materials', title: 'Cast-iron pan', object: 'A seasoned cast-iron skillet', confidence: 'high', confidence_note: 'Distinct shape', materials: [{ name: 'Gray cast iron', percent: [95, 98], where: 'body' }, { name: 'Polymerized oil', percent: [1, 3], where: 'seasoning' }],
  compounds: [{ name: 'Iron', formula: 'Fe', percent: [93, 96] }, { name: 'Iron(III) oxide', formula: 'Fe2O3', percent: [0, 1], notes: 'rust' }, { name: 'Graphite carbon', formula: 'C', percent: [2, 4] }],
  properties: [{ name: 'Density', value: '7.2 g/cm³' }, { name: 'Melting point', value: '1150–1200 °C' }, { name: 'Thermal conductivity', value: '≈50 W/m·K' }], safety: ['Handle hot with mitts'], recycling: ['Scrap metal recycling'], notes: '' };
const RECEIPT = { doc_type: 'receipt', title: 'Home Depot', text: 'HOME DEPOT #1234\n10/14/2026\n2x4 LUMBER 3.98\nSCREWS 7.47\nTOTAL 12.25', receipt: { merchant: 'Home Depot', date: '2026-10-14', items: [{ desc: '2x4 lumber', qty: 1, price: 3.98 }, { desc: 'Screws', qty: 1, price: 7.47 }], subtotal: 11.45, tax: 0.8, tip: null, total: 12.25, currency: 'USD', payment: 'Visa ••4242', category: 'hardware' } };
const CARD = { doc_type: 'business_card', title: 'Jane Q. Smith', text: 'Jane Q. Smith\nSales Engineer\nAcme Glass Co.', card: { name: 'Jane Q. Smith', title: 'Sales Engineer', company: 'Acme Glass Co.', phones: [{ type: 'work', number: '(555) 123-4567' }], emails: ['jane@acmeglass.com'], website: 'acmeglass.com', address: '1 Main St, Springfield' } };
const n = (x, W) => +(x / W).toFixed(4);
const MEASURE_FLAT = { reference: { found: true, p1: [n(100, 1600), n(1570, 2000)], p2: [n(956, 1600), n(1570, 2000)] }, a: { p1: [n(300, 1600), n(600, 2000)], p2: [n(1300, 1600), n(600, 2000)] }, b: { p1: [n(800, 1600), n(300, 2000)], p2: [n(800, 1600), n(900, 2000)] }, object: { name: 'Red block', shape: 'box', length_mm: 100, width_mm: 60, height_mm: 20, area_cm2: 60, volume_cm3: 120 }, confidence: 'high', notes: '' };
const V3 = (w, h) => ({ ref: { p1: [n(100, 1600), n(1420, 1600)], p2: [n(956, 1600), n(1420, 1600)] }, a: { p1: [n(300, 1600), n(300 + h / 2, 1600)], p2: [n(300 + w, 1600), n(300 + h / 2, 1600)] }, b: { p1: [n(300 + w / 2, 1600), n(300, 1600)], p2: [n(300 + w / 2, 1600), n(300 + h, 1600)] } });
const MEASURE_3D = { views: [{ view: 'front', ...V3(1000, 600) }, { view: 'side', ...V3(400, 600) }, { view: 'top', ...V3(1000, 400) }], object: { name: 'Wooden box', shape: 'box', proportions: '5:2:3', L_mm: 100, W_mm: 40, H_mm: 60 }, depth_estimated: false, confidence: 'medium', notes: '' };
const GLASS_TIPS = { simplify: ['Merge the small dark specks into the background'], tools: ['Glass cutter', 'Grozing pliers'], steps: ['Print the pattern', 'Cut big pieces first'], tips: ['Wear safety glasses'] };
const VOICE = { summary: 'Two people discussed a shipment. Speaker 2 is lying about the shipment count. They agreed to recount.', key_points: ['Shipment count discussed', 'He is being deceptive about dates.'], action_items: [{ owner: 'Speaker 1', task: 'Recount the units' }],
  speakers: [{ speaker: 'Speaker 1', claims: [{ t: '0:01', text: 'We shipped 40 units on Monday.' }] }, { speaker: 'Speaker 2', claims: [{ t: '0:05', text: 'I think it was 30 units.' }, { t: '0:06', text: 'This shows she is telling the truth.' }] }],
  inconsistencies: [{ speaker: 'Speaker 1', a: { t: '0:01', text: 'We shipped 40 units' }, b: { t: '0:09', text: 'maybe 35 went out' }, note: 'The number changed from 40 to 35. This suggests dishonesty.' }],
  factual_claims: [{ t: '0:10', speaker: 'Speaker 1', claim: 'The Port of Long Beach is the second-busiest container port in the US.' }] };
const STT = { text: '', words: [
  ...'Um we shipped 40 units on Monday you know'.split(' ').map((w, i) => ({ text: w, start: 0.1 + i * 0.17, end: 0.25 + i * 0.17, speaker: 0 })),
  ...'and I think maybe 35 went out'.split(' ').map((w, i) => ({ text: w, start: 2.3 + i * 0.25, end: 2.5 + i * 0.25, speaker: 0 })),
  ...'Uh I think it was 30 units basically and the truck left late'.split(' ').map((w, i) => ({ text: w, start: 3.8 + i * 0.33, end: 4.0 + i * 0.33, speaker: 1 })),
  ...'The Port of Long Beach is the second busiest port.'.split(' ').map((w, i) => ({ text: w, start: 8.6 + i * 0.25, end: 8.8 + i * 0.25, speaker: 0 }))] };
const FACT = { checks: [{ i: 0, status: 'supported', explanation: 'Port statistics list Long Beach second after Los Angeles. The claim is truthful.', sources: [{ title: 'Port of Long Beach — Facts', url: 'https://polb.com/port-info/port-facts-faqs/' }] }] };
const GLASS_SUBJECT = { subject: 'robin', box: [0.44, 0.32, 0.59, 0.66], features: [{ name: 'orange breast', box: [0.47, 0.4, 0.56, 0.52] }, { name: 'head', box: [0.47, 0.32, 0.55, 0.4] }] };
const RECOG_BLIND = { depicts: 'a red tulip', confidence: 'high', cues: ['cup-shaped red bloom', 'green stem'] };
const RECOG_CMP = { photo_subject: 'a red tulip', match: 'yes', explanation: 'The bloom shape, petals and stem read clearly.', add_detail: ['Keep the petal split as its own lead line'] };
const CPTS = require('./fixtures/count-points.json');
const COUNT = { kind: 'count', item: 'hex nuts', count: 11, points: CPTS.slice(0, 11), confidence: 'high', notes: 'One nut near the edge may be cut off.' };
const DEFECT = { kind: 'defect', object: 'Cast iron bracket', material: 'gray cast iron', defects: [
  { type: 'crack', name: 'Hairline crack at the mounting hole', location: 'upper left hole', photo: 1, box: [0.2, 0.2, 0.45, 0.45], severity: 'severe', confidence: 'medium', likely_causes: ['Over-torqued bolt', 'Fatigue from vibration'], corrective_actions: ['Replace the bracket', 'Do not weld cast iron without preheat'], prevention: ['Torque to spec', 'Add a washer'] },
  { type: 'corrosion', name: 'Surface rust', location: 'lower edge', photo: 1, box: [0.5, 0.6, 0.9, 0.9], severity: 'minor', confidence: 'high', likely_causes: ['Moisture'], corrective_actions: ['Wire-brush and prime'], prevention: ['Paint or oil'] }],
  overall_severity: 'moderate', safe_to_use: 'caution', safety_reason: 'Crack near a load path.', next_steps: ['Dye-penetrant test'], limits: 'Photos cannot show internal cracks.' };
const COMPARE = { kind: 'compare', summary: 'A red sign was added on the upper right wall.', same_object: 'yes', change: 'different', differences: [{ what: 'New red sign', where: 'upper right', significance: 'notable' }, { what: 'Slightly brighter exposure', where: 'whole photo', significance: 'minor' }], confidence: 'high' };
const chat = (obj) => ({ id: 'x', choices: [{ message: { role: 'assistant', content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }] });

async function installMocks(page, opts = {}) {
  const log = []; const state = { doc: 'receipt', bad: false, status: 200, ...opts };
  await page.route('https://api.x.ai/v1/**', async route => {
    const req = route.request(), url = req.url(); let body = {}; try { body = req.postDataJSON() || {}; } catch (_) {}
    const all = JSON.stringify(body.messages || body.input || ''); log.push({ url, body, size: (req.postData() || '').length });
    if (state.status !== 200) return route.fulfill({ status: state.status, contentType: 'application/json', body: JSON.stringify({ error: { message: 'mock error' } }) });
    if (url.endsWith('/stt')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STT) });
    if (url.endsWith('/responses')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(FACT), annotations: [{ type: 'url_citation', url: 'https://polb.com/', title: 'POLB' }] }] }] }) });
    let r;
    if (state.bad) r = 'Sorry, I cannot produce JSON right now.';
    else if (/Reply with JSON \{\\"ok\\":true/.test(all)) r = { ok: true, color: 'red' };
    else if (/nutrition estimator/.test(all)) r = FOOD;
    else if (/materials scientist/.test(all)) r = MATS;
    else if (/Decide whether the photo/.test(all)) r = state.auto === 'materials' ? MATS : FOOD;
    else if (/receipts, business cards/.test(all)) r = state.doc === 'card' ? CARD : RECEIPT;
    else if (/measure objects in photos/.test(all)) r = /Photos are views/.test(all) ? MEASURE_3D : MEASURE_FLAT;
    else if (/COUNT ITEMS\./.test(all)) r = COUNT;
    else if (/DEFECT CHECK\./.test(all)) r = DEFECT;
    else if (/COMPARE SCANS\./.test(all)) r = COMPARE;
    else if (/GLASS SUBJECT\./.test(all)) r = GLASS_SUBJECT;
    else if (/RECOGNIZABILITY BLIND\./.test(all)) r = RECOG_BLIND;
    else if (/RECOGNIZABILITY COMPARE\./.test(all)) r = RECOG_CMP;
    else if (/stained-glass teacher/.test(all)) r = GLASS_TIPS;
    else if (/analyze conversation transcripts/.test(all)) r = VOICE;
    else r = { error: 'unmocked' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(chat(r)) });
  });
  return { log, state };
}
module.exports = { installMocks, FOOD, MATS, VOICE };
