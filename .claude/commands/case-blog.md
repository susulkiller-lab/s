---
description: 판결문, 판결 요지, 사건번호로 판례 해설 블로그 글을 만든다
argument-hint: "[판결문 파일 경로 | 사건번호 | 판결 요지]"
---

판례 해설 블로그 자동 생성 지시서(case-commentary-blog)의 0장부터 10장까지를 그대로 따라 글을 만든다.
지시서가 로드되어 있지 않으면 .claude/skills/case-commentary-blog/SKILL.md 또는 ~/.claude/skills/case-commentary-blog/SKILL.md를 먼저 읽는다.

입력: $ARGUMENTS

입력이 비어 있으면 판결문 텍스트나 파일 경로, 사건번호를 요청한다.
입력에 분량, 플랫폼, 독자가 이미 적혀 있으면 그 항목은 묻지 않는다.
```
