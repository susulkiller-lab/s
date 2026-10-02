# 금융거래정보 제출명령 작성기

사건번호·당사자·대상기관·명의인·거래기간·사용목적을 입력하면 신청서 문안을 만들고, 전자소송 입력용 항목별 복사와 DOCX 저장을 지원하는 도구다. 블로그 하네스(`app/`, `kit/`)와는 별개다. 명세는 `SPEC.md`.

## 구성
| 파일 | 내용 |
|---|---|
| `SPEC.md` | 출력 문서·기관 데이터·동작·DOM 계약 명세 |
| `src/template.html`, `src/style.css` | 화면 마크업과 스타일 |
| `src/app.js` | 문서 조립, 기관 목록, 저장, DOCX 생성 등 앱 코드 |
| `data/institutions.json` | 기관 목록 병합본(앱에 내장되는 원본) |
| `data/raw/*.json`, `*.md` | 조사팀 원자료와 조사 로그(후보 값은 여기에만 남김) |
| `vendor/docx-8.5.0.iife.js` | DOCX 생성 라이브러리(npm `docx@8.5.0` 번들, HTML에 직접 내장) |
| `merge_data.py` | `data/raw`를 검증·병합해 `data/institutions.json` 생성 |
| `build.py` | 템플릿에 CSS·라이브러리·데이터·앱 코드를 넣어 `dist/` 생성 |
| `tests/` | 단위·DOCX·DOM 시험(`tests/run-all.sh`) |

## 빌드와 게시
```
python3 finorder/merge_data.py     # 기관 데이터가 바뀐 경우
python3 finorder/build.py          # dist/finorder.html(아티팩트용), dist/finorder.standalone.html(로컬 시험용)
```
아티팩트로 게시할 때는 `dist/finorder.html`을 올리고 기능 선언은 `sample`, `db`, `user`, `downloads`를 쓴다. 규칙·데이터를 바꾸면 같은 URL로 재게시한다.

시험:
```
NODE_PATH=<jsdom이 설치된 node_modules> sh finorder/tests/run-all.sh
```
컨테이너 로케일이 `C`이면 브라우저 시험에서 한글 파일명이 `download`로 저장되므로 `LC_ALL=C.UTF-8`로 실행한다.

## 기관 주소 데이터 정책
- `user_provided`: 사용자가 제공한 양식(2026. 9. 작성본)의 9곳. 바로 쓸 수 있고 화면에 "양식 기준"으로 표시된다.
- `needs_check`: 주소를 원문으로 확인하지 못한 곳. 명칭만 두고 주소·우편번호는 비워 둔다. 직원이 선택하면 입력행이 뜨고, 확인한 주소를 한 번 저장하면 공용 목록에 남아 이후 일반 항목처럼 쓰인다.
- `verified`: 독립 출처 2곳 이상을 실제로 열어 확인한 곳(현재 0곳).
- 검색 결과의 AI 요약문, 위키·채용·사업자정보 사이트는 출처로 인정하지 않는다. 조사 중 요약에서 얻은 후보 값은 `data/raw/*.md`에만 두고 앱 데이터에는 넣지 않는다.
- 이 환경(웹 원문 열람 차단)에서는 검증이 막혀 있다. 네트워크 허용 도메인(각 기관 공식 홈페이지, `dart.fss.or.kr`, `www.juso.go.kr`, `www.epost.go.kr`)과 검색 한도가 열린 세션에서 "금융기관 주소 최신화"를 요청하면 조사팀을 다시 돌려 `needs_check`를 채운다.

## 앱 안의 최신화 버튼
아티팩트의 Claude 호출은 인터넷 검색을 못 하므로 앱이 직접 검색해 갱신할 수는 없다. 최신화 패널은 현재 목록과 검증 규칙이 담긴 요청문을 복사하고, 웹 검색이 되는 Claude가 돌려준 JSON을 붙여 넣으면 기존 값과 비교해 선택 적용하는 흐름이다. 출처 URL이 없거나 형식이 틀린 항목은 적용되지 않는다.

## 개인정보
이름·주민등록번호·사건번호·사건명은 어떤 저장소(db, localStorage)에도 저장하지 않고, Claude 호출에도 보내지 않는다(사용목적 다듬기는 초안에서 이름·번호를 치환한 뒤 보낸다). 저장하는 것은 기관 추가·수정분과 선택 세트뿐이다.
