/* Scan Lab — Voice mode: record/import, transcription with speakers, on-device speech metrics, neutral Grok analysis + fact-check. */
const VOICE_NOTE = 'Voice analysis cannot detect deception. Studies of voice-stress analysis find it performs near chance. Pitch, pace, pauses and filler words change with nerves, fatigue, accent, topic and setting, so they are shown here only as neutral speaking patterns, not judgments about anyone.';
const VERDICT_RE = /\b(lie|lies|lied|lying|liar|liars|deceptive|deceiving|deceit|deceitful|deception|truthful|untruthful|dishonest|dishonesty|fibbing|credibility score|honesty score|truth score)\b|telling the truth|not being truthful|stress (?:indicates|suggests|shows|means|reveals)/i;
const FILLERS = ['um', 'umm', 'uh', 'uhh', 'erm', 'er', 'ah', 'hmm', 'you know', 'i mean', 'basically', 'literally', 'actually', 'like,'];
const HEDGES = ['i think', 'i guess', 'i believe', 'i suppose', 'maybe', 'probably', 'perhaps', 'possibly', 'might', "i'm not sure", 'not sure', 'sort of', 'kind of', 'it seems', 'apparently', 'more or less'];
const SPK_COL = ['#6ff0c4', '#ff9a5a', '#4da3ff', '#e48cff', '#ffd166', '#ff6b8b'];
const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const neutral = s => { const t = String(s || ''); if (!VERDICT_RE.test(t)) return t; const kept = t.split(/(?<=[.!?])\s+/).filter(x => !VERDICT_RE.test(x)).join(' '); return kept || '(removed: verdict-style wording isn’t shown)'; };
const V = { rec: null, recState: null };
function voiceStopIfIdle() { /* recording keeps running across tabs on purpose; nothing to do */ }
function recMime() { if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return ''; return ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (_) { return false; } }) || ''; }
const mimeExt = m => /mp4|aac|m4a/.test(m || '') ? 'm4a' : /webm/.test(m || '') ? 'webm' : /ogg/.test(m || '') ? 'ogg' : /wav/.test(m || '') ? 'wav' : /mpeg|mp3/.test(m || '') ? 'mp3' : 'm4a';

async function voiceOpen(out, saved) {
  if (saved) return voiceReport(out, saved);
  if (V.recState) return voiceRecUI(out);
  const consent = localStorage.getItem('voiceConsent');
  const orphans = await DB.all('chunks').catch(() => []);
  out.innerHTML = `${consent ? '' : `<div class="card warn" id="vConsent"><b>Before you record</b><p class="small">Some US states (including California, Florida, Illinois, Maryland, Massachusetts, Montana, New Hampshire, Pennsylvania and Washington) and many countries require <b>everyone</b> in a conversation to agree to being recorded. Always tell people and get their OK first.</p><button class="primary" id="vOK">I’ll get everyone’s consent</button></div>`}
  ${orphans.length ? `<div class="card warn"><b>Unsaved recording found</b><p class="small">${orphans.length} chunk(s) from a recording that didn’t finish (the app may have been closed).</p><div class="row gap"><button class="primary" id="vRecover">Recover it</button><button class="pill danger" id="vDiscard">Discard</button></div></div>` : ''}
  <div class="card"><div class="res-head"><h2>🎙 Voice</h2><span class="badge">${aiHasKey() ? 'Grok + on-device' : 'on-device'}</span></div>
    <label class="field"><span>Title (optional)</span><input id="vTitle" type="text" placeholder="e.g. Supplier call"></label>
    <div class="row gap"><button class="primary big" id="vRec" ${consent ? '' : 'disabled'} style="flex:1">⏺ Record</button></div>
    <div class="row gap" style="margin-top:8px"><button class="pill" id="vImport">📂 Import audio file</button><span class="muted small">m4a, mp3, wav, webm…</span></div>
    <input type="file" id="vFile" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.aac,.mp4" hidden>
    <p class="muted small">${aiHasKey() ? 'After you stop, the audio goes to your provider for a transcript with speakers (xAI speech-to-text), then Grok writes a neutral summary.' : 'No API key: you’ll get on-device speech metrics, and you can paste a transcript. Add a key in Settings for automatic transcripts and Grok analysis.'}</p>
    <p class="small" style="color:var(--warn)">${esc(VOICE_NOTE)}</p></div>`;
  const ok = $('#vOK', out); if (ok) ok.onclick = () => { localStorage.setItem('voiceConsent', String(Date.now())); voiceOpen(out); };
  $('#vRec', out).onclick = () => voiceStart(out);
  $('#vImport', out).onclick = () => $('#vFile', out).click();
  $('#vFile', out).onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) voiceProcess(out, { blob: f, mime: f.type || 'audio/' + (f.name.split('.').pop() || 'm4a'), name: f.name, title: $('#vTitle', out).value.trim() || f.name.replace(/\.[^.]+$/, '') }); };
  const rv = $('#vRecover', out); if (rv) rv.onclick = async () => { const ch = orphans.sort((a, b) => a.i - b.i); const blob = new Blob(ch.map(c => c.buf || c.blob), { type: ch[0].mime || 'audio/mp4' }); for (const c of ch) await DB.del('chunks', c.id); voiceProcess(out, { blob, mime: blob.type, title: 'Recovered recording' }); };
  const dv = $('#vDiscard', out); if (dv) dv.onclick = async () => { for (const c of orphans) await DB.del('chunks', c.id); voiceOpen(out); };
}
async function voiceStart(out) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') return toast('Recording isn’t available here — import an audio file instead.');
  let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } }); } catch (e) { return toast('Microphone blocked: allow it in Settings → Safari → Microphone.'); }
  const mime = recMime(), id = uid(); let mr; try { mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : {}); } catch (_) { mr = new MediaRecorder(stream); }
  const st = V.recState = { id, mr, stream, mime: mr.mimeType || mime || 'audio/mp4', parts: [], i: 0, t0: Date.now(), title: ($('#vTitle', out) || {}).value || '' };
  mr.ondataavailable = ev => { if (ev.data && ev.data.size) { st.parts.push(ev.data); const i = st.i++; (st.pend = st.pend || []).push(ev.data.arrayBuffer().then(buf => DB.put('chunks', { id: id + '_' + String(i).padStart(6, '0'), rec: id, i, mime: st.mime, buf })).catch(() => {})); } };
  mr.onstop = async () => { stream.getTracks().forEach(t => t.stop()); const blob = new Blob(st.parts, { type: st.mime }); V.recState = null; try { await Promise.all(st.pend || []); const ch = await DB.all('chunks'); for (const c of ch) if (c.rec === id) await DB.del('chunks', c.id); } catch (_) {} voiceProcess(out, { blob, mime: st.mime, title: st.title || 'Recording ' + new Date(st.t0).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }); };
  mr.start(2000); // a chunk every 2 s, saved as it arrives so a crash keeps the audio
  try { const ac = new (window.AudioContext || window.webkitAudioContext)(); const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(stream).connect(an); st.ac = ac; st.an = an; } catch (_) {}
  voiceRecUI(out);
}
function voiceRecUI(out) {
  const st = V.recState; out.innerHTML = `<div class="card"><div class="res-head"><h2>⏺ Recording</h2><span class="badge conf-low" id="vT">0:00</span></div><canvas id="vLvl" width="600" height="60" style="width:100%;height:60px;background:#000;border-radius:10px"></canvas>
    <button class="primary big" id="vStop">■ Stop &amp; analyze</button><p class="muted small">Audio is saved every 2 seconds on this device while recording.</p></div>`;
  $('#vStop', out).onclick = () => { try { st.mr.requestData && st.mr.requestData(); } catch (_) {} st.mr.stop(); if (st.ac) st.ac.close(); };
  const cv = $('#vLvl', out), g = cv.getContext('2d'), buf = st.an ? new Uint8Array(st.an.fftSize) : null;
  const tick = () => { if (V.recState !== st || !cv.isConnected) return; $('#vT', out).textContent = mmss(Date.now() - st.t0); if (st.an) { st.an.getByteTimeDomainData(buf); let s = 0; for (const v of buf) s += ((v - 128) / 128) ** 2; const lv = Math.min(1, Math.sqrt(s / buf.length) * 4); g.drawImage(cv, -3, 0); g.fillStyle = '#000'; g.fillRect(cv.width - 3, 0, 3, 60); g.fillStyle = '#6ff0c4'; g.fillRect(cv.width - 3, 30 - lv * 28, 3, lv * 56 + 1); } requestAnimationFrame(tick); }; tick();
}

/* ---------- audio decoding + on-device metrics ---------- */
async function decodeAudio(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext; const ac = new Ctx(); const buf = await blob.arrayBuffer();
  const ab = await new Promise((res, rej) => { const p = ac.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); }).catch(() => { throw new Error('Couldn’t decode this audio. Try m4a, mp3 or wav.'); });
  ac.close && ac.close(); const sr = ab.sampleRate, n = ab.length, mono = new Float32Array(n); for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ab.numberOfChannels; }
  const target = 8000, step = sr / target, m = Math.floor(n / step), x = new Float32Array(m); for (let i = 0; i < m; i++) { const a = Math.floor(i * step), b = Math.max(a + 1, Math.floor((i + 1) * step)); let s = 0; for (let j = a; j < b; j++) s += mono[j]; x[i] = s / (b - a); }
  return { x, sr: target, dur: n / sr * 1000 };
}
async function acousticFrames({ x, sr }, prog) {
  const N = Math.round(sr * 0.04), hop = Math.round(sr * 0.02), minLag = Math.floor(sr / 400), maxLag = Math.ceil(sr / 70), frames = [];
  for (let s = 0, k = 0; s + N <= x.length; s += hop, k++) {
    let e = 0; for (let i = 0; i < N; i++) e += x[s + i] * x[s + i]; const rms = Math.sqrt(e / N); let f0 = 0;
    if (rms > 0.004) { let best = 0, bl = 0; const r = new Float32Array(maxLag + 2); for (let lag = minLag; lag <= maxLag + 1 && lag < N; lag++) { let num2 = 0, e1 = 0, e2 = 0; for (let i = 0; i + lag < N; i++) { const a = x[s + i], b = x[s + i + lag]; num2 += a * b; e1 += a * a; e2 += b * b; } r[lag] = num2 / (Math.sqrt(e1 * e2) || 1); }
      const peaks = []; for (let lag = minLag + 1; lag <= maxLag; lag++) if (r[lag] > r[lag - 1] && r[lag] >= r[lag + 1]) { peaks.push(lag); if (r[lag] > best) best = r[lag]; }
      bl = peaks.find(l => r[l] >= best * 0.88) || 0; best = bl ? r[bl] : 0; // first strong peak avoids octave errors
      if (best > 0.5 && bl) { const a = r[bl - 1], b = r[bl], c = r[bl + 1], d = (a - c) / (2 * (a - 2 * b + c) || 1); f0 = sr / (bl + (isFinite(d) ? d : 0)); } }
    frames.push({ t: s / sr * 1000, rms, f0 });
    if (k % 1500 === 0) { prog && prog('Measuring speech… ' + Math.round(s / x.length * 100) + '%'); await new Promise(r2 => setTimeout(r2, 0)); }
  }
  const sorted = frames.map(f => f.rms).sort((a, b) => a - b), floor = sorted[Math.floor(sorted.length * 0.1)] || 0, peak = sorted[Math.floor(sorted.length * 0.98)] || 0.1;
  const thr = Math.max(floor * 3, peak * 0.08, 0.003); frames.forEach(f => { f.speech = f.rms > thr; });
  return { frames, thr };
}
function vadSegments(frames, durMs) { const segs = []; let cur = null; for (const f of frames) { if (f.speech) { if (!cur || f.t - cur.end > 700) { cur = { t: f.t, end: f.t + 40, sp: '1', text: '' }; segs.push(cur); } else cur.end = f.t + 40; } } return segs.filter(s => s.end - s.t > 250); }
const countPhrases = (text, list) => { const t = ' ' + String(text).toLowerCase().replace(/[’]/g, "'") + ' '; const out = {}; for (const p of list) { const re = new RegExp('(?<![a-z\'])' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (p.endsWith(',') ? '' : '(?![a-z\'])'), 'g'); const n = (t.match(re) || []).length; if (n) out[p.replace(/,$/, '')] = n; } return out; };
function speakerMetrics(segs, A) {
  const by = new Map(), frames = A.frames;
  for (const s of segs) { const k = s.sp || '1'; if (!by.has(k)) by.set(k, { sp: k, talk: 0, words: 0, text: '', pauses: [], f0: [], db: [], turns: 0, interruptions: 0 }); const m = by.get(k); m.talk += Math.max(0, s.end - s.t); m.words += (s.text.match(/[\w'’-]+/g) || []).length; m.text += ' ' + s.text; m.turns++; }
  // frame-level stats + pauses inside each speaker's own turns
  let fi = 0; const sorted = segs.slice().sort((a, b) => a.t - b.t);
  for (const s of sorted) { const m = by.get(s.sp || '1'); while (fi < frames.length && frames[fi].t < s.t) fi++; let run = 0; for (let j = fi; j < frames.length && frames[j].t < s.end; j++) { const f = frames[j]; if (f.speech) { if (run >= 400) m.pauses.push(run); run = 0; if (f.f0) m.f0.push(f.f0); m.db.push(20 * Math.log10(f.rms)); } else run += 20; } }
  for (let i = 1; i < sorted.length; i++) { const a = sorted[i - 1], b = sorted[i]; if ((a.sp || '1') === (b.sp || '1')) continue; if (b.t < a.end - 300 || (b.t - a.end < 150 && a.text && !/[.?!]["”']?$/.test(a.text.trim()))) by.get(b.sp || '1').interruptions++; }
  const total = [...by.values()].reduce((a, m) => a + m.talk, 0) || 1, mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null, sd = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)) : null; };
  return [...by.values()].map(m => ({ sp: m.sp, talkMs: Math.round(m.talk), share: m.talk / total, turns: m.turns, words: m.words, wpm: m.words && m.talk > 5000 ? Math.round(m.words / (m.talk / 60000)) : null, pauses: m.pauses.length, pauseMean: m.pauses.length ? Math.round(mean(m.pauses)) : 0, pitchMean: m.f0.length > 10 ? Math.round(mean(m.f0)) : null, pitchSD: m.f0.length > 10 ? Math.round(sd(m.f0)) : null, loudness: m.db.length ? Math.round(mean(m.db) * 10) / 10 : null, fillers: countPhrases(m.text, FILLERS), hedges: countPhrases(m.text, HEDGES), interruptions: m.interruptions })).sort((a, b) => b.talkMs - a.talkMs);
}

/* ---------- transcription ---------- */
function sttConfig() { const c = aiCfg(); if (!c.key) return null; return c.provider === 'xai' || /x\.ai/.test(c.base) ? { api: 'xai', base: c.base, key: c.key, model: 'grok-voice-transcribe-2.0' } : { api: 'openai', base: c.base, key: c.key, model: 'whisper-1' }; }
async function sttRequest(cfg, blob, mime) {
  const fd = new FormData(); fd.append('model', cfg.model);
  if (cfg.api === 'xai') fd.append('diarize', 'true'); else { fd.append('response_format', 'verbose_json'); fd.append('timestamp_granularities[]', 'segment'); }
  fd.append('file', blob, 'conversation.' + mimeExt(mime)); // xAI: file must be the last field
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 300000);
  try {
    const res = await fetch(cfg.base.replace(/\/+$/, '') + (cfg.api === 'xai' ? '/stt' : '/audio/transcriptions'), { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.key }, body: fd, signal: ctl.signal });
    if (!res.ok) { const e = new Error(res.status === 401 ? 'the key was rejected (401)' : res.status === 413 ? 'the audio is too large for this provider' : res.status === 429 ? 'rate limited or out of credit (429)' : 'transcription failed (HTTP ' + res.status + ')'); e.status = res.status; throw e; }
    return await res.json();
  } catch (e) { if (e.name === 'AbortError') throw new Error('transcription timed out'); if (e instanceof TypeError) throw new Error('couldn’t reach the transcription service'); throw e; } finally { clearTimeout(to); }
}
function parseSTT(j, durMs) {
  const sp = v => { if (v == null || v === '') return null; if (typeof v === 'number') return String(v + 1); const m = String(v).match(/\d+/); return m ? String(+m[0] + 1) : String(Math.max(1, String(v).toUpperCase().charCodeAt(0) - 64)); }, out = [];
  if (Array.isArray(j.words) && j.words.length) { let cur = null; for (const w of j.words) { const s = sp(w.speaker), t = (w.start || 0) * 1000, text = String(w.text || w.word || '').trim(); if (!text) continue; const brk = !cur || s !== cur.sp || t - cur.end > 1500 || (cur.n > 45 && /[.?!]$/.test(cur.text)); if (brk) { cur = { t: Math.round(t), end: Math.round((w.end || w.start || 0) * 1000), sp: s, text, n: 1 }; out.push(cur); } else { cur.text += (/^[.,!?;:%)]/.test(text) ? '' : ' ') + text; cur.end = Math.round((w.end || w.start || 0) * 1000); cur.n++; } } out.forEach(x => delete x.n); return out; }
  if (Array.isArray(j.segments) && j.segments.length) return j.segments.map(g => ({ t: Math.round((g.start || 0) * 1000), end: Math.round((g.end || 0) * 1000), sp: sp(g.speaker), text: String(g.text || '').trim() })).filter(x => x.text);
  const sents = String(j.text || '').match(/[^.!?]+[.!?]*\s*/g) || [], total = sents.join('').length || 1; let acc = 0;
  return sents.map(x => { const t = durMs * acc / total; acc += x.length; return { t: Math.round(t), end: Math.round(durMs * acc / total), sp: null, text: x.trim() }; }).filter(x => x.text);
}
async function transcribe(blob, mime, durMs) {
  const cfg = sttConfig(); if (!cfg) return null;
  try { return { segs: parseSTT(await sttRequest(cfg, blob, mime), durMs), engine: cfg.model }; }
  catch (e) { const wk = aiCfg().whisperKey; if (cfg.api === 'xai' && wk && e.status !== 401) { const w = { api: 'openai', base: 'https://api.openai.com/v1', key: wk, model: 'whisper-1' }; return { segs: parseSTT(await sttRequest(w, blob, mime), durMs), engine: 'whisper-1 (fallback)' }; } throw e; }
}

/* ---------- Grok analysis + fact check ---------- */
const VOICE_RULES = `Rules (strict): describe what was said neutrally. NEVER judge whether anyone is lying, deceptive, truthful or honest, and never infer that from voice, pauses, pitch, stress or filler words; no credibility or honesty scores. "inconsistencies" are statements in this transcript that conflict with each other — quote both with timestamps and describe the difference neutrally (people misspeak, change their minds, or lack context). "factual_claims" are specific, checkable public facts (numbers, dates, events, prices, laws, specs), not opinions.`;
async function grokVoice(lines, title) {
  const raw = await aiChat([{ role: 'system', content: 'You analyze conversation transcripts and answer in strict JSON only. ' + VOICE_RULES }, { role: 'user', content: `Conversation: ${title}\nTranscript ([m:ss] Speaker: text):\n${lines.join('\n').slice(0, 60000)}\n\nReturn ONLY JSON: {"summary":"5-8 sentences","key_points":[""],"action_items":[{"owner":"","task":""}],"speakers":[{"speaker":"label as in transcript","claims":[{"t":"m:ss","text":"what they stated"}]}],"inconsistencies":[{"speaker":"","a":{"t":"m:ss","text":"quote"},"b":{"t":"m:ss","text":"quote"},"note":"neutral description"}],"factual_claims":[{"t":"m:ss","speaker":"","claim":""}]}` }], { timeout: 180000 });
  const j = parseJSONLoose(raw), ts = v => str(v, 8);
  return { summary: neutral(str(j.summary, 3000)), key_points: strs(j.key_points, 15).map(neutral), action_items: (Array.isArray(j.action_items) ? j.action_items : []).slice(0, 20).map(a => ({ owner: str(a.owner, 40), task: neutral(str(a.task || a, 200)) })),
    speakers: (Array.isArray(j.speakers) ? j.speakers : []).slice(0, 8).map(s => ({ speaker: str(s.speaker, 40), claims: (Array.isArray(s.claims) ? s.claims : []).slice(0, 25).map(c => ({ t: ts(c.t), text: neutral(str(c.text || c, 300)) })) })),
    inconsistencies: (Array.isArray(j.inconsistencies) ? j.inconsistencies : []).slice(0, 15).map(x => ({ speaker: str(x.speaker, 40), a: { t: ts(x.a && x.a.t), text: neutral(str(x.a && x.a.text, 300)) }, b: { t: ts(x.b && x.b.t), text: neutral(str(x.b && x.b.text, 300)) }, note: neutral(str(x.note, 300)) })),
    factual_claims: (Array.isArray(j.factual_claims) ? j.factual_claims : []).slice(0, 8).map(c => ({ t: ts(c.t), speaker: str(c.speaker, 40), claim: neutral(str(c.claim || c, 300)) })).filter(c => c.claim) };
}
const FC_STATUS = { supported: 'Supported by sources', disputed: 'Sources disagree', mixed: 'Mixed / partly supported', unverified: 'Unverified' };
async function factCheck(claims) {
  const c = aiCfg(); if (!claims.length) return [];
  const base = claims.map(x => ({ ...x, status: 'unverified', explanation: 'Not checked.', sources: [] }));
  if (!(c.provider === 'xai' || /x\.ai/.test(c.base))) return base.map(x => ({ ...x, explanation: 'Fact-checking with web search needs the xAI provider.' }));
  try {
    const r = await fetch(c.base.replace(/\/+$/, '') + '/responses', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key }, body: JSON.stringify({ model: c.model, tools: [{ type: 'web_search' }], input: [{ role: 'system', content: 'You check specific factual claims against reliable public sources using web search. Never comment on whether a person is honest. Answer with strict JSON only.' }, { role: 'user', content: `Check each claim. Return ONLY JSON {"checks":[{"i":0,"status":"supported|disputed|mixed|unverified","explanation":"1-2 neutral sentences about what sources say","sources":[{"title":"","url":"https://..."}]}]}. Use "unverified" when you can't find good sources.\n${claims.map((x, i) => `${i}. ${x.claim}`).join('\n')}` }] }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(); let text = j.output_text || ''; const cites = [];
    for (const o of j.output || []) for (const ct of o.content || []) { if (ct.text) text += ct.text; for (const a of ct.annotations || []) if (a.url) cites.push({ title: a.title || a.url, url: a.url }); }
    for (const u of j.citations || []) cites.push(typeof u === 'string' ? { title: u, url: u } : { title: u.title || u.url, url: u.url });
    const p = parseJSONLoose(text);
    return base.map((x, i) => { const k = (p.checks || []).find(c2 => +c2.i === i) || (p.checks || [])[i]; if (!k) return { ...x, explanation: 'No result for this claim.' }; const src = (Array.isArray(k.sources) ? k.sources : []).filter(s => /^https?:\/\//.test(s && s.url || '')).slice(0, 4).map(s => ({ title: str(s.title || s.url, 120), url: str(s.url, 500) })); const st = FC_STATUS[k.status] && src.length ? k.status : 'unverified'; return { ...x, status: st, explanation: neutral(str(k.explanation, 400)) || (st === 'unverified' ? 'No reliable sources found.' : ''), sources: src.length ? src : cites.slice(0, 2) }; });
  } catch (e) { return base.map(x => ({ ...x, explanation: 'Web search unavailable (' + e.message + ') — marked unverified.' })); }
}

/* ---------- pipeline ---------- */
async function voiceProcess(out, { blob, mime, title }) {
  const prog = t => { const el = $('#vProg', out); if (el) el.textContent = t; };
  out.innerHTML = `<div class="card"><span class="spinner"></span><span id="vProg">Reading audio…</span></div>`;
  const scan = { id: uid(), at: Date.now(), mode: 'voice', kind: 'voice', title: title || 'Conversation', audio: await blob.arrayBuffer(), mime, /* ArrayBuffer: stores reliably in every Safari mode */ thumb: voiceThumb(), result: { kind: 'voice', names: {}, warn: [] } };
  const r = scan.result;
  try {
    const au = await decodeAudio(blob); r.durMs = Math.round(au.dur); const A = await acousticFrames(au, prog);
    r.frames = A.frames.filter((_, i) => i % 5 === 0).map(f => [Math.round(f.t), +f.rms.toFixed(4), Math.round(f.f0)]); // light copy for the chart
    let tr = null; if (aiHasKey()) { prog('Transcribing with speakers…'); try { tr = await transcribe(blob, mime, r.durMs); } catch (e) { r.warn.push('Transcription: ' + e.message); } }
    r.segs = tr && tr.segs.length ? tr.segs : vadSegments(A.frames, r.durMs); r.engine = tr ? tr.engine : 'none (on-device speech detection only)'; r.hasText = !!(tr && tr.segs.length);
    r.metrics = speakerMetrics(r.segs, A); scan._A = A;
    if (r.hasText && aiHasKey()) { prog('Grok is summarizing…'); try { r.analysis = await grokVoice(r.segs.map(s => `[${mmss(s.t)}] Speaker ${s.sp || '1'}: ${s.text}`), scan.title); prog('Fact-checking claims…'); r.factchecks = await factCheck(r.analysis.factual_claims); } catch (e) { r.warn.push('Grok analysis: ' + e.message); } }
    delete scan._A; await DB.put('scans', scan); voiceReport(out, scan);
  } catch (e) { out.innerHTML = `<div class="card err" role="alert"><b>Couldn’t analyze that audio</b><p>${esc(e && e.message || e)}</p></div>`; }
}
function voiceThumb() { const c = document.createElement('canvas'); c.width = c.height = 120; const g = c.getContext('2d'); g.fillStyle = '#20232b'; g.fillRect(0, 0, 120, 120); g.strokeStyle = '#6ff0c4'; g.lineWidth = 6; g.lineCap = 'round'; [20, 45, 70, 30, 55, 25].forEach((h, i) => { g.beginPath(); g.moveTo(22 + i * 15, 60 - h / 2); g.lineTo(22 + i * 15, 60 + h / 2); g.stroke(); }); return c.toDataURL('image/png'); }
const spName = (r, sp) => r.names[sp || '1'] || 'Speaker ' + (sp || '1');
function voiceReport(out, scan) {
  const r = scan.result, M = r.metrics || [], an = r.analysis, fcs = r.factchecks || [];
  const save = () => DB.put('scans', scan).catch(() => {});
  const phr = o => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ×${v}`).join(', ') || '—';
  out.innerHTML = `<div class="card"><div class="res-head"><h2>🎙 ${esc(scan.title)}</h2><span class="badge">${mmss(r.durMs)}</span></div>
    <p class="muted small">Transcript: ${esc(r.engine)}${r.warn.length ? ' · ' + r.warn.map(esc).join(' · ') : ''}</p>
    ${scan.audio ? `<audio controls src="${URL.createObjectURL(new Blob([scan.audio], { type: scan.mime || 'audio/mp4' }))}" style="width:100%"></audio>` : ''}
    <h3>Speakers</h3><div class="ctl">${M.map((m, i) => `<label><span style="color:${SPK_COL[i % 6]}">● ${Math.round(m.share * 100)}% talk time</span><input data-spk="${m.sp}" value="${esc(spName(r, m.sp))}" aria-label="Name for speaker ${m.sp}"></label>`).join('')}</div>
    <canvas id="vChart" width="900" height="260" style="width:100%;height:auto;background:#0b0c10;border-radius:10px;margin-top:10px"></canvas>
    <p class="muted small">Top: who is talking. Line: pitch (Hz) over time, coloured by speaker; faint: loudness.</p></div>
  <div class="card"><h3 style="margin-top:0">Speaking patterns</h3><div style="overflow-x:auto"><table><tr><th></th>${M.map(m => `<th>${esc(spName(r, m.sp))}</th>`).join('')}</tr>
    ${[['Talk time', m => mmss(m.talkMs) + ' (' + Math.round(m.share * 100) + '%)'], ['Turns', m => m.turns], ['Words / min', m => m.wpm ?? '—'], ['Pauses ≥0.4 s', m => m.pauses + (m.pauses ? ' · avg ' + (m.pauseMean / 1000).toFixed(1) + ' s' : '')], ['Pitch', m => m.pitchMean ? m.pitchMean + ' Hz ± ' + m.pitchSD : '—'], ['Loudness', m => m.loudness != null ? m.loudness + ' dBFS' : '—'], ['Filler words', m => phr(m.fillers)], ['Hedging phrases', m => phr(m.hedges)], ['Cut-ins / interruptions', m => m.interruptions]].map(([l, f]) => `<tr><td class="muted">${l}</td>${M.map(m => `<td>${f(m)}</td>`).join('')}</tr>`).join('')}</table></div>
    <p class="small" style="color:var(--warn)">${esc(VOICE_NOTE)}</p></div>
  ${an ? `<div class="card"><h3 style="margin-top:0">Summary</h3><p>${esc(an.summary)}</p>${an.key_points.length ? `<ul class="tight">${an.key_points.map(k => `<li>${esc(k)}</li>`).join('')}</ul>` : ''}${an.action_items.length ? `<h3>Action items</h3><ul class="tight">${an.action_items.map(a => `<li>${a.owner ? '<b>' + esc(a.owner) + ':</b> ' : ''}${esc(a.task)}</li>`).join('')}</ul>` : ''}</div>
  <div class="card"><h3 style="margin-top:0">Claims by speaker</h3>${an.speakers.map(s => `<h3>${esc(r.names[(s.speaker.match(/\d+/) || [])[0]] || s.speaker)}</h3><ul class="tight small">${s.claims.map(c => `<li><span class="muted">[${esc(c.t)}]</span> ${esc(c.text)}</li>`).join('')}</ul>`).join('') || '<p class="muted">None listed.</p>'}</div>
  <div class="card"><h3 style="margin-top:0">Statements that don’t line up</h3>${an.inconsistencies.length ? an.inconsistencies.map(x => `<div class="item"><b>${esc(x.speaker)}</b><p class="small">[${esc(x.a.t)}] “${esc(x.a.text)}”<br>[${esc(x.b.t)}] “${esc(x.b.text)}”</p><p class="small muted">${esc(x.note)}</p></div>`).join('') : '<p class="muted">None found.</p>'}<p class="muted small">Differences can come from misspeaking, changed plans or missing context.</p></div>
  <div class="card"><h3 style="margin-top:0">Fact-check</h3>${fcs.length ? fcs.map(f => `<div class="item"><div class="item-head"><span>[${esc(f.t)}] ${esc(f.claim)}</span><span class="badge ${f.status === 'supported' ? 'conf-high' : f.status === 'unverified' ? '' : 'conf-medium'}">${FC_STATUS[f.status]}</span></div><p class="small muted">${esc(f.explanation)}</p>${f.sources.length ? `<ul class="tight small">${f.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">${esc(s.title)}</a></li>`).join('')}</ul>` : ''}</div>`).join('') : '<p class="muted">No specific factual claims to check.</p>'}</div>` : `<div class="card"><p class="muted small">${aiHasKey() ? 'Grok analysis needs a transcript.' : 'Add an API key in Settings for a transcript, summary, claims and fact-check.'} You can paste a transcript below (one line per turn, e.g. “Alice: …”).</p><textarea class="doc-text" id="vPaste" placeholder="Alice: We shipped 40 units on Monday.&#10;Bob: I thought it was 30?"></textarea><button class="pill" id="vUsePaste">Use this transcript</button></div>`}
  <div class="card"><h3 style="margin-top:0">Transcript</h3>${r.hasText ? r.segs.map(s => `<p class="small"><span class="muted">[${mmss(s.t)}]</span> <b>${esc(spName(r, s.sp))}:</b> ${esc(s.text)}</p>`).join('') : '<p class="muted small">No transcript yet — speech regions were detected on-device.</p>'}
    </div>${actBar({ auto: true, exports: [['vPDF', '⤓ PDF report'], ['vTXT', '⤓ Text report (TXT)'], ['vCopy', '⧉ Copy transcript']] })}`;
  drawVoiceChart($('#vChart', out), r);
  $$('[data-spk]', out).forEach(i => i.onchange = () => { r.names[i.dataset.spk] = i.value.trim().slice(0, 40); save(); voiceReport(out, scan); });
  const nm = ext => (scan.title || 'conversation').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) + '.' + ext;
  $('#vTXT', out).onclick = () => shareOrDownload(nm('txt'), voiceTXT(scan), 'text/plain');
  $('#vPDF', out).onclick = () => shareOrDownload(nm('pdf'), voicePDF(scan).blob(), 'application/pdf');
  $('#vCopy', out).onclick = () => navigator.clipboard.writeText(r.segs.filter(s => s.text).map(s => `[${mmss(s.t)}] ${spName(r, s.sp)}: ${s.text}`).join('\n')).then(() => toast('Copied'), () => toast('Copy failed'));
  const up = $('#vUsePaste', out); if (up) up.onclick = async () => {
    const lines = $('#vPaste', out).value.split(/\n+/).map(l => l.trim()).filter(Boolean); if (!lines.length) return; const names = {}, ids = {}; let k = 0;
    r.segs = lines.map((l, i) => { const m = l.match(/^([^:]{1,30}):\s*(.+)$/); const who = m ? m[1].trim() : 'Speaker 1'; if (!ids[who]) { ids[who] = String(++k); names[ids[who]] = who; } return { t: Math.round(r.durMs * i / lines.length), end: Math.round(r.durMs * (i + 1) / lines.length), sp: ids[who], text: m ? m[2] : l }; });
    r.names = names; r.hasText = true; r.engine = 'pasted (timings approximate)';
    r.metrics = speakerMetrics(r.segs, { frames: (r.frames || []).map(f => ({ t: f[0], rms: f[1], f0: f[2], speech: f[1] > 0.01 })) });
    if (aiHasKey()) { try { r.analysis = await grokVoice(r.segs.map(s => `[${mmss(s.t)}] ${spName(r, s.sp)}: ${s.text}`), scan.title); r.factchecks = await factCheck(r.analysis.factual_claims); } catch (e) { r.warn.push('Grok analysis: ' + e.message); } }
    await save(); voiceReport(out, scan);
  };
  window.__voice = scan;
}
function drawVoiceChart(cv, r) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, dur = r.durMs || 1, X = t => 40 + (W - 50) * t / dur, spIdx = {}; (r.metrics || []).forEach((m, i) => spIdx[m.sp] = i);
  g.fillStyle = '#0b0c10'; g.fillRect(0, 0, W, H); g.font = '12px -apple-system,system-ui'; g.fillStyle = '#9aa1ad';
  for (const s of r.segs || []) { const i = spIdx[s.sp || '1'] ?? 0; g.fillStyle = SPK_COL[i % 6]; g.fillRect(X(s.t), 8 + i * 9, Math.max(1, X(s.end) - X(s.t)), 7); }
  const top = 20 + Object.keys(spIdx).length * 9, y = hz => H - 22 - (Math.min(400, Math.max(60, hz)) - 60) / 340 * (H - top - 30);
  g.strokeStyle = '#2c3039'; g.fillStyle = '#9aa1ad'; for (const hz of [100, 200, 300]) { g.beginPath(); g.moveTo(40, y(hz)); g.lineTo(W - 10, y(hz)); g.stroke(); g.fillText(hz + '', 6, y(hz) + 4); }
  const fr = r.frames || [], segAt = t => (r.segs || []).find(s => t >= s.t && t <= s.end);
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.beginPath(); fr.forEach((f, i) => { const yy = H - 22 - Math.min(1, f[1] * 8) * 40; i ? g.lineTo(X(f[0]), yy) : g.moveTo(X(f[0]), yy); }); g.stroke();
  for (const f of fr) { if (!f[2]) continue; const s = segAt(f[0]); g.fillStyle = SPK_COL[(spIdx[(s && s.sp) || '1'] ?? 0) % 6]; g.fillRect(X(f[0]) - 1, y(f[2]) - 1, 2.5, 2.5); }
  g.fillStyle = '#9aa1ad'; for (let k = 0; k <= 4; k++) g.fillText(mmss(dur * k / 4), X(dur * k / 4) - 12, H - 6);
}
function voiceLines(scan) {
  const r = scan.result, M = r.metrics || [], an = r.analysis, L = [];
  L.push(scan.title, `Recorded/imported: ${new Date(scan.at).toLocaleString()} · length ${mmss(r.durMs)} · transcript: ${r.engine}`, '');
  L.push('SPEAKING PATTERNS (neutral observations)'); for (const m of M) L.push(`${spName(r, m.sp)}: talk ${mmss(m.talkMs)} (${Math.round(m.share * 100)}%), ${m.turns} turns, ${m.wpm ?? '—'} words/min, ${m.pauses} pauses${m.pauses ? ' (avg ' + (m.pauseMean / 1000).toFixed(1) + ' s)' : ''}, pitch ${m.pitchMean ? m.pitchMean + ' Hz ± ' + m.pitchSD : '—'}, loudness ${m.loudness ?? '—'} dBFS, fillers: ${Object.entries(m.fillers).map(([k, v]) => k + '×' + v).join(', ') || 'none'}, hedges: ${Object.entries(m.hedges).map(([k, v]) => k + '×' + v).join(', ') || 'none'}, cut-ins: ${m.interruptions}`);
  L.push('', VOICE_NOTE, '');
  if (an) { L.push('SUMMARY', an.summary, ...an.key_points.map(k => '• ' + k), ''); if (an.action_items.length) L.push('ACTION ITEMS', ...an.action_items.map(a => '• ' + (a.owner ? a.owner + ': ' : '') + a.task), ''); L.push('CLAIMS BY SPEAKER'); an.speakers.forEach(s => { L.push(s.speaker); s.claims.forEach(c => L.push(`  [${c.t}] ${c.text}`)); }); L.push('', 'STATEMENTS THAT DON’T LINE UP'); an.inconsistencies.forEach(x => L.push(`${x.speaker}: [${x.a.t}] "${x.a.text}" vs [${x.b.t}] "${x.b.text}" — ${x.note}`)); if (!an.inconsistencies.length) L.push('None found.'); L.push('', 'FACT-CHECK'); (r.factchecks || []).forEach(f => { L.push(`[${f.t}] ${f.claim} — ${FC_STATUS[f.status]}. ${f.explanation}`); f.sources.forEach(s => L.push('   ' + s.title + ' ' + s.url)); }); L.push(''); }
  L.push('TRANSCRIPT'); if (r.hasText) r.segs.forEach(s => L.push(`[${mmss(s.t)}] ${spName(r, s.sp)}: ${s.text}`)); else L.push('(none)');
  return L;
}
const voiceTXT = scan => voiceLines(scan).join('\n');
function voicePDF(scan) {
  const doc = new PDFDoc(), M = 40; let p = doc.page(), y = M; const r = scan.result;
  p.text(M, y, 16, scan.title, true); y += 24;
  // chart
  const cw = 530, ch = 90, dur = r.durMs || 1, ids = (r.metrics || []).map(m => m.sp); p.stroke(200, 200, 200).lw(0.5).rect(M, 792 - y - ch, cw, ch);
  (r.segs || []).forEach(s => { const i = Math.max(0, ids.indexOf(s.sp || '1')), c = SPK_COL[i % 6]; p.fill(parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)).rect(M + cw * s.t / dur, 792 - y - 8 - i * 7, Math.max(0.5, cw * (s.end - s.t) / dur), 5, 'f'); });
  p.fill(60, 60, 60); (r.frames || []).forEach(f => { if (f[2]) p.rect(M + cw * f[0] / dur, 792 - y - ch + 4 + (Math.min(400, f[2]) - 60) / 340 * (ch - 30), 1, 1, 'f'); });
  y += ch + 14;
  for (const line of voiceLines(scan).slice(1)) { if (y > 750) { p = doc.page(); y = M; } const bold = /^[A-Z][A-Z \-’']{5,}$/.test(line); y = p.para(M, y, 530, bold ? 10.5 : 9, line || ' ', bold, line === VOICE_NOTE ? [150, 80, 0] : [0, 0, 0]); }
  return doc;
}
