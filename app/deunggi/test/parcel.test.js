// 표제부 분할·지목변경·합병 이력 정리 테스트(가상 지번). 사용법: node app/deunggi/test/parcel.test.js
const assert = require('assert');
const DG = require('../engine.js');
const cols = ['표시번호', '접수', '소재지번', '지목', '면적', '등기원인및기타사항'];
const row = (...t) => ({ sub: '토지의표시', cols, cells: t.map(x => ({ text: x, lines: [{ t: x, k: 0 }], struck: 0 })) });
const h = DG.buildParcelHistory({ pyoje: [
  row('1', '1985년3월2일', '가상도 가상시 장평동 723', '전', '1200㎡', ''),
  row('2', '2010년5월1일', '가상도 가상시 장평동 723-2', '전', '600㎡', '분할로 인하여 전 600㎡를 가상도 가상시 장평동 723-5에 이기'),
  row('3', '2012년6월1일', '가상도 가상시 장평동 723-2', '대', '600㎡', '2012년5월20일 지목변경'),
  row('4', '2014년2월1일', '가상도 가상시 장평동 723-2', '대', '830㎡', '합병 가상도 가상시 장평동 723-7')
] });
assert.deepStrictEqual(h.events.map(e => e.kinds.join()), ['', '분할', '지목변경', '합병']);
assert(/표시: .*723 → .*723-2/.test(h.events[1].text) && /면적: 1200㎡ → 600㎡/.test(h.events[1].text));
assert.deepStrictEqual(h.events[1].lots, ['장평동 723-5']);
assert(/지목: 전 → 대/.test(h.events[2].text) && /면적: 600㎡ → 830㎡/.test(h.events[3].text));
assert.deepStrictEqual(h.events[3].lots, ['장평동 723-7']);
console.log('parcel: ok');
