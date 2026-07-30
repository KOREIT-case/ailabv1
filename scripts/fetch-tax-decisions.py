#!/usr/bin/env python3
"""조세심판례(ttSpecialDecc) → corpus/decisions/*.md

왜 심판례인가
  취득세·체비지·청산금·간주취득세·신탁재산 같은 정비사업 세무 쟁점은 대법원 판례보다
  조세심판원 재결(심판례)에 압도적으로 많고 구체적이다. 게다가 심판례 사건명은
  실무 질문과 어휘가 그대로 겹쳐("관리처분계획에 따라 취득하는 임대주택을 체비지로 보아
  취득세를 감면하여야 한다는 청구주장의 당부"), 구어체 질의 → 법령 조문 사이의 다리가 된다.

⛔ 검색 API 특성 (2026-07-25 실측)
  ttSpecialDecc 는 어절을 AND 로 좁힌다. 어절이 늘수록 급격히 줄고 0건도 난다.
    "신탁"(4,077) → "신탁 취득세"(492) → "신탁 취득세 납세의무자"(15) → "신탁 사업시행자 취득세"(0)
  → 질의는 2어절이 스윗스팟. 3어절 이상은 쓰지 않는다.
  ("지정개발자"는 0건 — 신탁방식 정비사업은 "사업시행자"로 걸어야 한다.)

⛔ 본문 응답의 청구번호는 비어 있다. 검색 결과의 청구번호를 넘겨받아 기록한다.

⛔ 시점 주의 — 세법에서 가장 위험한 지점
  심판례는 '의결 당시 법령' 기준 판단이다. 특히 신탁 관련은 2020년 지방세법 개정으로
  납세의무자 구조가 바뀌어, 그 이전 재결을 현행법 근거로 인용하면 오답이 된다.
  → CUTOFF 이후만 수집하고, 의결일자를 메타데이터·본문 모두에 남긴다.

실행:
  python3 scripts/fetch-tax-decisions.py            # 시범 3축 (체비지·청산금·신탁)
  python3 scripts/fetch-tax-decisions.py --all      # 전체 축
  python3 scripts/fetch-tax-decisions.py 체비지 청산금
"""
import json, os, re, sys, time, pathlib, urllib.request
from urllib.parse import quote

OC = "law-bot"
BASE = "https://www.law.go.kr/DRF"
OUT = pathlib.Path(__file__).resolve().parent.parent / "corpus" / "decisions"
CONFIRM = "2026-07-25"
CUTOFF = "2015-01-01"     # 의결일자 하한 (구법 기준 재결 배제)
PER_AXIS = 15             # 축당 수집 상한 (최신순)

# 축 → 2어절 질의 목록. 3어절 이상 금지(위 docstring 참조).
AXES = {
    "체비지":   ["체비지 취득세", "체비지 감면", "보류지 취득세"],
    "청산금":   ["청산금 취득세", "현금청산 취득세", "청산금 과세표준"],
    # 신탁 축은 질의 자체에 정비 맥락을 넣는다. "위탁자 취득세"류로 걸면 담보신탁·처분신탁의
    # 위탁자 지위이전 과세표준 사건이 100건씩 쏟아져(정비와 무관) 본문 확인 비용만 커진다.
    # 실측: 신탁 사업시행자 19건 / 신탁 관리처분 9건 / 신탁 정비사업 3건 / 신탁 체비지 2건
    "신탁":     ["신탁 사업시행자", "신탁 정비사업", "수탁자 정비사업", "위탁자 정비사업",
                "신탁 관리처분", "신탁 체비지", "신탁 조합원"],
    # --all 로만 도는 확장 축
    "관리처분": ["관리처분계획 취득세", "종전부동산 취득세"],
    "사업시행자": ["사업시행자 취득세", "재개발 취득세", "재건축 취득세"],
    "간주취득": ["간주취득세 과점주주", "과점주주 취득세"],
    "무상귀속": ["무상귀속 취득세", "정비기반시설 취득세"],
    # 양도소득세(국세) 축 — 지방세 축만 모으면 세목이 취득·재산으로 쏠려, 입주권·청산금
    # 양도세 질의에 취득세 재결이 끌려온다. 조합원입주권 양도는 실무 문의 상위권이다.
    "양도": ["조합원입주권 양도", "입주권 양도소득", "관리처분 양도소득",
            "재개발 양도소득", "청산금 양도소득", "조합원입주권 비과세"],
}
PILOT = ["체비지", "청산금", "신탁", "양도"]

# ★ 관련성 판정은 2단 AND — OR로 두면 신탁 사건이 통째로 밀려든다.
#
#   1차(CORE): 정비사업 맥락이 반드시 있어야 한다.
#      "위탁자|수탁자|신탁재산" 같은 신탁 어휘를 단독 채택 신호로 두면, 담보신탁·처분신탁의
#      위탁자 지위이전 과세표준 사건(신탁사 일반 업무)이 대량 유입된다. 실측에서 신탁 축
#      15건 중 12건이 그런 사건이었고, 쟁점도 거의 동일해 corpus만 부풀렸다.
#      → 도시정비 챗봇이므로 정비 맥락 없는 일반 신탁 재결은 받지 않는다.
#   2차(EXCLUDE): 명의신탁·주식 사건은 층위가 달라 배제(간주취득 축에서 따로 다룬다).
#
#   사건명에 정비 신호가 없어도 본문(처분개요)에는 있는 경우가 있어, 사건명 → 본문 순으로 본다.
CORE = re.compile(
    r"정비사업|재개발|재건축|관리처분|조합원|주택조합|정비조합|체비지|보류지|청산금|현금청산|"
    r"주거환경개선|정비구역|정비기반시설|입주권|종전부동산|가로주택|소규모주택|도시환경정비")
EXCLUDE = re.compile(r"명의신탁|명의수탁|실질주주|주식의? 취득|비상장주식")

# 같은 쟁점 재결이 수십 건씩 반복된다(위탁자 지위이전 과세표준 등).
# 쟁점 지문이 같으면 축당 이 수만큼만 남긴다 — 대표례만 있으면 검색 목적은 충족된다.
MAX_SAME_ISSUE = 3

# 쟁점 태그는 축 이름이 아니라 사건명에서 뽑는다(한 재결이 여러 축 질의에 걸리므로).
ISSUE_TAGS = ["체비지", "보류지", "청산금", "현금청산", "관리처분", "종전부동산", "위탁자 지위이전",
              "신탁재산", "정비기반시설", "무상귀속", "과점주주", "주거환경개선", "재개발", "재건축"]


def _get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 ** i)


def _clean(s):
    """법제처 응답의 숫자 HTML 엔티티·태그 제거."""
    if not s:
        return ""
    s = str(s)
    s = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), s)
    s = re.sub(r"&#x([0-9a-fA-F]+);", lambda m: chr(int(m.group(1), 16)), s)
    s = s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    return s.strip()


def search(query, display=100):
    url = (f"{BASE}/lawSearch.do?OC={OC}&target=ttSpecialDecc"
           f"&query={quote(query)}&type=JSON&display={display}")
    box = json.loads(_get(url)).get("Decc", {})
    items = box.get("decc") or []
    return [items] if isinstance(items, dict) else items


def body(tt_id):
    url = f"{BASE}/lawService.do?OC={OC}&target=ttSpecialDecc&ID={tt_id}&type=JSON"
    raw = json.loads(_get(url))
    d = raw.get("DeccService") or raw.get("Decc") or raw
    d = d.get("SpecialDeccService", d) if isinstance(d, dict) else {}
    if isinstance(d, dict) and "decc" in d:
        d = d["decc"]
    if isinstance(d, list):
        d = d[0] if d else {}
    return d if isinstance(d, dict) else {}


def ymd(s):
    s = re.sub(r"\D", "", str(s or ""))
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 else ""


def split_reason(reason):
    """이유를 (처분개요·주장, 심리 및 판단)으로 분리.

    실측상 모든 재결이 '3. 심리 및 판단' 마커를 갖는다. 법리 판단은 그 뒤에 있고,
    앞부분(처분개요·당사자 주장)은 개별 사실관계라 검색 노이즈가 크다.
    → 파일에는 둘 다 보존하되, 인덱서가 판단부를 주 검색대상으로 삼도록 절을 나눈다.
    """
    m = re.search(r"3\.\s*심리\s*및\s*판단", reason)
    if not m:
        return reason, ""
    return reason[:m.start()].strip(), reason[m.start():].strip()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    axes = list(AXES) if "--all" in sys.argv else (args or PILOT)

    OUT.mkdir(parents=True, exist_ok=True)
    seen, wrote = set(), []
    skipped = {"구법": 0, "무관": 0, "본문없음": 0, "중복쟁점": 0}
    issue_count = {}   # 쟁점 지문 → 채택 건수 (동일 쟁점 반복 억제)

    for axis in axes:
        if axis not in AXES:
            print(f"! 알 수 없는 축: {axis} (가능: {', '.join(AXES)})")
            continue
        pool = {}
        for q in AXES[axis]:
            hits = search(q)
            print(f"  [{axis}] '{q}' → {len(hits)}건")
            for h in hits:
                pool.setdefault(h.get("특별행정심판재결례일련번호"), h)

        # 최신 의결 우선 → 축당 상한만큼
        cands = sorted(pool.values(), key=lambda h: ymd(h.get("의결일자")), reverse=True)
        picked = 0
        for h in cands:
            if picked >= PER_AXIS:
                break
            tid = h.get("특별행정심판재결례일련번호")
            if tid in seen:
                continue
            date = ymd(h.get("의결일자"))
            if not date or date < CUTOFF:
                skipped["구법"] += 1
                continue
            name = _clean(h.get("사건명"))
            if EXCLUDE.search(name):
                skipped["무관"] += 1
                continue
            # 사건명에 정비 신호가 없으면 본문까지 확인하고, 거기도 없으면 버린다.
            d = body(tid) if not CORE.search(name) else None
            if d is not None and not CORE.search(_clean(d.get("이유"))[:3000] + " " + _clean(d.get("재결요지"))):
                skipped["무관"] += 1
                continue

            d = d or body(tid)
            요지 = _clean(d.get("재결요지"))
            주문 = _clean(d.get("주문"))
            이유 = _clean(d.get("이유"))
            if not (요지 or 주문):
                skipped["본문없음"] += 1
                continue

            # 동일 쟁점 반복 억제 — 쟁점 지문(사건명에서 숫자·기호·따옴표 제거)이 같으면 상한까지만.
            fp = re.sub(r"[①-⑨0-9\s'\"“”‘’·、,()「」]+", "", name)[:45]
            if issue_count.get(fp, 0) >= MAX_SAME_ISSUE:
                skipped["중복쟁점"] += 1
                continue
            issue_count[fp] = issue_count.get(fp, 0) + 1
            seen.add(tid)
            picked += 1

            개요, 판단 = split_reason(이유)
            청구번호 = _clean(h.get("청구번호")) or f"심판례 {tid}"
            세목 = _clean(d.get("세목"))
            관련법령 = _clean(d.get("관련법령"))
            참조결정 = _clean(d.get("참조결정"))
            쟁점 = " ".join(t for t in ISSUE_TAGS if t in name) or axis

            fm = ("---\n"
                  "자료유형: 심판례\n"
                  f"기관: {_clean(d.get('재결청')) or '조세심판원'}\n"
                  f"사건명: {name}\n"
                  f"사건번호: \"{청구번호}\"\n"
                  f"법령명: {청구번호}\n"            # 근거 인용 라벨용 (citation)
                  f"의결일자: {date}\n"
                  f"세목: {세목}\n"
                  f"관련법령: {관련법령}\n"
                  f"쟁점: {쟁점}\n"
                  f"일련번호: \"{tid}\"\n"
                  "출처: 국가법령정보센터 조세심판례(ttSpecialDecc)\n"
                  f"최종확인일: {CONFIRM}\n"
                  "---\n")

            doc = [fm, f"\n# {청구번호} ({name[:60]})\n"]
            doc.append(f"\n> 의결일자 {date} 기준 판단이다. 이후 세법 개정 여부를 반드시 확인할 것.\n")
            if 요지:
                doc.append(f"\n## 재결요지\n\n{요지}\n")
            if 주문:
                doc.append(f"\n## 주문\n\n{주문}\n")
            if 관련법령:
                doc.append(f"\n## 관련법령\n\n{관련법령}\n")
            if 판단:
                doc.append(f"\n## 심리 및 판단\n\n{판단}\n")
            if 개요:
                doc.append(f"\n## 처분개요 및 당사자 주장\n\n{개요}\n")
            if 참조결정:
                doc.append(f"\n## 참조결정\n\n{참조결정}\n")

            fn = re.sub(r"[\\/:*?\"<>|\s]+", "", 청구번호) + ".md"
            (OUT / fn).write_text("".join(doc).rstrip() + "\n", encoding="utf-8")
            wrote.append((청구번호, date, 쟁점, 세목, len("".join(doc))))
            print(f"    ✓ {fn}: {name[:44]} ({date})")

    print(f"\n=== 수집 {len(wrote)}건 / 제외 {skipped} ===")
    for c, d, a, s, n in sorted(wrote, key=lambda x: x[1], reverse=True):
        print(f"{d}  {c:18s} {a:6s} {s or '-':4s} {n:,}자")


if __name__ == "__main__":
    main()
