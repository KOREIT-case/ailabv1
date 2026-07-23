#!/usr/bin/env python3
# 판례 상세(target=prec) → corpus/precedents/*.md
import subprocess, json, re, os
import pathlib
OUT=str(pathlib.Path(__file__).resolve().parent.parent/"corpus"/"precedents"); CONFIRM="2026-07-23"
CASES=[  # (판례일련번호, 쟁점태그)
 ("68353","재건축 매도청구"),("221769","조합설립인가"),("207571","조합설립인가"),
 ("619425","관리처분계획"),("238939","관리처분계획"),("192753","사업시행계획"),
 ("184790","사업시행계획"),("172053","정비구역 지정"),("168592","정비구역 지정"),
 ("164328","정비구역 지정"),("606503","조합원 지위·분양대상"),("240737","조합원 지위"),
 ("423576","취득세 감면"),
]
def strip(t): return re.sub(r'\s+',' ', re.sub(r'<[^>]+>','\n',str(t))).strip()
def fetch(cid):
    url=f"https://www.law.go.kr/DRF/lawService.do?OC=law-bot&target=prec&ID={cid}&type=JSON"
    for _ in range(4):
        r=subprocess.run(['curl','-sS','--max-time','30',url],capture_output=True,text=True)
        if r.returncode==0 and r.stdout.strip():
            try: return json.loads(r.stdout).get('PrecService',{})
            except: pass
    raise RuntimeError(f"fail {cid}")
def ymd(s): s=str(s).strip(); return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s)==8 else s
def sect(title, val):
    v=re.sub(r'<br\s*/?>','\n',str(val)); v=re.sub(r'<[^>]+>','',v).strip()
    return f"## {title}\n\n{v}\n\n" if v else ""

os.makedirs(OUT,exist_ok=True)
summ=[]
for cid,tag in CASES:
    s=fetch(cid)
    no=s.get('사건번호',''); name=s.get('사건명',''); court=s.get('법원명','')
    date=ymd(s.get('선고일자','')); kind=s.get('사건종류명','')
    fm=("---\n자료유형: 판례\n"
        f"사건명: {name}\n법령명: {court} {no}\n사건번호: \"{no}\"\n법원: {court}\n"
        f"선고일자: {date}\n사건종류: {kind}\n쟁점: {tag}\n"
        "출처: 국가법령정보센터 판례\n"
        f"최종확인일: {CONFIRM}\n---\n")
    body=(f"\n# {court} {no} ({name})\n\n"
          + sect("판시사항", s.get('판시사항',''))
          + sect("판결요지", s.get('판결요지',''))
          + sect("참조조문", s.get('참조조문',''))
          + sect("참조판례", s.get('참조판례','')))
    doc=(fm+body).rstrip()+"\n"
    fn=f"{no}.md"
    open(os.path.join(OUT,fn),'w',encoding='utf-8').write(doc)
    print(f"✓ {fn}: {court} {no} {name[:24]} | {tag} | {len(doc):,}자")
    summ.append((no,name,court,date,tag,fn))
print("\n=== 요약 ===")
for r in summ: print(f"{r[2]} {r[0]}\t{r[4]}\tcorpus/precedents/{r[5]}")
