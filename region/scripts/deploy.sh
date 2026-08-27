#!/usr/bin/env bash
# deploy.sh — 내려받기 → 빌드 → KV 업로드 → 워커 배포를 순서대로 한다.
#
# 통계는 매월 갱신된다. 자료만 바뀌고 코드가 그대로면 KV 만 올리면 되고 재배포는 필요 없다
# (워커가 KV 에서 읽으므로). 다만 시도·시군구 목록은 번들(index.js)에 들어 있어서
# 행정구역 자체가 바뀐 달에는 재배포까지 해야 한다 — 그래서 기본값은 '전부'다.
#
# 사용
#   bash region/scripts/deploy.sh          # 전부
#   bash region/scripts/deploy.sh data     # 내려받기 + 빌드 + KV (재배포 안 함)
#   bash region/scripts/deploy.sh code     # 워커 배포만
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-all}"
step() { printf "\n\033[1m▶ %s\033[0m\n" "$1"; }

step "wrangler 인증 확인"
if ! npx wrangler whoami 2>&1 | grep -qE "Account Name|Account ID"; then
  echo "✗ wrangler 로그인이 안 돼 있습니다:  npx wrangler login" >&2
  exit 1
fi

if [[ "$MODE" == "all" || "$MODE" == "data" ]]; then
  step "원천 통계 내려받기 (행정안전부)"
  node "$ROOT/scripts/fetch-jumin.mjs"

  step "자료 빌드"
  node "$ROOT/scripts/build-data.mjs"

  step "경로 점검 (배포 전)"
  node "$ROOT/scripts/test-routes.mjs"

  step "KV 업로드"
  bash "$ROOT/scripts/kv-upload.sh"
fi

if [[ "$MODE" == "all" || "$MODE" == "code" ]]; then
  step "워커 배포"
  (cd "$ROOT/worker" && npx wrangler deploy)
fi

step "배포 확인"
# HTTPS 프록시 환경에서 %{http_code} 는 프록시의 CONNECT 200 을 집는다 → 헤더를 직접 읽는다.
NAME="$(grep -E '^name *=' "$ROOT/worker/wrangler.toml" | head -1 | sed 's/.*"\(.*\)".*/\1/')"
SUB="$(npx wrangler whoami 2>/dev/null | grep -oE '[a-z0-9-]+\.workers\.dev' | head -1 || true)"
echo "  워커 이름: $NAME"
echo "  확인:  curl -sI https://$NAME.<계정>.workers.dev/대구/중구/남산동"
echo
echo "✓ 완료. 광고·추적·외부 스크립트 0개인지 확인하려면 개발자도구 네트워크 탭에 요청이"
echo "  HTML 하나만 뜨는지 보면 됩니다."
