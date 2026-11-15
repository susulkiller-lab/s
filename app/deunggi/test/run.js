// 사용법: NODE_PATH=<pdfjs-dist@3.11.174의 node_modules> node app/deunggi/test/run.js app/deunggi/test/fixtures [이름 ...]
// 가상 등기부(fixtures)의 정답(truth.json)과 판독 결과를 대조한다.
const path = require('path'), fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const DG = require('../engine.js');
const dir = process.argv[2];
const only = process.argv.slice(3);
const NS = s => String(s || '').replace(/\s+/g, '');

async function load(name) {
  const data = new Uint8Array(fs.readFileSync(path.join(dir, name + '.pdf')));
  const ex = await DG.extractPdf(pdfjsLib, data);
  const doc = DG.parseDocument(ex.pages);
  return { ex, doc };
}

(async () => {
  const names = only.length ? only : fs.readdirSync(dir).filter(f => f.endsWith('.pdf')).map(f => f.replace(/\.pdf$/, ''));
  const multi = [];
  let totalBad = 0;
  for (const name of names) {
    const truth = JSON.parse(fs.readFileSync(path.join(dir, name + '.truth.json'), 'utf8'));
    const { ex, doc } = await load(name);
    const purpose = name.startsWith('apt') ? 'lease' : name.startsWith('set') ? 'auction' : 'general';
    const rep = DG.analyze(doc, { purpose, baseDate: '2026-11-15' });
    multi.push({ name, doc, rep });
    console.log(`\n=== ${name} chars=${ex.chars} kind=${doc.kind} addr=${doc.address} uniq=${doc.uniqueNo} viewed=${doc.viewedAt} summary=${!!doc.summary}`);
    if (!ex.chars) { console.log('  (텍스트 없음: 이미지 판독 경로)'); continue; }
    const bad = [];
    const tEntries = truth.entries || [];
    for (const t of tEntries) {
      const list = t.section === '갑구' ? doc.gap : doc.eul;
      const e = list.find(x => x.rank === t.rank);
      if (!e) { bad.push(`누락 ${t.section} ${t.rank} ${t.purpose}`); continue; }
      if (NS(e.purpose).indexOf(NS(t.purpose).slice(0, 4)) < 0) bad.push(`목적 ${t.section}${t.rank}: '${NS(e.purpose)}' vs '${NS(t.purpose)}'`);
      if (t.receipt_date_iso && e.date !== t.receipt_date_iso) bad.push(`접수일 ${t.section}${t.rank}: ${e.date} vs ${t.receipt_date_iso}`);
      if (!!e.cancelled !== !!t.cancelled) bad.push(`말소 ${t.section}${t.rank}: ${e.cancelled}(${e.statusWhy}) vs ${t.cancelled}`);
      if (t.holder_text && NS(e.holder) !== NS(t.holder_text)) bad.push(`권리자칸 ${t.section}${t.rank}: '${NS(e.holder).slice(0, 60)}' vs '${NS(t.holder_text).slice(0, 60)}'`);
    }
    const extra = doc.gap.length + doc.eul.length - tEntries.length;
    if (extra) bad.push(`항목 수 차이 ${extra} (parsed gap ${doc.gap.length} eul ${doc.eul.length}, truth ${tEntries.length})`);
    const to = (truth.current_owners || []).map(o => NS(o.name || o)).sort().join(',');
    const po = rep.owners.map(o => NS(o.name)).sort().join(',');
    if (to !== po) bad.push(`소유자 '${po}' vs '${to}'`);
    totalBad += bad.length;
    console.log(bad.length ? bad.map(b => '  ✗ ' + b).join('\n') : '  ✓ 항목·말소·권리자칸·소유자 일치');
    console.log('  flags:', rep.flags.map(f => `[${DG.LV_LABEL[f.level]}]${f.title}`).join(' | '));
    console.log('  expected:', (truth.expected_flags || []).join(' | '));
    console.log('  fraud:', rep.fraud.map(f => `${f.kind}:${f.score}`).join(', ') || '-');
    console.log('  scenarios:', rep.scenarios.map(s => `${s.title}(${s.likelihood}/${s.impact})`).join(' | '));
    console.log('  base:', rep.baseRight ? rep.baseRight.sec + rep.baseRight.rank : '-', 'mortSum', rep.money.mortSum);
  }
  const sets = [['set_land', 'set_bldg'], ['owner_a1', 'owner_a2']];
  for (const s of sets) {
    const items = multi.filter(m => s.includes(m.name));
    if (items.length < 2) continue;
    const res = DG.analyzeMulti(items, { purpose: 'general' });
    console.log(`\n=== MULTI ${s.join('+')}`);
    res.findings.forEach(f => console.log(`  [${f.level}] ${f.title} :: ${f.detail}`));
    console.log('  scen:', res.scenarios.slice(0, 5).map(x => `${x.title}(${x.likelihood})`).join(' | '));
    const truth = JSON.parse(fs.readFileSync(path.join(dir, s[0] + '.truth.json'), 'utf8'));
    console.log('  expected:', JSON.stringify((truth.cross_document || {}).expected_cross_flags || []));
  }
  console.log('\nTOTAL mismatches:', totalBad);
})().catch(e => { console.error(e); process.exit(1); });
