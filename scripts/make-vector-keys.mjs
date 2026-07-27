#!/usr/bin/env node
/**
 * make-vector-keys.mjs — 벡터 키 매니페스트 생성
 *
 * 매니페스트는 "KV의 N번째 벡터가 어느 청크의 것인가"를 담은 키 배열이다.
 * Worker 는 이걸로 청크↔벡터를 순번이 아니라 이름(안정 키)으로 잇는다.
 *
 * ⚠ 실행 시점: **벡터를 새로 만들었을 때만** 실행한다.
 *   corpus 를 고칠 때마다 이걸 다시 만들면, 벡터는 그대로인데 매니페스트만 바뀌어
 *   정합성 검증이 무의미해진다(어긋난 벡터를 맞다고 우기게 된다).
 *   corpus 만 갱신했다면 매니페스트는 그대로 두면 된다 — 새로 생긴 청크는
 *   매니페스트에 없으므로 Worker 가 알아서 "벡터 없음"으로 처리한다.
 *
 * 실행:
 *   node scripts/build-index.mjs
 *   node scripts/make-vector-keys.mjs --expect 4550     # 현재 KV 벡터 개수를 넣어 확인
 *   cd chatbot/worker && npx wrangler kv key put "corpus-vector-keys" \
 *        --path=vector-keys.json --binding=CORPUS_KV --remote
 *
 * KV 벡터 개수 확인: (바이트 수 ÷ 1024)
 *   npx wrangler kv key get "corpus-vectors" --binding CORPUS_KV --remote | wc -c
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IN = join(ROOT, "chatbot", "worker", "corpus-index.json");
const OUT = join(ROOT, "chatbot", "worker", "vector-keys.json");

const index = JSON.parse(readFileSync(IN, "utf-8"));
const keys = index.map((c) => c.key);

if (keys.some((k) => !k)) throw new Error("key 없는 청크가 있다 — build-index.mjs 를 먼저 실행할 것");
if (new Set(keys).size !== keys.length) throw new Error("key 중복 — build-index.mjs 의 stableKey 확인 필요");

// --expect N : 현재 KV 벡터 개수와 다르면 멈춘다(매니페스트와 벡터가 어긋나는 사고 방지)
const ei = process.argv.indexOf("--expect");
if (ei > -1) {
  const expect = Number(process.argv[ei + 1]);
  if (keys.length !== expect) {
    throw new Error(
      `청크 ${keys.length}개 ≠ 벡터 ${expect}개. 벡터를 다시 만들지 않았다면 매니페스트를 갱신하면 안 된다.`
    );
  }
}

writeFileSync(OUT, JSON.stringify(keys), "utf-8");
console.log(`✓ ${keys.length}개 키 → ${OUT.replace(ROOT + "/", "")}`);
