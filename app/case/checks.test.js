// 기계 검사 단위 시험: node app/case/checks.test.js  (시험용 짧은 문자열만 쓴다)
const assert = require('assert');
const C = require('./checks.js');

const F = (id, text) => ({ text, fact_ids: [id] });
function base() {
  return {
    list_title: F('F1', '시험용 목록 제목'), subtitle: F('F1', '시험용 부제'),
    lead: [F('F1', '시험용 요약 첫 문장 불송치'), F('F1', '시험용 요약 둘째 문장')],
    summary_table: Object.fromEntries(C.TABLE_KEYS.slice(0, 7).map(k => [k, { value: '시험용', fact_ids: ['F1'] }])),
    sections: [1, 2, 3, 4].map(n => ({ no: n, heading: F('F1', n + '. 시험용 소제목'), paragraphs: [[F('F1', '시험용 문장')]] })),
    points: [F('F1', '시험용 항목')], final_points: [F('F1', '시험용 결과 항목')]
  };
}
const ctx = (draft, more = {}) => ({ draft, facts: [{ id: 'F1' }], source: '시험용 원고 불송치', record: '', office: '진앤솔 법률사무소',
  disclosure: { jur: false, time: 'none', forced: false }, titles: [], ...more });
const run = (mut, more) => { const d = base(); mut && mut(d); return C.runAll(ctx(d, more)); };
const lv = (r, k) => (r.findings[k] || []).map(f => f.level);

// 기준: 기본 원고는 수치·처분명·광고·식별 위반 없음
{ const r = run(); for (const k of ['ground', 'num', 'term', 'ad', 'id', 'style']) assert.strictEqual(r.status(k), '통과', k + ' ' + JSON.stringify(r.findings[k])); }

// 정규화
assert.strictEqual(C.cmp('징역 2년 6개월'), C.cmp('징역 2년6월'));
assert.strictEqual(C.cmp('1,500만 원'), C.cmp('1500만원'));
assert.ok(C.toArabic('천오백만 원').startsWith('15000000'));
assert.ok(C.toArabic('두 차례').startsWith('2차례'));
assert.deepStrictEqual(C.numTokens('천오백만 원').map(t => t.value), C.numTokens('1,500만 원').map(t => t.value));

// 오류 주입 (1) 근거에 없는 금액
{ const r = run(d => { d.sections[3].paragraphs[0][0].text = '시험용 합의금 500만 원'; }); assert.ok(lv(r, 'num').includes('위반')); }
// (2) 무죄 선고 → 무죄 확정
{ const r = run(d => { d.sections[3].paragraphs[0][0].text = '시험용 무죄 확정'; }, { source: '시험용 원고 불송치 1심 무죄 선고' });
  assert.notStrictEqual(r.status('term'), '통과'); }
// (3) 원고 문장 40자 그대로
{ const s = '시험용 문장으로 담당 변호사는 현장 사진과 출입 기록을 모아 시간대별 동선표를 만들어 제출했습니다';
  const r = run(d => { d.sections[2].paragraphs[0][0].text = s; }, { source: '시험용 원고 불송치\n' + s });
  assert.strictEqual(r.status('simBlog'), '위반'); }
// (4) 승소율 95%
{ const r = run(d => { d.points[0].text = '시험용 승소율 95%'; }); assert.strictEqual(r.status('ad'), '위반'); assert.ok(lv(r, 'num').includes('위반')); }
// (5) 사건번호
{ const r = run(d => { d.sections[0].paragraphs[0][0].text = '시험용 2025고단1234 사건'; }, { source: '시험용 원고 불송치 2025고단1234' });
  assert.ok(r.findings.id.some(f => f.level === '위반' && f.msg.startsWith('사건번호'))); }
// (6) '이 사건은'으로 시작하는 섹션
{ const r = run(d => { d.sections[1].paragraphs[0][0].text = '이 사건은 시험용입니다'; }); assert.strictEqual(r.status('struct'), '위반'); }
// (7) '~가 아니라 ~입니다'
{ const r = run(d => { d.sections[1].paragraphs[0][0].text = '시험용 쟁점은 고의가 아니라 과실입니다'; }); assert.notStrictEqual(r.status('style'), '통과'); }
// (8) 관할 미표기인데 창원지방법원
{ const r = run(d => { d.sections[0].paragraphs[0][0].text = '시험용 창원지방법원 사건'; }, { source: '시험용 원고 불송치 창원지방법원' });
  assert.strictEqual(r.status('id'), '위반'); }
// (9) 강제 미표기 유형에서 피해자 나이
{ const r = run(d => { d.sections[0].paragraphs[0][0].text = '시험용 피해자는 14세였습니다'; },
    { source: '시험용 원고 불송치 14세', disclosure: { jur: false, time: 'none', forced: true } });
  assert.ok(r.findings.id.some(f => f.level === '위반' && f.msg.startsWith('나이'))); }

// 오탐 시험: 위반으로 잡히면 안 된다
for (const s of ['시험용 진술거부권 보장', '시험용 최초 진술', '시험용 유일한 증거였습니다', '시험용 3시간', '시험용 13세 미만', '시험용 항소로 1년', '시험용 전문진술']) {
  const r = run(d => { d.sections[1].paragraphs[0][0].text = s; }, { source: '시험용 원고 불송치 ' + s, disclosure: { jur: false, time: 'none', forced: true } });
  for (const k of ['ad', 'id', 'num', 'term']) assert.notStrictEqual(r.status(k), '위반', s + ' → ' + k + ' ' + JSON.stringify(r.findings[k]));
}

// 6-2 제외된 사실만 인용
{ const r = run(d => { d.points[0].fact_ids = ['F9']; }, { excluded: ['F9'] }); assert.ok(r.findings.ground[0].msg.includes('제외된')); }
// 6-6 제목 중복
{ const r = run(null, { titles: ['시험용 목록 제목'] }); assert.strictEqual(r.status('dup'), '위반'); }
// 일반화한 표현 재등장
{ const r = run(d => { d.lead[1].text = '시험용 가나초등학교'; }, { generalized: [{ from: '가나초등학교', to: '초등학교' }] }); assert.strictEqual(r.status('id'), '위반'); }
// C1 근거 구절
{ const r = C.c1([{ id: 'F1', source: '원고', quote: '시험용, 원고' }, { id: 'F2', source: '원고', quote: '없는 구절' }], '시험용 원고 불송치', '');
  assert.deepStrictEqual([r.ok.length, r.bad.length], [1, 1]); }
// 패치: 삭제 후 위치 번호 유지
{ const d = base(); d.lead.push(F('F1', '시험용 셋째'));
  const r = C.applyPatches(d, [{ location: 'lead.1', action: 'delete' }, { location: 'lead.3', action: 'replace', text: '시험용 교체', fact_ids: ['F1'] }]);
  assert.deepStrictEqual(r.draft.lead.map(o => o.text), ['시험용 요약 둘째 문장', '시험용 교체']); }

console.log('checks.test.js: 통과');
