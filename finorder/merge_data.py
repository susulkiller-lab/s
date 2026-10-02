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

# 사용자 제공 양식(2026. 9. 작성본)의 주소. 조사 결과와 대조해 불일치를 보고한다.
USER_FORM = {
    "국민은행": ("07331", "서울특별시 영등포구 국제금융로8길 26", "여의도동"),
    "카카오뱅크": ("13529", "경기도 성남시 분당구 분당내곡로 131, 11층", "백현동, 판교테크원"),
    "토스뱅크": ("06133", "서울특별시 강남구 테헤란로 131, 13층", "역삼동, 한국지식재산센터"),
    "우리은행": ("04632", "서울특별시 중구 소공로 51", "회현동1가"),
    "케이뱅크": ("04548", "서울특별시 중구 을지로 170", "을지로4가, 을지트윈타워"),
    "농협은행": ("04517", "서울특별시 중구 통일로 120", "충정로1가"),
    "경남은행": ("51316", "경상남도 창원시 마산회원구 3·15대로 642", "석전동"),
    "신한은행": ("04513", "서울특별시 중구 세종대로9길 20", "태평로2가"),
    "우체국": ("30114", "세종특별자치시 도움5로 19", "어진동"),
}


def norm(s: str) -> str:
    return re.sub(r"[\s,·ㆍ.()]", "", s or "")


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
        if it.get("status") not in ("verified", "needs_check"):
            errors.append(f"{tag}: status 오류")
        if not it.get("name") or not it.get("short"):
            errors.append(f"{tag}: name/short 비어 있음")
        zp, ad = it.get("zip", ""), it.get("addr", "")
        if it.get("status") == "verified":
            if not re.fullmatch(r"\d{5}", zp or ""):
                errors.append(f"{tag}: verified인데 우편번호 5자리 아님({zp!r})")
            if not ad:
                errors.append(f"{tag}: verified인데 주소 없음")
            if len(it.get("sources", [])) < 2:
                warns.append(f"{tag}: verified인데 출처 {len(it.get('sources', []))}개")
        else:
            if zp or ad:
                warns.append(f"{tag}: needs_check인데 주소/우편번호가 채워져 있음(미확인 값 포함 여부 점검)")
        for s in it.get("sources", []):
            if not str(s.get("url", "")).startswith("http"):
                errors.append(f"{tag}: 출처 URL 형식 오류")
        if re.search(r"[*#`<>]", it.get("name", "") + it.get("short", "") + ad + it.get("note", "")):
            errors.append(f"{tag}: 마크다운/HTML 문자 포함")

    # 사용자 양식 대조
    for key, (uz, ua, un) in USER_FORM.items():
        hit = [i for i in items if key in (i.get("short", ""), *i.get("aliases", [])) or key in i.get("name", "")]
        if not hit:
            warns.append(f"사용자 양식 '{key}'에 해당하는 항목 없음")
            continue
        i = hit[0]
        diffs = []
        if i.get("zip") != uz:
            diffs.append(f"우편번호 {uz}→{i.get('zip')}")
        if norm(i.get("addr")) != norm(ua):
            diffs.append(f"주소 '{ua}'→'{i.get('addr')}'")
        if norm(i.get("note")) != norm(un):
            diffs.append(f"참고 '{un}'→'{i.get('note')}'")
        if diffs:
            warns.append(f"사용자 양식 불일치 [{i.get('id')}] " + "; ".join(diffs))

    order = {c: n for n, c in enumerate(CAT_IDS)}
    items.sort(key=lambda x: (order.get(x.get("cat"), 99),))
    for it in items:
        it.pop("_file", None)
    result = {"schema": 1, "asOf": AS_OF, "categories": CATEGORIES, "institutions": items}

    ver = sum(1 for i in items if i.get("status") == "verified")
    print(f"기관 {len(items)}곳 (verified {ver}, needs_check {len(items) - ver})")
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
