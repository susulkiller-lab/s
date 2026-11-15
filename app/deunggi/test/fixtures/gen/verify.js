// Verify fixtures with pdfjs-dist@3.11.174 (legacy build).
// Run: NODE_PATH=<testenv>/node_modules node verify.js <fixtures dir>
// Checks: Hangul text extracts correctly, text item granularity, red strike lines are found in the
// operator list and land exactly on the text of cancelled entries (and only partial lines of
// partially struck entries), image-only scan has no text.
const fs = require('fs');
const path = require('path');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const dir = process.argv[2] || path.join(__dirname, '..');
const OPSNAME = Object.fromEntries(Object.entries(pdfjs.OPS).map(([k, v]) => [v, k]));
const norm = (s) => (s || '').replace(/\s+/g, '');

async function load(file) {
  const data = new Uint8Array(fs.readFileSync(path.join(dir, file)));
  return pdfjs.getDocument({ data, disableFontFace: true, verbosity: 0 }).promise;
}

// Walk the operator list, returning stroked line segments with their stroke colour.
function strokeSegments(opList) {
  const segs = [];
  let color = [0, 0, 0];
  const stack = [];
  let pending = [];
  let firstRedExample = null;
  const { fnArray, argsArray } = opList;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === pdfjs.OPS.save) stack.push(color);
    else if (fn === pdfjs.OPS.restore) color = stack.pop() || [0, 0, 0];
    else if (fn === pdfjs.OPS.setStrokeRGBColor) color = Array.from(args);
    else if (fn === pdfjs.OPS.constructPath) {
      const [ops, coords] = args;
      let k = 0;
      let cur = null;
      pending = [];
      for (const op of ops) {
        if (op === pdfjs.OPS.moveTo) { cur = [coords[k], coords[k + 1]]; k += 2; }
        else if (op === pdfjs.OPS.lineTo) {
          const nxt = [coords[k], coords[k + 1]]; k += 2;
          pending.push([cur[0], cur[1], nxt[0], nxt[1]]);
          cur = nxt;
        } else if (op === pdfjs.OPS.rectangle) { k += 4; }
        else if (op === pdfjs.OPS.curveTo) { k += 6; }
        else if (op === pdfjs.OPS.curveTo2 || op === pdfjs.OPS.curveTo3) { k += 4; }
      }
    } else if (fn === pdfjs.OPS.stroke || fn === pdfjs.OPS.closeStroke) {
      for (const s of pending) segs.push({ x1: s[0], y1: s[1], x2: s[2], y2: s[3], color });
      if (!firstRedExample && color[0] > 200 && color[1] < 50) {
        firstRedExample = [];
        for (let j = Math.max(0, i - 3); j <= Math.min(fnArray.length - 1, i + 1); j++) {
          firstRedExample.push({ fn: OPSNAME[fnArray[j]], fnId: fnArray[j], args: argsArray[j] });
        }
      }
      pending = [];
    }
  }
  return { segs, firstRedExample };
}

function ser(v) {
  return JSON.stringify(v, (k, x) => (ArrayBuffer.isView(x) ? { [x.constructor.name]: Array.from(x) } : x));
}

async function checkText(file, truth) {
  const doc = await load(file);
  const report = { file, pages: doc.numPages, items: 0, singleGlyphItems: 0, problems: [] };
  let all = '';
  const struckItems = [];
  const unstruckItems = [];
  let example = null;
  let firstItems = null;
  let redCount = 0;
  let blackCount = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter((it) => it.str !== '');
    report.items += items.length;
    report.singleGlyphItems += items.filter((it) => it.str.trim().length === 1).length;
    if (!firstItems) firstItems = tc.items.slice(0, 12).map((it) => ({ str: it.str, x: +it.transform[4].toFixed(2), y: +it.transform[5].toFixed(2), w: +it.width.toFixed(2), h: it.height, hasEOL: it.hasEOL }));
    all += items.map((it) => it.str).join('') + '\n';
    const ol = await page.getOperatorList();
    const { segs, firstRedExample } = strokeSegments(ol);
    if (!example && firstRedExample) example = { page: p, ops: firstRedExample };
    const red = segs.filter((s) => s.color[0] > 200 && s.color[1] < 50 && s.color[2] < 50);
    redCount += red.length;
    blackCount += segs.filter((s) => s.color[0] === 0 && s.color[1] === 0 && s.color[2] === 0).length;
    for (const it of items) {
      const x0 = it.transform[4];
      const y0 = it.transform[5];
      const fs_ = Math.hypot(it.transform[2], it.transform[3]);
      const x1 = x0 + it.width;
      const hit = red.some((s) => Math.abs(s.y1 - s.y2) < 0.01 && s.y1 > y0 && s.y1 < y0 + fs_ * 0.8 &&
        Math.min(s.x1, s.x2) <= x0 + 1 && Math.max(s.x1, s.x2) >= x1 - 1);
      (hit ? struckItems : unstruckItems).push({ str: it.str, page: p, y: y0 });
    }
  }
  report.redStrokeSegments = redCount;
  report.blackStrokeSegments = blackCount;
  report.firstItems = firstItems;
  report.redExample = example;

  // content checks
  const N = norm(all);
  const must = [truth.address_line, '고유번호' + truth.unique_no, '열람일시:' + truth.viewed_at, '--이하여백--',
    '관할등기소' + truth.registry_office, '주요등기사항요약(참고용)', '[주의사항]', '1.소유지분현황(갑구)'];
  for (const m of must) if (!N.includes(norm(m))) report.problems.push('missing text: ' + m);
  const struckSet = new Set(struckItems.map((i) => norm(i.str)));
  const unstruckSet = new Set(unstruckItems.map((i) => norm(i.str)));
  let entriesChecked = 0;
  for (const e of truth.entries) {
    entriesChecked++;
    if (!N.includes(norm(e.purpose))) report.problems.push(`${e.section} ${e.rank}: purpose not found`);
    if (e.receipt_no && !N.includes(norm(e.receipt_date + e.receipt_no))) report.problems.push(`${e.section} ${e.rank}: receipt not found`);
    const firstHolder = (e.holder_text || '').split('\n')[0];
    if (firstHolder && !N.includes(norm(firstHolder))) report.problems.push(`${e.section} ${e.rank}: holder line not found: ${firstHolder}`);
    // strike consistency via the receipt number item (unique per doc)
    if (e.receipt_no) {
      const rn = norm(e.receipt_no);
      const isStruck = struckSet.has(rn);
      const isPlain = unstruckSet.has(rn);
      if (e.cancelled && !isStruck) report.problems.push(`${e.section} ${e.rank}: cancelled but receipt not struck`);
      if (!e.cancelled && isStruck) report.problems.push(`${e.section} ${e.rank}: valid but receipt struck`);
      if (!e.cancelled && !isPlain) report.problems.push(`${e.section} ${e.rank}: receipt item not found unstruck`);
    }
    for (const ps of e.partially_struck_lines || []) {
      // the logical line may wrap: every struck fragment must be part of it, and at least one exists
      const frag = struckItems.filter((i) => norm(ps.text).includes(norm(i.str)) && norm(i.str).length > 3);
      if (!frag.length) report.problems.push(`${e.section} ${e.rank}: partial strike missing for "${ps.text}"`);
    }
  }
  report.entriesChecked = entriesChecked;
  report.struckItemCount = struckItems.length;
  report.struckSample = struckItems.slice(0, 6).map((i) => i.str);
  return report;
}

async function checkScan(file) {
  const doc = await load(file);
  const r = { file, pages: doc.numPages, textItems: 0, imageOps: 0 };
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    r.textItems += (await page.getTextContent()).items.length;
    const ol = await page.getOperatorList();
    r.imageOps += ol.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintJpegXObject).length;
  }
  return r;
}

(async () => {
  const names = ['apt_risky', 'villa_trust', 'house_clean', 'land_share', 'set_land', 'set_bldg', 'owner_a1', 'owner_a2'];
  let fail = 0;
  for (const n of names) {
    const truth = JSON.parse(fs.readFileSync(path.join(dir, n + '.truth.json'), 'utf8'));
    const r = await checkText(n + '.pdf', truth);
    fail += r.problems.length;
    console.log(`\n== ${n}.pdf  pages=${r.pages} textItems=${r.items} singleGlyphItems=${r.singleGlyphItems} ` +
      `redStrokeSegs=${r.redStrokeSegments} blackStrokeSegs=${r.blackStrokeSegments} struckItems=${r.struckItemCount} entries=${r.entriesChecked}`);
    console.log('   problems:', r.problems.length ? r.problems : 'none');
    console.log('   struck sample:', JSON.stringify(r.struckSample));
    if (n === 'apt_risky') {
      console.log('   first text items (page 1):');
      for (const it of r.firstItems) console.log('     ', JSON.stringify(it));
      console.log('   first red stroke, raw ops (page ' + r.redExample.page + '):');
      for (const o of r.redExample.ops) console.log('     ', o.fn, '(' + o.fnId + ')', ser(o.args));
    }
  }
  const s = await checkScan('apt_risky_scan.pdf');
  console.log(`\n== apt_risky_scan.pdf pages=${s.pages} textItems=${s.textItems} imageOps=${s.imageOps}`);
  if (s.textItems !== 0 || s.imageOps !== s.pages) fail++;
  console.log(fail ? `\nFAILED (${fail})` : '\nALL OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
