// 매도대금 증여형 사해행위(실제 승소 사건의 구조를 가명·가상 지번으로 옮김) 회귀 테스트.
// 사용법: node app/deunggi/test/case_fraud.test.js
// 사례 데이터는 case_fraud.js(예시 화면과 공용).
const assert = require('assert');
const DG = require('../engine.js');
const [land, bldg, apt] = require('./case_fraud.js').map(d => DG.docFromVision(d.vision));

const base = { purpose: 'credit', baseDate: '2016-11-10' };
const items = (opt) => [['토지', land], ['건물', bldg], ['아파트', apt]].map(([name, doc]) => ({ name, doc, rep: DG.analyze(doc, opt) }));

// 1) 채무자 입력 없이도 교차 규칙이 매도대금 흐름을 잡는다
let m = DG.analyzeMulti(items(base), base);
const flow = m.findings.filter(f => f.id === 'proceeds_flow');
assert(flow.length >= 1, '매도 직후 친족 취득을 잡아야 함');
assert(flow.some(f => f.level === 'critical' && /김가상/.test(f.title) && /김다온/.test(f.title)), '하루 뒤 같은 성씨 취득은 위험 등급');
assert(flow.some(f => /만 32세/.test(f.detail)), '취득 당시 나이 신호');
assert(m.scenarios.some(s => s.id === 'multi_proceeds'), '통합 위험 순위에 매도대금 증여 시나리오');

// 2) 공유자전원지분전부이전은 전부 이전: 현재 소유자는 김다온 한 명, 이야기에도 '지분 일부'가 없어야 함
const aptRep = DG.analyze(apt, base);
assert.deepStrictEqual(aptRep.owners.map(o => o.name), ['김다온']);
assert(!aptRep.story.events.some(e => /지분 일부/.test(e.text)), '전부 이전을 지분 일부로 읽으면 안 됨');
assert(aptRep.story.events.some(e => /김다온이 .*담보로 돈을 빌렸습니다/.test(e.text)), '채무자 이름(주민번호 없음)을 읽어야 함');

// 3) 채무자를 지정하면 각 등기부에서도 처분·관련 취득을 짚는다
const opt = Object.assign({ debtors: '김가상', debtSince: '2013-05-24' }, base);
const landRep = DG.analyze(land, opt);
assert(landRep.fraud.some(c => c.signals.includes('지정한 채무자의 처분') && c.signals.some(x => /채권 발생일/.test(x))), '토지: 채무자의 채권 발생 뒤 매도');
assert(DG.analyze(apt, opt).fraud.some(c => /자금 출처/.test(c.signals.join(' '))), '아파트: 채무자와 관련 있을 수 있는 사람의 취득');
m = DG.analyzeMulti(items(opt), opt);
assert(m.findings.some(f => f.id === 'proceeds_flow' && /매도인이 지정한 채무자/.test(f.detail)));

// 4) 오래된 열람본은 채권 회수 목적에서 '참고'로만
assert(!landRep.flags.some(f => f.id === 'stale' && f.level !== 'info'));
console.log('case_fraud: ok');
