# 도시정비 법률 챗봇 (ailabv1)

한국토지신탁 도시정비사업 담당 주니어들이 **법 기반 자료만으로** 신뢰할 수 있는
답변을 얻도록 돕는 사내 챗봇 프로젝트.

## 핵심 원칙

1. **환각 금지** — 웹 검색을 하지 않는다. 오직 이 저장소의 `corpus/` 안에 있는
   법 기반 자료(법령·판례·유권해석)만 근거로 답한다.
2. **근거 명시** — 모든 답변은 참고한 자료(법령 조문번호, 판례 사건번호, 유권해석
   문서번호)를 함께 제시한다.
3. **모르면 모른다** — 자료에 근거가 없으면 지어내지 않고 "해당 자료로는 답변할 수
   없습니다"라고 답한다.

## 저장소 구조

```
ailabv1/
├── README.md                     ← 지금 이 파일 (전체 개요)
├── docs/                         ← 설계·규칙 문서
│   ├── architecture.md           ← 전체 아키텍처 (읽어볼 것)
│   ├── metadata-guide.md         ← md 자료 작성 규칙 (자료 추가 전 필독)
│   └── 자료추가_가이드.md          ← 새 자료 넣는 실무 절차
├── corpus/                       ← 챗봇이 참고하는 법 기반 자료 (RAG 원천)
│   ├── laws/                     ← 법령 (전문, md)
│   ├── precedents/               ← 판례
│   └── interpretations/          ← 유권해석·행정해석
├── index/
│   └── 법령_시행일_인덱스.md        ← 개정 감지용 시행일 종합표
├── chatbot/                      ← 배포용 챗봇
│   ├── public/index.html         ← 채팅 화면 (프론트엔드)
│   └── worker/                   ← Cloudflare Worker (검색+API+DeepSeek 두뇌)
│       ├── system-prompt.md      ← 환각 방지 시스템 프롬프트
│       └── worker.example.js     ← Worker 로직 골격
└── scripts/                      ← 인덱스 빌드·개정 감지 등 도구 (추후)
```

## 데이터 흐름 (한눈에)

```
[브라우저 - HTML 채팅]
      │ 질문
      ▼
[Cloudflare Worker - 두뇌]
   1. corpus를 벡터검색 → 관련 자료 조각 top-K 추출
   2. system-prompt + 추출 자료 + 질문을 묶어서
   3. DeepSeek API 호출 → 답변 생성
      │ 답변 + 근거
      ▼
[화면에 표시]

※ 국가법령정보 Open API는 '답변'이 아니라 '개정 감지 알림'에만 쓴다.
  (scripts/ 의 개정 감지 도구가 백그라운드에서 시행일을 확인 → 명근에게 알림)
```

## 자료 관리 방식 (반자동 개정 반영)

- 모든 법령·판례·유권해석은 `corpus/`에 **md로 보관** → 챗봇 답변은 항상 로컬 자료 기반(빠름).
- 각 md는 상단 메타데이터에 `시행일자`/`버전`을 기록한다. → `docs/metadata-guide.md` 참조.
- 개정 감지 도구가 국가법령정보 API로 최신 시행일을 확인 → 우리 자료와 다르면
  **명근에게만 알림** → 명근이 해당 md를 교체한다. (반자동)

## 상태

🟢 **동작 확인 단계** — 정비사업 관련 법령·행정규칙 + 세금 법령까지 `corpus/`에
들어갔고, 검색→DeepSeek 생성 파이프라인이 종단 테스트를 통과했다.

- 완료: 도시정비 관련 법령·고시 corpus(도정법·노후계획도시법·소규모주택법·수도권정비법·
  세금법 다수 + 고시 3종), 어휘검색(BM25-lite), Worker 구현·**Cloudflare 배포**,
  로그인 게이트(공용 비밀번호), 랜덤 배경, 마크다운 렌더링, 환각 방지 검증.
- corpus 검색 인덱스는 번들 크기 한도(무료 1MB)를 피해 **Cloudflare KV**에 저장
  (`build-index.mjs` 생성 → `wrangler kv key put` 업로드). 번들엔 코드·화면·이미지만.
- 다음: 판례·유권해석 추가, 벡터검색 전환(bge-m3+Vectorize), 개정 감지 스크립트,
  검색 개선(별표 가중치 조정 등).

접속: https://jeongbi.explozn87.workers.dev (비밀번호 필요)

### 로컬에서 돌려보기
```bash
node scripts/build-index.mjs                              # corpus → 검색 인덱스
node scripts/test-retrieval.mjs                           # 질문→조문 검색만 확인 (키 불필요)
DEEPSEEK_KEY=sk-... node scripts/test-answer.mjs "질문"    # 종단(검색+생성) 테스트
```
