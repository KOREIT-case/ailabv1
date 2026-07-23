#!/usr/bin/env python3
# 지방세법 3종을 취득세·재산세(+총칙·등록면허세) 장만 남겨 재생성
import subprocess, re, os

import pathlib
OUT_DIR = str(pathlib.Path(__file__).resolve().parent.parent / "corpus" / "laws")
CONFIRM_DATE = "2026-07-23"
KEEP = ["총칙", "취득세", "등록면허세", "재산세"]  # 이 키워드가 장 제목에 있으면 유지
LAWS = [
    ("282559", "지방세법.md"),
    ("287223", "지방세법시행령.md"),
    ("287031", "지방세법시행규칙.md"),
]
SKIP_TABLES = {"지방세법시행규칙.md"}

def fetch(mst):
    url = f"https://www.law.go.kr/DRF/lawService.do?OC=law-bot&target=law&MST={mst}&type=XML"
    for _ in range(4):
        r = subprocess.run(['curl','-sS','--max-time','40',url], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout
    raise RuntimeError(f"fetch 실패 {mst}")

def ymd(s):
    s=(s or '').strip(); return f"{s[0:4]}-{s[4:6]}-{s[6:8]}" if len(s)==8 else s
def tag(x,n):
    m=re.search(rf'<{n}[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</{n}>', x, re.DOTALL); return m.group(1).strip() if m else ""
def clean(t): return re.sub(r'\s+',' ',t).strip()

def convert(xml, skip_tables):
    md=[]; keep=True; kept_ch=None
    for m in re.finditer(r'<조문단위[^>]*>.*?</조문단위>', xml, re.DOTALL):
        block=m.group(0)
        is_jeonmun = re.search(r'<조문여부>전문</조문여부>', block)
        if is_jeonmun:
            t=re.search(r'<조문내용>\s*<!\[CDATA\[(.*?)\]\]>', block, re.DOTALL)
            txt=t.group(1).strip() if t else ""
            cm=re.match(r'^제(\d+)장\s*(.*)$', txt)
            if cm:  # 새 장 시작 → keep 여부 갱신
                name=cm.group(2).strip()
                keep = any(k in name for k in KEEP)
                if keep: kept_ch=name
            continue
        if not keep:
            continue
        num_m=re.search(r'<조문번호>(\d+)</조문번호>', block)
        if not num_m: continue
        num=num_m.group(1)
        br_m=re.search(r'<조문가지번호>(\d+)</조문가지번호>', block)
        branch=br_m.group(1) if br_m else None
        ti_m=re.search(r'<조문제목><!\[CDATA\[(.*?)\]\]></조문제목>', block, re.DOTALL)
        title=ti_m.group(1).strip() if ti_m else ""
        label=f"제{num}조"+(f"의{branch}" if branch else "")
        heading=label+(f"({title})" if title else "")
        parts=re.findall(r'<(조문내용|항내용|호내용|목내용)>\s*<!\[CDATA\[(.*?)\]\]>', block, re.DOTALL)
        out=[]
        if parts and parts[0][0]=='조문내용':
            rest=parts[0][1]
            if rest.startswith(label):
                rest=rest[len(label):]
                if title and rest.startswith(f"({title})"): rest=rest[len(f'({title})'):]
                elif rest.startswith('('):
                    i=rest.find(')');
                    if i!=-1: rest=rest[i+1:]
            rest=clean(rest)
            if rest: out.append(rest)
            body_parts=parts[1:]
        else: body_parts=parts
        for tt,txt in body_parts:
            txt=clean(txt)
            if not txt: continue
            if tt=='항내용': out.append('')
            out.append(txt)
        body='\n'.join(out).strip()
        md.append(f"## {heading}\n\n{body}" if body else f"## {heading}")
    return '\n\n'.join(md)

def convert_tables(xml):
    out=[]
    for m in re.finditer(r'<별표단위[^>]*>(.*?)</별표단위>', xml, re.DOTALL):
        texts=re.findall(r'<!\[CDATA\[(.*?)\]\]>', m.group(1), re.DOTALL)
        full='\n'.join(t.rstrip() for t in texts if t.strip())
        if not full.strip(): continue
        title=clean(full.split('\n')[0])
        bl=[l for l in full.split('\n') if not re.search(r'\.(hwp|hwpx|pdf|docx?|gif|jpe?g|png)\s*$', l.strip(), re.I)]
        out.append(f"### [별표] {title}\n\n```\n{chr(10).join(bl).strip()}\n```")
    return '\n\n'.join(out)

for mst,fname in LAWS:
    xml=fetch(mst)
    name=tag(xml,'법령명_한글'); lawid=tag(xml,'법령ID')
    pub=ymd(tag(xml,'공포일자')); pno=tag(xml,'공포번호'); eff=ymd(tag(xml,'시행일자')); mini=tag(xml,'소관부처')
    pno_f=f"제{int(pno)}호" if pno.isdigit() else pno
    arts=convert(xml, fname in SKIP_TABLES)
    tables="" if fname in SKIP_TABLES else convert_tables(xml)
    fm=("---\n자료유형: 법령\n"
        f"법령명: {name}\n법령ID: \"{lawid}\"\n공포번호: \"{pno_f}\"\n공포일자: {pub}\n"
        f"시행일자: {eff}\n소관부처: {mini}\n버전: {eff}\n"
        "수록범위: 취득세·등록면허세·재산세·총칙 장만 (도시정비 무관 세목 제외)\n"
        "출처: 국가법령정보센터 (https://www.law.go.kr)\n"
        f"최종확인일: {CONFIRM_DATE}\n---\n")
    doc=fm+"\n# "+name+" (발췌: 취득세·재산세 등)\n\n"+arts
    if tables: doc+="\n\n"+tables
    doc=doc.rstrip()+"\n"
    open(os.path.join(OUT_DIR,fname),'w',encoding='utf-8').write(doc)
    print(f"✓ {fname}: 조문 {doc.count(chr(10)+'## 제')}개, {len(doc):,}자")
