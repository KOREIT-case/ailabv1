#!/usr/bin/env python3
# 국가법령정보 API XML → corpus/laws/*.md 변환기
import subprocess, re, sys, os

import pathlib
OUT_DIR = str(pathlib.Path(__file__).resolve().parent.parent / "corpus" / "laws")
CONFIRM_DATE = "2026-07-23"  # 최종확인일 (오늘)

# 별표(서식)를 제외할 파일 — 신고서식 등 노이즈·대용량 방지 (조문만 보존)
SKIP_TABLES = {"지방세법시행규칙.md"}

LAWS = [
    # (MST, 파일명)
    ("286539", "노후계획도시정비및지원에관한특별법.md"),
    ("287271", "노후계획도시정비및지원에관한특별법시행령.md"),
    ("262111", "노후계획도시정비및지원에관한특별법시행규칙.md"),
    ("284083", "빈집및소규모주택정비에관한특례법.md"),
    ("287301", "빈집및소규모주택정비에관한특례법시행령.md"),
    ("283805", "빈집및소규모주택정비에관한특례법시행규칙.md"),
    ("286575", "수도권정비계획법.md"),
    ("277967", "수도권정비계획법시행령.md"),
    ("282559", "지방세법.md"),
    ("287223", "지방세법시행령.md"),
    ("287031", "지방세법시행규칙.md"),
]

def fetch(mst):
    url = f"https://www.law.go.kr/DRF/lawService.do?OC=law-bot&target=law&MST={mst}&type=XML"
    for _ in range(4):
        r = subprocess.run(['curl','-sS','--max-time','40',url], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout
    raise RuntimeError(f"fetch 실패 MST={mst}")

def ymd(s):
    s = (s or "").strip()
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 else s

def tag(xml, name):
    m = re.search(rf'<{name}[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</{name}>', xml, re.DOTALL)
    return m.group(1).strip() if m else ""

def clean(t):
    return re.sub(r'\s+', ' ', t).strip()

def convert_articles(xml):
    md = []
    for m in re.finditer(r'<조문단위[^>]*>.*?</조문단위>', xml, re.DOTALL):
        block = m.group(0)
        if re.search(r'<조문여부>전문</조문여부>', block):
            continue  # 장·절 제목 블록 스킵
        num_m = re.search(r'<조문번호>(\d+)</조문번호>', block)
        if not num_m:
            continue
        num = num_m.group(1)
        br_m = re.search(r'<조문가지번호>(\d+)</조문가지번호>', block)
        branch = br_m.group(1) if br_m else None
        ti_m = re.search(r'<조문제목><!\[CDATA\[(.*?)\]\]></조문제목>', block, re.DOTALL)
        title = ti_m.group(1).strip() if ti_m else ""

        label = f"제{num}조" + (f"의{branch}" if branch else "")
        heading = label + (f"({title})" if title else "")

        parts = re.findall(r'<(조문내용|항내용|호내용|목내용)>\s*<!\[CDATA\[(.*?)\]\]>',
                            block, re.DOTALL)
        out_lines = []
        if parts and parts[0][0] == '조문내용':
            rest = parts[0][1]
            # 헤더 접두사(제N조(제목)) 제거 → 본문 도입부만 남김
            if rest.startswith(label):
                rest = rest[len(label):]
                if title and rest.startswith(f"({title})"):
                    rest = rest[len(f"({title})"):]
                elif rest.startswith('('):
                    idx = rest.find(')')
                    if idx != -1:
                        rest = rest[idx+1:]
            rest = clean(rest)
            if rest:
                out_lines.append(rest)
            body_parts = parts[1:]
        else:
            body_parts = parts

        for ttype, txt in body_parts:
            txt = clean(txt)
            if not txt:
                continue
            if ttype == '항내용':
                out_lines.append('')  # 항 앞 빈 줄
            out_lines.append(txt)

        body = '\n'.join(out_lines).strip()
        md.append(f"## {heading}\n\n{body}" if body else f"## {heading}")
    return '\n\n'.join(md)

def convert_tables(xml):
    out = []
    for m in re.finditer(r'<별표단위[^>]*>(.*?)</별표단위>', xml, re.DOTALL):
        texts = re.findall(r'<!\[CDATA\[(.*?)\]\]>', m.group(1), re.DOTALL)
        full = '\n'.join(t.rstrip() for t in texts if t.strip())
        if not full.strip():
            continue
        lines = [l for l in full.split('\n') if l.strip()]
        title_line = clean(lines[0]) if lines else "별표"
        # 이미지·문서 파일명 라인 제거 (서식에 삽입된 gif/pdf/hwp 등 노이즈)
        bodylines = [l for l in full.split('\n')
                     if not re.search(r'\.(hwp|hwpx|pdf|docx?|gif|jpe?g|png|bmp|tif)\s*$',
                                      l.strip(), re.I)]
        body = '\n'.join(bodylines).strip()
        out.append(f"### [별표] {title_line}\n\n```\n{body}\n```")
    return '\n\n'.join(out)

def build(mst, fname):
    xml = fetch(mst)
    name = tag(xml, '법령명_한글')
    lawid = tag(xml, '법령ID')
    pub_date = ymd(tag(xml, '공포일자'))
    pub_no = tag(xml, '공포번호')
    eff_date = ymd(tag(xml, '시행일자'))
    ministry = tag(xml, '소관부처')
    pub_no_fmt = f"제{int(pub_no)}호" if pub_no.isdigit() else pub_no

    fm = (
        "---\n"
        "자료유형: 법령\n"
        f"법령명: {name}\n"
        f'법령ID: "{lawid}"\n'
        f'공포번호: "{pub_no_fmt}"\n'
        f"공포일자: {pub_date}\n"
        f"시행일자: {eff_date}\n"
        f"소관부처: {ministry}\n"
        f"버전: {eff_date}\n"
        "출처: 국가법령정보센터 (https://www.law.go.kr)\n"
        f"최종확인일: {CONFIRM_DATE}\n"
        "---\n"
    )
    articles = convert_articles(xml)
    tables = "" if fname in SKIP_TABLES else convert_tables(xml)
    doc = fm + "\n# " + name + "\n\n" + articles
    if tables:
        doc += "\n\n" + tables
    doc = doc.rstrip() + "\n"

    path = os.path.join(OUT_DIR, fname)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(doc)

    art_cnt = doc.count('\n## 제') + (1 if doc.startswith('## 제') else 0)
    tbl_cnt = doc.count('### [별표]')
    print(f"✓ {fname}: {name} | 법령ID={lawid} 시행={eff_date} | 조문 {art_cnt}개, 별표 {tbl_cnt}개 | {len(doc):,} bytes")
    return dict(name=name, lawid=lawid, eff=eff_date, fname=fname)

if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    results = [build(mst, fname) for mst, fname in LAWS]
    print("\n=== 인덱스용 요약 ===")
    for r in results:
        print(f"{r['name']}\t{r['lawid']}\t{r['eff']}\tcorpus/laws/{r['fname']}")
