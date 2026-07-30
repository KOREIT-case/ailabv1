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

## 4. 배포 (`deploy.sh` / GitHub Actions)
배포가 네 조각(인덱스 빌드 → KV 업로드 → 워커 배포 → 구주소 리다이렉트)이라
하나만 빠뜨리면 증상이 헷갈린다. 한 번에 수행한다.

```bash
bash scripts/deploy.sh          # 전체
bash scripts/deploy.sh corpus   # 자료만 (인덱스 + KV)
bash scripts/deploy.sh code     # 코드만 (워커 + 리다이렉트)
```

모바일에서는 터미널·wrangler 로그인이 안 되므로 **GitHub Actions 버튼**을 쓴다:
`Actions → 챗봇 배포 → Run workflow`. 최초 1회 저장소 시크릿
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 등록이 필요하다
(`.github/workflows/deploy.yml` 상단 주석 참조).

## 5. 아직 연결되지 않은 회귀 데이터
`tax-cases.json`(114문항) / `proc-cases.json`(51문항)은 세무·절차 회귀 질문셋이다.
원래 실행기(`test-tax.mjs`)가 `expandTaxContext`·`expandRedevContext`·`TAX_INTENT` 등
**세무 라우팅 로직에 묶여 있어** 그 로직 없이는 돌지 않는다. 질문셋 자체는 손실되면
아까우므로 데이터만 먼저 옮겨 뒀다. 세무 라우팅 이식 여부를 정한 뒤 연결한다.
