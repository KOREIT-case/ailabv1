# 세션 인계 문서 (도시정비 법률 챗봇)

> 새 세션은 이 문서를 먼저 읽고 **§5 다음 세션에서 할 일**부터 진행한다.
> 최종 갱신: 2026-07-29

## 1. 프로젝트 개요

- **주체**: 명근 (한국토지신탁, 도시정비사업 기획·리스크관리 총괄)
- **목표**: 회사 주니어들이 쓰는 **도시정비 법률 챗봇**. 전산팀이 실적을 보고 사내
  카카오톡 임직원 채널 게시 여부를 판단하기로 한 상태.
- **저장소**: `KOREIT-case/ailabv1` / 최신 브랜치 `claude/ga4-monitoring-setup-ick8ff`
- **배포**: https://jeongbi.explozn87.workers.dev (Cloudflare Worker, 공용 비밀번호 게이트)
- **최우선 가치**: 정확성 / **환각 절대 금지**. 그 구체적 형태가 아래 대전제다.

> ### ★ 대전제 — 모르면 모른다고 한다
> 근거가 없으면 답하지 않고, **근거를 못 찾았을 때 그럴듯한 것으로 채우지 않는다.**
> 근거 표시가 사실과 다른 것은 근거가 없는 것보다 나쁘다.
> 코드에서 이 원칙을 어기는 폴백을 발견하면 제거 대상으로 본다.

## 2. 구조 요약

```
질문 → Worker → ① BM25 + 벡터 하이브리드 검색(corpus)
              → ② system-prompt + 검색자료 + 대화이력 조립
              → ③ DeepSeek 생성 → 답변 + 근거
```

- corpus(md) → `scripts/build-index.mjs` → `corpus-index.json` → **Cloudflare KV**
- 벡터(bge-m3, int8) → KV `corpus-vectors` + 키 매니페스트 `corpus-vector-keys`
- 프론트 `chatbot/public/index.html` 은 Worker 가 문자열로 번들해 직접 서빙

**KV 키 3개 (전부 운영 필수)**

| 키 | 내용 | 현재 |
|---|---|---|
| `corpus-index` | 청크 배열(JSON) | 4,550청크 |
| `corpus-vectors` | int8 벡터(1024차원) | 4,550개 = 4,659,200바이트 |
| `corpus-vector-keys` | 벡터 ↔ 청크 매핑(안정 키 배열) | 4,550개 |

## 3. 현재 상태 (2026-07-29 기준)

- corpus 4,550청크 = 법령 2,372 / 조례 1,707 / 행정규칙 102 / 판례 96 / **심판례 267 / 유권해석 6**
- GA4 운영 실적 측정 **가동 중** (측정 ID `G-KS5S1ZS621`) → `docs/ga4-운영실적-가이드.md`
  - ⚠ **미완료**: GA4 관리화면의 **맞춤 정의 등록**(측정기준 4 + 측정항목 3)과
    데이터 보관 14개월 설정은 명근이 직접 해야 한다. 등록 전 구간은 유형별 분해가 불가하다.
- `scripts/healthcheck.mjs` 로 배포본 상태를 한 번에 점검 가능 (전 항목 정상 확인됨)
- 미답변 질문 기록 시스템 **가동 중** (D1 `jeongbi-logs`) → §5. 검토: `node scripts/unanswered.mjs`

## 4. 이번 세션에서 한 일 (커밋 6개)

1. **GA4 계측 도입** — `login` / `ask_question`(질의유형·검색범위·길이) /
   `answer_shown`(결과·응답시간·인용법령·근거수) / `logout`.
   질문 원문·답변 원문은 전송하지 않고, 이름은 8자리 해시로만 보낸다.
   측정 시작점은 '페이지 열람'이 아니라 **'로그인 입장'**.
   운영자 점검 제외 2중 장치: 로그인 이름 `박새`, 그리고 `?nostat=1`(브라우저 영구 제외).
2. **유일본 자료 복원** — 심판례 267 + 유권해석 6청크가 KV에만 있고 md 원본이 git 어디에도
   없었다. KV 청크에서 md 53개를 복원(`scripts/restore-from-kv.mjs`).
   청크 경계를 그대로 살려 재빌드 결과가 KV와 100% 일치 → 기존 벡터 재사용 가능.
3. **청크↔벡터 연결을 순번 → 안정 키로 전환** — 아래 §6 지뢰 참조.
4. **심판례·유권해석을 검색 범위에 편입** — 이 둘이 `allowedTypes` 어디에도 없어
   자료가 있는데도 한 번도 검색된 적이 없었다. '법령' 범위에 포함.
5. **거절 시 가짜 근거 표시 제거** (대전제 위반 수정) — `usedSources` 가 인용 조문을
   못 찾으면 검색 상위 3개를 근거인 척 붙이고 있었다. 이제 빈 배열을 반환한다.
6. **입력 방어** — `/_embed` 시크릿 잠금, history role 화이트리스트, 질문 2000자 상한,
   DeepSeek max_tokens·60초 타임아웃, 이름 XSS 이스케이프.

## 5. ★ 미답변 질문 기록·보완 시스템 (**가동 중**)

챗봇이 답하지 못한 질문을 D1에 쌓아두고, 명근이 주기적으로 확인하며 Claude와 함께
"이 질문에 답하려면 어떤 근거 자료를 추가해야 하는가"를 판단해 corpus를 보강하는 루프.

### 5-1. 결정된 설계

| 논점 | 결정 | 이유 |
|---|---|---|
| 저장소 | **Cloudflare D1** (`LOGS_DB` / `jeongbi-logs`) | 상태를 가진 검토 큐 = 관계형. KV는 목록조회·상태갱신·중복집계가 전부 불편 |
| 기록 범위 | **실패 3종만** (성공 답변은 저장 안 함) | 저장량·프라이버시 부담 최소화 |
| 조회 | **로컬 스크립트만** (`scripts/unanswered.mjs`) | 질문 원문 조회 API를 §7의 취약한 인증 위에 얹지 않기 위해. 배포 표면 증가 0 |
| 화면 고지 | **넣지 않음** | 명근 판단 |

### 5-2. ★ 실패 3종 — GA가 못 잡던 것이 하나 있다

| reason | 판별 | GA 포착 |
|---|---|---|
| `검색0건` | 검색이 후보를 0건 냄 → pipeline이 즉시 NO_EVIDENCE | ✅ |
| `모델거절` | 답변이 "제공된 자료로는"으로 시작 | ✅ |
| **`근거미표시`** | **거절도 아닌데 `sources`가 빈 배열** | ❌ |

`근거미표시`가 이번에 새로 보이게 된 것이다. §4-5에서 "가짜 근거 붙이기"를 없앤 뒤로
이 경우 **답변은 화면에 뜨는데 근거는 하나도 안 붙는다.** 원인은 둘 중 하나 —
모델이 인용 형식(규칙 3)을 안 지켰거나, **자료 없이 답했거나(=환각)**.
대전제상 가장 위험한 케이스인데 프론트 GA 판별식이 `/^\s*제공된 자료로는/` 이라
GA는 이걸 `result: 답변`으로 집계한다. **여기 쌓이는 건 최우선으로 볼 것.**

덤: §7의 `stripFalseRefusal`(정직한 유보를 정규식으로 떼어낼 위험) 재검토도
이 기록이 쌓이면 추측이 아니라 실측으로 판단할 수 있다.

### 5-3. 배포 완료 (2026-07-29)

- D1 `jeongbi-logs` 생성(region ENAM), `database_id` 는 `wrangler.toml` 에 기입됨
- `unanswered` 테이블 생성 완료, Worker 배포 완료(Version `92e997e0`)
- KV `corpus-version` 키 생성 → 인덱스 캐시 무효화 가동

**대전제 위반 1건 추가 수정** — 거절 답변에 근거가 붙던 문제.
모델이 "왜 답할 수 없는지"를 설명하며 조문 번호를 나열하면
(예: *"참고자료에는 …법 제2조(정의), 제6조(납부의무자), 제12조(부과율)만 있습니다"*)
`usedSources` 가 그걸 인용으로 인식해, 화면에 "답변할 수 없습니다" 옆에 근거 5건이 붙었다.
§4-5에서 없앤 '가짜 근거 폴백'과는 **다른 경로**다(코드가 지어낸 게 아니라 모델이 실제로 쓴 조문).
→ `usedSources` 가 거절로 시작하는 답변에는 빈 배열을 돌려준다(`pipeline.mjs`).
명백한 범위 밖 질의("날씨")는 원래 0건이었고, 도메인 안이면서 답할 수 없는 질의에서만 났다.
`classifyFailure` 는 거절 판정을 근거 개수보다 **먼저** 하므로 이 수정 후에도 `모델거절` 로
분류된다(`근거미표시` 로 넘어가지 않음 — 실측 확인).

**실측 검증 결과**

| 항목 | 결과 |
|---|---|
| healthcheck 15항목 회귀 | 전 항목 정상 |
| 실패 질문 D1 기록 | 정상 (모델거절·검색0건 모두) |
| 중복 집계 | 구두점만 다른 질문 → 같은 행 `hit_count 2` |
| 운영자 제외 | healthcheck 의 범위 밖 질문 2건이 큐에 **안 쌓임** |
| `top_hits` 진단 | 상위 7건+점수 기록 → 원인 분류 가능 |
| 캐시 무효화 | 웜 isolate 가 버전 변경 감지 후 `4550청크` 재로드 로그 확인 |
| 거절 시 근거 0건 | 재현 케이스 5건 → 0건. 법령·판례·조례·심판례 정상 답변은 근거 유지 |

> D1 권한 주의: `CLOUDFLARE_TOKEN` 은 원래 `Edit Cloudflare Workers` 범위라 D1 생성이
> 막혔다(`Authentication error [code: 10000]`). 명근이 `Account / D1 / Edit` 를 추가해 해결.
> 토큰을 재발급할 때는 `Workers Scripts:Edit` + `Workers KV:Edit` + `D1:Edit` 를 챙길 것.

### 5-4. 검토 워크플로 (주기적으로)

```bash
node scripts/unanswered.mjs                # 미처리 목록 — hit_count 큰 순 = 우선순위
node scripts/unanswered.mjs --stats        # 원인·유형별 집계
node scripts/unanswered.mjs --id <qhash>   # 상세: 검색 상위 7건과 점수
```

`--id` 의 검색 상위 목록으로 원인을 가른다:

| 판별 | 조치 |
|---|---|
| 상위가 전부 무관 + 법률 무관 질의 | `--status 범위밖` (무시) |
| 정비 질의인데 관련 조문이 corpus에 **없음** | `--status 자료추가` ← **본래 목표**. `law-api-koreit` 로 조문 확보 |
| 관련 조문이 corpus에 **있는데** 상위에 안 뜸 | `--status 검색보정` (`retrieve.mjs` 의 `SYN`·가중치) |

자료를 넣은 뒤:
```bash
node scripts/build-index.mjs && bash scripts/kv-upload.sh
# ★ 최대 60초 대기 (corpus-version 이 전 isolate 에 퍼지는 시간)
#   그 질문을 다시 던져 답이 나오는지 확인
node scripts/unanswered.mjs --resolve <qhash> --status 해결 \
     --note "지특법 제31조 추가" --expect "지방세특례제한법 제31조"
```

- `--expect` 를 주면 `tests/golden.jsonl` 에 "질문 → 기대 조문" 회귀 케이스가 쌓인다.
  표본이 모이면 `scripts/test-retrieval.mjs` 에 기대값 검증을 붙인다(현재는 출력만 함).
- `해결`로 닫은 질문이 **다시 실패하면 자동으로 `미처리`로 되돌아온다**(회귀 감지).

### 5-5. 주의

- **운영자 점검 계정은 기록에서 제외된다** (`unanswered.mjs` 의 `EXCLUDED_USERS`).
  `healthcheck.mjs` 가 대전제 검증용으로 일부러 던지는 범위 밖 질문("오늘 서울 날씨 어때?")이
  검토 큐를 오염시키지 않도록. 프론트 `index.html` 의 GA 제외 명단과 **같은 값으로 유지할 것.**
- 현재 명단은 `["박새", "상태점검"]`. 프론트 `EXCLUDED_USERS` 에는 `상태점검` 이 **아직 없어서**
  healthcheck 실행분이 GA 실적에 잡힌다 → 추가 권장.
- `q_type` 은 프론트가 계산해 body 에 동봉하고 서버는 화이트리스트 검증만 한다.
  분류 로직을 서버에 복제하면 두 벌이 어긋나 GA↔D1 교차 확인이 깨진다. **목록만 동기화.**

## 6. ★ 반드시 알아야 할 것 (지뢰·주의사항)

- **corpus에 파일을 추가하면 벡터가 없는 상태가 된다.** 새 청크는 매니페스트에 없어
  Worker가 '벡터 없음'으로 처리하고 BM25만 쓴다(안전한 열화). 의미검색까지 살리려면
  재임베딩 후 매니페스트를 갱신해야 한다.
- **매니페스트(`corpus-vector-keys`)는 벡터를 새로 만들었을 때만 갱신한다.**
  corpus만 바뀔 때마다 갱신하면 정합성 검증이 무력화된다. `make-vector-keys.mjs --expect N` 사용.
- **`CORPUS_DIRS` 배열 순서를 바꾸거나 중간에 폴더를 끼우지 말 것.** 새 폴더는 항상 끝에 추가.
- **KV의 벡터는 백업이 없다.** 원본 md는 복원했지만 벡터는 유일본이다.
  (재생성은 가능하나 Workers AI 호출 4,550건이 필요하다.)
- **`/_embed` 는 평소 404다.** 재임베딩할 때만 `wrangler secret put EMBED_TOKEN` 으로 열고,
  끝나면 `secret delete` 로 반드시 닫는다. 호출 시 `X-Embed-Token` 헤더 필요.
- **문서와 코드가 어긋난 곳이 있다.** `chatbot/worker/system-prompt.md` 는 사문화됐고
  실제 규칙은 `pipeline.mjs` 의 `SYSTEM_PROMPT` 상수다(규칙 수·위계가 다름). 코드가 진짜다.

## 7. 남은 미결 이슈 (2026-07-26 코드검토 지적 중 미처리)

- ~~`worker.js` 의 `INDEX_CACHE` 무효화 로직 없음~~ → **해결**. KV `corpus-version` 키를
  60초에 한 번 확인해 바뀌었으면 인덱스·벡터 캐시를 버린다(§5 보완 루프의 재질문 확인이
  옛 인덱스에 걸려 오판하는 걸 막기 위해 같이 고침). `kv-upload.sh` 가 버전을 함께 올린다.
- `sessionToken` 이 비밀번호 해시 고정값 → 전 사용자가 같은 쿠키. 발급시각+HMAC 필요.
  `isAuthed` 는 `SITE_PASSWORD` 미설정 시 true 반환(fail-open).
- BM25가 전체 청크를 substring 스캔 → corpus 크기에 정비례. 현재는 정상 동작하나
  자료가 더 커지면 Workers CPU 한도 위험. (현재까지 Error 1102 발생 이력 없음)
- `stripFalseRefusal` — 모델이 정직하게 유보한 답변의 앞부분을 정규식으로 떼어낼 위험.
  대전제와 방향이 반대라 재검토 대상.
- 사문화 파일: `worker.example.js`, `scripts/embed-corpus.py`(죽은 경로 참조).
- 수집 스크립트 7개가 최대 86% 중복 → 공통 모듈화 여지.
- `scripts/README.md`·`architecture.md` 의 개정감지(`check-revisions`) 서술이 실제와 다름(미구현).

## 8. 운영 절차

```bash
# 상태 점검 (배포본)
SITE_PASSWORD=... node scripts/healthcheck.mjs

# corpus 갱신
node scripts/build-index.mjs
bash scripts/kv-upload.sh          # corpus-index + corpus-version 갱신 (매니페스트는 안 건드림)
                                   # → 최대 60초 뒤 살아있는 isolate 에 반영

# 미답변 질문 검토 (§5)
node scripts/unanswered.mjs                 # 미처리 목록
node scripts/unanswered.mjs --stats         # 원인·유형별 집계
node scripts/unanswered.mjs --id <qhash>    # 상세(검색 상위 7건)
node scripts/unanswered.mjs --resolve <qhash> --status 자료추가 --note "..."

# 배포 (chatbot/worker 에서, CLOUDFLARE_API_TOKEN 필요)
npx wrangler deploy

# 벡터를 새로 만든 경우에만
node scripts/make-vector-keys.mjs --expect <벡터개수>
npx wrangler kv key put "corpus-vector-keys" --path=vector-keys.json --binding=CORPUS_KV --remote
```

- Cloudflare API 토큰·DeepSeek 키 등은 Gmail의 **`[secret] 통합 API 키 보관함`** 메일에 있다.
- 접속 비밀번호는 코드에서 제거했다(과거 git 이력에는 남아 있음. 명근 판단으로 교체는 보류).

---
*갱신: 2026-07-29 세션 (GA4 계측 · 유일본 복원 · 안정키 전환 · 대전제 위반 수정 · 입력 방어)
→ 2026-07-29 세션 (미답변 질문 기록·보완 시스템 + 인덱스 캐시 무효화).
이어받는 세션은 §5-4(검토 워크플로)를 돌리는 것부터 시작 — 실제 미답변 질문이 쌓이면
Claude와 함께 원인을 분류하고 corpus를 보강한다.*
