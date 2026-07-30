# scripts — 도구 (추후 구현)

## 1. 벡터 인덱스 빌드 (`build-index`)
`corpus/`의 md를 읽어 청킹 → 임베딩 → 벡터 저장소에 적재.
자료 추가/교체 시 재실행하여 검색 인덱스를 갱신한다.

- 입력: `corpus/**/*.md` (front matter 메타데이터 포함)
- 청킹 규칙: `docs/metadata-guide.md` (법령=조 단위, 판례=사건 단위, 유권해석=질의-회신 단위)
- 출력: 벡터 저장소 (초기엔 경량 sqlite/JSON, 확장 시 pgvector/Chroma)

## 2. 개정 감지 알림 (`check-revisions`)
`index/법령_시행일_인덱스.md`의 시행일과 국가법령정보 Open API의 최신 시행일을 비교.
다르면 명근에게만 이메일/텔레그램 알림 → 명근이 해당 md 교체.

- 실행 주기: 정기 예약 (예: 매일 1회)
- 비교 기준: 법령ID → API 조회 → 시행일자 대조
- 알림 대상: 명근 1인 (주니어 대상 아님)
- 국가법령정보 API 접근은 별도 스킬/중계(Cloudflare relay) 참고

> 주의: 개정 감지 API는 '답변 경로'가 아니라 '알림 경로'에만 쓴다.
> 챗봇 답변은 항상 corpus의 로컬 md에만 근거한다.

## 3. 검색 품질 회귀 테스트 (`test-golden`)
`docs/검색품질_루프리포트.md`의 실무 질문 50개를 worker와 같은 경로로 돌려,
기대 조문이 몇 위에 오는지 측정한다. `retrieve.mjs`의 튜닝 상수를 건드릴 때마다
실행해 **다른 질문이 깨지지 않았는지** 확인하는 것이 목적이다.

```bash
node scripts/build-index.mjs                                   # 인덱스 먼저 생성
node scripts/test-golden.mjs --diff scripts/golden-baseline.json   # 회귀 확인
node scripts/test-golden.mjs --out scripts/golden-baseline.json    # 기준선 갱신
```

- 질문·기대조문: `scripts/golden-set.json`
- 기준선: `scripts/golden-baseline.json` (개선을 반영했으면 함께 갱신하고 커밋)
- 판정은 "기준선 대비 회귀 여부". 미검색 건수 자체는 아직 안 고친 결함(P2·P3·P12 등)
  때문이므로 0이 되기 전까지는 실패로 보지 않는다.
