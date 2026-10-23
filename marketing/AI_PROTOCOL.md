# AI 검색 답변 수집 절차

리포트는 `data/measure/<측정 날짜>/ai/` 폴더의 텍스트 파일만 읽는다. 누가 어떻게 모았는지는 상관없다.

파일 이름: `<엔진>__<질문id>__<회차>.txt` (밑줄 두 개)
- 엔진: chatgpt, gemini, perplexity, claude
- 질문id: `config/ai_prompts.csv`의 id(a01~a08)
- 회차: 1, 2, 3
- 예: `chatgpt__a01__1.txt`

내용: 답변 전문을 그대로 붙인다. 답변에 출처 링크가 있으면 그 주소들도 끝에 한 줄씩 붙인다(인용 여부를 센다). UTF-8로 저장한다.

## 측정 조건(매번 같게)
- 각 서비스에서 새 대화로 묻는다. 메모리·맞춤 설정이 켜져 있으면 임시 대화(기록 남지 않는 모드)를 쓴다
- 질문 문구는 ai_prompts.csv 그대로, 앞뒤에 말을 붙이지 않는다
- 웹 검색 기능을 켤 수 있는 서비스는 켠다(실제 의뢰인 사용 환경에 가깝게)
- 질문당 2~3회. 시간이 없으면 a01, a05, a07, a08만 1회씩이라도 하고, 다음 측정도 같은 범위로 한다

## Claude에게 시킬 때(Claude Code + Claude in Chrome)
1. 크롬 확장 Claude in Chrome(1.0.36 이상)을 설치하고 Claude 계정(Pro·Max·Team·Enterprise)으로 로그인한다
2. 명령 프롬프트에서 Claude Code 설치(한 번만): `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd` → 새 창에서 `claude --version` 확인
3. 저장소 폴더에서 `claude --chrome` 실행. 처음에는 브라우저 로그인(확장과 같은 계정·조직)과 안내창(Enter)이 나온다. 확장이 안 잡히면 크롬을 껐다 켠다
4. `/chrome` 입력 → "Status: Enabled", "Extension: Installed"면 연결 완료
5. 크롬에서 ChatGPT·Gemini·Perplexity에 로그인해 둔다
6. 지시: "marketing/AI_PROTOCOL.md 절차대로 data/measure/<측정 날짜>/ai 폴더에 AI 답변을 수집해줘. 엔진은 chatgpt, gemini, perplexity, 질문 전체, 회차 1회."
7. "Claude in Chrome wants to ..." 권한 질문이 나오면 해당 사이트를 허용한다. 보안문자·로그인 화면에서는 Claude가 멈추고 사람에게 넘긴다

Claude는 크롬 새 탭에서 각 서비스를 열어 질문하고, 답변 전문을 위 규칙의 파일로 저장한다. 답변 내용은 고치지 않고 그대로 저장한다. 근거: https://code.claude.com/docs/en/chrome

## 수동으로 할 때
각 서비스에서 질문 → 답변 전체 복사 → 메모장에 붙여넣기 → 위 이름으로 UTF-8 저장.
