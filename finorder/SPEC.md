# 금융거래정보 제출명령 작성기 명세서 (팀장 확정본)

작성: 팀장(메인 세션). 담당: 조사팀 3명, 코드, 디자인. 담당끼리는 서로 호출하지 못한다. 모든 전달은 팀장을 거친다.
산출물은 claude.ai 아티팩트 한 장(단일 HTML)이다. 직원이 이 화면에서 신청서 내용을 확인하고 전자소송에 옮겨 적으며, 필요하면 DOCX로 저장한다.

## 0. 공통 금지·원칙
1. 법조문·주소·우편번호·수치는 검색으로 확인한 것만 쓴다. 기억에 의존한 기재, 추정, 창작 금지. 확인 못 하면 비워 두고 "미확인"으로 표시한다.
2. 문서 본문과 화면 문구에 마크다운 강조(별표, 밑줄 문법)와 HTML 태그 문자열을 노출하지 않는다. 화면 문구는 간결한 경어체.
3. 특정 법률사무소의 명칭·변호사 이름·사건 정보를 코드·데이터·문구·테스트에 넣지 않는다. 테스트 입력은 가상 값(홍길동, 김영희 등)만 쓴다.
4. 주민등록번호와 이름은 어떤 저장소(db, localStorage)에도 저장하지 않는다. Claude(sample) 호출에도 보내지 않는다.
5. git 명령은 쓰지 않는다(커밋은 팀장이 한다). 자기 담당 파일만 쓴다.
6. 아티팩트 제약: `alert/confirm/prompt` 없음(화면 안 확인 단계로 대체), `<a download>` 불가(파일 저장은 `downloads` 기능), `window.print` 불가, 외부 네트워크 불가, 외부 스크립트는 cdnjs 등 허용 목록만(우리는 DOCX 라이브러리를 HTML에 직접 내장), 글꼴은 Google Fonts만, 모든 색은 `:root` 토큰 + 다크 모드 2벌, 폭 400px에서 가로 스크롤 없음.

## 1. 사용자 요구 (원문 의도 그대로)
- 입력: 사건번호, 사건명, 원고·피고 이름, 우리 측 당사자 선택(원고/피고).
- 1. 대상기관: 1금융권·우체국·인터넷은행·2금융권 중 많이 쓰는 곳을 체크. 정확한 명칭과 주소를 검색해 목록화해 두고, 체크한 곳만 1.에 가나다 순서로 기재.
- 2. 명의인: 이름과 주민등록번호(필수) 입력칸.
- 3. 요구대상 거래기간: 달력 선택 + 직접 입력.
- 4. 사용목적: 이혼 재산분할은 고정 문구, 그 밖의 사건은 직접 작성 후 Claude가 다듬기.
- 5. 요구하는 거래정보 등의 내용: 명의인 이름·주민등록번호가 표시됨.
- 아래 날짜, 대리인, 변호사, 사무소명, 법원명(귀중)은 출력하지 않는다.
- DOCX 저장. 기관 주소 최신화 버튼. 목록에 없는 기관을 입력하면 목록에 추가되어 다음에도 쓸 수 있음.
- 팀장 추가 판단(팀장이 보강한 항목): 명의인 복수, 명의인 지위(원고/피고/제3자), 기관 유형별 "귀 은행/귀 기관" 문구, 항목별 복사 버튼(전자소송 입력용), 미입력 항목 점검, 기관 선택 세트 저장, 초기화.

## 2. 출력 문서 (원본 양식 그대로)
아래가 DOCX와 화면 미리보기가 공유하는 문안이다. `{}`는 입력값이다. 원본 양식을 한 글자도 바꾸지 않는다.

```
금융거래정보 제출명령 신청서                         (가운데, 굵게, 18pt)

사    건    {사건번호} {사건명}
원    고    {원고 이름}
피    고    {피고 이름}

  위 사건에 관하여 {우리 측 지위} {우리 측 이름}의 소송대리인은 금융실명거래 및 비밀보장에 관한 법률 제4조 제1항에 의하여 다음과 같이 금융거래정보제출명령을 신청합니다.

                     다      음                       (가운데, 굵게)

1. 대상기관의 명칭 및 주소                            (굵게)
가. {기관 명칭}
({우편번호}) {도로명주소} ({참고})
나. {기관 명칭}
...
2. 명의인의 인적사항
{이름} ({주민등록번호})            (명의인마다 한 줄)
3. 요구대상 거래기간
{YYYY}. {M}. {D}.부터 {YYYY}. {M}. {D}.까지     (월·일 앞자리 0 없음)
4. 사용목적
{사용목적 문장}
5. 요구하는 거래정보 등의 내용
가. 귀 은행에 {이름} ({주민등록번호})을 명의자로 하는 계좌(예금, 적금, 보험, 연금, 신탁, 펀드, 외환거래, 대출 등 일체의 상품)가 개설되어 있는지(해지계좌 포함)
나. (있다면)
1) 전 계좌목록, 계좌번호 전체, 상품명, 개설일 및 해지일
2) 각 상품의 [요구대상거래기간의 거래내역](송금 상대방, 상대방 계좌번호 및 은행 등 일체의 정보)을 회신하여 주시기 바랍니다(복수인 경우 각 계좌 모두).
3) 위 각 항목은 PDF와 함께 XLSX 또는 CSV 형식의 전산자료로 제출하여 주시고, 거래코드의 설명과 통화·금액단위를 표시하여 주시기 바랍니다.
```
- `[요구대상거래기간의 거래내역]`은 밑줄(원본 양식과 동일). 대괄호는 밑줄 구간을 가리키는 표기이며 문서에는 넣지 않는다(원본 양식에 대괄호 없음). 다른 곳에는 밑줄 없음.
- 끝: 날짜, "소송대리인", 사무소명, 변호사명, 담당자명, "○○법원 귀중"은 출력하지 않는다. 문서는 5.의 3) 줄에서 끝난다.
- 기관 순번: 가, 나, 다, 라, 마, 바, 사, 아, 자, 차, 카, 타, 파, 하, 거, 너, 더, 러, 머, 버, 서, 어, 저, 처, 커, 터, 퍼, 허 (28개). 28개 초과 시 "①" 아닌 "가1" 같은 임의 표기 금지: 29번째부터 "(29)"처럼 숫자 표기.
- 주소 조립: `({zip}) {addr}` + (참고가 있으면 ` ({note})`). 끝에 마침표를 붙이지 않는다.
- 4. 사용목적
  - 이혼 재산분할 고정 문구: `{대상} 명의의 재산을 확인하여 재산분할 대상에 포함시키기 위함입니다.` `{대상}`은 명의인 지위로 만든다: 원고, 피고, 제3자는 이름. 지위가 둘 이상이면 "원고 및 피고"처럼 "및"으로 잇는다(동일 지위 중복 제거, 입력 순서).
  - 그 밖의 사건: 직원이 쓴 문장(다듬기 후 적용한 문장 포함).
- 5.가의 "귀 은행": 선택 기관이 모두 `wording:"은행"`이면 "귀 은행에", 하나라도 `"기관"`이면 "귀 기관에". 5.가 위쪽에 수동 선택(자동/귀 은행/귀 기관/귀 사)을 둔다. 원본 양식은 우체국을 포함해도 "귀 은행"이므로 우체국·인터넷은행·저축은행은 `"은행"`이다.
- 5.가 명의인 표기: `{이름} ({주민번호})`. 명의인이 여럿이면 `A (번호), B (번호)` 뒤에 "을/를 각 명의자로 하는"으로 쓴다. 한 명이면 "을/를 명의자로 하는". 조사(을/를)는 마지막 명의인 이름의 받침으로 정한다(받침 있으면 "을", 없으면 "를"; 이름이 한글이 아니면 "을").
- 번호 서식: 숫자 13자리면 `######-#######`, 10자리면 `###-##-#####`(사업자등록번호), 그 외는 입력 그대로. 입력 중 자동 하이픈. 법인등록번호(13자리)도 같은 서식.
- 일자 서식: `2023. 9. 1.` (월·일 0 채움 없음).
- 용지·서체: A4, 상하좌우 여백 위 30mm·아래 25mm·좌우 30mm. 서체 `바탕체`(eastAsia·ascii 모두), 본문 12pt, 줄간격 200%. 양쪽 정렬은 도입 문단과 5.의 긴 문장에만. 제목 18pt 굵게 가운데. 소제목(1.~5.) 굵게. 내용 단락은 위아래 여백으로 구분(빈 문단 쓰지 않음).
- 사건·원고·피고 줄은 탭 정렬(라벨 폭 동일, 값 시작 위치 동일).
- 5.의 단계 들여쓰기: 가./나. 는 왼쪽 440twip·내어쓰기 440, 1) 2) 3) 은 왼쪽 880·내어쓰기 440.
- 파일명: `금융거래정보제출명령신청서_{사건번호 또는 날짜}.docx`. 파일명에 이름·주민번호 금지. 사건번호의 파일명 금지 문자는 `_`로 바꾼다.

## 3. 기관 데이터 (`data/institutions.json`)

```jsonc
{
  "schema": 1,
  "asOf": "2026-10-02",
  "categories": [
    {"id":"bank","label":"시중·특수·지방은행"},
    {"id":"post","label":"우체국"},
    {"id":"inet","label":"인터넷전문은행"},
    {"id":"mutual","label":"상호금융"},
    {"id":"savings","label":"저축은행"},
    {"id":"securities","label":"증권사"},
    {"id":"insurance","label":"보험사"},
    {"id":"card","label":"카드사"}
  ],
  "institutions": [{
    "id": "kookmin",                 // 영문 소문자·숫자·하이픈. 고유
    "cat": "bank",                    // categories.id 중 하나
    "short": "국민은행",              // 체크 버튼에 보이는 이름(통용 명칭)
    "name": "주식회사 국민은행",      // 신청서에 쓰는 법적 상호 표기(등기·공시와 일치)
    "aliases": ["KB국민은행","KB","국민"],   // 검색용
    "wording": "은행",                // "은행" | "기관"
    "popular": true,                  // 많이 쓰는 곳 우선 노출
    "zip": "07331",                   // 5자리 새우편번호. 확인 못 하면 ""
    "addr": "서울특별시 영등포구 국제금융로8길 26",   // 도로명주소(번지·층 포함, 참고 괄호 제외). 확인 못 하면 ""
    "note": "여의도동",               // 참고 괄호 안 내용(법정동, 건물명). 없으면 ""
    "status": "verified",             // verified | user_provided | needs_check
    "checkedAt": "2026-10-02",
    "sources": [{"label":"공식 홈페이지 오시는 길","url":"https://..."}],
    "memo": ""                        // 출처가 있는 특이사항만. 없으면 ""
  }]
}
```
- `addr`는 법인 등기부상 본점 소재지(공시·약관의 "본점 소재지" 표기)를 쓴다. 대표 사무소·영업점·별관 주소가 다르면 `memo`에만 적는다.
- `verified`: 도로명주소가 서로 독립된 출처 2곳 이상(공식 홈페이지·약관·전자공시·금융감독원 등)에서 일치하고, 우편번호가 공식 페이지 또는 정부 도로명주소 DB 1곳 이상에서 확인된 경우만.
- `user_provided`: 사용자가 제공한 양식(2026. 9. 작성본)의 주소를 그대로 쓴 항목. 공식 출처로 재확인하기 전 상태이며 일반 항목처럼 선택·출력된다. 화면 배지는 "양식 기준". `sources`에 `{"label":"사용자 제공 양식(2026. 9. 작성본)","url":""}`를 둔다(이 경우에 한해 url 빈 문자열 허용).
- `needs_check`: 확인 못 한 항목. `addr`·`zip`을 비운다(추정 기재 금지). 화면은 선택 시 주소 입력을 요구하고, 입력값은 공용 목록(`override`)에 저장되어 다음부터 쓸 수 있다. 화면 배지는 "주소 미확인".
- 환경 제약: 이 환경에서는 웹 페이지 원문 열람(WebFetch)이 전 도메인에서 차단되어 있어 대부분의 기관이 `needs_check`로 남는다. 검색 요약(AI 요약문, 위키·채용·사업자정보 사이트)은 출처로 인정하지 않는다.
- 사용자가 제공한 양식(2026. 9. 작성본)의 9곳 주소는 시작 자료다. 검색 결과와 다르면 `memo`에 두 값을 모두 적고 팀장에게 보고한다(임의로 덮어쓰지 않는다).
  - 국민은행 (07331) 서울특별시 영등포구 국제금융로8길 26 (여의도동)
  - 카카오뱅크 (13529) 경기도 성남시 분당구 분당내곡로 131, 11층(백현동, 판교테크원)
  - 토스뱅크 (06133) 서울특별시 강남구 테헤란로 131, 13층(역삼동, 한국지식재산센터)
  - 우리은행 (04632) 서울특별시 중구 소공로 51 (회현동1가)
  - 케이뱅크 (04548) 서울특별시 중구 을지로 170 (을지로4가, 을지트윈타워)
  - 농협은행 주식회사 (04517) 서울특별시 중구 통일로 120(충정로1가)
  - 주식회사 경남은행 (51316) 경상남도 창원시 마산회원구 3·15대로 642 (석전동)
  - 주식회사 신한은행 (04513) 서울특별시 중구 세종대로9길 20 (태평로2가)
  - 우정사업본부(우체국예금) (30114) 세종특별자치시 도움5로 19 (어진동)
- 앱은 이 파일을 `__DATA__` 자리에 내장한다(`build.py`). 사용자 추가·수정분은 앱이 별도 저장소에 두고 병합한다(4장).

## 4. 앱 동작 계약 (코드 담당)

### 상태와 저장
- `state` 한 객체가 화면의 단일 원천이다. 입력 이벤트마다 `render()`로 미리보기·점검 목록·버튼 상태를 갱신한다.
- 저장소(`Store`): 기관 추가·수정분과 선택 세트만 저장한다. 이름·주민번호·사건번호·사건명은 저장하지 않는다.
  - `claude.use("db")`가 있으면 컬렉션 `institutions`(문서 id = 기관 id, 필드는 위 스키마 + `origin:"custom"|"override"`, `updatedAt`, `updatedBy`)와 `sets`(문서 = `{name, ids[]}`)를 쓴다. 쓰기 권한이 없어 거부되면 localStorage(`finorder.v1.institutions`, `finorder.v1.sets`)로 저장하고 안내 문구를 표시한다.
  - `db`가 null이면 localStorage만 쓴다. localStorage 접근은 모두 try/catch.
  - 병합: 내장 목록 위에 `override`를 덮고 `custom`을 뒤에 붙인다. `custom`은 "추가" 배지와 삭제 버튼을 갖는다.
- 기관 선택은 선택 순서를 유지한다. 선택 목록(`#inst-selected`)에서 위/아래 이동, 제거. 문서의 가나다 순서는 이 순서를 따른다.
- 선택한 기관의 `addr`가 비어 있으면(needs_check) 그 줄에 주소 입력칸을 띄우고, 입력값은 `override`로 저장한다. 비어 있는 동안 미입력 점검에 걸린다.

### 점검(필수 항목)
미입력 목록(`#missing-list`)에 표시한다: 사건번호, 사건명, 원고 이름, 피고 이름, 우리 측 선택, 기관 1곳 이상, 기관 주소 누락, 명의인 이름·번호(각 행), 번호 자릿수 이상(13 또는 10자리 아님), 기간 시작·종료, 시작>종료, 사용목적(기타일 때). 번호는 체크섬 검증을 하지 않는다(2020년 10월 이후 부여 번호는 체크섬이 맞지 않는다). 자릿수만 본다.
DOCX 저장은 미입력이 있어도 가능하되, 첫 클릭에서 "미입력 N건 — 한 번 더 누르면 그대로 저장합니다"로 바꾸고 5초 안에 다시 누르면 저장한다.

### 거래기간
- 달력: `<input type="date">` 두 개(시작, 종료). 프리셋 버튼: 최근 3년·5년·10년(종료=오늘, 시작=오늘에서 N년 전), 종료일 오늘. 프리셋은 시작·종료만 채우고 사용자가 다시 고칠 수 있다.
- 직접 입력: 시작·종료를 `YYYY.M.D` 계열 텍스트로 직접 입력하는 모드(구분자 `.` `-` `/` 공백 허용, 공백 제거 후 해석). 해석 실패 시 오류 문구.
- 두 모드는 같은 `state.period.start/end`(ISO 문자열)를 공유한다. 출력은 `2023. 9. 1.부터 2026. 9. 1.까지`.
- 종료일 기본값: 오늘. 시작일 기본값: 비움(직원이 고름).

### 사용목적
- `이혼 재산분할`: 고정 문구 표시(읽기 전용, 대상 표기는 명의인 지위로 자동).
- `그 밖의 사건`: 직원이 쓴 초안을 `다듬기`로 `sample.json` 호출. 프롬프트 요건:
  - 입력은 초안과 사건명(선택)만 보낸다. 이름·번호·사건번호는 보내지 않는다.
  - 역할: 법원 제출명령 신청서의 "사용목적" 문장 다듬기. 합니다체 단정문, 1~2문장, "~하기 위함입니다."로 끝맺음. 초안에 없는 사실·법조문·판례·금액을 추가하지 않는다. 명의인 지칭은 초안의 표현 유지. 군더더기·번역투 제거.
  - 응답 JSON: `{"text":"다듬은 문장","changes":["바꾼 점 한 줄", ...]}`.
  - 결과는 원문 대비 화면(`#polish-result`)에 보여주고 `적용`/`취소`를 둔다. 자동 적용 금지. `sample`이 null이거나 거절되면 다듬기 버튼을 숨기고 직접 작성만 쓴다. 호출은 `modelTier:"quick"`, 중단 버튼 제공.

### 기관 추가
- `#add-inst` 폼(명칭, 우편번호 5자리, 도로명주소, 참고, 분류, 문구 구분). 저장하면 `custom`으로 저장·목록 반영·자동 선택. 필수: 명칭, 우편번호, 주소. 같은 명칭이 있으면 중복 안내.
- 검색창에서 결과가 0건이면 "목록에 없음 — '{검색어}' 추가" 버튼이 폼을 검색어로 채워 연다.

### 주소 최신화 (아티팩트에서 가능한 범위)
아티팩트의 Claude 호출(`sample`)은 인터넷 검색을 못 하고 페이지 네트워크도 막혀 있으므로, 앱이 직접 검색해 갱신하는 것은 불가능하다. 그래서 다음 흐름으로 만든다.
1. `최신화` 버튼 → 패널(`#update-panel`)이 열린다. 패널 상단에 기관별 조사일·출처 링크·상태 요약.
2. `요청문 복사`: 현재 목록(id, 명칭, 주소, 우편번호)과 출력 JSON 스키마, 검증 규칙(독립 출처 2곳, 기억 금지, 출처 URL 필수, 확인 못 하면 비움)을 담은 요청문을 클립보드에 복사한다. 직원은 이 요청문을 웹 검색이 되는 Claude(Claude Code 세션 또는 웹 검색을 켠 대화)에 붙여 넣는다.
3. `결과 붙여넣기` 입력칸(`#upd-paste`)에 Claude가 돌려준 JSON을 붙여 넣고 `변경 확인`을 누르면 기존값과 새값을 비교표(`#upd-diff`)로 보여준다(변경, 신규, 동일, 형식 오류). 항목별 체크박스로 고르고 `선택 적용`을 누르면 `override`로 저장하며 `checkedAt`·`sources`를 갱신한다.
4. 검증 규칙: 우편번호 5자리 숫자, 주소 비어 있지 않음, `sources` 1개 이상이어야 적용 가능. 위반 항목은 적용 불가로 표시.
5. 패널에 한 줄 안내: 앱 안에서는 검색할 수 없고, 팀장 세션(Claude Code)에서 "금융기관 주소 최신화"를 요청하면 데이터 파일과 아티팩트를 함께 갱신한다는 점.

### 기타 동작
- 복사 버튼: 미리보기 섹션별(1~5) 및 전체. `navigator.clipboard.writeText` 시도, 거부되면 텍스트를 선택 상태로 보여 주고 "직접 복사해 주십시오" 표시. 복사 텍스트는 문서 문안과 같은 줄바꿈 구조의 순수 텍스트.
- DOCX: `docx@8.5.0`(전역 `docx`, HTML에 내장)으로 `Packer.toBlob`. 저장은 `claude.use("downloads")`의 `save({filename, data: blob})`. `downloads`가 null이면 안내 문구만 표시(링크 다운로드는 아티팩트에서 동작하지 않음). 단, 로컬 테스트(`window.claude` 없음)에서는 `<a download>` 폴백을 써도 된다.
- 초기화 버튼: 화면 안 2단계 확인 후 입력값 전체를 지운다(기관 목록·세트는 유지).
- 모든 DOM 접근은 id 존재 여부를 방어적으로 처리한다(없으면 건너뜀).
- 접근성: 모든 입력에 label, 포커스 표시, 체크 버튼은 `<input type="checkbox">` 기반.
- 순수 함수(문서 조립 `composeDoc(state)`, 번호 서식, 날짜 서식, 조사 선택, 가나다 순번)는 DOM과 분리하고 `window.__finorder`에 노출한다(테스트용).

### 문서 모델 (미리보기·복사·DOCX 공통)
`composeDoc(state)`는 블록 배열을 돌려준다.
```
{k:"title", text}
{k:"case", label, value}
{k:"intro", text}
{k:"next", text:"다      음"}
{k:"h", sec:1..5, text:"1. 대상기관의 명칭 및 주소"}
{k:"inst", sec:1, letter:"가", name, addr}
{k:"holder", sec:2, text}
{k:"p", sec:3|4, text}
{k:"l1", sec:5, marker:"가.", runs:[{t, u?}]}
{k:"l2", sec:5, marker:"1)", runs:[{t, u?}]}
```
DOCX 렌더러와 미리보기 렌더러가 같은 블록을 소비한다. 복사 텍스트도 같은 블록에서 만든다.

## 5. DOM 계약 (디자인 담당이 `src/template.html`에 만들고 코드 담당이 `src/app.js`에서 쓴다)

`<title>`은 `금융거래정보 제출명령 작성기`. 아래 id는 모두 존재해야 한다. 추가 요소는 자유롭게 넣되 아래 id·클래스·data 속성은 이름을 바꾸지 않는다.

정적(디자인이 마크업 작성):
| id | 요소 | 설명 |
|---|---|---|
| `st-db`, `st-claude` | span | 연결 상태 알약. JS가 클래스 `on`/`off`와 텍스트를 바꾼다 |
| `tab-form`, `tab-preview` | button | 좁은 화면 전환 탭. JS가 `aria-selected`를 바꾼다 |
| `pane-form`, `pane-preview` | section | 작성 영역, 미리보기 영역. JS가 좁은 화면에서 `hidden` 토글 |
| `case-no`, `case-name` | input text | 사건번호, 사건명 |
| `plaintiff`, `defendant` | input text | 원고·피고 이름 |
| `ours-plaintiff`, `ours-defendant` | input radio (name=ours) | 우리 측 |
| `inst-search` | input search | 기관 검색(초성 검색 가능) |
| `inst-cats` | div | JS가 분류 탭/섹션을 채운다 |
| `inst-list` | div | JS가 체크 항목을 채운다 |
| `inst-count` | span | 선택 수 |
| `inst-selected` | ol | JS가 선택 목록을 채운다(순서 이동·제거) |
| `btn-add-inst-open`, `add-inst` | button, form/div | 기관 추가 열기, 폼(초기 hidden) |
| `add-name`, `add-zip`, `add-addr`, `add-note`, `add-cat`, `add-wording`, `add-save`, `add-cancel` | input/select/button | 기관 추가 필드 |
| `btn-update-open`, `update-panel` | button, div | 최신화 열기, 패널(초기 hidden) |
| `upd-summary`, `upd-copy`, `upd-paste`, `upd-check`, `upd-diff`, `upd-apply`, `upd-close` | div/button/textarea | 최신화 패널 |
| `set-name`, `set-save`, `set-list` | input/button/div | 선택 세트 저장·불러오기(`set-list`는 JS가 채움) |
| `holders` | div | JS가 명의인 행을 채운다 |
| `btn-add-holder` | button | 명의인 추가 |
| `per-mode-cal`, `per-mode-text` | input radio (name=permode) | 달력/직접 입력 |
| `per-presets` | div | 프리셋 버튼 컨테이너. 버튼은 `data-preset="3y|5y|10y|today"` |
| `per-start`, `per-end` | input date | 달력 모드 |
| `per-text-start`, `per-text-end` | input text | 직접 입력 모드 |
| `per-note` | p | 기간 오류·안내 문구 |
| `purpose-divorce`, `purpose-other` | input radio (name=purpose) | 사용목적 유형 |
| `purpose-fixed` | p | 이혼 재산분할 고정 문구 표시 |
| `purpose-text` | textarea | 그 밖의 사건 직접 입력 |
| `btn-polish`, `btn-polish-stop`, `polish-result` | button, button, div | 다듬기, 중단, 결과 |
| `wording` | select | auto / 은행 / 기관 / 사 |
| `doc-preview` | div | 용지 모양 미리보기. JS가 블록을 렌더 |
| `missing-list` | ul | 미입력 점검 목록 |
| `btn-copy-all`, `btn-docx`, `btn-reset` | button | 전체 복사, DOCX 저장, 초기화 |
| `toast` | div | 짧은 알림 |

동적(코드가 만드는 조각, 디자인이 CSS로 꾸민다):
- 분류 탭(`#inst-cats` 안): `<button class="cat-tab" role="tab" aria-selected data-cat="bank">시중·특수·지방은행 <span class="cat-n">3/16</span></button>`, 그리고 `<button class="cat-all" data-cat="bank">전체 선택</button>`, `<button class="cat-none" data-cat="bank">해제</button>`
- 기관 체크 항목(`#inst-list` 안): `<label class="inst-item" data-id="kookmin" data-checked="true|false" data-status="verified|needs_check" data-origin="builtin|custom|override"><input type="checkbox" class="inst-cb"><span class="inst-short">국민은행</span><span class="inst-sub">주식회사 국민은행</span><span class="badge">추가</span></label>`. 인기 항목 그룹 머리글 `<div class="inst-group">자주 쓰는 곳</div>`.
- 선택 목록 한 줄(`#inst-selected` 안): `<li class="sel-row" data-id=""><span class="sel-letter">가.</span><div class="sel-main"><b class="sel-name"></b><span class="sel-addr"></span></div><div class="sel-ctl"><button class="sel-up" aria-label="위로">↑</button><button class="sel-down" aria-label="아래로">↓</button><button class="sel-del" aria-label="제거">✕</button></div></li>`. 주소가 비어 있으면 `.sel-addr` 대신 `<div class="sel-fill"><input class="sel-fill-zip"><input class="sel-fill-addr"><button class="sel-fill-save">저장</button></div>`.
- 명의인 행(`#holders` 안): `<div class="holder" data-i="0"><select class="h-role"><option value="plaintiff">원고</option><option value="defendant">피고</option><option value="third">제3자</option></select><input class="h-name"><input class="h-no" inputmode="numeric"><button class="h-del">삭제</button></div>`. 오류 시 `.h-no`에 `aria-invalid="true"`.
- 미리보기(`#doc-preview` 안): 블록마다 `div.d-title`, `div.d-case`(`.d-label`, `.d-value`), `p.d-intro`, `div.d-next`, `h3.d-h[data-sec]`, `div.d-inst`(`.d-letter`, `.d-name`, `.d-addr`), `p.d-holder`, `p.d-p`, `p.d-l1`(`.d-mk` 마커), `p.d-l2`, `u`(밑줄 구간). 섹션 복사 버튼은 `h3.d-h` 안에 `<button class="btn-copy" data-copy="1">복사</button>`. 미입력으로 비어 있는 값은 `span.d-blank`(예: 「○○○」 자리표시)로 표시.
- 미입력 점검 항목: `<li class="miss-item" data-sev="req|warn">`.
- 최신화 비교표(`#upd-diff`): `<table class="diff-table">`, 행 `tr[data-kind="changed|new|same|invalid"]`, 체크 `input.diff-cb`.
- 세트 목록(`#set-list`): `<span class="set-chip"><button class="set-load">이름</button><button class="set-del" aria-label="삭제">✕</button></span>`.
- 기타 공통: `.btn`, `.btn.primary`, `.btn.ghost`, `.btn.danger`, `.field`, `.hint`, `.err`, `.card`, `.step`(작성 영역의 각 단계 섹션, `data-step="case|inst|holder|period|purpose"`), `.pill.on|.off`.

## 6. 디자인 지침 (디자인 담당)
- 대상: 법률사무소 사무장·직원이 하루 여러 번 쓰는 업무 도구. 조용하고 정확한 인상, 높은 가독성, 정보 밀도 있는 UI. 장식 최소.
- 레이아웃: 데스크톱은 좌측 작성(단계형 카드: 사건 → 대상기관 → 명의인 → 거래기간 → 사용목적), 우측은 용지 모양 미리보기가 상단 고정(sticky)이고 그 아래에 점검 목록·복사·DOCX 버튼. 폭 900px 이하는 탭(작성/미리보기)으로 전환. 단계 번호는 신청서 항목 번호(1.~4.)와 맞춘다. 사건 정보는 번호 없는 머리 카드.
- 미리보기는 실제 문서 느낌(흰 용지, 바탕체 계열 `Noto Serif KR`·`Nanum Myeongjo` 폴백, 12pt 비율, 줄간격 2.0)으로, 다크 모드에서도 용지는 밝게 유지해 문서임을 알린다(용지 색 토큰을 별도로 둔다).
- 서체: UI는 `IBM Plex Sans KR`(기존 도구와 통일), 문서는 `Noto Serif KR`. 숫자 열은 `tabular-nums`.
- 색: 기존 원고실 토큰(`app/template.html` 참고)을 이어 받아 같은 도구 모음으로 보이게 하되 복사하지 말고 이 도구에 맞게 정리한다. 상태색(성공/주의/오류)은 강조색과 분리. 다크 모드 2벌.
- 기관 체크 항목은 칩 형태로 눈에 띄게 선택됨을 표시(체크 + 배경 변화), `needs_check`는 주의 배지, `custom`은 "추가" 배지. 한 줄에 여러 개가 흐르도록 flex-wrap, 400px에서도 터치하기 쉬운 높이(44px 이상).
- 선택 목록은 문서에 나올 순서를 보여 주는 영역이므로 가나다 순번이 눈에 띄어야 한다.
- 미입력 점검 목록은 항목이 0개일 때 "제출 전 점검 이상 없음"을 상태색으로 표시.
- `prefers-reduced-motion` 존중, 키보드 포커스 표시, 한 화면에 가로 스크롤 없음.

## 7. 파일·빌드
- `src/template.html`(디자인), `src/style.css`(디자인), `src/app.js`(코드).
- `build.py`(팀장): `template.html`의 자리표시 `/*__CSS__*/`, `/*__DOCX__*/`, `/*__DATA__*/`, `/*__APP__*/`를 치환해 `dist/finorder.html`(아티팩트 게시용 조각)과 `dist/finorder.standalone.html`(doctype 포함, 로컬 시험용)을 만든다. 템플릿에는 이 네 자리표시를 각각 `<style>`/`<script>` 안에 한 번씩 둔다:
  ```html
  <style>/*__CSS__*/</style>
  ...
  <script>/*__DOCX__*/</script>
  <script>window.__INSTITUTIONS__ = /*__DATA__*/;</script>
  <script>/*__APP__*/</script>
  ```
- 디자인 담당은 `<title>`, 글꼴 `<link>`, 마크업을 `template.html`에 쓰고 CSS는 `style.css`에 쓴다(템플릿에 `<style>` 직접 작성 금지, 자리표시만).
- 코드 담당은 `app.js`만 쓴다. 템플릿이 필요한 id를 빠뜨렸으면 `src/NEEDS.md`에 요청을 적는다(템플릿을 직접 고치지 않는다).
