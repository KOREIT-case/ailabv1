#!/usr/bin/env python3
# 추가 법령: 재건축초과이익환수법(재건축부담금) + 토지보상법(손실보상 발췌)
# fetch-tax-laws.py 와 동일한 파서. 큰 법(토지보상법)은 보상 관련 조문만 발췌(kw)해 슬림 유지.
import subprocess, re, os, pathlib
OUT_DIR = str(pathlib.Path(__file__).resolve().parent.parent / "corpus" / "laws")
CONFIRM = "2026-07-24"

# 손실보상 관련 발췌 키워드 (주거이전비·영업보상·이주정착금 등 실무 질문 대응)
BOSANG_KW = ["보상", "주거이전", "이주정착", "이주대책", "영업", "지장물", "이전비",
             "잔여지", "손실", "생활대책", "휴업", "감정평가", "이농비", "이어비", "축조물"]

LAWS = [
  dict(mst="277019", fn="재건축초과이익환수에관한법률.md", mode="full"),
  dict(mst="284841", fn="재건축초과이익환수에관한법률시행령.md", mode="full"),
  dict(mst="286903", fn="토지보상법.md", mode="kw", kw=BOSANG_KW),
  dict(mst="261727", fn="토지보상법시행규칙.md", mode="kw", kw=BOSANG_KW, skip_tables=True),
]

def fetch(mst):
    url=f"https://www.law.go.kr/DRF/lawService.do?OC=law-bot&target=law&MST={mst}&type=XML"
    for _ in range(4):
        r=subprocess.run(['curl','-sS','--max-time','50',url],capture_output=True,text=True)
        if r.returncode==0 and r.stdout.strip(): return r.stdout
    raise RuntimeError(f"fetch fail {mst}")
def ymd(s): s=(s or '').strip(); return f"{s[0:4]}-{s[4:6]}-{s[6:8]}" if len(s)==8 else s
def tg(x,n):
    m=re.search(rf'<{n}[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</{n}>',x,re.DOTALL); return m.group(1).strip() if m else ""
def clean(t): return re.sub(r'\s+',' ',t).strip()

def convert(xml, cfg):
    md=[]; chapter=""
    for m in re.finditer(r'<조문단위[^>]*>.*?</조문단위>', xml, re.DOTALL):
        block=m.group(0)
        if re.search(r'<조문여부>전문</조문여부>', block):
            t=re.search(r'<조문내용>\s*<!\[CDATA\[(.*?)\]\]>', block, re.DOTALL)
            if t:
                cm=re.match(r'^제(\d+)장(?:의\d+)?\s*(.*)$', t.group(1).strip())
                if cm: chapter=re.sub(r'\s*<.*','',cm.group(2)).strip()
            continue
        num_m=re.search(r'<조문번호>(\d+)</조문번호>', block)
        if not num_m: continue
        parts=re.findall(r'<(조문내용|항내용|호내용|목내용)>\s*<!\[CDATA\[(.*?)\]\]>', block, re.DOTALL)
        alltext=' '.join(p[1] for p in parts)
        mode=cfg['mode']
        if mode=='full': keep=True
        elif mode=='kw': keep=('총칙' in chapter) or any(k in alltext for k in cfg['kw'])
        else: keep=True
        if not keep: continue
        num=num_m.group(1)
        br_m=re.search(r'<조문가지번호>(\d+)</조문가지번호>', block); branch=br_m.group(1) if br_m else None
        ti=re.search(r'<조문제목><!\[CDATA\[(.*?)\]\]></조문제목>', block, re.DOTALL); title=ti.group(1).strip() if ti else ""
        label=f"제{num}조"+(f"의{branch}" if branch else ""); heading=label+(f"({title})" if title else "")
        out=[]
        if parts and parts[0][0]=='조문내용':
            rest=parts[0][1]
            if rest.startswith(label):
                rest=rest[len(label):]
                if title and rest.startswith(f"({title})"): rest=rest[len(f'({title})'):]
                elif rest.startswith('('):
                    i=rest.find(')')
                    if i!=-1: rest=rest[i+1:]
            rest=clean(rest)
            if rest: out.append(rest)
            bp=parts[1:]
        else: bp=parts
        for tt,txt in bp:
            txt=clean(txt)
            if not txt: continue
            if tt=='항내용': out.append('')
            out.append(txt)
        body='\n'.join(out).strip()
        md.append(f"## {heading}\n\n{body}" if body else f"## {heading}")
    return '\n\n'.join(md)

def tables(xml):
    out=[]
    for m in re.finditer(r'<별표단위[^>]*>(.*?)</별표단위>', xml, re.DOTALL):
        texts=re.findall(r'<!\[CDATA\[(.*?)\]\]>', m.group(1), re.DOTALL)
        full='\n'.join(t.rstrip() for t in texts if t.strip())
        if not full.strip(): continue
        title=clean(full.split('\n')[0])
        bl=[l for l in full.split('\n') if not re.search(r'\.(hwp|hwpx|pdf|docx?|gif|jpe?g|png)\s*$', l.strip(), re.I)]
        out.append(f"### [별표] {title}\n\n```\n{chr(10).join(bl).strip()}\n```")
    return '\n\n'.join(out)

for cfg in LAWS:
    xml=fetch(cfg['mst'])
    name=tg(xml,'법령명_한글'); lid=tg(xml,'법령ID'); pub=ymd(tg(xml,'공포일자'))
    pno=tg(xml,'공포번호'); eff=ymd(tg(xml,'시행일자')); mini=tg(xml,'소관부처')
    pno_f=f"제{int(pno)}호" if pno.isdigit() else pno
    arts=convert(xml,cfg)
    tbl="" if cfg.get('skip_tables') else tables(xml)
    scope = {"kw":"발췌: 손실보상 관련 조문","full":"전문"}[cfg['mode']]
    fm=("---\n자료유형: 법령\n"+f"법령명: {name}\n법령ID: \"{lid}\"\n공포번호: \"{pno_f}\"\n"
        f"공포일자: {pub}\n시행일자: {eff}\n소관부처: {mini}\n버전: {eff}\n"
        f"수록범위: {scope}\n출처: 국가법령정보센터 (https://www.law.go.kr)\n최종확인일: {CONFIRM}\n---\n")
    doc=fm+"\n# "+name+(f" ({scope})" if cfg['mode']!='full' else "")+"\n\n"+arts
    if tbl: doc+="\n\n"+tbl
    doc=doc.rstrip()+"\n"
    open(os.path.join(OUT_DIR,cfg['fn']),'w',encoding='utf-8').write(doc)
    print(f"✓ {cfg['fn']}: {name} | {cfg['mode']} | 조문 {doc.count(chr(10)+'## 제')}개 | {len(doc):,}자")
