// 예시용 가상 등기부(test/fixtures)의 추출 결과를 samples.json으로 저장한다.
// 사용법: NODE_PATH=<pdfjs-dist@3.11.174가 설치된 node_modules> node app/deunggi/test/make_samples.js
const fs = require('fs'), path = require('path');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const DG = require('../engine.js');
const dir = path.join(__dirname, 'fixtures');
const SETS = [
  { key: 'apt', label: '예시: 위험 신호가 많은 아파트', files: [['apt_risky', '예시 아파트(가상)']] },
  { key: 'set', label: '예시: 같은 지번의 토지·건물', files: [['set_land', '예시 토지(가상)'], ['set_bldg', '예시 건물(가상)']] },
  { key: 'owner', label: '예시: 같은 날 넘어간 두 집', files: [['owner_a1', '예시 아파트 A(가상)'], ['owner_a2', '예시 빌라 B(가상)']] }
];
const r1 = v => Math.round(v * 10) / 10;
(async () => {
  const out = [];
  for (const set of SETS) {
    const docs = [];
    for (const [file, name] of set.files) {
      const ex = await DG.extractPdf(pdfjsLib, new Uint8Array(fs.readFileSync(path.join(dir, file + '.pdf'))));
      docs.push({
        name, pages: ex.pages.map(p => ({
          n: p.n, w: r1(p.w), h: r1(p.h),
          items: p.items.map(i => [i.s, r1(i.x), r1(i.y), r1(i.w), r1(i.h)]),
          segs: {
            strikes: p.segs.strikes.map(s => [r1(s.x1), r1(s.x2), r1(s.y)]),
            hl: p.segs.hl.map(s => [r1(s.x1), r1(s.x2), r1(s.y)]),
            vl: p.segs.vl.map(s => [r1(s.x), r1(s.y1), r1(s.y2)])
          }
        }))
      });
    }
    out.push({ key: set.key, label: set.label, docs });
  }
  const file = path.join(__dirname, '..', 'samples.json');
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(file, fs.statSync(file).size, 'bytes');
})();
