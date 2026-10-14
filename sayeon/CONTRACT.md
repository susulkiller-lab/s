# 사건 연표 (SAYEON) 설계서 v1

이 문서는 모든 담당이 따르는 단일 기준이다. 기획자(메인 세션)가 쓰고 관리한다. 모호하거나 모순되는 부분은 임의로 해석하지 말고 결과 보고서에 "설계서 질의"로 적어라. 임의로 바꾸지 마라.

작업 루트: `<작업루트>` (이하 `$R`)

## 0. 제품 한 줄 요약
법원 기록(소장, 답변서, 준비서면 등)의 원본을 올리면 (1) 쟁점별 주장 변천 지도, (2) 화면용 타임라인, (3) 서면에 끼워 넣는 A4 별지 타임라인(흑백 인쇄 대응)을 만들어 주는 claude.ai 아티팩트(단일 HTML). 사용자는 15년 차 법률 사무장. 서면 작성 보조 도구이지 법률 자문 도구가 아니다.

## 1. 절대 원칙 (위반하면 반려)
1. 사실 상한: 원문에 없는 사실을 만들지 않는다. 모든 진술(statement)은 원문 인용(quote)과 쪽수를 갖는다. 인용은 해당 서면 텍스트에 그대로(공백 차이만 허용) 존재해야 한다. 확인되지 않은 진술은 저장하지 않는다.
2. 해석이 필요한 판정은 `review: true`("검토 필요")로 남긴다. 자백은 항상 "자백후보"로만 표시한다(준비서면 기재만으로 자백이 성립하는 것이 아니고, 변론기일에 진술된 서면인지 변론조서로 확인해야 하기 때문). 화면과 출력 어디에도 "자백 성립", "확정" 같은 단정 표현을 쓰지 않는다.
3. 법조문·판례번호·법리 수치를 코드나 문구에 새로 만들어 넣지 않는다. 필요하면 "검토 필요"로 둔다.
4. 화면 문구는 한국어 경어체. 이모지 금지. 마크다운 강조(별표 등)·HTML 태그를 사용자에게 보이는 생성 텍스트(반박 재료, 각주, 요지)에 섞지 않는다.
5. 출력물(A4 별지)은 항상 흰 바탕 검은 글씨. 테마(다크/라이트)와 무관해야 하며 색에만 의존하지 않는다(실선/점선, 채운 원/빈 원, 기호 병행).
6. 개인정보: 주민등록번호 형태는 기본으로 가려서(`SY.maskSensitive`) Claude로 보내고 저장한다(사용자가 끌 수 있음). 콘솔·화면에 원문을 불필요하게 출력하지 않는다.

## 2. 실행 환경 제약 (아티팩트)
- 단일 HTML. 최종 빌드는 `<!doctype>/<html>/<head>/<body>` 태그 없이 `<title>`, `<style>`, 본문 마크업, `<script>` 순서. 제목은 `사건 연표`.
- 외부 스크립트는 cdnjs.cloudflare.com만(고정 버전): pdf.js 3.11.174(`pdf.min.js`, 워커 `pdf.worker.min.js`), mammoth 1.6.0(`mammoth.browser.min.js`), jszip 3.10.1(`jszip.min.js`). 외부 스타일은 Google Fonts만. fetch/XHR로 외부 접속 불가.
- `window.print()`, `<a download>`, 스크립트 자체 다운로드는 동작하지 않는다. 파일 저장은 `downloads` 능력(`const dl = await claude.use("downloads"); await dl.save({filename, data})`), 확장자는 png, svg, txt, json, csv, docx, pdf, html 등 허용 목록 안에서.
- 능력(capabilities): `db`, `user`, `sample`, `downloads`, `assets`, `mcp`(구글 드라이브 커넥터). 모두 `await claude.use(name)`로 얻고 `null`이면 그 기능을 숨기거나 대체 경로를 제공한다. 능력 호출은 사용자 클릭 이후에만(로드 시 자동 호출 금지). 타입 정의는 `artifact-capabilities` 스킬의 타입 정의(claude.d.ts, sample.d.ts, mcp.d.ts, db.d.ts, downloads.d.ts, assets.d.ts, user.d.ts)(claude.d.ts, sample.d.ts, mcp.d.ts, db.d.ts, downloads.d.ts, assets.d.ts, user.d.ts)를 직접 읽고 따라라. 기억에 의존해 API를 짐작하지 마라.
- sample(Claude 호출): 입력 프롬프트 합계 256KiB 이하. 이미지는 JPEG/PNG/WebP/GIF Blob만, 개수·크기 한도는 `sample.limits()`로 확인. 호출은 사용자 비용(구독 사용량)으로 차감되므로 호출 전 예상 횟수를 보여 주고, 중지 버튼(AbortController)과 진행 표시를 둔다. 오류 코드별로 분기한다(rate_limited, not_granted, prompt_too_large, images_unavailable 등).
- db 문서 한 개는 256KiB 이하. 큰 데이터는 쪼갠다(5.2 참조).
- 레이아웃: 휴대폰 폭(약 400px)에서도 동작, 가로 스크롤은 표/도표 컨테이너 안에서만. 다크/라이트 모두 토큰 기반(`src/tokens.css`). 하드코딩 색 금지(A4 출력 SVG는 예외로 흑백 고정).
- 시험 환경: 샌드박스는 외부망이 막혀 있다. cdnjs 대신 `$R/vendor/` 의 로컬 파일을 Playwright `page.route`로 대신 내준다(`vendor/pdfjs-dist-3.11.174/package/build/pdf.min.js`, `pdf.worker.min.js`, `vendor/mammoth-1.6.0/package/mammoth.browser.min.js`, `vendor/jszip-3.10.1/package/dist/jszip.min.js`). 실행: `cd $R && NODE_PATH=$(npm root -g) node test/xxx.js` (Chromium은 playwright가 자동 탐색). 한글 폰트는 샌드박스에 거의 없으니 스크린샷의 글자 모양은 신경 쓰지 말고 배치·겹침·잘림을 본다.

## 3. 데이터 스키마 (C = 사건 객체)

### 3.1 최상위
```
C = {
  id: 'c_xxxxxx', title: '갑 계약금반환', caseNo: '2099가단00001', court: '○○지방법원',
  ourSide: '원고' | '피고',
  parties: { '원고': '갑', '피고': '을' },
  margins: { top: 45, bottom: 20, left: 30, right: 30 },   // mm. 하단 20은 프로그램 기본값(법정 수치 아님)
  docs: [Doc], issues: [Issue], statements: [Statement], changes: [Change], facts: [Fact],
  updatedAt: ISO문자열, schema: 1
}
```
### 3.2 Doc (서면)
```
{ id:'D1', kind:'소장'|'답변서'|'준비서면'|..., side:'원고'|'피고', submitter:'원고 소송대리인',
  filedDate:'2023-04-11', authoredDate:'2023-04-10'|null, fileName, source:'paste'|'file'|'folder'|'drive',
  pageCount:20, pages:[{ n:1, text:'원문', status:'text'|'ocr'|'needsOcr'|'manual' }] }
```
`filedDate`는 접수·제출일(전자소송 제출일시 기준). 인용 표기는 `SY.docName(doc)` = "2023. 6. 7.자 답변서".
### 3.3 Issue (쟁점)
`{ id:'I1', name:'...', elements:'관련 요건사실' }`. `I0`는 기초사실용 예약 id.
### 3.4 Statement (진술)
```
{ id:'S001', docId:'D2', page:3, item:'2.다.', issueIds:['I6'], side:'피고',
  gist:'평서형 한 문장, 다로 끝남, 60자 이내, 마침표 없음. 예: 상수도 문제나 인허가상의 문제는 없다',
  quote:'원문 그대로의 연속된 구절 8~220자', evidence:['갑13','을3-1'], factIds:['F03'] }
```
- `gist`는 `SY.quotative(gist)`로 "...다고 주장하였습니다" 문형에 바로 이어 붙을 수 있도록 쓴다. 주어("피고는")는 gist에 넣지 않는다.
- `evidence`는 `SY.normEvidence` 형태의 정규화 문자열. 그 진술이 입증에 의지하는 호증만 적는다. 상대방 호증을 부인하거나 부지로 인부하는 진술에는 그 호증을 적지 않는다(gist 에 그 사실을 쓴다). 쪽에 걸친 인용은 허용(검증기와 `SY.verifyQuote` 가 인접 쪽 합본으로 대조), 진술 id 는 `S{서면번호}-{일련번호}` 형식(예: S1-001, S4-012).
### 3.5 Change (변화 판정)
```
{ id:'C001', issueId:'I2', scope:'same'|'cross', fromId:'S004', toId:'S009'|null, toDocId?:'D3',
  type:'유지'|'보충'|'변경'|'번복'|'철회'|'모순'|'자백후보'|'미반복', basis:'판정 근거 1~3문장(원문 근거를 쪽수와 함께)', review:true|false }
```
- 미반복은 뒤 진술이 없으므로 `toId:null` 이고 대신 `toDocId`(앞 주장을 다루지 않은 이후 서면 id)를 반드시 둔다. 다른 유형은 `toId` 필수. 미반복의 지도상 위치는 (issueId, toDocId) 칸이다.
- scope `same`: 같은 편의 앞 진술(from)과 뒤 진술(to). `cross`: 상대편 주장(from)과 이를 인정하는 취지의 진술(to) → 유형은 `자백후보`만.
- 정의: 유지(같은 취지 반복), 보충(앞 진술에 사실·근거를 덧붙임), 변경(같은 사실에 대한 서술이 일부 달라짐: 일자, 금액, 표현, 주체 등), 번복(앞 진술과 정반대 취지로 바뀜), 철회(명시적으로 거두어들임), 모순(같은 편의 두 진술이 양립하지 않음. 시간 순서와 무관하게 서로 충돌), 자백후보(상대 주장 사실을 인정하는 취지의 기재), 미반복(앞서 주장했으나 후속 서면에서 다루지 않음. 철회 아님).
- 원문 근거가 약하거나 해석이 필요하면 `review:true`.
### 3.6 Fact (사실)
```
{ id:'F01', title:'20자 안팎 표제', 
  date:{ start:'2022-10-03', end:null|'YYYY-MM-DD', precision:'day'|'month'|'year'|'approx'|'range', label:'' },
  plaintiff:{ text, stmtIds:[], evidence:[], date?:{...} } | null,
  defendant:{ text, stmtIds:[], evidence:[], date?:{...} } | null,
  dispute:'다툼없음'|'일부다툼'|'다툼'|'미확정', issueIds:[], note:'' }
```
- `approx`는 "○○경"(흐린 구간), `range`는 기간(시간선 위 막대).
- 양측이 같은 사건의 날짜를 다르게 말하면 각 측 `date`를 따로 둔다(화면은 두 점을 점선으로 잇는다).
- `다툼없음`이면 시간선 위의 점 하나(원고 서술을 기본 문구로 사용), 그 외에는 원고 서술은 위쪽, 피고 서술은 아래쪽. 한쪽만 주장하고 상대가 침묵하면 `미확정`으로 두고 주장한 쪽에만 표시한다.
- `title`은 20자 안팎. 모든 사실의 근거는 `stmtIds`로 진술에 연결되고, 진술을 거쳐 서면·쪽수·인용으로 이어진다(근거 서면 원문을 우측 창에 보여 주기 위함).

## 4. 모듈과 파일 (담당별 소유, 서로의 파일을 고치지 않는다)
빌드는 `src/` 파일을 정해진 순서로 이어 붙여 `build/sayeon.html`을 만든다. 각 모듈은 `window.SY` 아래 네임스페이스에 붙고, 정의 시점에는 다른 모듈이나 CDN 라이브러리가 로드됐다고 가정하지 않는다(사용 시점에 검사).

| 파일 | 소유 담당 | 공개 API |
|---|---|---|
| `src/common.js`, `src/tokens.css` | 기획자 | `SY.*` 유틸 (읽기 전용) |
| `src/viz_timeline.js` + `src/viz_timeline.css` | 화면 타임라인 | `SY.Viz.timeline`, `SY.Viz.factDetail` |
| `src/viz_map.js` + `src/viz_map.css` | 변천 지도 | `SY.Viz.map`, `SY.Viz.rebuttalText` |
| `src/viz_a4.js` | A4 별지 | `SY.Viz.a4`, `SY.Viz.toPngBlob` |
| `src/ingest.js` + `src/ingest.css` | 자료 올리기 | `SY.Ingest.mount`, `SY.Ingest.classifyName` 등 |
| `src/pipeline.js` | 분석 파이프라인 | `SY.Pipeline.*` |
| `src/store.js`, `src/shell.js`, `src/shell.css`, `src/shell.html`, `build.py`, `test/mock_claude.js`, `tools/split_case.js` | 껍데기·저장 | `SY.Store`, `SY.App` |

### 4.1 Viz API
```
SY.Viz.timeline(el, C, opts) -> ctrl
  opts: { scale:'real'|'even', issueId:null|'I2', from:null|'YYYY-MM-DD', to:null|'YYYY-MM-DD', selectedId:null, onSelect(factId|null) }
  ctrl: { update(partialOpts), zoomBy(factor), fit(), select(factId), destroy() }
SY.Viz.factDetail(el, C, factId, opts?)      // 우측 창: 설명, 근거 서면 원문(쪽·인용), 증거번호, 양측 주장 변천 이력(해당 사실의 진술과 변화 판정)
SY.Viz.map(el, C, opts) -> ctrl               // 쟁점(세로) x 서면(가로, 제출일 순) 격자 + 비교 서랍 + 반박 재료 내보내기 UI
  opts: { onExport(text, filename) }          // 파일 저장은 껍데기가 downloads 로 처리. 클립보드 복사는 map 이 직접(실패 시 선택 상태로 폴백).
SY.Viz.rebuttalText(C, changeIds[]) -> string // 3.5 문형. 예: "피고는 2023. 6. 7.자 답변서 제2쪽에서 ...다고 주장하였다가, 2023. 8. 8.자 준비서면 제2쪽에서는 ...다고 주장하였습니다."
SY.Viz.a4(C, opts) -> { pages:[{ figure:'<svg>', sheet:'<svg>', footnotes:[{no,text}], rangeLabel }], widthMm, heightMm, warnings:[] }
  opts: { layout:'S'|'Z', mode:'submit'|'internal', margins?, issueId?, from?, to?, showEvidence:true, fontScale:1, itemsPerRow?:auto, title? }
SY.Viz.toPngBlob(svgString, { dpi:300, widthMm, heightMm }) -> Promise<Blob>
```
### 4.2 Store API (db 능력, 없으면 메모리+localStorage 폴백)
```
await SY.Store.init() -> { mode:'db'|'local', canWrite:boolean }
await SY.Store.listCases() -> [{ id, title, caseNo, updatedAt, counts }]
await SY.Store.loadCase(id) -> C
await SY.Store.saveCase(C)          // 변경된 부분만 쓴다
await SY.Store.deleteCase(id)
```
### 4.3 Ingest API
```
SY.Ingest.mount(el, { getCase(), onDocs(docs[]), rules, setRules(rules) }) -> ctrl
SY.Ingest.classifyName(fileName) -> { caseNo, date:'YYYY-MM-DD'|null, kind, role:'brief'|'record'|'skip', submitter, seq, title, reason }
```
`onDocs`가 받는 doc 은 3.2 형태 + 과도기 필드(`pages[i].image: Blob`, `rawBlob: Blob`). 아직 쓰지 않은 서면은 사용자가 "자료함에서 확인 → 분석에 추가"를 눌렀을 때만 전달한다.
### 4.4 Pipeline API (모두 `{signal, onProgress(msg, frac)}` 옵션을 받고 Promise 를 반환)
```
SY.Pipeline.estimate(C, stages) -> { calls, images, note }
SY.Pipeline.transcribe(C, docId, opts)            // needsOcr 쪽을 이미지로 Claude 에 보내 원문 텍스트로 옮김. pages[i].status='ocr'
SY.Pipeline.draftIssues(C, opts) -> Issue[]       // 쟁점 초안(사용자가 확정)
SY.Pipeline.extractStatements(C, docId, opts) -> { statements, rejected }   // 인용 대조를 통과한 것만. rejected 에는 사유
SY.Pipeline.judgeChanges(C, opts) -> Change[]     // 쟁점별로 서면 순서에 따라 같은 편 진술 비교(same) + 상대 주장 인정 여부(cross)
SY.Pipeline.buildFacts(C, opts) -> Fact[]         // 진술에서 사실·일자·다툼 여부를 묶음
SY.Pipeline.runAll(C, stages, opts)
SY.Pipeline.addDocument(C, docId, opts)           // 새 서면 1건만 추가 분석하고 달라진 부분만 병합
```
## 5. 자료 올리기 요구 (필수, 반드시 모두 구현)
원본을 넣는 경로는 반드시 다음 네 가지가 모두 있어야 하고, 같은 "자료함"으로 합쳐진다.
1. 텍스트 붙여넣기: 서면 전문을 붙여넣고 종류·제출자·제출일·쪽 구분을 지정(쪽 구분은 빈 줄 3개, 폼피드 문자, `- 3 -` 형태 쪽번호, `=== p.3 ===` 중 인식, 없으면 한 쪽).
2. 파일: 여러 파일 선택 + 드래그앤드롭. PDF(텍스트 층 있으면 pdf.js로 추출, 텍스트가 거의 없으면 스캔본으로 보고 쪽별 이미지로 렌더링해 `needsOcr`), DOCX(mammoth), HWPX(jszip으로 압축을 풀어 `Contents/section*.xml`의 텍스트 추출, 최선 노력), TXT/MD, 이미지(PNG/JPG: `needsOcr`). `.hwp`는 지원 불가이므로 PDF 변환 안내.
3. 폴더: 폴더 선택(`webkitdirectory`)과 폴더 드롭(`webkitGetAsEntry` 재귀). 전자소송 파일명 규칙 `사건번호_(yy.mm.dd)서면종류_NNNNNN.제목_제출자.pdf`, 서증은 `..._서증_NNNNNN.갑3-3_...`, 첨부는 `..._첨부_...` 를 해석해 role 을 정한다. 기본 포함: 소장, 답변서, 준비서면, 반소장, 항소장, 항소이유서, 변론요지서, 청구취지 및 청구원인 변경신청서, 참고서면. 기본 제외(skip): 서증, 첨부, 증거설명서, 증거신청, 문서제출명령(신청서·심문서 포함), 사실조회(서·회신·신청서), 보정명령, 송달, 위임장, 독촉. `record`(변론조서, 판결, 화해권고결정 등)는 목록에 보이되 기본 선택 해제(진술 여부 대조용). 규칙은 화면에서 고칠 수 있고 localStorage 에 기억한다. 건수가 많아도(수백 개) 목록이 버벅이지 않아야 한다.
4. 구글 드라이브: 폴더 또는 파일 링크(또는 ID) 붙여넣기 → `mcp` 능력의 구글 드라이브 커넥터(서버 표시명 `Google Drive`)로 목록을 가져와(검색 결과가 5건씩 페이지로 오므로 `pageToken` 반복, 진행 표시) 같은 분류 규칙을 적용하고, 선택한 파일을 `read_file_content`(텍스트 층 있는 PDF·문서)로 읽는다. 결과 텍스트가 사실상 비어 있으면(전자소송 워터마크 문구뿐 등) 스캔본으로 보고 `download_file_content`(base64)로 받아 pdf.js 로 쪽 이미지를 만든다. 커넥터 미연결·권한 오류·결과 과대 등은 오류 코드별로 안내하고 다른 경로(파일 올리기)를 권한다.
공통: 자료함 표에 파일별 분류·제출일·제출자·쪽수·상태(텍스트 OK/스캔본/미지원)를 보여 주고 사용자가 고친 뒤 "분석에 추가"를 누르게 한다(확인 단계). "원본 보관"(assets 능력, 쓰기 권한자만)과 "주민번호 가림"은 체크박스. 실패한 파일은 사유와 함께 남기고 나머지는 계속 처리한다.

### 5.1 파이프라인 요구
- 모든 Claude 호출은 `sample.json` 또는 `sample`을 쓰고 스키마·규칙을 프롬프트에 명시한다. 출력 JSON 은 검증 후 쓰며, 깨지면 1회 수선 재시도 후 사유를 보고한다.
- 진술 추출: 서면 1건씩(쪽 번호가 붙은 전문). 모델에게 quote 를 원문에서 그대로 복사하게 하고, 돌아온 quote 는 `SY.verifyQuote`로 대조해 통과한 것만 저장한다. 실패 건은 `rejected`로 사유(not_found/too_short)와 함께 반환, 화면에 건수를 보이고 원하면 보게 한다.
- 쟁점 매핑은 확정된 쟁점 목록(`C.issues`)의 id 만 허용. 어디에도 안 맞는 진술은 `issueIds:[]`로 두고 별도 "미분류"로 보인다.
- 변화 판정: 쟁점별로 서면 제출 순서에 따라 같은 편 진술을 잇고(`same`), 상대 진술과의 `cross` 자백후보를 따로 판정. 판정마다 basis 에 원문 근거(쪽수)를 쓴다. 근거가 약하면 review:true. 프롬프트에 3.5 정의와 "자백 후보는 후보일 뿐" 원칙을 넣는다.
- 사실 구성: 일자(확정일, 경, 기간), 원고/피고 서술, 다툼 여부, 증거, 출처 진술 id. 날짜 표기는 `SY.date` 규칙. 원문에 날짜가 없으면 사실을 만들지 않는다.
- 긴 기록(수십 건)은 서면 단위로 나눠 순차 실행하고, 중간 결과를 호출자가 저장할 수 있도록 단계마다 반환한다. 동시 호출은 최대 2.
- 새 서면 1건 추가 시(`addDocument`): 그 서면의 진술만 추출하고, 같은 쟁점의 기존 진술과 비교해 달라진 판정·사실만 병합한다.

### 5.2 저장 배치 (Store)
- `cases/{caseId}` 문서: 메타(title, caseNo, court, ourSide, parties, margins, issues, docs 목록(본문 제외), counts, updatedAt, schema)
- `cases/{caseId}/parts/{partId}` 문서들: `pages_{docId}_{seq}`(쪽 텍스트), `statements_{seq}`, `changes_{seq}`, `facts_{seq}`. 각 문서는 `{kind, docId?, seq, items|pages}`이고 직렬화 크기 200,000바이트 이하로 쪼갠다.

## 6. 화면 요구 (요약, 상세는 각 담당 지시서)
- 타임라인: 가운데 가로 시간선. 다툼 없는 사실은 선 위 점, 원고 주장은 위, 피고 주장은 아래. 점을 누르면 우측 창에 설명·근거 서면 원문·증거번호·양측 주장 변천. 일자 "○○경"은 흐린 구간, 기간은 선 위 막대, 양측 일자가 다르면 점선 연결. 실제 비율 보기/순서 등간격 보기 전환, 긴 공백은 물결선으로 줄임. 쟁점별 걸러 보기, 확대·축소, 기간 지정.
- 변천 지도: 세로 쟁점, 가로 서면(제출 순). 칸에 진술 요지, 변화 배지(색+기호+글자). 칸을 누르면 앞/뒤 서면 원문 인용 좌우 비교(쪽수 포함). 반박 재료 내보내기(체크한 판정을 문형으로). 자백후보는 후보 문구 고정, 변론조서 확인 필요 문구 병기.
- A4 별지: S자(첫 줄 좌→우, 반원으로 꺾여 둘째 줄 우→좌)와 Z자(모든 줄 좌→우, 줄 끝에서 다음 줄 처음으로 연결선) 전환 버튼. 원고 주장 항상 시간선 위, 피고 아래. 지점에 ①②③ 번호와 진행 화살표. 흑백: 다툼 없는 사실=채운 원, 원고 주장=빈 원+실선 줄기, 피고 주장=빈 마름모(또는 사각)+점선 줄기, 양측 일자 불일치 연결=점선 곡선. 표제 20자 안팎, 설명은 번호별 각주(별지 하단, SVG 안에 포함). 지점이 많으면 쪽을 나누고 "(계속)". 본문 폭 = 210 - 좌 - 우 (mm). 제출용(`submit`)은 다툼 없는 사실 + 우리 측 주장(증거번호 포함)만, 내부용(`internal`)은 세 줄 전부. 기본값은 `submit`.
- 껍데기: 상단에 사건 선택, 탭 `자료`, `쟁점`, `진술`, `연표`, `변천 지도`, `A4 별지`. 사건이 없으면 안내와 "새 사건" 버튼이 있는 빈 상태(무엇이 나타날지 설명). 샘플 데이터는 db 에 기획자가 따로 넣는다.
  - `자료` 탭: `SY.Ingest` 마운트 + 서면 목록(제출일·제출자·쪽수·상태) + "새 서면 추가 분석".
  - `쟁점` 탭: 쟁점 추가·수정·삭제·순서 변경, "쟁점 초안 만들기"(`draftIssues`) 후 사용자가 확정. 확정 전에는 진술 추출을 막는다.
  - `진술` 탭: 분석 실행 패널(단계 선택, 예상 호출 수, 진행률, 중지) + 진술 목록(서면·쪽·쟁점·요지·원문 인용, 인용 대조 결과, 삭제·쟁점 변경)으로 추출 결과 검수.
  - 분석 단계 순서: 서면 확인 → 쟁점 확정 → 진술 추출 → 검수 → 변화 판정 → 사실 구성 → 시각화. 각 단계 사이에 사용자 확인.
  - 파일 저장은 껍데기가 `downloads`로 처리(`SY.App.saveFile(filename, data)`), 각 Viz 는 콜백으로만 요청한다.

## 7. 시험·납품 규칙
- 각 담당은 자기 모듈 단독 시험 페이지(`test/harness_<이름>.html` 또는 Playwright 스크립트)를 만들어 `data/sample_min.json`으로 구동하고, 스크린샷(`test/shots/`)으로 데스크톱(1280px)과 휴대폰(400px) 모두 확인한다. 겹침, 잘림, 콘솔 오류, 가로 스크롤을 직접 점검하고 고친 뒤 납품한다.
- 순수 함수(파일명 해석, 날짜 척도, 레이아웃 계산, 인용 대조, JSON 수선 등)는 node 단위 시험(`test/unit_<이름>.js`)을 쓰고 통과 결과를 보고서에 붙인다.
- 보고서(최종 응답)에 반드시 넣을 것: 만든 파일 목록, 공개 API 가 설계서와 다른 점(있으면 이유), 시험한 것과 못 한 것(특히 실제 아티팩트 환경에서만 확인 가능한 것), 알려진 한계, 설계서 질의.
- 시험하지 않은 것을 시험했다고 쓰지 마라. 못 한 것은 못 했다고 써라.
