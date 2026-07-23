#!/usr/bin/env bash
# kv-upload.sh — corpus-index.json 을 Cloudflare KV(CORPUS_KV)의 'corpus-index' 키로 올린다.
#
# corpus 는 Worker 번들이 아니라 KV 에서 서빙한다(번들 1MB 한도 회피).
# 따라서 corpus 갱신은 "재빌드 → 이 스크립트"만 하면 되고, 재배포는 불필요하다.
#
# 사전:
#   1) node scripts/build-index.mjs           # corpus-index.json 최신화
#   2) (최초 1회) cd chatbot/worker && npx wrangler kv namespace create CORPUS
#        → 출력 id 를 chatbot/worker/wrangler.toml 의 [[kv_namespaces]] id 에 기입
#   3) wrangler 로그인/토큰 준비 (npx wrangler login 또는 CLOUDFLARE_API_TOKEN)
#
# 사용: bash scripts/kv-upload.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INDEX="$ROOT/chatbot/worker/corpus-index.json"

if [[ ! -f "$INDEX" ]]; then
  echo "✗ corpus-index.json 없음. 먼저 'node scripts/build-index.mjs' 실행." >&2
  exit 1
fi

cd "$ROOT/chatbot/worker"

# wrangler v3/v4: 'kv key put'. 구버전은 'kv:key put' (콜론) 을 쓴다.
# --binding 은 wrangler.toml 의 [[kv_namespaces]] 를 참조하므로 id 가 채워져 있어야 한다.
npx wrangler kv key put "corpus-index" --path="$INDEX" --binding=CORPUS_KV --remote

echo "✓ corpus-index 업로드 완료 ($(du -h "$INDEX" | cut -f1), $(node -e "console.log(require('$INDEX').length)") 청크)"
