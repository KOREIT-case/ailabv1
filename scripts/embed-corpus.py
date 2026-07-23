import json, subprocess, time, os, struct
U="https://dosijeongbi-chatbot.explozn87.workers.dev"
SC="/tmp/claude-0/-home-user-ailabv1/df7b12a6-6c4a-5c05-8c50-ec4f37fd3a73/scratchpad"
JAR=f"{SC}/embed_cj.txt"
LOG=open(f"{SC}/embed_result.txt","w")
def log(s): LOG.write(s+"\n"); LOG.flush()

# 로그인
subprocess.run(['curl','-sS','--max-time','20','-X','POST',f'{U}/login','-H','Content-Type: application/json',
                '-d','{"name":"embed","password":"koreit"}','-c',JAR],capture_output=True,text=True)

d=json.load(open('/home/user/ailabv1/chatbot/worker/corpus-index.json'))
N=len(d)
log(f"청크 {N}개 임베딩 시작")
BATCH=32
vecs=[None]*N
bodyfile=f"{SC}/embed_body.json"
i=0
while i<N:
    texts=[d[j]['text'][:1200] for j in range(i,min(i+BATCH,N))]
    json.dump({'texts':texts}, open(bodyfile,'w'))
    ok=False
    for attempt in range(4):
        r=subprocess.run(['curl','-sS','--max-time','120','-X','POST',f'{U}/_embed','-b',JAR,
                          '-H','Content-Type: application/json','--data-binary',f'@{bodyfile}'],
                         capture_output=True,text=True)
        try:
            o=json.loads(r.stdout); v=o.get('vectors')
            if v and len(v)==len(texts):
                for k,vec in enumerate(v): vecs[i+k]=vec
                ok=True; break
            else:
                log(f"  batch {i}: 이상응답 {r.stdout[:120]}"); time.sleep(3*(attempt+1))
        except Exception as e:
            log(f"  batch {i}: 파싱실패 {r.stdout[:120]} {e}"); time.sleep(3*(attempt+1))
    if not ok:
        log(f"!! batch {i} 실패 — 중단"); break
    i+=BATCH
    if (i//BATCH)%10==0: log(f"  진행 {min(i,N)}/{N}")

done=sum(1 for v in vecs if v is not None)
log(f"임베딩 완료 {done}/{N}")
if done==N:
    # float32 정규화 후 int8 양자화하여 저장
    out=open(f"{SC}/corpus_vecs_int8.bin","wb")
    for v in vecs:
        import math
        n=math.sqrt(sum(x*x for x in v)) or 1.0
        out.write(bytes((max(-127,min(127,round(x/n*127)))&0xff) for x in v))
    out.close()
    log(f"int8 벡터 저장: {os.path.getsize(f'{SC}/corpus_vecs_int8.bin')} bytes (dim=1024, N={N})")
log("DONE")
LOG.close()
