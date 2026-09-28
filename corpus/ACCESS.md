# 접근 확인 결과

확인 시각: 2026-09-28T00:56:01Z (UTC)
확인 방법: curl -sS -o /dev/null -w '%{http_code}' https://<호스트>/ (세션 에그레스 프록시 경유)

| 호스트 | HTTP 코드 | 결과 |
|---|---|---|
| lawrewrite.com | 000 | 차단: 프록시 CONNECT 403 (환경 네트워크 정책 거부) |
| www.lawtalk.co.kr | 000 | 차단: 프록시 CONNECT 403 (환경 네트워크 정책 거부) |
| jinnsol.tistory.com | 000 | 차단: 프록시 CONNECT 403 (환경 네트워크 정책 거부) |
| m.blog.naver.com | 000 | 차단: 프록시 CONNECT 403 (환경 네트워크 정책 거부) |

프록시 상태 기록(recentRelayFailures): 네 호스트 모두 "gateway answered 403 to CONNECT (policy denial or upstream failure)".

# robots.txt

네 호스트 모두 접속 자체가 차단되어 robots.txt를 확인하지 못함.

# 수집 실패 URL

사유: 위 호스트 전부 환경 네트워크 정책에 의해 차단(프록시 403). 우회 수집은 하지 않음.

- https://lawrewrite.com/ 및 내부 페이지 전체 (미수집)
- https://www.lawtalk.co.kr/posts/189483
- https://www.lawtalk.co.kr/posts/189485
- 로톡 작성자 페이지 추가 글 (목록 확인 불가)
- https://jinnsol.tistory.com/212
- https://jinnsol.tistory.com/213
- 티스토리 최신 글 추가분 (목록 확인 불가)
- https://m.blog.naver.com/jinnsollaw/224420858955
- https://m.blog.naver.com/jinnsol-law/224420956625

# 재수집 조건

클라우드 환경 설정(세션 제목 표시줄의 환경 메뉴 > Edit > Network access)에서 접근 수준을 넓히거나 위 4개 도메인을 허용 목록에 추가한 뒤 재실행 필요.
