#!/usr/bin/env python3
# 세금 관련 법령 일괄 변환 (전문/장발췌/키워드발췌 지원)
import subprocess, re, os

import pathlib
OUT_DIR = str(pathlib.Path(__file__).resolve().parent.parent / "corpus" / "laws")
CONFIRM = "2026-07-23"
KW = ["정비사업","재개발","재건축","조합원입주권","대토","가로주택","소규모주택",
      "소규모재건축","소규모재개발","도시환경정비","주거환경개선"]

LAWS = [
  dict(mst="286607", fn="지방세특례제한법.md", mode="full"),
  dict(mst="287191", fn="지방세특례제한법시행령.md", mode="full"),
  dict(mst="282707", fn="지방세특례제한법시행규칙.md", mode="full", skip_tables=True),
  dict(mst="280409", fn="조세특례제한법.md", mode="kw"),
  dict(mst="287181", fn="조세특례제한법시행령.md", mode="kw"),
  dict(mst="280405", fn="소득세법.md", mode="chap", keep=["총칙","양도소득"]),
  dict(mst="286211", fn="소득세법시행령.md", mode="chap", keep=["총칙","양도소득"]),
  dict(mst="280417", fn="종합부동산세법.md", mode="full"),
  dict(mst="283639", fn="종합부동산세법시행령.md", mode="full"),
  dict(mst="285905", fn="농어촌특별세법.md", mode="full"),
  dict(mst="280835", fn="농어촌특별세법시행령.md", mode="full"),
  dict(mst="283257", fn="지방세기본법.md", mode="full"),
  dict(mst="286471", fn="지방세기본법시행령.md", mode="full"),
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
    md=[]; chapter="";
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
        # 텍스트 추출
        parts=re.findall(r'<(조문내용|항내용|호내용|목내용)>\s*<!\[CDATA\[(.*?)\]\]>', block, re.DOTALL)
        alltext=' '.join(p[1] for p in parts)
        # keep 판단
        mode=cfg['mode']
        if mode=='full': keep=True
        elif mode=='chap': keep=any(k in chapter for k in cfg['keep'])
        elif mode=='kw': keep=('총칙' in chapter) or any(k in alltext for k in KW)
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
                    i=rest.find(')');
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
    scope = {"chap":"발췌: 총칙·양도소득","kw":"발췌: 정비사업 관련 조문","full":"전문"}[cfg['mode']]
    fm=("---\n자료유형: 법령\n"+f"법령명: {name}\n법령ID: \"{lid}\"\n공포번호: \"{pno_f}\"\n"
        f"공포일자: {pub}\n시행일자: {eff}\n소관부처: {mini}\n버전: {eff}\n"
        f"수록범위: {scope}\n출처: 국가법령정보센터 (https://www.law.go.kr)\n최종확인일: {CONFIRM}\n---\n")
    doc=fm+"\n# "+name+(f" ({scope})" if cfg['mode']!='full' else "")+"\n\n"+arts
    if tbl: doc+="\n\n"+tbl
    doc=doc.rstrip()+"\n"
    open(os.path.join(OUT_DIR,cfg['fn']),'w',encoding='utf-8').write(doc)
    print(f"✓ {cfg['fn']}: {name} | {cfg['mode']} | 조문 {doc.count(chr(10)+'## 제')}개 | {len(doc):,}자")
