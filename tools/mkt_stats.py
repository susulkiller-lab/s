"""마케팅 리포트의 통계·판독 보조 함수(표준 라이브러리만). mkt_report.py가 쓴다.

- wilson: 비율의 95% 신뢰구간(답변 수가 적을 때도 0~100% 안에서 계산되는 윌슨 방식)
- pct: 정렬된 값의 백분위
- age_days: 검색 결과 요약문의 게시 시점("3일 전", "2026.07.20.")을 측정일 기준 경과일로
- distance_km: 플레이스 거리 문구("1.8km", "330m")를 km로
- kw_tokens / name_kw: 키워드의 지역·분야 단어가 업체명에 몇 개 들어 있는지
- spearman: 순위 상관
"""
import math
import re
from datetime import date

AGO_RE = re.compile(r"(\d+)\s*(분|시간|일|주|개월|달|년)\s*전")
DATE_RE = re.compile(r"(20\d{2})\.\s?(\d{1,2})\.\s?(\d{1,2})\.")
AGO_DAYS = {"분": 0, "시간": 0, "일": 1, "주": 7, "개월": 30, "달": 30, "년": 365}
GENERIC = ("변호사", "법률사무소", "법무법인", "로펌", "소송", "전문")


def wilson(k, n, z=1.96):
    """k/n 비율의 95% 신뢰구간(%, 소수 첫째 자리). n이 0이면 None."""
    if not n:
        return None
    p = k / n
    den = 1 + z * z / n
    mid = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return round(max(mid - half, 0) * 100, 1), round(min(mid + half, 1) * 100, 1)


def pct(sorted_vals, q):
    """정렬된 목록의 q(0~1) 백분위. 선형 보간."""
    if not sorted_vals:
        return None
    i = (len(sorted_vals) - 1) * q
    lo, hi = math.floor(i), math.ceil(i)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (i - lo)


def age_days(text, measured_on):
    """요약문 앞부분의 게시 시점을 경과일로. 시점 표시가 없으면 None."""
    head = (text or "")[:80]
    m = AGO_RE.search(head)
    if m:
        return int(m.group(1)) * AGO_DAYS[m.group(2)]
    m = DATE_RE.search(head)
    if m:
        try:
            d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
        return max((date.fromisoformat(measured_on) - d).days, 0)
    return None


def distance_km(v):
    m = re.fullmatch(r"\s*([\d.]+)\s*(km|m)\s*", str(v or ""))
    if not m:
        return None
    x = float(m.group(1))
    return x if m.group(2) == "km" else x / 1000


def kw_tokens(keyword):
    """'창원 형사변호사' → ['창원', '형사']. 변호사·법률사무소 같은 일반어는 뺀다."""
    out = []
    for w in keyword.split():
        for g in GENERIC:
            w = w.replace(g, "")
        if w:
            out.append(w)
    return out


def name_kw(name, keyword):
    """(업체명에 든 키워드 단어 수, 키워드 단어 수)."""
    toks = kw_tokens(keyword)
    n = (name or "").replace(" ", "")
    return sum(1 for t in toks if t in n), len(toks)


def spearman(xs, ys):
    n = len(xs)
    if n < 5:
        return None

    def rk(v):
        o = sorted(range(n), key=lambda i: v[i])
        r = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j + 1 < n and v[o[j + 1]] == v[o[i]]:
                j += 1
            for k in range(i, j + 1):
                r[o[k]] = (i + j) / 2 + 1
            i = j + 1
        return r
    a, b = rk(xs), rk(ys)
    ma, mb = sum(a) / n, sum(b) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    va = sum((x - ma) ** 2 for x in a) ** 0.5
    vb = sum((y - mb) ** 2 for y in b) ** 0.5
    return round(cov / (va * vb), 2) if va and vb else None
