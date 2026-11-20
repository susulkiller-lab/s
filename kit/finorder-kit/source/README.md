# 작성기 원본(관리자용)

이 폴더는 finorder.html을 만든 원본이다. 직원 설치에는 쓰지 않는다. 설치는 상위 폴더의 CLAUDE.md 절차(finorder.html 게시)로 한다.

## 구성
- SPEC.md: 출력 문서(은행·금융기관용, 보험사용), 데이터, 동작, 화면 계약 명세
- src/template.html, src/style.css, src/app.js: 화면과 동작
- data/institutions.json: 기관 목록(70곳, 우편번호 없음). 앱에 내장되는 원본
- data/raw/user_list.json: 사용자 제공 주소 목록(기준일 2026. 10. 2.). 주소의 출처
- vendor/docx-8.5.0.iife.js: DOCX 생성 라이브러리(npm docx 8.5.0 번들)
- build.py: 조립 스크립트
- tests/: 단위, DOCX, 화면, 브라우저 시험

## 다시 만들기
```
python3 build.py
```
dist/에 세 파일이 생긴다.
- finorder.kit.html: 키트 배포용(DOCX 라이브러리를 jsDelivr, 실패하면 unpkg에서 불러온다. 약 220KB). 이 파일을 상위 폴더의 finorder.html로 바꿔 넣고 다시 게시한다.
- finorder.html: 라이브러리를 내장한 완성본(약 960KB). 외부 CDN을 쓸 수 없는 환경용.
- finorder.standalone.html: 로컬 브라우저 시험용.

## 주소를 고칠 때
1. data/institutions.json에서 해당 기관의 addr(도로명주소, 번지·층까지)와 note(괄호 안 법정동·건물명)를 고친다. 도로명주소에는 괄호를 넣지 않는다. 우편번호는 쓰지 않는다.
2. status는 user_provided(제공 자료 기준) 또는 needs_check(미확인, addr 비움)로 둔다.
3. python3 build.py 를 실행하고, 시험을 돌린 뒤, finorder.kit.html을 상위 폴더에 finorder.html로 복사한다.
4. 직원에게는 "신청서 작성기 업데이트해줘"를 안내한다.

## 시험
```
NODE_PATH=<jsdom이 설치된 node_modules> sh tests/run-all.sh
LC_ALL=C.UTF-8 NODE_PATH=<playwright-core가 설치된 node_modules> node tests/e2e.js
LC_ALL=C.UTF-8 NODE_PATH=<playwright-core가 설치된 node_modules> node tests/kit_e2e.js
```
- run-all.sh: 단위, DOCX(은행용·보험사용), 화면(jsdom). DOCX를 PDF로 바꾸는 단계는 LibreOffice(soffice)가 있어야 한다.
- e2e.js, kit_e2e.js: 실제 Chromium 시험. 컨테이너 로케일이 C이면 한글 파일명이 깨지므로 LC_ALL=C.UTF-8로 실행한다.

## 규칙
- 이름, 주민등록번호, 사건번호, 사건명은 저장하지 않고 Claude 호출에도 보내지 않는다.
- 주소·명칭·수치는 확인한 것만 쓴다. 검색 요약이나 위키·채용 사이트는 출처로 인정하지 않는다.
- DOCX에는 keepNext, keepLines, pageBreakBefore를 쓰지 않는다(Word가 줄 옆에 검은 네모를 띄운다).
- 코드를 고치면 SPEC.md와 tests/를 함께 고치고 시험을 모두 통과시킨 뒤 배포한다.
