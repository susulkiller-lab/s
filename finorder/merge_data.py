"""data/raw/*.json(조사팀 산출)을 검증·병합해 data/institutions.json을 만든다.

사용법: python3 finorder/merge_data.py [--check]
--check: 파일을 쓰지 않고 검증 결과만 출력한다.
검증 실패(오류)가 있으면 종료 코드 1. 경고는 출력만 한다.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "institutions.json"
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
FIELDS = ["id", "cat", "short", "name", "aliases", "wording", "popular", "zip", "addr", "note", "status", "checkedAt", "sources", "memo"]

# 사용자 제공 양식(2026. 9. 작성본)의 9곳. 조사 결과와 무관하게 이 값을 user_provided로 확정한다.
# id: (신청서에 쓰는 명칭, 우편번호, 도로명주소, 참고)
USER_SEED = {
    "kookmin": ("주식회사 국민은행", "07331", "서울특별시 영등포구 국제금융로8길 26", "여의도동"),
    "kakaobank": ("주식회사 카카오뱅크", "13529", "경기도 성남시 분당구 분당내곡로 131, 11층", "백현동, 판교테크원"),
    "tossbank": ("주식회사 토스뱅크", "06133", "서울특별시 강남구 테헤란로 131, 13층", "역삼동, 한국지식재산센터"),
    "woori": ("주식회사 우리은행", "04632", "서울특별시 중구 소공로 51", "회현동1가"),
    "kbank": ("주식회사 케이뱅크", "04548", "서울특별시 중구 을지로 170", "을지로4가, 을지트윈타워"),
    "nonghyup": ("농협은행 주식회사", "04517", "서울특별시 중구 통일로 120", "충정로1가"),
    "kyongnam": ("주식회사 경남은행", "51316", "경상남도 창원시 마산회원구 3·15대로 642", "석전동"),
    "shinhan": ("주식회사 신한은행", "04513", "서울특별시 중구 세종대로9길 20", "태평로2가"),
    "koreapost": ("우정사업본부(우체국예금)", "30114", "세종특별자치시 도움5로 19", "어진동"),
}
USER_SOURCE = {"label": "사용자 제공 양식(2026. 9. 작성본)", "url": ""}
# 사용자에게 알려야 할 불일치 메모(검색 요약과 양식이 어긋난 곳). 요약값은 원문 확인 전이라 후보로만 언급한다.
USER_MEMO = {
    "kbank": "우편번호는 사용자 양식 기준입니다. 검색 요약에 다른 우편번호가 나온 바 있어 도로명주소 안내시스템에서 한 번 확인해 두십시오.",
    "kyongnam": "주소는 사용자 양식 기준입니다. 검색 요약 중 다른 주소가 나온 바 있어 공식 홈페이지에서 한 번 확인해 두십시오.",
}
# 메모를 남기는 분류: 중앙회의 조문 근거(법령 도구로 확인)만 유지한다.
KEEP_MEMO_CATS = {"mutual"}


def norm(s: str) -> str:
    return re.sub(r"[\s,·ㆍ.()]", "", s or "")


def apply_policy(items, warns):
    """확정 정책: 사용자 양식 9곳은 user_provided, 그 외 미확인 기관은 주소·우편번호·참고를 비운다."""
    by_id = {i["id"]: i for i in items}
    for iid in USER_SEED:
        if iid not in by_id:
            warns.append(f"사용자 양식 시드 '{iid}'에 해당하는 조사 항목이 없어 건너뜀")
    for it in items:
        iid = it["id"]
        if iid in USER_SEED:
            name, zp, ad, note = USER_SEED[iid]
            if it.get("addr") and norm(it["addr"]) != norm(ad):
                warns.append(f"[{iid}] 조사 후보 주소가 사용자 양식과 다름 -> 양식 값 사용(조사: {it['addr']})")
            it.update(name=name, zip=zp, addr=ad, note=note, status="user_provided", sources=[dict(USER_SOURCE)])
            it["memo"] = USER_MEMO.get(iid, "")
        elif it.get("status") == "verified" and any("검색요약" in str(x.get("label", "")) for x in it.get("sources", [])):
            # 검색 결과 목록·요약만 보고 적은 출처는 열람한 원문이 아니므로 verified로 인정하지 않는다.
            warns.append(f"[{iid}] 출처가 검색요약뿐이라 verified를 needs_check로 강등(후보 주소는 raw 로그에만 남김)")
            it.update(status="needs_check", zip="", addr="", note="", sources=[])
            if it.get("cat") not in KEEP_MEMO_CATS:
                it["memo"] = ""
        elif it.get("status") == "needs_check":
            it.update(zip="", addr="", note="", sources=[])
            if it.get("cat") not in KEEP_MEMO_CATS:
                it["memo"] = ""


def main() -> int:
    check_only = "--check" in sys.argv
    errors, warns, items = [], [], []
    files = sorted(RAW.glob("*.json"))
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

    apply_policy(items, warns)

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
        if it.get("status") not in ("verified", "user_provided", "needs_check"):
            errors.append(f"{tag}: status 오류")
        if not it.get("name") or not it.get("short"):
            errors.append(f"{tag}: name/short 비어 있음")
        zp, ad = it.get("zip", ""), it.get("addr", "")
        st = it.get("status")
        if st in ("verified", "user_provided"):
            if not re.fullmatch(r"\d{5}", zp or ""):
                errors.append(f"{tag}: {st}인데 우편번호 5자리 아님({zp!r})")
            if not ad:
                errors.append(f"{tag}: {st}인데 주소 없음")
        if st == "verified" and len(it.get("sources", [])) < 2:
            errors.append(f"{tag}: verified인데 출처 {len(it.get('sources', []))}개(2곳 이상 필요)")
        if st == "user_provided" and not it.get("sources"):
            errors.append(f"{tag}: user_provided인데 출처(사용자 양식 표시) 없음")
        if st == "needs_check" and (zp or ad):
            warns.append(f"{tag}: needs_check인데 주소/우편번호가 채워져 있음(미확인 값 포함 여부 점검)")
        for s in it.get("sources", []):
            url = str(s.get("url", ""))
            if st == "user_provided" and url == "":
                continue
            if not url.startswith("http"):
                errors.append(f"{tag}: 출처 URL 형식 오류")
        if re.search(r"[*#`<>]", it.get("name", "") + it.get("short", "") + ad + it.get("note", "")):
            errors.append(f"{tag}: 마크다운/HTML 문자 포함")

    order = {c: n for n, c in enumerate(CAT_IDS)}
    items.sort(key=lambda x: (order.get(x.get("cat"), 99),))
    for it in items:
        it.pop("_file", None)
    result = {"schema": 1, "asOf": AS_OF, "categories": CATEGORIES, "institutions": items}

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
