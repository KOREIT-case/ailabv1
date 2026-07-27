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

# ※ 벡터 키 매니페스트('corpus-vector-keys')는 여기서 올리지 않는다.
#   매니페스트는 벡터와 짝을 이루므로 **벡터를 새로 만들었을 때만** 갱신한다.
#   corpus 만 늘렸다면 그대로 두면 되고, 새 청크는 Worker 가 '벡터 없음'으로 처리해
#   BM25 만으로 검색한다(어긋난 벡터를 쓰는 것보다 안전).
#   벡터 재생성 후:  node scripts/make-vector-keys.mjs --expect <벡터개수>
#                    npx wrangler kv key put "corpus-vector-keys" --path=vector-keys.json --binding=CORPUS_KV --remote

echo "✓ corpus-index 업로드 완료 ($(du -h "$INDEX" | cut -f1), $(node -e "console.log(require('$INDEX').length)") 청크)"
