#!/usr/bin/env python3
# 행정규칙(고시) XML → corpus/admin_rules/*.md
import subprocess, re, os

import pathlib
OUT_DIR = str(pathlib.Path(__file__).resolve().parent.parent / "corpus" / "admin_rules")
CONFIRM_DATE = "2026-07-23"

RULES = [
    # (ID, 파일명)
    ("2100000235448", "정비사업의임대주택및주택규모별건설비율.md"),
    ("2100000246728", "정비사업공사비검증기준.md"),
    ("2100000262834", "정비사업계약업무처리기준.md"),
    # 2026-07-24 추가: 실무 빈도 높은 국토부 고시 3종
    ("2100000282452", "주택재건축판정을위한재건축진단기준.md"),
    ("2100000282446", "재건축초과이익환수업무처리지침.md"),
    ("2100000271910", "정비사업조합설립추진위원회운영규정.md"),
]

def fetch(rid):
    url = f"https://www.law.go.kr/DRF/lawService.do?OC=law-bot&target=admrul&ID={rid}&type=XML"
    for _ in range(4):
        r = subprocess.run(['curl','-sS','--max-time','40',url], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout
    raise RuntimeError(f"fetch 실패 ID={rid}")

def ymd(s):
    s = (s or "").strip()
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 else s

def tag(xml, name):
    m = re.search(rf'<{name}[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</{name}>', xml, re.DOTALL)
    return m.group(1).strip() if m else ""

def build(rid, fname):
    xml = fetch(rid)
    name = tag(xml, '행정규칙명')
    kind = tag(xml, '행정규칙종류')
    issue_no = tag(xml, '발령번호')
    issue_date = ymd(tag(xml, '발령일자'))
    eff_date = ymd(tag(xml, '시행일자'))
    ministry = tag(xml, '소관부처명')

    # 조문내용 블록들 순회
    blocks = re.findall(r'<조문내용>\s*<!\[CDATA\[(.*?)\]\]>\s*</조문내용>', xml, re.DOTALL)
    md_parts = []
    for raw in blocks:
        text = raw.strip()
        if not text:
            continue
        first = text.split("\n", 1)[0].strip()
        # 장·절 제목 블록은 스킵 (제N장/제N절만 있는 줄)
        if re.match(r'^제\d+장', first) or re.match(r'^제\d+절', first):
            if not re.search(r'제\d+조', first):
                continue
        m = re.match(r'^(제(\d+)조(?:의(\d+))?)\s*(\(([^)]*)\))?', first)
        if not m:
            continue  # 조문 아님
        label = m.group(1)
        title = m.group(5) or ""
        heading = label + (f"({title})" if title else "")
        # 헤더 접두사 제거 → 본문
        prefix = m.group(0)
        lines = text.split("\n")
        lines[0] = lines[0][len(prefix):].strip() if lines[0].startswith(prefix) else lines[0]
        body = "\n".join(re.sub(r'[ \t]+', ' ', ln).rstrip() for ln in lines).strip()
        md_parts.append(f"## {heading}\n\n{body}" if body else f"## {heading}")

    # 폴백: 제N조 구조가 아닌 고시(예: 재건축진단 기준의 "1-1-1." 번호체계)는
    # 조문 파싱이 비므로, 원문 블록을 제N장 단위로 통째 수록한다.
    if not md_parts:
        for raw in blocks:
            text = raw.strip()
            if not text:
                continue
            for seg in re.split(r'(?m)(?=^\s*제\d+장)', text):
                seg = seg.strip()
                if not seg:
                    continue
                first = seg.split("\n", 1)[0].strip()
                is_ch = bool(re.match(r'^제\d+장', first))
                head = first if is_ch else "본문"
                lines = seg.split("\n")[1:] if is_ch else seg.split("\n")
                body = "\n".join(re.sub(r'[ \t]+', ' ', ln).rstrip() for ln in lines).strip()
                md_parts.append(f"## {head}\n\n{body}" if body else f"## {head}")
        # 별표(평가표 등)가 첨부서식(hwp/pdf)로만 제공되면 그 존재를 명시(점수표는 원문 확인 안내)
        btitles = [b.strip() for b in re.findall(r'<별표제목>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</별표제목>', xml) if b.strip() and b.strip() != "삭제"]
        if btitles:
            md_parts.append("## 별표(첨부서식)\n\n다음 평가표·서식은 고시 별표(첨부파일)로 제공되며 구체적 배점·항목은 원문 별표에서 확인해야 합니다: " + ", ".join(btitles))

    issue_fmt = f"제{issue_no}호" if issue_no and not issue_no.startswith("제") else issue_no
    fm = (
        "---\n"
        "자료유형: 행정규칙\n"
        f"행정규칙명: {name}\n"
        f"법령명: {name}\n"   # citation·검색 호환(법령명 필드에 규칙명)
        f"종류: {kind}\n"
        f'행정규칙ID: "{rid}"\n'
        f'발령번호: "{issue_fmt}"\n'
        f"발령일자: {issue_date}\n"
        f"시행일자: {eff_date}\n"
        f"소관부처: {ministry}\n"
        f"버전: {eff_date}\n"
        "출처: 국가법령정보센터 (https://www.law.go.kr)\n"
        f"최종확인일: {CONFIRM_DATE}\n"
        "---\n"
    )
    doc = fm + "\n# " + name + "\n\n" + "\n\n".join(md_parts)
    doc = doc.rstrip() + "\n"
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, fname)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(doc)
    art = doc.count('\n## 제')
    print(f"✓ {fname}: {name} | {kind} ID={rid} 시행={eff_date} | 조문 {art}개 | {len(doc):,}자")
    return dict(name=name, rid=rid, eff=eff_date, fname=fname, kind=kind)

if __name__ == '__main__':
    results = [build(rid, fn) for rid, fn in RULES]
    print("\n=== 인덱스용 요약 ===")
    for r in results:
        print(f"{r['name']}\t{r['kind']}\t{r['rid']}\t{r['eff']}\tcorpus/admin_rules/{r['fname']}")
