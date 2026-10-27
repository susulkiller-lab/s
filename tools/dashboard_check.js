// 업무판(app/dashboard.html)의 순수 함수 자체 점검. 사용법: node tools/dashboard_check.js
const fs = require("fs"), assert = require("assert");
const html = fs.readFileSync(__dirname + "/../app/dashboard.html", "utf8");
const pure = html.split("/*PURE-START*/")[1].split("/*PURE-END*/")[0];
const f = new Function(pure + "; return {kst,add,dow,monday,wkey,lastDay,shiftYM,allocDays,classify,parsePaste,pii};")();

assert.equal(f.wkey("2026-10-27"), "2026-W44");
assert.equal(f.wkey("2026-12-28"), "2026-W53");
assert.equal(f.wkey("2027-01-03"), "2026-W53");
assert.equal(f.wkey("2027-01-04"), "2027-W01");
assert.equal(f.monday("2026-11-01"), "2026-10-26");
assert.equal(f.lastDay("2026-02"), "2026-02-28");
assert.equal(f.shiftYM("2026-01", -1), "2025-12");
assert.equal(f.kst(Date.parse("2026-10-27T15:00:00Z")), "2026-10-28"); // 한국 자정 경계
// 06 문서 3.11 경계 사례 3: 월 0/2, 화 4편 → 화 2, 월 2
assert.deepEqual(f.allocDays([2, 2, 2, 2, 2], [0, 4, 0, 0, 0]).F, [2, 2, 0, 0, 0]);
assert.deepEqual(f.allocDays([2, 2, 2, 2, 2], [0, 0, 3, 0, 0]).F, [1, 0, 2, 0, 0]); // 넘친 1편은 이른 부족분(월)으로
assert.equal(f.classify("https://www.lawtalk.co.kr/posts/201082").key, "lawtalk_201082");
assert.equal(f.classify("https://jinnsol.tistory.com/248").key, "tistory_jinnsol_248");
assert.equal(f.classify("https://blog.naver.com/jinnsol-law/224454509785", "양육비 이행").match, "naver:jinnsol-law");
assert.equal(f.classify("https://m.blog.naver.com/PostView.naver?blogId=jinnsollaw&logNo=1", "음주운전 불기소 성공사례").match, "naver:case");
assert.ok(f.classify("https://blog.naver.com/someone/123").notours);
const items = f.parsePaste("10/26(월)\n\n<로톡>\nhttps://www.lawtalk.co.kr/posts/201082\n사실적시 명예훼손 고소 대응\n\n<티스토리>\nhttps://jinnsol.tistory.com/249\n도로교통법위반 불기소(계성진) 성공사례", "2026-10-27");
assert.equal(items.length, 2);
assert.equal(items[0].day, "2026-10-26");
assert.equal(items[0].title, "사실적시 명예훼손 고소 대응");
assert.equal(items[1].hint, "티스토리");
assert.equal(f.parsePaste("12/31\nhttps://x.com/a", "2027-01-04")[0].day, "2026-12-31"); // 연말 경계
assert.ok(f.pii("010-1234-5678") && f.pii("900101-1234567") && !f.pii("음주운전 변호사"));
console.log("dashboard_check: ok");
