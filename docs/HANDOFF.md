# 세션 인계 문서 (도시정비 법률 챗봇)

> 이 문서는 네트워크가 열린 새 세션에서 작업을 이어받기 위한 인계서다.
> 새 세션 시작 시 이 문서를 먼저 읽고, 아래 "새 세션에서 할 일"부터 진행한다.

## 1. 프로젝트 개요

- **주체**: 명근 (한국토지신탁, 도시정비사업 기획·리스크관리 총괄)
- **목표**: 회사 주니어들이 편하게 쓰는 **도시정비 법률 챗봇**
- **저장소**: `KOREIT-case/ailabv1`, 작업 브랜치 `claude/claude-code-galaxy-tab-80kjy6`
- **최우선 가치**: 정확성 / **환각 절대 금지** (틀린 답은 없느니만 못함)

## 2. 확정된 설계 결정 (합의 완료)

| 항목 | 결정 |
|---|---|
| 검색 범위 | 웹검색 차단. `corpus/`의 법 기반 자료(md)만 근거 |
| 답변 엔진 | DeepSeek API (`temperature:0`). 중국 전송 OK (금융회사, 유출 무관) |
| 자료 형식 | 전부 md 통일 — **법령도 뼈대만이 아니라 전문(B안)** |
| 법령 API 역할 | 답변용 아님. **개정 감지 알림 전용**으로만 사용 |
| 개정 반영 | 반자동 — 시행일 비교로 개정 감지 → 명근에게만 알림 → 명근이 md 교체 |
| 배포 형태 | HTML 프론트 + Cloudflare Worker 백엔드 (순수 HTML만으론 불가) |
| 검색 방식 | 벡터검색(RAG). 자료 커질 예정(판례·유권해석 대량) 전제 |
| 위계 | 답변 근거 우선순위 **법령 > 판례 > 유권해석** (system-prompt에 명시) |

### 핵심 설계 원리 (왜 이렇게 했나)
- **LLM은 검색 안 한다.** 검색·자료선별은 Worker가 함. DeepSeek은 넣어준 자료로 답만 생성.
  → 정제 안 된 정보 혼입은 Worker 단계에서 통제.
- **법령을 API 실시간이 아니라 md로** 둔 이유: 뼈대만 색인하면 조문 세부를 검색이 놓침.
  전문 md여야 세부까지 벡터검색 대상. 반자동 갱신이라 로컬 md도 며칠 내 최신 유지.
- 국가법령정보 API는 **개정 감지 알림 경로에만** 둠(답변 경로에서 제외).

## 3. 현재 저장소 상태 (이미 커밋됨)

```
ailabv1/
├── README.md                     전체 개요 + 데이터 흐름도
├── docs/
│   ├── architecture.md           설계 결정 전체 기록
│   ├── metadata-guide.md         ★ md 작성·메타데이터·청킹 규칙 (자료 넣기 전 필독)
│   ├── 자료추가_가이드.md          새 자료 넣는 실무 절차
│   └── HANDOFF.md                 (이 문서)
├── corpus/
│   ├── laws/          _TEMPLATE.md, _예시_도시정비법.md
│   ├── precedents/    _TEMPLATE.md
│   └── interpretations/ _TEMPLATE.md
├── index/법령_시행일_인덱스.md      개정 감지용 시행일 종합표
├── chatbot/
│   ├── public/index.html          채팅 화면 초안 (동작 UI)
│   └── worker/
│       ├── system-prompt.md       ★ 환각 방지 규칙 6개
│       └── worker.example.js       검색+DeepSeek 두뇌 골격
└── scripts/README.md              인덱스 빌드·개정 감지 도구 계획
```

## 4. 막혔던 지점 (왜 새 세션이 필요한가)

- 이전 세션(갤탭)은 **네트워크 정책이 GitHub·패키지 저장소만 허용**하는 잠금 모드였음.
- `www.law.go.kr` 등 정부 API가 egress 정책에서 **403 차단** → 법령을 받아 md로 변환 불가.
- WebFetch·curl·Cloudflare 중계 전부 같은 정책으로 차단됨. (조직 정책 거부라 우회 금지)
- → **새 세션에서 네트워크 정책을 law.go.kr(또는 전체) 허용으로 열고** 이 작업을 진행하기로 함.

> 참고: 최종 운영 챗봇은 이 제약과 무관. 실제 API 호출은 Cloudflare Worker(클라우드)가 함.
> 지금 막힌 건 "법령 대량 → md 1회 변환" 작업뿐.

## 5. ★ 새 세션에서 할 일 (바로 이것부터)

**작업: KV 네임스페이스 생성 → corpus-index 업로드 → 시크릿 등록 → 재배포.**
(코드는 이미 준비됨. 아래는 Cloudflare 계정 접근이 되는 환경에서 실행만 하면 된다.)

corpus 는 이제 Worker 번들이 아니라 Cloudflare KV(`CORPUS_KV`)에서 서빙한다.
worker.js 의 `loadIndex(env)` 가 콜드스타트에 KV `corpus-index` 키를 1회 읽어 캐시한다.

### 절차 (chatbot/worker 기준, wrangler 로그인 상태에서)
1. `node scripts/build-index.mjs` — corpus-index.json 최신화 (이미 커밋돼 있으면 생략 가능)
2. `npx wrangler kv namespace create CORPUS` — 출력 id 를
   `chatbot/worker/wrangler.toml` 의 `[[kv_namespaces]]` id(`REPLACE_WITH_KV_NAMESPACE_ID`)에 기입
3. `bash scripts/kv-upload.sh` — corpus-index.json → KV(`corpus-index` 키)
4. `npx wrangler secret put DEEPSEEK_KEY` / `npx wrangler secret put SITE_PASSWORD`
5. `npx wrangler deploy`
6. 배포 주소를 `chatbot/public/index.html` 의 `WORKER_URL` 에 기입(자체 서빙이면 생략)
7. **corpus 갱신 시**: 1) → 3) 만 반복(재배포 불필요, KV만 갱신).

### 참고 — 이번 세션(맥스)에서 이미 완료
- 세금 법령 6종 corpus 추가: 지방세특례제한법·조세특례제한법·소득세법·종합부동산세법·
  농어촌특별세법·지방세기본법 (법률 조문만. 소득세=총칙+양도소득, 조특법=정비사업 발췌).
  → `corpus/laws/`, 시행일 인덱스, corpus-index.json(1,592 청크) 반영.
- KV 전환 코드: `worker.js`(loadIndex), `wrangler.toml`([[kv_namespaces]]),
  `scripts/kv-upload.sh` 신규.
- 검색 검증 통과(취득세 감면→지특법 §74, 조합원입주권 양도세→소득세법 §89,
  정비사업조합 과세특례→조특법 §104의7).

### 세금 corpus 변환 방법 (재현/보강용)
- 변환기 골격은 대화 기록의 `convert_tax.py` 참고. 핵심: `target=law` 전문 XML →
  `<조문단위>` 순회, `조문여부=전문`(장절 제목) 스킵, `조문내용/항내용/호내용/목내용`
  CDATA 를 문서순 추출, `## 제N조(제목)` 헤딩(가지번호=제N조의M), 조문 사이 빈 줄.
- 소득세·조특법은 조항별 시행일이 나뉘어(1/1·7/1) 있어 현행 기준 시행일 **2026-07-01** 로 기록.
- 서식성 별표는 제외(지방세법 방침과 동일). 감면 세부가 시행령에 있는 경우 후속 보강 대상.

## 6. 그 다음 로드맵 (참고)
- 세금 시행령 보강(지특법·종부세 시행령의 감면 요건 세부)
- `scripts/check-revisions` (개정 감지 알림) 구현
- 판례·유권해석 추가 → 대량화 시 임베딩/벡터검색 전환(`retrieve.mjs` 교체, 인터페이스 유지)
- DeepSeek 한국어 법 해석 정확도 실측(샘플 질문셋)

---
*작성: 이전 세션(갤탭, 네트워크 잠금) → 갱신: 맥스 세션(세금 corpus + KV 전환).
이어받는 세션은 §5(배포)부터 시작.*
