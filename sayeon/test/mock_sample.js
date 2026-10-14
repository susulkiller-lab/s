/* 가짜 sample 능력 (artifact-capabilities 0.2.67 sample.d.ts 형태를 따름). node 시험·프롬프트 덤프용.
 *   const mock = createMockSample({ case: C정답, issues, delayMs, limits, keepPrompts })
 *   await mock(input, options) -> { text, truncated, modelTierApplied }   (실패는 {code, message, text?} 로 거부)
 *   await mock.json(input, options) -> 값  (전체 -> 코드펜스 본문 -> 첫 {[ ~ 끝 }] 순서로 관대하게 해석, 실패·잘림은 invalid_json + text)
 *   await mock.limits() -> { maxPromptBytes, images? }
 *   mock.inject(stage, fault)  // 다음 한 번의 해당 단계 호출에 잘못된 응답을 주입
 *     fault.kind: 'fence' | 'prose' | 'garbage' | 'truncate' | 'trailingComma' | 'raw'(fault.text) | 'error'(fault.code)
 *     fault.mutate(value, prompt) -> value  // 인용 변조, 없는 쟁점 id, 잘못된 fromId 등
 *     fault.match: 이 문자열이 든 프롬프트에만 적용(예: '- 서면 id: D2')
 *   mock.state: { calls:[{stage, bytes, verb, modelTier, images}], peak, inFlight }
 * 단계는 프롬프트 첫 줄 '사건 연표 분석 작업: …' 으로 알아낸다. 정답은 opt.case(sample_min 형태)에서 인용으로 대응시켜 만든다. */
'use strict';
const MAX = 262144;
const STAGE = { '진술 추출': 'extract', '변화 판정': 'judge', '사실 구성': 'facts', '쟁점 초안': 'issues', '원문 판독': 'transcribe' };

function norm(s) {
  return String(s == null ? '' : s).normalize('NFC').replace(/[‘’‚‛′'`]/g, "'").replace(/[“”„‟″"]/g, '"')
    .replace(/[·•‧・]/g, '.').replace(/[\s ​　]+/g, '').replace(/["'`]/g, '').toLowerCase();
}
function err(code, message, text) { const e = { code, message: message || code }; if (text != null) e.text = text; return e; }
function isPlain(o) { return o !== null && typeof o === 'object' && !Array.isArray(o) && Object.getPrototypeOf(o) === Object.prototype; }
function tolerantParse(t) {
  try { return JSON.parse(t); } catch (e) { /* 다음 */ }
  const f = /```[a-zA-Z]*\s*\n?([\s\S]*?)```/.exec(t);
  if (f) { try { return JSON.parse(f[1]); } catch (e) { /* 다음 */ } }
  const a = [t.indexOf('{'), t.indexOf('[')].filter(i => i >= 0), s = a.length ? Math.min(...a) : -1;
  const e = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (s >= 0 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch (x) { /* 실패 */ } }
  return undefined;
}
function jsonLinesAfter(prompt, header) {
  const i = header ? prompt.indexOf(header) : 0; if (i < 0) return [];
  return prompt.slice(i).split('\n').filter(l => l.startsWith('{"id"')).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
}
function delay(ms, signal) {
  return new Promise((res, rej) => {
    if (!ms) { res(); return; }
    const t = setTimeout(res, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(err('cancelled')); });
  });
}

function createMockSample(opt = {}) {
  const C = opt.case || { statements: [], changes: [], facts: [] };
  const st = { calls: [], inFlight: 0, peak: 0, faults: [] };
  const limitsVal = opt.limits !== undefined ? opt.limits
    : { maxPromptBytes: MAX, images: { maxCount: 5, maxInputBytes: 20 * 1024 * 1024, mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } };

  /* 프롬프트의 진술 줄(id, quote)을 정답 사건의 진술 id 로 대응 */
  function mapIds(lines) {
    const byQuote = {}; C.statements.forEach(s => { byQuote[norm(s.quote)] = s.id; });
    const m = {}; lines.forEach(l => { const k = byQuote[norm(l.quote)]; if (k) m[k] = l.id; });
    return m;
  }
  const answers = {
    extract(prompt) {
      const doc = (/^- 서면 id: (\S+)$/m.exec(prompt) || [])[1];
      const pages = new Set([...prompt.matchAll(/^=== p\.(\d+) ===$/gm)].map(m => +m[1]));
      const list = C.statements.filter(s => s.docId === doc && pages.has(s.page))
        .map(s => ({ page: s.page, item: s.item, issueIds: s.issueIds.slice(), gist: s.gist, quote: s.quote, evidence: (s.evidence || []).slice() }));
      return { statements: list };
    },
    judge(prompt) {
      const issue = (/^- 쟁점 id: (\S+)$/m.exec(prompt) || [])[1];
      const m = mapIds(jsonLinesAfter(prompt, '\n[입력]\n'));
      const changes = C.changes.filter(c => c.issueId === issue && m[c.fromId] && (c.toId ? m[c.toId] : true))
        .map(c => { const o = { scope: c.scope, fromId: m[c.fromId], toId: c.toId ? m[c.toId] : null, type: c.type, basis: c.basis, review: c.review }; if (c.toDocId) o.toDocId = c.toDocId; return o; });
      return { changes };
    },
    facts(prompt) {
      const m = mapIds(jsonLinesAfter(prompt, '\n[입력]\n'));
      const existing = jsonLinesAfter(prompt.slice(0, Math.max(0, prompt.indexOf('\n[입력]\n'))), '[기존 사실]');
      const exByTitle = {}; existing.forEach(f => { exByTitle[f.title] = f.id; });
      const facts = C.facts.map(f => {
        const side = s => s ? Object.assign({}, s, { stmtIds: (s.stmtIds || []).map(id => m[id] || id) }) : null;
        const o = { title: f.title, date: f.date, plaintiff: side(f.plaintiff), defendant: side(f.defendant), dispute: f.dispute, issueIds: f.issueIds, note: f.note };
        if (exByTitle[f.title]) o.id = exByTitle[f.title];
        return o;
      });
      return { facts };
    },
    issues() {
      const list = (opt.issues || []).filter(i => i.id !== 'I0');
      const i0 = (opt.issues || []).find(i => i.id === 'I0');
      return { basic: { elements: i0 ? i0.elements : '' }, issues: list.map(i => ({ name: i.name, elements: i.elements })) };
    },
    transcribe(prompt) {
      const line = (/^- 이미지 순서: (.+)$/m.exec(prompt) || [])[1] || '';
      const ns = [...line.matchAll(/p\.(\d+)/g)].map(x => +x[1]);
      return { pages: ns.map(n => ({ n, text: opt.ocrText ? opt.ocrText(n) : '판독 본문 ' + n + '쪽 2099. 1. 5. 통화하였습니다.' })) };
    }
  };

  async function core(input, options, verb) {
    if (options !== undefined && !isPlain(options)) throw err('invalid_request', 'options must be a plain object');
    options = options || {};
    let text;
    if (typeof input === 'string') { if (!input.trim()) throw err('invalid_request', 'empty input'); text = input; }
    else if (Array.isArray(input)) {
      if (!input.length || input[0].role !== 'user' || input[input.length - 1].role !== 'user') throw err('invalid_request', 'turns must start and end on user');
      text = input.map(t => t.content).join('\n');
    } else throw err('invalid_request', 'input must be string or turns');
    if ('signal' in options && !(options.signal instanceof AbortSignal)) throw err('invalid_request', 'signal must be an AbortSignal');
    if ('modelTier' in options && !['default', 'complex', 'quick'].includes(options.modelTier)) throw err('invalid_request', 'unknown modelTier');
    if ('onText' in options && typeof options.onText !== 'function') throw err('invalid_request', 'onText must be a function');
    if (options.signal && options.signal.aborted) throw err('cancelled');
    let imgs = options.images;
    if (imgs != null && !Array.isArray(imgs)) imgs = [imgs];
    if (imgs) {
      if (!limitsVal || !limitsVal.images) throw err('images_unavailable');
      if (imgs.some(b => !(b instanceof Blob))) throw err('invalid_request', 'images must be Blobs');
      if (imgs.length > limitsVal.images.maxCount) throw err('image_rejected', 'too many images');
    }
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > MAX) throw err('prompt_too_large');
    const m = /^사건 연표 분석 작업: (.+)$/m.exec(text);
    const stage = m ? (STAGE[m[1].trim()] || 'unknown') : 'unknown';
    const call = { stage, bytes, verb, modelTier: options.modelTier, images: imgs ? imgs.length : 0, retry: text.includes('[형식 재요청]'), hasSignal: options.signal instanceof AbortSignal };
    if (opt.keepPrompts) call.prompt = text;
    st.calls.push(call);
    st.inFlight++; st.peak = Math.max(st.peak, st.inFlight);
    try {
      await delay(opt.delayMs || 0, options.signal);
      const fi = st.faults.findIndex(f => (f.stage === stage || f.stage === '*') && (!f.match || text.includes(f.match)));
      const f = fi >= 0 ? st.faults.splice(fi, 1)[0] : null;
      if (f && f.kind === 'error') throw err(f.code, f.message, f.text);
      let value = opt.answer ? opt.answer(stage, text) : (answers[stage] ? answers[stage](text) : {});
      if (f && f.mutate) value = f.mutate(JSON.parse(JSON.stringify(value)), text);
      let out = JSON.stringify(value), truncated = false;
      if (f) {
        if (f.kind === 'fence') out = '결과입니다.\n```json\n' + out + '\n```\n이상입니다.';
        else if (f.kind === 'prose') out = '다음과 같이 정리했습니다. ' + out + ' 참고하십시오.';
        else if (f.kind === 'garbage') out = '정리할 수 없습니다.';
        else if (f.kind === 'truncate') { out = out.slice(0, Math.floor(out.length * (f.ratio || 0.6))); truncated = true; }
        else if (f.kind === 'trailingComma') out = out.replace(/\]\}$/, ',]}');
        else if (f.kind === 'raw') out = f.text;
      }
      if (options.onText) { await Promise.resolve(); if (!(options.signal && options.signal.aborted)) options.onText({ text: out, delta: out }); }
      return { text: out, truncated, modelTierApplied: options.modelTier || 'default' };
    } finally { st.inFlight--; }
  }
  const sample = (input, options) => core(input, options, 'sample');
  sample.json = async (input, options) => {
    const r = await core(input, options, 'json');
    if (r.truncated) throw err('invalid_json', 'cut short by the length limit', r.text);
    const v = tolerantParse(r.text);
    if (v === undefined) throw err('invalid_json', 'no JSON value', r.text);
    return v;
  };
  sample.limits = async () => {
    if (opt.limitsReject) throw err('upstream_error');
    return limitsVal ? JSON.parse(JSON.stringify(limitsVal)) : { maxPromptBytes: MAX };
  };
  sample.inject = (stage, fault) => { st.faults.push(Object.assign({ stage }, fault)); return sample; };
  sample.state = st;
  return sample;
}
module.exports = { createMockSample, tolerantParse, norm };
