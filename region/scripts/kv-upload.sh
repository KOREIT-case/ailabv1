#!/usr/bin/env bash
# kv-upload.sh — 빌드된 지역 자료를 Cloudflare KV(REGION_KV)로 한 번에 올린다.
#
# 키 구성
#   sgg:{법정동코드}  시군구 한 곳의 전체 자료(그 안의 법정동 전부 포함)
#   names            이름 → 코드 색인 (짧은 주소/검색용)
#   meta             기준 월·건수
#
# 사전: node region/scripts/build-data.mjs  (data/kv-bulk.json 생성)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BULK="$ROOT/data/kv-bulk.json"

[[ -f "$BULK" ]] || { echo "✗ $BULK 없음. 먼저 'node region/scripts/build-data.mjs' 실행." >&2; exit 1; }

cd "$ROOT/worker"
grep -q 'id = ""' wrangler.toml && {
  echo "✗ wrangler.toml 의 KV id 가 비어 있습니다. 먼저 실행하세요:" >&2
  echo "    cd region/worker && npx wrangler kv namespace create REGION" >&2
  exit 1
}

# wrangler v3/v4 는 'kv bulk put', 구버전은 'kv:bulk put'.
npx wrangler kv bulk put "$BULK" --binding=REGION_KV --remote

# 공유 카드 PNG 는 선택 사항이다(make-og.mjs 로 미리 구운 경우에만 있다).
OG="$ROOT/data/og-bulk.json"
if [[ -f "$OG" ]]; then
  npx wrangler kv bulk put "$OG" --binding=REGION_KV --remote
  echo "✓ 공유 카드 $(node -e "console.log(require('$OG').length)")장 업로드"
fi

echo "✓ KV 업로드 완료 — 키 $(node -e "console.log(require('$BULK').length)")개, $(du -h "$BULK" | cut -f1)"
