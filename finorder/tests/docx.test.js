/* DOCX 실물 검증. 사용: node tests/docx.test.js
 * 1) 가상 입력으로 tests/out/sample.docx 생성
 * 2) python3 tests/check_docx.py 로 XML 유효성·문안·서식 검사
 * 3) soffice가 있으면 PDF로 변환해 tests/out/sample.pdf, 쪽별 PNG(tests/out/page-N.png)를 만든다(육안 비교용)
 * 또 미입력 상태 문서와 29곳 이상 문서도 만들어 XML이 유효한지 본다. */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "vendor", "docx-8.5.0.iife.js"), "utf8"));
const F = require("../src/app.js");
const out = path.join(__dirname, "out");
fs.mkdirSync(out, { recursive: true });

const KOOKMIN = { name: "주식회사 국민은행", zip: "07331", addr: "서울특별시 영등포구 국제금융로8길 26", note: "여의도동", wording: "은행" };
const KAKAO = { name: "주식회사 카카오뱅크", zip: "13529", addr: "경기도 성남시 분당구 분당내곡로 131, 11층", note: "백현동, 판교테크원", wording: "은행" };
const state = {
  caseNo: "2026드단12345", caseName: "이혼 등", plaintiff: "홍길동", defendant: "김영희", ours: "defendant",
  selected: [KOOKMIN, KAKAO],
  holders: [{ role: "plaintiff", name: "홍길동", no: "9001012345678" }],
  period: { start: "2023-09-01", end: "2026-09-01" },
  purpose: { type: "divorce", text: "" }, wording: "auto",
};

async function write(name, st) {
  const doc = F.buildDocument(F.composeDoc(st), globalThis.docx);
  const buf = await globalThis.docx.Packer.toBuffer(doc);
  const p = path.join(out, name);
  fs.writeFileSync(p, buf);
  return p;
}
function py(args) {
  const r = spawnSync("python3", [path.join(__dirname, "check_docx.py")].concat(args), { encoding: "utf8" });
  return r;
}

(async () => {
  let fail = 0;
  const report = (ok, msg) => { console.log((ok ? "통과 " : "실패 ") + msg); if (!ok) fail++; };

  const p1 = await write("sample.docx", state);
  const r = py([p1]);
  report(r.status === 0, "가상 입력 DOCX 검증: " + (r.stdout + r.stderr).trim().split("\n")[0]);
  if (r.status !== 0) console.log(r.stdout + r.stderr);

  // 미입력 + 명의인 복수 + 기관 30곳 문서도 XML이 유효해야 한다
  const many = [];
  for (let i = 1; i <= 30; i++) many.push({ name: "가상기관 " + i, zip: "12345", addr: "가상시 가상로 " + i, note: "", wording: i % 2 ? "은행" : "기관" });
  const p2 = await write("blank.docx", { selected: [], holders: [{ role: "third", name: "", no: "" }], period: {}, purpose: { type: "divorce" } });
  const p3 = await write("many.docx", Object.assign({}, state, { selected: many, holders: [{ role: "plaintiff", name: "홍길동", no: "9001012345678" }, { role: "defendant", name: "김영희", no: "123-45-67890" }] }));
  [p2, p3].forEach((p) => {
    const z = spawnSync("python3", ["-c", "import sys,zipfile,xml.etree.ElementTree as ET\nz=zipfile.ZipFile(sys.argv[1])\n[ET.fromstring(z.read(n)) for n in z.namelist() if n.endswith(('.xml','.rels'))]\nprint('ok')", p], { encoding: "utf8" });
    report(z.status === 0 && z.stdout.trim() === "ok", path.basename(p) + " XML 유효");
  });
  // 문단별로 w:t를 이어 붙여 검사한다(run이 나뉘어 있어 원문 XML 검색으로는 안 보인다)
  const paraTexts = (file) => {
    const code = "import sys,zipfile,re,json\nx=zipfile.ZipFile(sys.argv[1]).read('word/document.xml').decode()\nps=re.findall(r'<w:p>.*?</w:p>',x,re.S)\nprint(json.dumps([''.join(re.findall(r'<w:t(?: [^>]*)?>(.*?)</w:t>',p)) for p in ps],ensure_ascii=False))";
    return JSON.parse(spawnSync("python3", ["-c", code, file], { encoding: "utf8" }).stdout);
  };
  const t2 = paraTexts(p2);
  report(t2.some((l) => l.includes("「사건번호」 「사건명」")) && t2.includes("가. 「대상기관」") && t2.some((l) => l.startsWith("귀 은행") || l.includes("귀 은행에 「이름」 (「주민등록번호」)")), "미입력 문서에 자리표시가 들어감");
  const t3 = paraTexts(p3);
  report(t3.includes("(29) 가상기관 29") && t3.includes("(30) 가상기관 30") && t3.includes("허. 가상기관 28"), "기관 30곳 문서: 허. 다음 (29), (30) 순번");
  report(t3.some((l) => l.startsWith("가.귀 기관에") && l.includes("각 명의자로")), "기관 30곳 문서: 귀 기관, 각 명의자로");
  report(t3.some((l) => l.includes("홍길동 (900101-2345678), 김영희 (123-45-67890)를 각 명의자로")), "명의인 복수: 마지막 이름 기준 조사");

  // PDF 변환(선택). 바탕체가 없는 환경에서는 명조 계열(NanumMyeongjo)로 대체해 구조만 비교한다.
  const lo = path.join(out, ".lo");
  fs.mkdirSync(lo, { recursive: true });
  const fc = path.join(lo, "fonts.conf");
  fs.writeFileSync(fc, '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include>' +
    '<match target="pattern"><test name="family" qual="any"><string>바탕체</string></test><edit name="family" mode="assign" binding="strong"><string>NanumMyeongjo</string></edit></match></fontconfig>');
  const env = Object.assign({}, process.env, { FONTCONFIG_FILE: fc, HOME: lo });
  const so = spawnSync("soffice", ["--headless", "-env:UserInstallation=file://" + path.join(lo, "profile"), "--convert-to", "pdf", "--outdir", out, p1], { encoding: "utf8", timeout: 120000, env });
  if (so.status === 0 && fs.existsSync(path.join(out, "sample.pdf"))) {
    spawnSync("pdftoppm", ["-r", "70", "-png", path.join(out, "sample.pdf"), path.join(out, "page")]);
    const info = spawnSync("pdfinfo", [path.join(out, "sample.pdf")], { encoding: "utf8" }).stdout;
    const pages = /Pages:\s+(\d+)/.exec(info);
    report(true, "PDF 변환 완료(쪽수 " + (pages ? pages[1] : "?") + ") → tests/out/sample.pdf, page-N.png");
  } else {
    console.log("PDF 변환 건너뜀(soffice에 Writer가 없거나 실패): " + (so.stderr || "").trim().split("\n").pop());
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
