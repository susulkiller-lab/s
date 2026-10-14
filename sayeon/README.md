# 사건 연표 (sayeon)

법원 기록(소장, 답변서, 준비서면)을 올려 쟁점별 주장 변천 지도, 화면 타임라인, 서면 삽입용 A4 별지 연표를 만드는 claude.ai 아티팩트(단일 HTML)의 원본 코드.

- `CONTRACT.md`: 설계서(데이터 스키마, 모듈 API, 자료 올리기 4경로, 절대 원칙). 식별 정보는 지운 사본.
- `src/`: 모듈별 원본. `build.py`가 순서대로 이어 붙여 `build/sayeon.html`을 만든다(`python3 build.py`).
  - `common.js`, `tokens.css`: 공용 유틸·디자인 토큰
  - `viz_timeline.*`, `viz_map.*`, `viz_a4.js`: 화면 타임라인, 변천 지도, A4 별지(S자/Z자, 흑백)
  - `ingest.*`: 자료 올리기(텍스트 붙여넣기, 파일, 폴더, 구글 드라이브)
  - `pipeline.js`: 분석 파이프라인(전사, 쟁점 초안, 진술 추출, 변화 판정, 사실 구성)
  - `store.js`, `shell.*`: 저장(db 능력 또는 브라우저 저장)과 앱 껍데기
- `test/`: 단위 시험(`node test/unit_*.js`)과 Playwright 시험(`NODE_PATH=$(npm root -g) node test/shot_*.js`). 합성 데이터만 쓴다. 실제 사건 데이터와 이를 쓰는 시험(자료 올리기, 파이프라인 프롬프트 덤프, 통합 e2e)은 의뢰인 정보 때문에 이 저장소에 넣지 않았다.
- `data/sample_min.json`: 화면 개발용 가상 데이터.

게시 시 선언할 능력: `db`, `user`, `sample`, `downloads`, `assets`, `mcp`(서버 `Google Drive`, 도구 search_files, get_file_metadata, read_file_content, download_file_content).

실제 아티팩트 환경에서만 확인되는 것(CSP 하의 pdf.js 워커, 실제 Drive 커넥터 응답, 실제 Claude 응답)은 시험하지 못했다.
