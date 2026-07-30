# tax-line 보존본 (폐기 브랜치 `claude/tax-chatbot-improvement-kxck42`)

## 무엇인가
2026-07-25~27 사이 38커밋으로 진행된 **세무 강화 계통**의 산출물 중,
현행 계통으로 회수하지 못한 코드다. 브랜치는 폐기했고 이 사본만 남긴다.

## 왜 폐기했나
같은 `df8559c` 에서 갈라진 계통이 둘로 존재하면 다음 세션이 잘못된 쪽에서 시작한다.
실제로 이 저장소에서 같은 사고가 세 번 났다(아래 "사고 이력").

## 회수한 것 (커밋 0f60ab2 — 저장소 본체에 있음)
- `.github/workflows/deploy.yml`, `scripts/deploy.sh` — 배포 자동화(모바일 버튼 배포)
- `chatbot/redirect/` — 구주소(dosijeongbi-chatbot) 리다이렉트 워커
- `scripts/fetch-tax-decisions.py`, `scripts/fetch-interpretations.py` — 심판례·유권해석 수집기
- `scripts/tax-cases.json`(114문항), `scripts/proc-cases.json`(51문항) — 회귀 질문셋
- `docs/챗봇_안내서.md`

## 회수하지 않고 여기 보존만 한 것
- `retrieve.mjs` (739줄) — 세무 라우팅. 현행본(353줄) 대비 약 386줄이 추가분이다.
  주요 요소: `SEMOK_INTENT`/`semokIntent`(세목 라우팅), `LAW_SEMOK`/`chunkSemok`,
  `applyTypeFloor`(자료유형별 하한), `capPerSource`(출처별 상한),
  `expandTaxContext`/`expandRedevContext`(세무·정비 문맥 확장), `REDEV_INTENT`, `TAX_DOC`.
  **현행 계통 위에 그대로 얹으면 검색 거동이 크게 바뀐다.** 이식하려면 회수해 둔
  질문셋으로 먼저 현행 상태를 측정하고, 항목 단위로 옮기며 골든셋 회귀를 확인할 것.
- `test-tax.mjs`, `test-hybrid.mjs` — 위 함수들에 의존하는 실행기. 세무 라우팅과 한 몸이다.

## 사고 이력 — 같은 원인, 세 번
1. **07-27** 현행 계통 세션이 이 브랜치를 못 보고, 이미 `corpus/decisions/` 에 있던
   심판례 51건을 "git 이력 어디에도 없는 KV 유일본"으로 판단해 KV에서 md 를 역복원했다
   (커밋 8a6f926). 그래서 같은 자료가 `decisions/` 와 `tribunals/` 로 이중 존재하게 됐다.
2. **07-30** 다른 세션이 6일 묵은 `df8559c` 에서 시작해, 심판례가 빠진 corpus 위에서
   검색 품질을 측정하고 하마터면 그 상태로 배포할 뻔했다.
3. 그 세션이 세션 중반에 똑같은 이유(브랜치 미인지)로 `docs/검색품질_루프리포트.md` 를
   못 찾았다.

원인은 매번 같다 — **세션이 어느 브랜치에서 시작했는지 확인하지 않았고,
`docs/HANDOFF.md` 가 브랜치마다 다른 사본으로 존재하며 옛 브랜치를 가리켰다.**
그래서 HANDOFF.md 는 삭제했고(커밋 2baa5d6), 계통도 하나로 합친다.
