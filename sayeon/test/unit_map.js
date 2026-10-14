/* 변천 지도 단위 시험: SY.Viz.rebuttalText 문형, SY.Viz.map.model 격자 데이터.
   실행: cd $R && node test/unit_map.js   (실패하면 종료 코드 1) */
'use strict';
const assert = require('assert');
const path = require('path');
const R = path.resolve(__dirname, '..');
require(path.join(R, 'src/common.js'));
require(path.join(R, 'src/viz_map.js'));
const { gen } = require(path.join(__dirname, 'gen_synth_map.js'));
const SY = globalThis.SY;
const sample = () => JSON.parse(JSON.stringify(require(path.join(R, 'data/sample_min.json'))));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('PASS ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + '\n  ' + String(e && e.message || e).split('\n').join('\n  ')); }
}
const rt = SY.Viz.rebuttalText, model = SY.Viz.map.model;

/* sample_min + 미반복 1건(설계서 3.5 갱신: toId:null, toDocId). 파일은 고치지 않고 메모리에서만 덧붙인다. */
function sampleWithOmit() {
  const C = sample();
  C.changes.push({ id: 'C5', issueId: 'I8', scope: 'same', fromId: 'S06', toId: null, toDocId: 'D3', type: '미반복',
    basis: '답변서 제1쪽의 잔금 기한 연장 주장이 2099. 8. 8.자 준비서면에는 없음', review: false });
  return C;
}

const L_C1 = '피고는 2099. 6. 7.자 답변서 제1쪽에서 상수도 문제는 없다고 주장하였다가, 2099. 8. 8.자 준비서면 제1쪽에서는 토지는 상수도 미급수지역이고 인입경비는 약 3천만 원이 소요된다고 주장하였습니다.';
const L_C2 = '[검토 메모] 피고는 2099. 8. 8.자 준비서면 제1쪽에서 토지는 상수도 미급수지역이고 인입경비는 약 3천만 원이 소요된다고 기재하여 상대방 주장(2099. 4. 11.자 소장 제2쪽)을 인정하는 취지로 보이나, 해당 서면이 변론기일에 진술되었는지 변론조서로 확인하지 않았으므로 자백 여부는 검토가 필요함. (검토 필요)';
const L_C3 = '[검토 메모] 피고는 2099. 6. 7.자 답변서 제1쪽에서 매매계약 체결과 계약금 수령 사실을 인정한다고 기재하여 상대방 주장(2099. 4. 11.자 소장 제1쪽)을 인정하는 취지로 보이나, 해당 서면이 변론기일에 진술되었는지 변론조서로 확인하지 않았으므로 자백 여부는 검토가 필요함. (검토 필요)';
const L_C5 = '피고는 2099. 6. 7.자 답변서 제1쪽에서 잔금 기한을 2098. 10. 31.에서 2098. 12. 29.로 연장하였다고 주장하였으나, 2099. 8. 8.자 준비서면에서는 이에 관하여 아무런 언급을 하지 않고 있습니다.';
const HEAD = '반박 재료 - 가상 사건 계약금반환 (2099가단00001)';
const REVIEW = '※ 검토 필요 표시된 항목은 원문 대조 후 사용하십시오.';
const MEMO = '검토 메모 (내부 확인용입니다. 서면에 그대로 붙여 넣지 마십시오.)';

/* ---------- rebuttalText: sample_min ---------- */
t('C1 변경(same): 정해진 문형, 검토 필요 아님 → 안내 줄 없음', () => {
  assert.strictEqual(rt(sample(), ['C1']), [HEAD, '', '[쟁점] 상수도 인입(특약 제12항)', L_C1].join('\n'));
});
t('C2 자백후보(cross): [검토 메모] 블록 + 붙여 넣지 말라는 표시 + (검토 필요) + 머리 안내', () => {
  assert.strictEqual(rt(sample(), ['C2']), [HEAD, REVIEW, '', MEMO, L_C2].join('\n'));
});
t('C3 자백후보(cross): 상대방 주장 위치는 from 서면·쪽', () => {
  assert.strictEqual(rt(sample(), ['C3']), [HEAD, REVIEW, '', MEMO, L_C3].join('\n'));
});
t('C4 보충: 반박 재료 후보가 아니므로 빈 문자열', () => {
  assert.strictEqual(rt(sample(), ['C4']), '');
});
t('미반복(toId:null, toDocId:D3): to 서면을 toDocId 로 계산', () => {
  assert.strictEqual(rt(sampleWithOmit(), ['C5']), [HEAD, '', '[쟁점] 잔금 기한', L_C5].join('\n'));
});
t('여러 건: 쟁점 순서(C.issues)·서면 순으로 정렬, 자백후보는 끝의 검토 메모 블록, 중복 id 무시', () => {
  const out = rt(sampleWithOmit(), ['C4', 'C3', 'C2', 'C5', 'C1', 'C1']);
  assert.strictEqual(out, [HEAD, REVIEW, '', '[쟁점] 상수도 인입(특약 제12항)', L_C1, '', '[쟁점] 잔금 기한', L_C5, '', MEMO, L_C3, L_C2].join('\n'));
});
t('금지 표현·마크업 없음, 원문 인용(quote)은 문형에 넣지 않음', () => {
  const out = rt(sampleWithOmit(), ['C1', 'C2', 'C3', 'C5']);
  ['자백 성립', '자백이 성립', '확정', '*', '#', '<', '>', '`', '소요됩니다', '없습니다.', '인정합니다'].forEach(w => {
    assert.ok(out.indexOf(w) < 0, '포함되면 안 됨: ' + w);
  });
});
t('빈 입력: 빈 배열·없는 사건 → 빈 문자열', () => {
  assert.strictEqual(rt(sample(), []), '');
  assert.strictEqual(rt({}, []), '');
  assert.strictEqual(rt(null, null), '');
});
t('없는 판정 id → 제외 안내 줄', () => {
  const out = rt(sample(), ['C1', 'C999']);
  assert.ok(out.indexOf('※ 연결된 진술이나 서면을 찾지 못한 판정 1건은 제외하였습니다.') >= 0);
  assert.ok(out.indexOf(L_C1) >= 0);
});

/* ---------- rebuttalText: 직접 만든 소형 사건(유형별) ---------- */
function mini() {
  return {
    title: '소형', caseNo: '2099가단1',
    docs: [
      { id: 'D1', kind: '소장', side: '원고', filedDate: '2099-01-10' },
      { id: 'D2', kind: '답변서', side: '피고', filedDate: '2099-02-10' },
      { id: 'D3', kind: '준비서면', side: '피고', filedDate: '2099-03-10' },
      { id: 'D4', kind: '준비서면', side: '원고', filedDate: '2099-04-10' }
    ],
    issues: [{ id: 'I1', name: '쟁점 하나' }, { id: 'I2', name: '쟁점 둘' }],
    statements: [
      { id: 'A', docId: 'D2', page: 2, issueIds: ['I1'], side: '피고', gist: '해당 토지는 상수도 미급수지역이다', quote: 'q' },
      { id: 'B', docId: 'D3', page: 4, issueIds: ['I1'], side: '피고', gist: '해당 토지에는 상수도가 이미 연결되어 있다', quote: 'q' },
      { id: 'E', docId: 'D3', page: 1, issueIds: ['I1'], side: '피고', gist: '공사비는 피고가 부담하기로 하였다', quote: 'q' },
      { id: 'F', docId: 'D1', page: 3, issueIds: ['I2'], side: '원고', gist: '계약금은 4,000만 원이다', quote: 'q' },
      { id: 'G', docId: 'D4', page: null, issueIds: ['I2'], side: '원고', gist: '계약금은 3,000만 원이다', quote: 'q' }
    ],
    changes: [
      { id: 'X1', issueId: 'I1', scope: 'same', fromId: 'A', toId: 'B', type: '번복', basis: '', review: true },
      { id: 'X2', issueId: 'I1', scope: 'same', fromId: 'A', toId: 'B', type: '철회', basis: '', review: false },
      { id: 'X3', issueId: 'I1', scope: 'same', fromId: 'E', toId: 'B', type: '모순', basis: '', review: false },
      { id: 'X4', issueId: 'I2', scope: 'same', fromId: 'F', toId: 'G', type: '변경', basis: '', review: false },
      { id: 'X5', issueId: 'I1', scope: 'same', fromId: 'A', toId: null, type: '미반복', basis: '', review: false },
      { id: 'X6', issueId: 'I1', scope: 'same', fromId: 'A', toId: 'B', type: '유지', basis: '', review: false },
      { id: 'X7', issueId: 'I1', scope: 'same', fromId: 'A', toId: 'NOPE', type: '변경', basis: '', review: false }
    ]
  };
}
const lineOf = (C, id) => rt(C, [id]).split('\n').filter(l => /^(원고|피고)는 |^\[검토 메모\] /.test(l))[0];
t("번복 + '이다→이라고'(SY.quotative) + (검토 필요)", () => {
  assert.strictEqual(lineOf(mini(), 'X1'),
    '피고는 2099. 2. 10.자 답변서 제2쪽에서 해당 토지는 상수도 미급수지역이라고 주장하였다가, 2099. 3. 10.자 준비서면 제4쪽에서는 해당 토지에는 상수도가 이미 연결되어 있다고 주장하였습니다. (검토 필요)');
  assert.strictEqual(SY.quotative('해당 토지는 상수도 미급수지역이다'), '해당 토지는 상수도 미급수지역이라고');
});
t('철회 문형', () => {
  assert.strictEqual(lineOf(mini(), 'X2'),
    '피고는 2099. 2. 10.자 답변서 제2쪽에서 해당 토지는 상수도 미급수지역이라고 주장하였으나, 2099. 3. 10.자 준비서면 제4쪽에서 이를 철회하였습니다.');
});
t('모순 문형 ("주장하면서도"), 같은 서면이면 "같은 서면 제N쪽"', () => {
  assert.strictEqual(lineOf(mini(), 'X3'),
    '피고는 2099. 3. 10.자 준비서면 제1쪽에서 공사비는 피고가 부담하기로 하였다고 주장하면서도, 같은 서면 제4쪽에서는 해당 토지에는 상수도가 이미 연결되어 있다고 주장하였습니다.');
});
t('원고 측 변경 + 쪽수 없는 진술은 "제N쪽" 생략', () => {
  assert.strictEqual(lineOf(mini(), 'X4'),
    '원고는 2099. 1. 10.자 소장 제3쪽에서 계약금은 4,000만 원이라고 주장하였다가, 2099. 4. 10.자 준비서면에서는 계약금은 3,000만 원이라고 주장하였습니다.');
});
t('toDocId 없는 옛 미반복 → "이후 제출한 서면에서는"', () => {
  assert.strictEqual(lineOf(mini(), 'X5'),
    '피고는 2099. 2. 10.자 답변서 제2쪽에서 해당 토지는 상수도 미급수지역이라고 주장하였으나, 이후 제출한 서면에서는 이에 관하여 아무런 언급을 하지 않고 있습니다.');
});
t('유지는 제외, 뒤 진술이 없는 변경은 제외 안내', () => {
  assert.strictEqual(rt(mini(), ['X6']), '');
  assert.ok(rt(mini(), ['X7']).indexOf('찾지 못한 판정 1건') >= 0);
});

/* ---------- rebuttalText: 합성 데이터(쟁점 9 x 서면 6, 진술 80, 판정 40) ---------- */
t('합성 데이터: 개수, 인용 대조(SY.verifyQuote) 전부 통과', () => {
  const C = gen();
  assert.strictEqual(C.issues.length, 9); assert.strictEqual(C.docs.length, 6);
  assert.strictEqual(C.statements.length, 80); assert.strictEqual(C.changes.length, 40);
  const docs = SY.byId(C.docs);
  C.statements.forEach(s => {
    const pt = {}; docs[s.docId].pages.forEach(p => { pt[p.n] = p.text; });
    const v = SY.verifyQuote(s.quote, pt, s.page);
    assert.ok(v.ok && v.page === s.page, s.id + ' 인용 대조 실패');
  });
  C.changes.filter(c => c.type === '미반복').forEach(c => { assert.strictEqual(c.toId, null); assert.ok(docs[c.toDocId], c.id + ' toDocId'); });
});
t('합성 데이터: 담을 수 있는 판정 전부의 문장 모양', () => {
  const C = gen();
  const takeable = C.changes.filter(c => c.type !== '유지' && c.type !== '보충');
  const out = rt(C, takeable.map(c => c.id));
  const lines = out.split('\n');
  const body = lines.filter(l => /^(원고|피고)는 /.test(l)), memo = lines.filter(l => l.startsWith('[검토 메모] '));
  assert.strictEqual(body.length + memo.length, takeable.length, '문장 수');
  assert.strictEqual(memo.length, C.changes.filter(c => c.type === '자백후보').length);
  body.forEach(l => assert.ok(/습니다\.( \(검토 필요\))?$/.test(l), l));
  memo.forEach(l => assert.ok(/검토가 필요함\. \(검토 필요\)$/.test(l), l));
  assert.ok(out.indexOf('찾지 못한') < 0);
  assert.ok(out.indexOf(REVIEW) > 0 && out.indexOf(MEMO) > out.lastIndexOf('[쟁점]'));
  const omit = C.changes.filter(c => c.type === '미반복');
  omit.forEach(c => {
    const d = SY.byId(C.docs)[c.toDocId];
    assert.ok(out.indexOf(SY.docName(d) + '에서는 이에 관하여 아무런 언급을') >= 0, c.id + ' 미반복 to서면');
  });
  // '이다'로 끝나는 요지가 하나 이상 '이라고'로 바뀌었는지
  assert.ok(/이라고 주장하였/.test(out), "'이다→이라고' 사례 없음");
  assert.ok(!/이다고/.test(out), "'이다고' 오형 발견");
});

/* ---------- 격자 데이터 ---------- */
t('model(sample_min): 행=C.issues 순서, 미분류 없음, 열=제출일 순', () => {
  const m = model(sample());
  assert.deepStrictEqual(m.rows.map(r => r.id), ['I0', 'I2', 'I8', 'I9']);
  assert.deepStrictEqual(m.docs.map(d => d.id), ['D1', 'D2', 'D3', 'D4']);
  assert.strictEqual(m.hasUnclassified, false);
  assert.strictEqual(m.stmtCount, 8);
});
t('model(sample_min): 배지는 toId 진술 칸, 앞 진술 칸 기록, 빈 칸', () => {
  const m = model(sampleWithOmit());
  assert.deepStrictEqual(m.placement.C1, { rowId: 'I2', docId: 'D3', stmtId: 'S05', atFrom: false, loose: false });
  assert.deepStrictEqual(m.fromCell.C1, { rowId: 'I2', docId: 'D2', stmtId: 'S04' });
  assert.deepStrictEqual(m.placement.C3, { rowId: 'I0', docId: 'D2', stmtId: 'S02', atFrom: false, loose: false });
  const cell = m.rowsById.I2.cells.D3;
  assert.deepStrictEqual(cell.changes.map(c => c.id), ['C2', 'C1'], '강도 높은 판정(자백후보 3)이 변경(1)보다 먼저');
  assert.strictEqual(m.rowsById.I8.cells.D1, undefined, '진술 없는 칸');
  assert.deepStrictEqual(m.rowsById.I2.cells.D2.outs.map(c => c.id), ['C1']);
});
t('model: 미반복(toId:null, toDocId) → (issueId, toDocId) 칸의 loose 배지', () => {
  const m = model(sampleWithOmit());
  assert.deepStrictEqual(m.placement.C5, { rowId: 'I8', docId: 'D3', stmtId: null, atFrom: false, loose: true });
  const cell = m.rowsById.I8.cells.D3;
  assert.strictEqual(cell.stmts.length, 0);
  assert.deepStrictEqual(cell.loose.map(c => c.id), ['C5']);
  assert.deepStrictEqual(m.fromCell.C5, { rowId: 'I8', docId: 'D2', stmtId: 'S06' });
  assert.strictEqual(m.orphans.length, 0);
});
t('model: 미분류 행(빈 issueIds, 목록에 없는 쟁점 id)은 마지막 행', () => {
  const C = sample();
  C.statements.push({ id: 'S90', docId: 'D3', page: 1, issueIds: [], side: '피고', gist: '가', quote: '토지는 상수도' });
  C.statements.push({ id: 'S91', docId: 'D4', page: 1, issueIds: ['I77'], side: '원고', gist: '나', quote: '피고는 군청' });
  C.statements.push({ id: 'S92', docId: 'D4', page: 1, issueIds: ['I77', 'I9'], side: '원고', gist: '다', quote: '피고는 군청' });
  const m = model(C);
  assert.deepStrictEqual(m.rows.map(r => r.id), ['I0', 'I2', 'I8', 'I9', '__unc']);
  assert.strictEqual(m.rows[4].name, '미분류');
  assert.deepStrictEqual(m.rows[4].cells.D3.stmts.map(s => s.id), ['S90']);
  assert.deepStrictEqual(m.rows[4].cells.D4.stmts.map(s => s.id), ['S91']);
  assert.ok(m.rowsById.I9.cells.D4.stmts.some(s => s.id === 'S92'), '알려진 쟁점이 하나라도 있으면 그 행');
  assert.strictEqual(m.unknownIssueRefs, 2);
});
t('model: 제출일 동률은 id 자연순(D2 < D10), C.docs 배열 순서와 무관', () => {
  const C = { docs: [
    { id: 'D10', kind: '준비서면', side: '원고', filedDate: '2099-05-01' },
    { id: 'D3', kind: '준비서면', side: '피고', filedDate: '2099-05-01' },
    { id: 'D1', kind: '소장', side: '원고', filedDate: '2099-01-01' },
    { id: 'D2', kind: '준비서면', side: '피고', filedDate: '2099-05-01' }
  ], issues: [], statements: [], changes: [] };
  assert.deepStrictEqual(model(C).docs.map(d => d.id), ['D1', 'D2', 'D3', 'D10']);
  const g = model(gen());
  assert.deepStrictEqual(g.docs.map(d => d.id), ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'], '합성: 뒤섞인 배열, D5·D6 동률');
  assert.strictEqual(g.docs[4].filedDate, g.docs[5].filedDate);
});
t('model: 여러 쟁점 진술은 각 행에, 배지는 change.issueId 행에만', () => {
  const C = sample();
  C.statements.find(s => s.id === 'S05').issueIds = ['I0', 'I2'];
  const m = model(C);
  assert.ok(m.rowsById.I0.cells.D3.stmts.some(s => s.id === 'S05'));
  assert.ok(m.rowsById.I2.cells.D3.stmts.some(s => s.id === 'S05'));
  assert.strictEqual(m.placement.C1.rowId, 'I2');
  assert.strictEqual(m.rowsById.I0.cells.D3.changes.length, 0);
});
t('model: 끊긴 판정(toId 없는 진술)은 orphans, 빈 사건도 오류 없음', () => {
  const m = model(mini());
  assert.deepStrictEqual(m.orphans, ['X7']);
  assert.deepStrictEqual(m.placement.X5, { rowId: 'I1', docId: 'D2', stmtId: 'A', atFrom: true, loose: false });
  const e = model({});
  assert.strictEqual(e.rows.length, 0); assert.strictEqual(e.stmtCount, 0);
  assert.strictEqual(model(null).docs.length, 0);
});
t('model: 칸 안 진술은 쪽 순, 같은 쪽이면 id 자연순', () => {
  const C = { docs: [{ id: 'D1', kind: '소장', side: '원고', filedDate: '2099-01-01' }], issues: [{ id: 'I1', name: 'a' }],
    statements: [
      { id: 'S10', docId: 'D1', page: 2, issueIds: ['I1'], gist: 'x' }, { id: 'S9', docId: 'D1', page: 2, issueIds: ['I1'], gist: 'x' },
      { id: 'S1', docId: 'D1', page: 5, issueIds: ['I1'], gist: 'x' }, { id: 'S2', docId: 'D1', page: null, issueIds: ['I1'], gist: 'x' }
    ], changes: [] };
  assert.deepStrictEqual(model(C).rowsById.I1.cells.D1.stmts.map(s => s.id), ['S9', 'S10', 'S1', 'S2']);
});
t('model: 15 x 12 합성(진술 360, 판정 180) 구성 시간', () => {
  const C = gen({ issues: 15, docs: 12, statements: 360, changes: 180 });
  const t0 = process.hrtime.bigint();
  const m = model(C);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.strictEqual(m.docs.length, 12); assert.ok(m.rows.length >= 15);
  assert.strictEqual(m.changes.length + m.orphans.length, 180);
  console.log('     (model 15x12: ' + ms.toFixed(1) + ' ms, 배치 ' + m.changes.length + ', 끊김 ' + m.orphans.length + ')');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
