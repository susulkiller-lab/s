/* 업무사례 재가공기 기계 검사(지시서 6장). Claude 호출 없음. 브라우저는 window.Checks, node는 require. */
(function (root) {
'use strict';

/* ───── 기본 규칙(설정에서 덮어씀) ───── */
const DEFAULT_AD = [
  '위반: 승소율|성공률|석방률|무혐의율|인용률|\\d+\\s?%\\s?(승소|성공|석방|무죄|감형)',
  '위반: 100\\s?%\\s?(승소|성공|무죄|석방|해결|보장)',
  '위반: (결과|승소|무죄|석방|성공|감형|해결)[^.\\n]{0,8}보장|보장(해\\s?드|합니다|해드립)',
  '위반: 무조건|반드시\\s?(승소|무죄|석방|해결|이길|이깁)',
  '위반: 최고의|최고\\s?(변호사|로펌|수준|실력)|(국내|업계|지역|경남|창원)\\s?최초|유일한\\s?(변호사|로펌|사무소|법인)|1위|넘버\\s?원|압도적|독보적',
  '위반: (같은|비슷한)\\s?결과를\\s?(얻|받|기대)',
  '위반: 무료\\s?(법률\\s?)?상담|상담\\s?무료|최저가',
  '위반: 전관',
  '위반: 강정한',
  '주의: (검사|판사|부장판사|경찰|검찰)\\s?출신',
  '주의: 전문\\s?(변호사|로펌|법인|사무소|센터)|전담\\s?(변호사|팀|센터)',
  '주의: 확실(히|하게)|(다른|타)\\s?(변호사|사무소|로펌|법인)'
].join('\n');

const DEFAULT_STYLE = [
  '상투: 심층적으로|다각적으로|포괄적으로|체계적으로|면밀히|아울러|더불어|나아가|매우 중요합니다|절대적으로|전문가들은|많은 이들이|안녕하세요|알아보겠습니다|살펴보겠습니다|도움이 되셨으면',
  '비유: 갈래|세 축|두 축|(?<![가-힣])축으로|층위|같은 결(?=[이을로에은의\\s,.]|$)|(?<![가-힣])결이 (같|다르)|지형|그림을 그리|문을 열|통로|경로를 (두|남기|열어)|장치를 마련|분절|반대 방향|방향을 가리키|흩어지|새어나가|무너지|빠져나가|어긋나|보여준다|보여주는|앞세운|앞세워|달라지기 시작|곁을 지킬|(이|가) 선다',
  '문형: (이|가) 아니라[^.!?]{0,40}(입니다|이다|였습니다)',
  '문형: (하는|한|된|인) 것은[^.!?]{0,40}(입니다|이다)'
].join('\n');

const DEFAULT_BANNED = [
  'AI 상투어: 심층적으로, 다각적으로, 포괄적으로, 체계적으로, 면밀히, 아울러, 더불어, 나아가, 매우 중요합니다, 절대적으로, 전문가들은, 많은 이들이, 안녕하세요, 알아보겠습니다, 살펴보겠습니다, 도움이 되셨으면',
  '비유·번역투: 갈래, 세 축, 두 축, 축으로, 층위, 같은 결, 결이 같다·다르다, 지형, 그림을 그리다, 문을 열다, 통로, 경로를 두다·남기다·열다, 장치를 마련하다, 분절, 반대 방향, 방향을 가리키다, 흩어지다, 새어나가다, 무너지다, 빠져나가다, 어긋나다, 보여준다, 보여주는, 앞세운·앞세워, 달라지기 시작하다, 곁을 지키다, ~이/가 선다',
  '문형: "~이/가 아니라 ~입니다" 대비 문형, "~하는 것은 ~입니다" 분열문, 문장 첫머리의 \'또한\'·\'게다가\', 따옴표 직접 인용',
  '광고: 승소율·성공률·석방률 등 비율, 결과 보장·예측, 무조건·반드시 승소, 최고·최초·유일·1위·압도적·독보적, 같은 결과를 기대하게 하는 문장, 무료 상담·최저가, 전관, 검사·판사·경찰 출신 표시, 전문·전담 표방, 다른 사무소와의 비교'
].join('\n');

const DEFAULT_TH = { run20: 0, sentPct: 60, totalPct: 30, dice: 0.8, listMax: 25, pageMax: 45, leadMax: 180, leadFirstMax: 120, bodyMin: 700, bodyMax: 1800 };

const TERMS_A = ['불송치','혐의없음','죄가안됨','공소권없음','불기소','기소유예','기소중지','약식명령','구약식','구공판','구속영장 기각','영장 기각','구속적부심','보석','집행유예','선고유예','무죄','공소기각','면소','항소기각','상고기각','파기환송','파기자판','보호처분','감호위탁','사회봉사','수강명령','보호관찰','전부 인용','일부 인용','청구 기각','각하','화해권고결정','강제조정','조정 성립','이행권고결정','지급명령','위자료','재산분할','친권','양육권','면접교섭','처분 취소','무효확인','집행정지','재결','산재 승인','불승인'];
const TERMS_B = ['확정','전부','전액','인용','기각','취소','조정','승인','승소','패소','감형','벌금','징역','금고'];
const termRe = list => new RegExp(list.slice().sort((a, b) => b.length - a.length)
  .map(t => [...t.replace(/\s/g, '')].join('\\s?')).join('|') + (list === TERMS_A ? '|\\d\\s?호\\s?조치' : ''), 'g');
const RE_A = termRe(TERMS_A), RE_B = termRe(TERMS_B);
const NUM_RE = /(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(%|퍼센트|억\s*원|천만\s*원|백만\s*원|만\s*원|원|년|개월|월|일|시간|분|회|명|건|차|호|세|살)?/g;
const CRIME_RE = /[가-힣ㆍ·]{2,30}(?:법|법률)\s?위반(?:\([^)]{1,30}\))?|[가-힣]{1,8}죄/g;
const ENDING_RE = /하였습니다|되었습니다|있었습니다|받았습니다|했습니다|였습니다|습니다|의뢰인[은이의을]/g;
const VAGUE_NUM = /(?<![가-힣])수\s?(?:십|백|천|만|억)|몇\s?(?:차례|번|명|건|개월|년|회)/g;
const SENSITIVE = /성범죄|성폭력|성추행|강제추행|강간|추행|카메라등이용촬영|불법촬영|통신매체이용음란|성매매|성착취|아동|청소년|아청|학대|소년보호|소년부|보호사건|학교폭력|학폭/;

/* ───── 정규화 ───── */
const norm = s => String(s ?? '').normalize('NFC').replace(/[​-‍⁠﻿]/g, '')
  .replace(/[  -   　]/g, ' ').replace(/[ \t]+/g, ' ');
const nospace = s => norm(s).replace(/\s+/g, '');

const NATIVE = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };
const DIG = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 륙: 6, 칠: 7, 팔: 8, 구: 9 };
const SMALL = { 십: 10, 백: 100, 천: 1000 };
function sino(s) {
  let total = 0, sect = 0, n = 0;
  for (const ch of s) {
    if (DIG[ch]) n = DIG[ch];
    else if (SMALL[ch]) { sect += (n || 1) * SMALL[ch]; n = 0; }
    else if (ch === '만' || ch === '억') { total += ((sect + n) || 1) * (ch === '만' ? 1e4 : 1e8); sect = 0; n = 0; }
    else return null;
  }
  return total + sect + n;
}
// 한글 수사를 숫자로(천오백만 원 → 15000000 원, 두 차례 → 2차례)
function toArabic(s) {
  return norm(s)
    .replace(/(?<![가-힣])(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s?(차례|번|명|건|회|개월|달|곳|가지|살)/g,
      (m, n, u) => NATIVE[n] + (u === '달' ? '개월' : u))
    .replace(/(?<![가-힣])([일이삼사오육륙칠팔구십백천만억]{2,})(?=\s*(?:원|명|건|회|년|개월|일|세|차례|퍼센트))/g,
      m => { if (!/[십백천만억]/.test(m)) return m; const v = sino(m); return v == null ? m : String(v); });
}
// 비교용: 공백·문장부호 제거, 숫자 쉼표 제거, 만 원=만원, 개월=월
const cmp = s => toArabic(s).replace(/(\d),(?=\d{3})/g, '$1').replace(/개월/g, '월').replace(/[\s\p{P}\p{S}]/gu, '');

function numTokens(s) {
  const out = [];
  for (const m of toArabic(s).matchAll(NUM_RE)) {
    let v = parseFloat(m[1].replace(/,/g, '') + (m[2] || '')), u = (m[3] || '').replace(/\s/g, '');
    const mult = { 억원: 1e8, 천만원: 1e7, 백만원: 1e6, 만원: 1e4 }[u];
    if (mult) { v *= mult; u = '원'; }
    u = { 퍼센트: '%', 개월: '월', 살: '세' }[u] || u;
    out.push({ raw: m[0].trim(), value: Math.round(v * 1000) / 1000, unit: u });
  }
  return out;
}
function bigrams(s) { const t = nospace(s), b = new Set(); for (let i = 0; i + 2 <= t.length; i++) b.add(t.slice(i, i + 2)); return b; }
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b); if (!A.size || !B.size) return 0;
  let n = 0; for (const x of A) if (B.has(x)) n++; return 2 * n / (A.size + B.size);
}
function parseRules(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*([^:]{1,4}):\s?(.+)$/); if (!m) continue;
    try { out.push({ tag: m[1].trim(), re: new RegExp(m[2], 'g'), src: m[2] }); } catch (e) { out.push({ tag: m[1].trim(), error: e.message, src: m[2] }); }
  }
  return out;
}
const isSensitive = s => SENSITIVE.test(norm(s));

/* ───── 원고 JSON 평탄화: 위치 표지별 항목 ───── */
const TABLE_KEYS = ['분야', '사건유형', '의뢰인지위', '진행단계', '결과', '핵심쟁점', '담당변호사', '관할', '결과시점'];
function items(d) {
  const out = [], push = (loc, kind, o) => { const text = norm(o?.text ?? o?.value ?? '').trim(); if (o && text) out.push({ loc, kind, text, fact_ids: o.fact_ids || [] }); };
  if (!d) return out;
  push('title.list', 'title', d.list_title); push('title.sub', 'title', d.subtitle);
  (d.lead || []).forEach((o, i) => push('lead.' + (i + 1), 'lead', o));
  for (const k of TABLE_KEYS) { const o = d.summary_table?.[k]; if (o && o.value != null && o.value !== '') push('table.' + k, 'table', o); }
  (d.sections || []).forEach((s, si) => {
    const n = si + 1; push(`s${n}.h`, 'heading', s.heading);
    (s.paragraphs || []).forEach((p, pi) => (p || []).forEach((o, k) => push(`s${n}.p${pi + 1}.${k + 1}`, 'body', o)));
  });
  (d.points || []).forEach((o, i) => push('points.' + (i + 1), 'point', o));
  (d.final_points || []).forEach((o, i) => push('final.' + (i + 1), 'point', o));
  return out;
}
const stripNo = t => t.replace(/^\s*\d+\s*[.)]\s*/, '');
const pageTitle = d => [d?.list_title?.text, d?.subtitle?.text].filter(Boolean).join(' | ');
const bodyText = d => [(d?.lead || []).map(o => o.text).join(' '),
  ...(d?.sections || []).flatMap(s => [s.heading?.text || '', ...(s.paragraphs || []).map(p => (p || []).map(o => o.text).join(' '))])].join('\n');

/* ───── 6-1 / C1 근거 구절 ───── */
function c1(facts, source, record) {
  const S = cmp(source), lines = String(record || '').split('\n').map(l => l.trim()).filter(Boolean);
  const ok = [], bad = [];
  for (const f of facts || []) {
    let pass = false, why = '';
    if (f.source === '기록') {
      const src = String(f.quote || '').replace(/^기록\s*:\s*/, '').trim();
      const best = Math.max(0, ...lines.map(l => dice(f.text, l)));
      pass = lines.length > 0 && (!src || src === '기록' || norm(record).includes(src)) && best >= 0.35;
      why = !lines.length ? '사건 기록 확인 사실이 입력되지 않았습니다' : '입력된 확인 사실 목록에서 찾지 못했습니다';
    } else {
      const q = cmp(f.quote); pass = q.length > 0 && S.includes(q); why = '근거 구절이 원고에 없습니다';
    }
    (pass ? ok : bad).push(pass ? f : { ...f, why });
  }
  const total = ok.length + bad.length;
  return { ok, bad, ratio: total ? bad.length / total : 0 };
}

/* ───── 6-5 원문 유사도 ───── */
function mask(s, office) {
  let t = toArabic(s).replace(NUM_RE, '□').replace(RE_A, '□').replace(RE_B, '□').replace(CRIME_RE, '□');
  if (office) t = t.split(office).join('□');
  return t.replace(ENDING_RE, '□').replace(/\s+/g, '');
}
function grams(t, n = 6) { const a = []; for (let i = 0; i + n <= t.length; i++) a.push(t.slice(i, i + n)); return a; }
function similarity(list, source, office, th, label = '블로그 원고') {
  const S = mask(source, office), G = new Set(grams(S)), runs = [], sent = [];
  let hit = 0, all = 0;
  for (const it of list) {
    const m = mask(it.text, office);
    for (let i = 0; i + 20 <= m.length;) {
      let len = 0; while (i + len < m.length && S.includes(m.slice(i, i + len + 1))) len++;
      if (len >= 20) { runs.push({ loc: it.loc, len, text: m.slice(i, i + len) }); i += len; } else i++;
    }
    const g = grams(m), h = g.filter(x => G.has(x)).length; hit += h; all += g.length;
    if (nospace(it.text).length >= 30 && g.length) sent.push({ loc: it.loc, pct: Math.round(100 * h / g.length) });
  }
  const total = all ? Math.round(100 * hit / all) : 0, f = [];
  if (runs.length > th.run20) runs.forEach(r => f.push({ level: '위반', loc: r.loc, msg: `${label}와 ${r.len}자가 그대로 같습니다(사무소명·처분명 등은 빼고 셈): ${r.text}` }));
  sent.filter(s => s.pct > th.sentPct).forEach(s => f.push({ level: '위반', loc: s.loc, msg: `이 문장이 ${label}와 ${s.pct}% 겹칩니다(기준 ${th.sentPct}% 이하)` }));
  if (total > th.totalPct) f.push({ level: '위반', loc: null, msg: `글 전체가 ${label}와 ${total}% 겹칩니다(기준 ${th.totalPct}% 이하)` });
  return { runs, sent, total, findings: f };
}
// 원문 대조 화면용: 문장 글자별로 원고와 겹치는 6글자 구간 표시
function overlapMask(text, source) {
  const S = nospace(source), chars = [...norm(text)], idx = [];
  chars.forEach((c, i) => { if (!/\s/.test(c)) idx.push(i); });
  const ns = idx.map(i => chars[i]).join(''), mark = new Array(chars.length).fill(false);
  for (let i = 0; i + 6 <= ns.length; i++) if (S.includes(ns.slice(i, i + 6))) for (let k = i; k < i + 6; k++) mark[idx[k]] = true;
  return chars.map((c, i) => [c, mark[i]]);
}

/* ───── 전체 검사(C2·C3) ───── */
/* ctx: draft, facts(활성), excluded(제외 id 배열), source, record, other, refs(본문 허용 조문·판례 문자열),
        extra(확인 패널 입력 등 사용자 확정 문자열), generalized([{from,to}]), disclosure{jur,time:'ym'|'y'|'none',forced},
        office, titles(게시된 사례 제목), rules{ad,style,th} */
function runAll(ctx) {
  const d = ctx.draft, th = { ...DEFAULT_TH, ...(ctx.rules?.th || {}) }, list = items(d);
  const evid = [ctx.source, ctx.record, ...(ctx.refs || []), ...(ctx.extra || []), ...(ctx.generalized || []).map(g => g.to)].join('\n');
  const E = cmp(evid), Etok = numTokens(evid), srcN = norm(ctx.source);
  const active = new Set((ctx.facts || []).map(f => f.id)), excluded = new Set(ctx.excluded || []);
  const C = {}, add = (k, level, loc, msg) => (C[k] = C[k] || []).push({ level, loc, msg });
  const textual = list.filter(it => it.kind !== 'table');

  // 6-1 근거 구절은 c1 결과를 페이지가 넣는다. 6-2 근거 연결
  for (const it of list) {
    if (it.kind === 'table' && (/^(확인 필요|미표기)$/.test(it.text) || it.loc === 'table.담당변호사')) continue;
    const ids = it.fact_ids, live = ids.filter(id => active.has(id));
    if (!ids.length) add('ground', '위반', it.loc, '근거 사실 id가 없습니다');
    else if (!live.length) add('ground', '위반', it.loc, ids.some(id => excluded.has(id)) ? `제외된 사실만 인용합니다(${ids.join(', ')})` : `존재하지 않는 사실 id입니다(${ids.join(', ')})`);
  }

  // 6-3 수치
  for (const it of list) {
    if (it.loc === 'table.담당변호사') continue;
    const t = it.kind === 'heading' ? stripNo(it.text) : it.text;
    for (const tk of numTokens(t)) {
      const ok = Etok.some(e => e.value === tk.value && (!tk.unit || e.unit === tk.unit));
      if (!ok) add('num', '위반', it.loc, `근거 범위에 없는 수치: ${tk.raw}`);
    }
    for (const m of norm(t).matchAll(VAGUE_NUM)) add('num', '주의', it.loc, `숫자로 바꾸지 못한 수량 표현(사람 확인): ${m[0]}`);
  }

  // 6-4 처분·결과 용어
  for (const it of list) {
    const t = toArabic(it.text);
    for (const m of t.matchAll(RE_A)) if (!E.includes(cmp(m[0]))) add('term', '위반', it.loc, `근거 범위에 없는 처분·결과 용어: ${m[0]}`);
    for (const m of t.replace(RE_A, x => '□'.repeat(x.length)).matchAll(RE_B)) if (!E.includes(cmp(m[0]))) add('term', '주의', it.loc, `근거 범위에 없는 문맥어: ${m[0]}`);
  }

  // 6-5 원문 유사도
  const sim = { blog: similarity(textual, ctx.source || '', ctx.office, th), other: ctx.other ? similarity(textual, ctx.other, ctx.office, th, '다른 채널 원고') : null };
  sim.blog.findings.forEach(f => add('simBlog', f.level, f.loc, f.msg));
  sim.other?.findings.forEach(f => add('simOther', f.level, f.loc, f.msg));

  // 6-6 제목 중복
  for (const [loc, t] of [['title.list', d?.list_title?.text || ''], ['title.list', pageTitle(d)]]) {
    if (!t) continue;
    for (const p of ctx.titles || []) {
      if (!p) continue;
      if (nospace(p) === nospace(t)) add('dup', '위반', loc, `게시된 사례 제목과 같습니다: ${p}`);
      else { const s = dice(t, p); if (s >= th.dice) add('dup', '주의', loc, `게시된 사례 제목과 비슷합니다(${s.toFixed(2)}): ${p}`); }
    }
  }

  // 6-7 광고 규정
  for (const r of parseRules(ctx.rules?.ad ?? DEFAULT_AD)) {
    if (r.error) { add('ad', '주의', null, `규칙 오류(${r.src}): ${r.error}`); continue; }
    for (const it of list) for (const m of it.text.matchAll(r.re)) add('ad', r.tag === '위반' ? '위반' : '주의', it.loc, `광고 규정 표현: ${m[0]}`);
  }

  // 6-8 식별 정보
  const dz = ctx.disclosure || {}, forced = !!dz.forced, refN = (ctx.refs || []).map(nospace).join('|');
  const ID = [
    ['위반', /(?:19|20)\d{2}\s?(?!년)[가-힣]{1,3}\s?\d{2,7}(?![\d년월일만원명건회개조])/g, '사건번호', m => !refN.includes(nospace(m))],
    ['위반', /0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g, '전화번호'],
    ['위반', /\d{6}[-\s]?[1-4]\d{6}/g, '주민등록번호'],
    ['주의', /\d{4}\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}\.?|\d{4}년\s*\d{1,2}월\s*\d{1,2}일|\d{1,2}월\s*\d{1,2}일/g, '날짜'],
    ['주의', /\d{1,2}시(?!간)/g, '시각'],
    [forced ? '위반' : '주의', /[가-힣A-Za-z0-9]{2,}(?:초등학교|중학교|고등학교|대학교|병원|의원|어린이집|유치원|아파트|교회)/g, '기관명'],
    ['주의', /(?<![가-힣])[가-힣]{1,8}(?:대로|로\s?\d{1,4}번길)\s?\d{1,4}(?![\d가-힣])/g, '도로명'],
    [forced ? '위반' : '주의', /\d{1,2}\s?(?:세|살)(?!\s?(?:미만|이상|이하|초과))/g, '나이'],
    ['주의', /(?<![가-힣])[가-힣]{2,3}\s?(?:씨|양|군)(?=[은는이가을를의에와도께]|\s|[,.]|$)|[가-힣](?:모|OO|○○)\s?씨/g, '실명 의심',
      m => !/^(의뢰인|피해자|상대방|고소인|피고소인|신고인)/.test(m)]
  ];
  if (!dz.jur) {
    ID.push(['위반', /[가-힣]{2,}(?:지방법원|가정법원|고등법원|지방검찰청|지청|경찰서)|(?:마산|진주|통영|밀양|거창)지원/g, '관할(미표기 설정)']);
    ID.push(['주의', /[가-힣]{2,}지원(?=[은는이가을를의에서\s,.]|$)/g, '관할 의심(미표기 설정)',
      m => !/(법률|생활|경제|재정|정부|양육|주거|의료|심리|피해|학습|취업|자금|금융|복지|행정|기술|교육|소송|법적)지원$/.test(m) && !/(마산|진주|통영|밀양|거창)지원/.test(m)]);
  }
  if (dz.time !== 'ym') ID.push(['위반', /\d{4}\s*(?:년|\.)\s*\d{1,2}\s*(?:월|\.)/g, dz.time === 'y' ? '연월(연만 표기 설정)' : '연월(시점 미표기 설정)']);
  if (dz.time === 'none') ID.push(['주의', /(?:19|20)\d{2}\s?년/g, '연도(시점 미표기 설정)']);
  if (forced) ID.push(['주의', /초등학생|중학생|고등학생|\d\s?학년|[○O]\s?학년|친부|친모|계부|계모|의붓/g, '학년·가족관계']);
  for (const it of list) for (const [lv, re, name, keep] of ID) for (const m of it.text.matchAll(re)) if (!keep || keep(m[0])) add('id', lv, it.loc, `${name}: ${m[0]}`);
  for (const g of ctx.generalized || []) if (g.from && nospace(g.from).length >= 2)
    for (const it of list) if (cmp(it.text).includes(cmp(g.from))) add('id', '위반', it.loc, `확인 패널에서 ${g.to ? '일반화하기로' : '빼기로'} 한 표현이 다시 나왔습니다(원래 표현은 저장하지 않음)`);

  // 6-9 문체
  for (const r of parseRules(ctx.rules?.style ?? DEFAULT_STYLE)) {
    if (r.error) { add('style', '주의', null, `규칙 오류(${r.src}): ${r.error}`); continue; }
    for (const it of list) for (const m of it.text.matchAll(r.re)) {
      if (r.tag === '비유' && srcN.includes(m[0])) continue;
      add('style', '주의', it.loc, `${r.tag}: ${m[0]}`);
    }
  }
  const starts = textual.filter(it => /^(또한|게다가)/.test(it.text));
  if (starts.length >= 2) starts.forEach(it => add('style', '주의', it.loc, `문장 첫머리 '또한'·'게다가' ${starts.length}회`));
  const quotes = textual.filter(it => /“[^”]+”|"[^"]+"|‘[^’]+’|'[^']+'|「[^」]+」/.test(it.text));
  if (quotes.length >= 2) quotes.forEach(it => add('style', '주의', it.loc, `따옴표 직접 인용 ${quotes.length}회`));

  // 6-10 구조
  const lt = d?.list_title?.text || '', pt = pageTitle(d), lead = d?.lead || [], secs = d?.sections || [];
  if (lt.length > th.listMax) add('struct', '위반', 'title.list', `목록 제목 ${lt.length}자(${th.listMax}자 이하)`);
  if (pt.length > th.pageMax) add('struct', '위반', 'title.sub', `페이지 제목 ${pt.length}자(${th.pageMax}자 이하)`);
  const leadLen = lead.map(o => o.text).join(' ').length;
  if (lead.length < 2 || lead.length > 3) add('struct', '위반', 'lead.1', `요약 문단 ${lead.length}문장(2~3문장)`);
  if (leadLen > th.leadMax) add('struct', '위반', 'lead.1', `요약 문단 ${leadLen}자(${th.leadMax}자 이하)`);
  const l1 = lead[0]?.text || '', resV = d?.summary_table?.결과?.value || '';
  if (l1.length > th.leadFirstMax) add('struct', '위반', 'lead.1', `요약 첫 문장 ${l1.length}자(${th.leadFirstMax}자 이하)`);
  const hasResult = t => { RE_A.lastIndex = 0; return RE_A.test(toArabic(t)) || (resV && !/확인 필요/.test(resV) && cmp(t).includes(cmp(resV))); };
  if (l1 && !hasResult(l1)) add('struct', '위반', 'lead.1', '요약 첫 문장에 결과 처분명이 없습니다');
  if (secs.length !== 4) add('struct', '위반', null, `섹션 ${secs.length}개(정확히 4개)`);
  secs.forEach((s, i) => {
    const ps = (s.paragraphs || []).filter(p => p && p.length);
    if (!ps.length) add('struct', '위반', `s${i + 1}.h`, `${i + 1}번 섹션에 문단이 없습니다`);
    const first = ps[0]?.[0]?.text || '';
    if (/^(이|위|해당|그|이러한|이와 같은)\s/.test(norm(first))) add('struct', '위반', `s${i + 1}.p1.1`, `섹션 첫 문장이 지시어로 시작합니다: ${first.slice(0, 12)}…`);
  });
  const bl = bodyText(d).length;
  if (bl < th.bodyMin || bl > th.bodyMax) add('struct', '주의', null, `본문 ${bl}자(${th.bodyMin}~${th.bodyMax}자 기준)`);
  for (const k of TABLE_KEYS.slice(0, 7)) if (!d?.summary_table?.[k]?.value) add('struct', '위반', 'table.' + k, `요약표 '${k}' 칸이 비었습니다`);
  [...(d?.points || []).map((o, i) => ['points.' + (i + 1), o]), ...(d?.final_points || []).map((o, i) => ['final.' + (i + 1), o])]
    .forEach(([loc, o]) => { if ((o.text || '').length > 40) add('struct', '주의', loc, `항목 ${o.text.length}자(40자 이내)`); });

  // 6-11 요약표-본문 일치
  if (resV && !/확인 필요/.test(resV)) {
    const s4 = (secs[3]?.paragraphs || []).flat().map(o => o.text).join(' '), leadT = lead.map(o => o.text).join(' ');
    const keys = [...toArabic(resV).matchAll(RE_A)].map(m => m[0]).concat(numTokens(resV).map(t => t.raw));
    for (const k of keys) {
      if (!cmp(leadT).includes(cmp(k))) add('struct', '주의', 'lead.1', `요약표 결과의 '${k}'가 요약 문단에 없습니다`);
      if (!cmp(s4).includes(cmp(k))) add('struct', '주의', 's4.h', `요약표 결과의 '${k}'가 4번 섹션에 없습니다`);
    }
  }
  const typeV = d?.summary_table?.사건유형?.value || '';
  if (typeV && !/확인 필요/.test(typeV) && !cmp(bodyText(d)).includes(cmp(typeV))) add('struct', '주의', 'table.사건유형', `사건유형 '${typeV}'가 본문에 그대로 나오지 않습니다`);

  const status = k => (C[k] || []).some(f => f.level === '위반') ? '위반' : (C[k] || []).length ? '주의' : '통과';
  return { findings: C, status, sim, items: list };
}

/* ───── S4 패치 적용 ───── */
function applyPatches(draft, patches) {
  const d = JSON.parse(JSON.stringify(draft)), applied = [], skipped = [];
  for (const p of patches || []) {
    const loc = String(p.location || ''), del = p.action === 'delete', val = { text: p.text || '', fact_ids: p.fact_ids || [] };
    let m, ok = true;
    if (loc === 'title.list' || loc === 'title.sub') { const k = loc === 'title.list' ? 'list_title' : 'subtitle'; if (del) ok = false; else d[k] = val; }
    else if ((m = loc.match(/^(lead|points|final)\.(\d+)$/))) {
      const arr = d[{ lead: 'lead', points: 'points', final: 'final_points' }[m[1]]] || [], i = +m[2] - 1;
      if (!arr[i]) ok = false; else arr[i] = del ? null : val;
    } else if ((m = loc.match(/^table\.(.+)$/))) {
      if (!d.summary_table?.[m[1]]) ok = false; else d.summary_table[m[1]] = del ? { value: '확인 필요', fact_ids: [] } : { value: val.text, fact_ids: val.fact_ids };
    } else if ((m = loc.match(/^s(\d+)\.h$/))) {
      const s = d.sections?.[+m[1] - 1]; if (!s || del) ok = false; else s.heading = val;
    } else if ((m = loc.match(/^s(\d+)\.p(\d+)\.(\d+)$/))) {
      const p2 = d.sections?.[+m[1] - 1]?.paragraphs?.[+m[2] - 1];
      if (!p2 || !p2[+m[3] - 1]) ok = false; else p2[+m[3] - 1] = del ? null : val;
    } else ok = false;
    (ok ? applied : skipped).push(p);
  }
  // 삭제는 표시만 해 두었다가 마지막에 걷어 내야 뒤 위치 번호가 밀리지 않는다
  d.lead = (d.lead || []).filter(Boolean); d.points = (d.points || []).filter(Boolean); d.final_points = (d.final_points || []).filter(Boolean);
  (d.sections || []).forEach(s => { s.paragraphs = (s.paragraphs || []).map(p => (p || []).filter(Boolean)).filter(p => p.length); });
  return { draft: d, applied, skipped };
}

const api = { DEFAULT_AD, DEFAULT_STYLE, DEFAULT_BANNED, DEFAULT_TH, TERMS_A, TERMS_B, TABLE_KEYS,
  norm, nospace, cmp, toArabic, numTokens, dice, parseRules, isSensitive, items, pageTitle, bodyText, stripNo,
  c1, mask, similarity, overlapMask, runAll, applyPatches };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Checks = api;
})(typeof window !== 'undefined' ? window : globalThis);
