#!/usr/bin/env bash
# deploy.sh — 챗봇 전체 배포를 순서대로 한 번에 수행한다.
#
# 왜 스크립트인가
#   배포가 네 조각으로 나뉘어 있어(인덱스 빌드 → KV 업로드 → 워커 배포 → 구주소 리다이렉트)
#   하나만 빠뜨려도 증상이 헷갈린다. 실제로 겪은 사고:
#     · KV 업로드를 빠뜨림 → 코드는 새 것인데 답변 근거에 심판례가 안 나옴
#     · 구주소 워커를 안 건드림 → 북마크로 들어온 사람은 옛 버전 챗봇을 계속 씀
#
# 사전 준비(최초 1회)
#   npx wrangler login
#   cd chatbot/worker
#   npx wrangler secret put DEEPSEEK_KEY     # DeepSeek API 키
#   npx wrangler secret put SITE_PASSWORD    # 접속 비밀번호
#
# 사용
#   bash scripts/deploy.sh              # 전체 (인덱스 + KV + 워커 + 리다이렉트)
#   bash scripts/deploy.sh corpus       # corpus만 갱신 (인덱스 + KV). 재배포 불필요할 때
#   bash scripts/deploy.sh code         # 코드만 배포 (워커 + 리다이렉트)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-all}"
MAIN_URL="https://jeongbi.explozn87.workers.dev"
OLD_URL="https://dosijeongbi-chatbot.explozn87.workers.dev"

step() { printf "\n\033[1m▶ %s\033[0m\n" "$1"; }

# ── 0. 인증 확인 — 여기서 걸러야 중간에 반쯤 배포되는 상태를 피한다.
step "wrangler 인증 확인"
if ! npx wrangler whoami 2>&1 | grep -qE "Account Name|Account ID"; then
  echo "✗ wrangler 로그인이 안 돼 있습니다. 먼저 실행하세요:" >&2
  echo "    npx wrangler login" >&2
  exit 1
fi

# ── 1. 검색 인덱스 빌드 (corpus → corpus-index.json)
if [[ "$MODE" == "all" || "$MODE" == "corpus" ]]; then
  step "검색 인덱스 빌드"
  node "$ROOT/scripts/build-index.mjs" | tail -1

  step "회귀 스위트 (배포 전 확인)"
  # 검색이 깨진 채로 배포되는 것을 막는다. 미해결(known)은 실패로 치지 않는다.
  node "$ROOT/scripts/test-golden.mjs" --diff "$ROOT/scripts/golden-baseline.json" || {
    echo "✗ 기준선 대비 회귀 발생 — 배포 중단." >&2
    exit 1
  }

  step "corpus 인덱스 KV 업로드"
  bash "$ROOT/scripts/kv-upload.sh"
fi

# ── 2. 본 워커 배포
if [[ "$MODE" == "all" || "$MODE" == "code" ]]; then
  step "본 워커 배포 (jeongbi)"
  (cd "$ROOT/chatbot/worker" && npx wrangler deploy)

  # ── 3. 구주소 리다이렉트 배포
  # 주소를 줄일 때 옛 워커가 그대로 살아남아 '구버전 법률 챗봇'이 계속 서비스됐다.
  # 같은 이름으로 리다이렉트를 덮어써서 현행 주소로 넘긴다.
  step "구주소 리다이렉트 배포 (dosijeongbi-chatbot)"
  (cd "$ROOT/chatbot/redirect" && npx wrangler deploy)
fi

# ── 4. 배포 후 확인 — 눈으로 안 봐도 되게 자동 점검한다.
step "배포 확인"
# 확인 방식에 함정이 둘 있었다.
#  1) HTTPS 프록시 환경에서 %{http_code} 는 프록시의 "CONNECT 200" 을 집어 실제 301을 놓친다.
#  2) curl -I 는 HEAD 요청이라 워커가 405를 준다(GET/POST만 처리). 실제 사용자 요청과 다르다.
# → GET 으로 보내되 본문은 버리고 헤더(-D -)만 읽는다.
status() { curl -s -o /dev/null -D - "$1" --max-time 20 2>/dev/null | grep -Eo "^HTTP/[0-9.]+ [0-9]{3}" | tail -1 | awk '{print $2}'; }
code_main=$(status "$MAIN_URL"); code_main=${code_main:-000}
code_old=$(status "$OLD_URL"); code_old=${code_old:-000}
loc_old=$(curl -s -o /dev/null -D - "$OLD_URL" --max-time 20 2>/dev/null | grep -i "^location:" | tr -d "\r" | awk "{print \$2}")

echo "  현행 $MAIN_URL → HTTP $code_main"
echo "  구주소 $OLD_URL → HTTP $code_old ${loc_old:+(→ $loc_old)}"

[[ "$code_main" == "200" ]] || { echo "✗ 현행 주소가 200이 아닙니다." >&2; exit 1; }
if [[ "$MODE" != "corpus" ]]; then
  [[ "$code_old" == "301" ]] || echo "⚠ 구주소가 301이 아닙니다 — 리다이렉트 배포를 확인하세요."
fi

cat <<'EOF'

✓ 배포 완료.

마지막 확인은 사람이 해야 합니다 — 챗봇에 세무 질문을 하나 던져 보세요.
  예) "체비지 취득세 감면 되나요"
  · 답변 하단 근거에 "심판례 조심 2025지…" 가 뜨면 → KV 업로드까지 반영된 것
  · 법령만 뜨면 → corpus 갱신이 안 된 것 (bash scripts/deploy.sh corpus)
  · 모델 오류가 뜨면 → DEEPSEEK_MODEL 변수 확인 (기본 deepseek-v4-pro)
EOF
