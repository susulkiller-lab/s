"""data/raw의 조사팀 산출(*.json)과 사용자 제공 목록(user_list.json)을 검증·병합해 data/institutions.json을 만든다.

사용법: python3 finorder/merge_data.py [--check]
--check: 파일을 쓰지 않고 검증 결과만 출력한다.
검증 실패(오류)가 있으면 종료 코드 1. 경고는 출력만 한다.

정책
- 주소·명칭의 원천은 사용자 제공 목록(data/raw/user_list.json)이다. 목록에 있는 기관은 status를 user_provided로 하고
  조사팀 값은 쓰지 않는다. 우편번호는 쓰지 않는다(사용자 지시).
- 목록에 없는 기관 중 조사팀이 검색 요약만으로 채운 값은 쓰지 않고 needs_check로 비운다.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "institutions.json"
USER_LIST = RAW / "user_list.json"
AS_OF = "2026-10-02"

CATEGORIES = [
    {"id": "bank", "label": "시중·특수·지방은행"},
    {"id": "post", "label": "우체국"},
    {"id": "inet", "label": "인터넷전문은행"},
    {"id": "mutual", "label": "상호금융"},
    {"id": "savings", "label": "저축은행"},
    {"id": "securities", "label": "증권사"},
    {"id": "insurance", "label": "보험사"},
    {"id": "card", "label": "카드사"},
]
CAT_IDS = [c["id"] for c in CATEGORIES]
FIELDS = ["id", "cat", "short", "name", "aliases", "wording", "popular", "addr", "note", "status", "checkedAt", "sources", "memo"]

# 신청서 표기를 사용자가 실제로 제출한 양식 그대로 유지하는 기관(제공 목록의 표기와 다를 때)
NAME_KEEP = {"koreapost": "우정사업본부(우체국예금)"}
USER_SOURCE = {"label": "사용자 제공 목록(금융기관 본점 및 본사 주소, 기준일 2026. 10. 2.)", "url": ""}
# 사용자에게 알려야 할 메모
USER_MEMO = {}
# needs_check로 남는 기관의 메모는 중앙회의 조문 근거(법령 도구로 확인)만 유지한다.
KEEP_MEMO_CATS = {"mutual"}


def apply_policy(items, user_rows, warns):
    by_id = {i["id"]: i for i in items}
    for u in user_rows:
        if u["id"] not in by_id:
            warns.append(f"사용자 제공 목록 '{u['short']}'({u['id']})에 해당하는 조사 항목이 없어 건너뜀")
    users = {u["id"]: u for u in user_rows}
    for it in items:
        iid = it["id"]
        u = users.get(iid)
        if u:
            it["name"] = NAME_KEEP.get(iid, u["name"])
            it["addr"], it["note"] = u["addr"], u["note"]
            it["status"] = "user_provided"
            it["sources"] = [dict(USER_SOURCE)] + ([{"label": "기관 확인 자료(사용자 제공 목록의 링크)", "url": u["link"]}] if u.get("link") else [])
            it["checkedAt"] = AS_OF
            it["memo"] = USER_MEMO.get(iid, "")
        elif it.get("status") == "needs_check":
            it.update(addr="", note="", sources=[])
            if it.get("cat") not in KEEP_MEMO_CATS:
                it["memo"] = ""
        elif it.get("status") == "verified" and any("검색요약" in str(x.get("label", "")) for x in it.get("sources", [])):
            warns.append(f"[{iid}] 출처가 검색요약뿐이라 verified를 needs_check로 강등")
            it.update(status="needs_check", addr="", note="", sources=[])
            if it.get("cat") not in KEEP_MEMO_CATS:
                it["memo"] = ""
        it.pop("zip", None)  # 우편번호는 쓰지 않는다


def main() -> int:
    check_only = "--check" in sys.argv
    errors, warns, items = [], [], []
    files = sorted(p for p in RAW.glob("*.json") if p.name != USER_LIST.name)
    if not files:
        print("data/raw/*.json이 없습니다", file=sys.stderr)
        return 1
    for f in files:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            errors.append(f"{f.name}: JSON 파싱 실패 {e}")
            continue
        for it in d.get("institutions", []):
            it["_file"] = f.name
            items.append(it)
    user_rows = []
    if USER_LIST.exists():
        user_rows = json.loads(USER_LIST.read_text(encoding="utf-8")).get("institutions", [])

    apply_policy(items, user_rows, warns)

    seen = {}
    for it in items:
        tag = f"{it.get('_file')}:{it.get('id')}"
        for k in FIELDS:
            if k not in it:
                errors.append(f"{tag}: 필드 누락 {k}")
        if not re.fullmatch(r"[a-z0-9-]+", str(it.get("id", ""))):
            errors.append(f"{tag}: id 형식 오류")
        if it.get("id") in seen:
            errors.append(f"{tag}: id 중복({seen[it['id']]})")
        seen[it.get("id")] = it.get("_file")
        if it.get("cat") not in CAT_IDS:
            errors.append(f"{tag}: cat 오류 {it.get('cat')}")
        if it.get("wording") not in ("은행", "기관"):
            errors.append(f"{tag}: wording 오류")
        st = it.get("status")
        if st not in ("verified", "user_provided", "needs_check"):
            errors.append(f"{tag}: status 오류")
        if not it.get("name") or not it.get("short"):
            errors.append(f"{tag}: name/short 비어 있음")
        ad = it.get("addr", "")
        if st in ("verified", "user_provided") and not ad:
            errors.append(f"{tag}: {st}인데 주소 없음")
        if st == "needs_check" and ad:
            warns.append(f"{tag}: needs_check인데 주소가 채워져 있음")
        if "(" in ad or ")" in ad:
            errors.append(f"{tag}: addr에 괄호가 있음(참고는 note에)")
        if st == "verified" and len(it.get("sources", [])) < 2:
            errors.append(f"{tag}: verified인데 출처 {len(it.get('sources', []))}개(2곳 이상 필요)")
        if st == "user_provided" and not it.get("sources"):
            errors.append(f"{tag}: user_provided인데 출처 없음")
        for s in it.get("sources", []):
            url = str(s.get("url", ""))
            if st == "user_provided" and url == "":
                continue
            if not url.startswith("http"):
                errors.append(f"{tag}: 출처 URL 형식 오류")
        if re.search(r"[*#`<>]", it.get("name", "") + it.get("short", "") + ad + it.get("note", "")):
            errors.append(f"{tag}: 마크다운/HTML 문자 포함")
        # 보험사 분류는 보험사용 신청서 문안을 쓴다. 분류가 보험이면 wording은 기관이어야 한다
        if it.get("cat") == "insurance" and it.get("wording") != "기관":
            warns.append(f"{tag}: 보험사인데 wording이 기관이 아님")

    order = {c: n for n, c in enumerate(CAT_IDS)}
    items.sort(key=lambda x: (order.get(x.get("cat"), 99),))
    for it in items:
        it.pop("_file", None)
    result = {"schema": 2, "asOf": AS_OF, "categories": CATEGORIES, "institutions": items}

    cnt = {s: sum(1 for i in items if i.get("status") == s) for s in ("verified", "user_provided", "needs_check")}
    print(f"기관 {len(items)}곳 (verified {cnt['verified']}, user_provided {cnt['user_provided']}, needs_check {cnt['needs_check']})")
    for e in errors:
        print("오류:", e)
    for w in warns:
        print("경고:", w)
    if errors:
        return 1
    if not check_only:
        OUT.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"쓰기 완료: {OUT.relative_to(ROOT.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
