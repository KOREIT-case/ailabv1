#!/usr/bin/env python3
"""법령해석례(expc) → corpus/interpretations/*.md

법제처·소관부처가 지자체 질의에 회신한 유권해석. 법령 조문의 '적용 여부'를 다투는
실무 질의라 조문만으로는 안 나오는 결론(예: 도시개발사업 시행자가 신탁한 토지도
분리과세대상인지)이 담긴다. 위계는 법령·판례 아래, 심판례와 같은 참고 층위다.

⛔ expc 검색 함정 (2026-07-25 실측)
  expc 는 안건명 매칭 성향이 강해 다어절 쿼리가 0건이 되기 쉽다.
    "정비사업조합 취득세"·"재개발 취득세" → 0건 / "신탁"·"청산금" → 정상
  → 질의는 반드시 **키워드 1개**. 0건이면 더 줄여 재시도한다.
  (조세심판례 ttSpecialDecc 와 정반대 특성이라 스크립트를 나눠 둔다.)

실행:
  python3 scripts/fetch-interpretations.py           # 시범 축
  python3 scripts/fetch-interpretations.py --all
"""
import json, re, sys, time, pathlib, urllib.request
from urllib.parse import quote

OC = "law-bot"
BASE = "https://www.law.go.kr/DRF"
OUT = pathlib.Path(__file__).resolve().parent.parent / "corpus" / "interpretations"
CONFIRM = "2026-07-25"
CUTOFF = "2015-01-01"
PER_KEYWORD = 8

# ★ 반드시 단어 1개 (위 docstring 참조)
KEYWORDS = ["체비지", "청산금", "보류지", "수탁자", "간주취득", "입주권"]
KEYWORDS_ALL = KEYWORDS + ["정비사업", "재개발", "취득세", "신탁", "재산세", "분리과세"]

# 정비·세무 맥락이 함께 있어야 채택 (신탁 어휘 단독 채택 금지 — 담보신탁 일반 질의 유입 방지)
CORE = re.compile(
    r"정비사업|재개발|재건축|관리처분|조합원|주택조합|체비지|보류지|청산금|현금청산|"
    r"주거환경개선|정비구역|정비기반시설|입주권|종전부동산|가로주택|소규모주택|도시개발")
TAX = re.compile(r"취득세|재산세|양도소득|종합부동산|지방세|과세|비과세|감면|세액|세율|농어촌특별세|분리과세")


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
    if not s:
        return ""
    s = str(s)
    s = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), s)
    s = re.sub(r"&#x([0-9a-fA-F]+);", lambda m: chr(int(m.group(1), 16)), s)
    s = s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    return s.strip()


def search(keyword, display=100):
    if len(keyword.split()) > 1:
        raise ValueError(f"expc 는 다어절이면 0건이 된다 — 단어 1개로: {keyword!r}")
    url = (f"{BASE}/lawSearch.do?OC={OC}&target=expc"
           f"&query={quote(keyword)}&type=JSON&display={display}")
    box = json.loads(_get(url)).get("Expc", {})
    items = box.get("expc") or []
    return [items] if isinstance(items, dict) else items


def body(expc_id):
    url = f"{BASE}/lawService.do?OC={OC}&target=expc&ID={expc_id}&type=JSON"
    raw = json.loads(_get(url))
    d = raw.get("ExpcService") or raw.get("Expc") or raw
    if isinstance(d, dict) and "expc" in d:
        d = d["expc"]
    if isinstance(d, list):
        d = d[0] if d else {}
    return d if isinstance(d, dict) else {}


def ymd(s):
    s = re.sub(r"\D", "", str(s or ""))
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 else ""


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    kws = KEYWORDS_ALL if "--all" in sys.argv else (args or KEYWORDS)
    OUT.mkdir(parents=True, exist_ok=True)
    seen, wrote, skipped = set(), [], {"구법": 0, "무관": 0, "본문없음": 0}

    for kw in kws:
        hits = search(kw)
        print(f"  '{kw}' → {len(hits)}건")
        picked = 0
        for h in sorted(hits, key=lambda x: ymd(x.get("회신일자")), reverse=True):
            if picked >= PER_KEYWORD:
                break
            eid = h.get("법령해석례일련번호")
            if eid in seen:
                continue
            name = _clean(h.get("안건명"))
            date = ymd(h.get("회신일자"))
            if not date or date < CUTOFF:
                skipped["구법"] += 1
                continue
            if not (CORE.search(name) and TAX.search(name)):
                skipped["무관"] += 1
                continue

            d = body(eid)
            질의 = _clean(d.get("질의요지"))
            회답 = _clean(d.get("회답"))
            이유 = _clean(d.get("이유"))
            if not 회답:
                skipped["본문없음"] += 1
                continue
            seen.add(eid)
            picked += 1

            안건번호 = _clean(d.get("안건번호")) or eid
            기관 = _clean(d.get("해석기관명")) or "법제처"
            라벨 = f"{기관} 해석 {안건번호}"

            fm = ("---\n"
                  "자료유형: 유권해석\n"
                  f"제목: {name}\n"
                  f"회신기관: {기관}\n"
                  f"문서번호: \"{안건번호}\"\n"
                  f"사건번호: \"{안건번호}\"\n"      # 근거 인용 매칭용
                  f"법령명: {라벨}\n"
                  f"회신일자: {date}\n"
                  f"질의기관: {_clean(d.get('질의기관명'))}\n"
                  f"쟁점: {kw}\n"
                  f"일련번호: \"{eid}\"\n"
                  "출처: 국가법령정보센터 법령해석례(expc)\n"
                  f"최종확인일: {CONFIRM}\n"
                  "---\n")

            doc = [fm, f"\n# {라벨} ({name[:70]})\n",
                   f"\n> 회신일자 {date} 기준 해석이다. 이후 법령 개정 여부를 반드시 확인할 것.\n"]
            if 질의:
                doc.append(f"\n## 질의요지\n\n{질의}\n")
            doc.append(f"\n## 회답\n\n{회답}\n")
            if 이유:
                doc.append(f"\n## 이유\n\n{이유}\n")

            fn = f"{date}_{re.sub(r'[^0-9A-Za-z가-힣-]', '', 안건번호)}.md"
            (OUT / fn).write_text("".join(doc).rstrip() + "\n", encoding="utf-8")
            wrote.append((라벨, date, kw, name))
            print(f"    ✓ {fn}: {name[:50]}")

    print(f"\n=== 수집 {len(wrote)}건 / 제외 {skipped} ===")
    for l, d, k, n in sorted(wrote, key=lambda x: x[1], reverse=True):
        print(f"{d}  {l:22s} {k:6s} {n[:56]}")


if __name__ == "__main__":
    main()
