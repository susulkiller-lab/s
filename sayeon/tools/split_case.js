#!/usr/bin/env node
/* 사건 JSON 을 SY.Store 와 같은 배치(설계서 5.2)로 문서별 JSON 파일로 나눈다. 기획자가 ArtifactData 로 db 에 시딩할 때 쓴다.
 *
 * 사용법: node tools/split_case.js <case.json> <outdir>
 *   outdir/part_<partId>.json     -> collection "cases/<caseId>/parts", doc_id <partId>
 *   outdir/case_<caseId>.json     -> collection "cases", doc_id <caseId>
 *   outdir/manifest.json          -> [{collection, doc_id, file}] (묶음 먼저, 메타 마지막: 이 순서로 쓰면 반쯤 쓴 사건이 목록에 보이지 않는다)
 * 직렬화는 src/store.js 의 SY.Store.split 을 그대로 쓴다(같은 코드). 사건에 updatedAt 이 없으면 지금 시각을 넣는다.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const R = path.resolve(__dirname, '..');
require(path.join(R, 'src', 'common.js'));
require(path.join(R, 'src', 'store.js'));
const SY = globalThis.SY;

function main(argv) {
  const [inp, outdir] = argv;
  if (!inp || !outdir) {
    console.error('사용법: node tools/split_case.js <case.json> <outdir>');
    return 2;
  }
  const C = JSON.parse(fs.readFileSync(inp, 'utf8'));
  const sp = SY.Store.split(C, { now: C.updatedAt || new Date().toISOString() });
  fs.mkdirSync(outdir, { recursive: true });
  const seg = SY.Store.safeSeg(sp.caseId);
  const manifest = [];
  const put = (file, body) => {
    const s = JSON.stringify(body);
    fs.writeFileSync(path.join(outdir, file), s);
    return Buffer.byteLength(s, 'utf8');
  };
  let total = 0, maxBytes = 0;
  sp.parts.forEach((p) => {
    const file = 'part_' + p.id + '.json';
    const b = put(file, p.body);
    total += b; maxBytes = Math.max(maxBytes, b);
    manifest.push({ collection: 'cases/' + seg + '/parts', doc_id: p.id, file });
  });
  const mfile = 'case_' + seg + '.json';
  const mb = put(mfile, sp.meta);
  total += mb; maxBytes = Math.max(maxBytes, mb);
  manifest.push({ collection: 'cases', doc_id: seg, file: mfile });
  fs.writeFileSync(path.join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`사건 ${sp.caseId}: 문서 ${manifest.length}개(메타 1, 묶음 ${sp.parts.length}), 합계 ${total}바이트, 최대 ${maxBytes}바이트(한도 ${SY.Store.LIMIT})`);
  console.log('manifest: ' + path.join(outdir, 'manifest.json'));
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { console.error('실패:', e && (e.message || e.code) || e); process.exitCode = 1; }
}
module.exports = { main };
