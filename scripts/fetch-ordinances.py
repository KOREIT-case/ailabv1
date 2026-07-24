#!/usr/bin/env python3
# 자치법규(조례·규칙) XML → corpus/ordinances/*.md  (법령과 동일한 md 포맷)
import subprocess, re, os
import pathlib
OUT=str(pathlib.Path(__file__).resolve().parent.parent/"corpus"/"ordinances"); CONFIRM="2026-07-23"
ORDINS=[
 # 서울특별시
 ("2130189","서울특별시도시및주거환경정비조례.md"),
 ("2122221","서울특별시도시및주거환경정비조례시행규칙.md"),
 ("2147713","서울특별시빈집및소규모주택정비에관한조례.md"),
 ("2130733","서울특별시빈집및소규모주택정비에관한조례시행규칙.md"),
 ("2147725","서울특별시도시재정비촉진을위한조례.md"),
 # 부산광역시
 ("2079585","부산광역시도시및주거환경정비조례.md"),
 ("2040629","부산광역시도시및주거환경정비조례시행규칙.md"),
 ("2146747","부산광역시빈집및소규모주택정비조례.md"),
 # 대구광역시
 ("1968229","대구광역시도시및주거환경정비조례.md"),
 ("1954871","대구광역시도시및주거환경정비조례시행규칙.md"),
 ("1968241","대구광역시도시재정비촉진조례.md"),
 ("2134013","대구광역시빈집및소규모주택정비조례.md"),
 # 인천광역시
 ("2104539","인천광역시도시및주거환경정비조례.md"),
 ("2088977","인천광역시도시및주거환경정비조례시행규칙.md"),
 ("2031949","인천광역시빈집및소규모주택정비에관한조례.md"),
 # 광주광역시
 ("2091179","광주광역시도시및주거환경정비조례.md"),
 ("1949313","광주광역시빈집및소규모주택정비조례.md"),
 # 대전광역시
 ("2098217","대전광역시도시및주거환경정비조례.md"),
 ("1938609","대전광역시도시및주거환경정비조례시행규칙.md"),
 ("1914613","대전광역시빈집및소규모주택정비에관한조례.md"),
 # 울산광역시
 ("2104607","울산광역시도시및주거환경정비조례.md"),
 ("2110533","울산광역시빈집및소규모주택정비조례.md"),
 # 경기도
 ("2136197","경기도도시및주거환경정비조례.md"),
 ("2106595","경기도빈집및소규모주택정비에관한조례.md"),
]
def fetch(mst):
    url=f"https://www.law.go.kr/DRF/lawService.do?OC=law-bot&target=ordin&MST={mst}&type=XML"
    for _ in range(4):
        r=subprocess.run(['curl','-sS','--max-time','40',url],capture_output=True,text=True)
        if r.returncode==0 and r.stdout.strip(): return r.stdout
    raise RuntimeError(f"fail {mst}")
def ymd(s): s=(s or '').strip(); return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s)==8 else s
def tg(x,n):
    m=re.search(rf'<{n}[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</{n}>',x,re.DOTALL); return m.group(1).strip() if m else ""
def cln(t): return re.sub(r'[ \t]+',' ',t).rstrip()

def convert(xml):
    md=[]
    for m in re.finditer(r"<조\s[^>]*조문번호='(\d+)'[^>]*>(.*?)</조>", xml, re.DOTALL):
        num6=m.group(1); block=m.group(2)
        if re.search(r'<조문여부>N</조문여부>', block): continue  # 장·절 제목
        jo=int(num6[:4]); br=int(num6[4:6])
        label=f"제{jo}조"+(f"의{br}" if br else "")
        title_m=re.search(r'<조제목><!\[CDATA\[(.*?)\]\]></조제목>', block, re.DOTALL)
        title=title_m.group(1).strip() if title_m else ""
        heading=label+(f"({title})" if title else "")
        cont_m=re.search(r'<조내용><!\[CDATA\[(.*?)\]\]></조내용>', block, re.DOTALL)
        text=cont_m.group(1).strip() if cont_m else ""
        # 접두사 "제N조(제목)" 제거
        first=text.split("\n",1)[0]
        pref=re.match(r'^(제\d+조(?:의\d+)?)\s*(\([^)]*\))?', first)
        if pref and text.startswith(pref.group(0)):
            lines=text.split("\n"); lines[0]=lines[0][len(pref.group(0)):].strip()
            text="\n".join(lines)
        body="\n".join(cln(l) for l in text.split("\n")).strip()
        md.append(f"## {heading}\n\n{body}" if body else f"## {heading}")
    return "\n\n".join(md)

def tables(xml):
    out=[]
    for m in re.finditer(r'<별표단위[^>]*>(.*?)</별표단위>', xml, re.DOTALL):
        texts=re.findall(r'<!\[CDATA\[(.*?)\]\]>', m.group(1), re.DOTALL)
        full='\n'.join(t.rstrip() for t in texts if t.strip())
        if not full.strip(): continue
        title=re.sub(r'\s+',' ',full.split('\n')[0]).strip()
        bl=[l for l in full.split('\n') if not re.search(r'\.(hwp|hwpx|pdf|docx?|gif|jpe?g|png)\s*$', l.strip(), re.I)]
        out.append(f"### [별표] {title}\n\n```\n{chr(10).join(bl).strip()}\n```")
    return "\n\n".join(out)

os.makedirs(OUT,exist_ok=True)
for mst,fn in ORDINS:
    xml=fetch(mst)
    name=tg(xml,'자치법규명'); lid=tg(xml,'자치법규ID'); pub=ymd(tg(xml,'공포일자'))
    pno=tg(xml,'공포번호'); eff=ymd(tg(xml,'시행일자')); gov=tg(xml,'지자체기관명')
    gov=re.sub(r'^\(구\)\s*','',gov)  # law.go.kr DB의 "(구)광주광역시" 표기 잔재 정리
    pno_f=f"제{int(pno)}호" if pno.isdigit() else pno
    arts=convert(xml); tbl=tables(xml)
    fm=("---\n자료유형: 조례\n"+f"법령명: {name}\n자치법규ID: \"{lid}\"\n공포번호: \"{pno_f}\"\n"
        f"공포일자: {pub}\n시행일자: {eff}\n지자체: {gov}\n버전: {eff}\n"
        "출처: 국가법령정보센터 자치법규 (https://www.law.go.kr)\n"+f"최종확인일: {CONFIRM}\n---\n")
    doc=fm+"\n# "+name+"\n\n"+arts
    if tbl: doc+="\n\n"+tbl
    open(os.path.join(OUT,fn),'w',encoding='utf-8').write(doc.rstrip()+"\n")
    print(f"✓ {fn}: {name} | 시행 {eff} | 조문 {doc.count(chr(10)+'## 제')}개, 별표 {doc.count('### [별표]')}개")
