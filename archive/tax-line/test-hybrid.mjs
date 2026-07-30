#!/usr/bin/env node
/**
 * test-hybrid.mjs — 회귀 스위트를 **하이브리드 경로**로 돌린다.
 *
 * 왜 따로 필요한가 (2026-07-26 사고)
 *   test-tax.mjs 는 로컬에 벡터가 없어 BM25 경로만 돈다. 그런데 배포본은 벡터가 있으면
 *   하이브리드 경로로 돈다. 즉 **검증한 경로와 서비스하는 경로가 달랐다.**
 *   그 틈에서 "인덱스만 갱신하고 벡터는 옛것" 상태가 통과해 버렸고, 심판례가 근거로
 *   나오지 않는 사고가 사람 눈에 띌 때까지 남아 있었다.
 *   → 벡터가 있을 때는 이 스크립트로도 돌려서 두 경로를 모두 확인한다.
 *
 * 질의 임베딩은 워커의 /_embed 를 쓴다(로컬엔 임베딩 모델이 없다). 인증이 필요하다.
 *
 * 사용:
 *   SITE_PASSWORD=... node scripts/test-hybrid.mjs
 *   SITE_PASSWORD=... node scripts/test-hybrid.mjs "질문"
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  retrieveHybrid, expandReferences, expandTaxContext, expandRedevContext, normalizeVec, citation, TAX_INTENT,
} from "../chatbot/worker/retrieve.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_PATH = join(ROOT, "chatbot", "worker", "corpus-index.json");
const VEC_PATH = join(ROOT, "chatbot", "worker", "corpus-vectors.bin");
const URL_BASE = process.env.WORKER_URL || "https://jeongbi.explozn87.workers.dev";
const PW = process.env.SITE_PASSWORD;
const DIM = 1024;
const TYPES = ["법령", "행정규칙", "유권해석", "심판례"];

if (!PW) { console.error("환경변수 SITE_PASSWORD 필요"); process.exit(1); }
if (!existsSync(VEC_PATH)) {
  console.error(`벡터 없음: ${VEC_PATH}\n  → SITE_PASSWORD=... python3 scripts/embed-corpus.py`);
  process.exit(1);
}

const index = JSON.parse(readFileSync(INDEX_PATH, "utf-8"));
const vectors = new Int8Array(readFileSync(VEC_PATH));
// 케이스는 두 파일에 나눠 둔다 — 세무(tax-cases)와 절차(proc-cases).
// 나눈 이유는 성격이 달라서일 뿐, 회귀는 항상 둘을 합쳐서 돈다. 한쪽을 고치다 다른 쪽을
// 깨뜨리는 일이 실제로 잦았고(세무 라우팅이 절차 질의를 오염시키는 형태), 그건 합쳐 돌려야만 잡힌다.
const CASES = ["tax-cases.json", "proc-cases.json"].flatMap((f) => {
  const p = join(ROOT, "scripts", f);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : [];
});

// 정합성부터 확인 — 이게 이번 사고의 핵심이었다.
if (vectors.length !== index.length * DIM) {
  console.error(`✗ 벡터-인덱스 불일치: 벡터 ${vectors.length / DIM}청크 vs 인덱스 ${index.length}청크`);
  console.error("  → 인덱스를 새로 만들었으면 벡터도 다시 만들어야 한다(embed-corpus.py).");
  process.exit(1);
}
console.log(`벡터 ${vectors.length / DIM}청크 = 인덱스 ${index.length}청크 ✓`);

/** 로그인 → 세션 쿠키 */
const res = await fetch(`${URL_BASE}/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "test-hybrid", password: PW }),
});
const cookie = (res.headers.getSetCookie?.() || [])
  .map((c) => c.split(";")[0]).join("; ");
if (!cookie.includes("sid=")) { console.error("로그인 실패"); process.exit(1); }

const embedCache = new Map();
async function embed(q) {
  if (embedCache.has(q)) return embedCache.get(q);
  const r = await fetch(`${URL_BASE}/_embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ texts: [q] }),
  });
  const v = (await r.json())?.vectors?.[0];
  const out = v ? normalizeVec(v) : null;
  embedCache.set(q, out);
  return out;
}

/** worker.js 와 동일한 하이브리드 경로 */
async function search(q) {
  const qv = await embed(q);
  const k = TAX_INTENT.test(q) ? 9 : 7;
  let hits = qv
    ? retrieveHybrid(index, vectors, qv, q, k, TYPES, DIM, null)
    : (console.warn(`  (임베딩 실패 — 어휘검색으로 대체: ${q})`), []);
  hits = expandReferences(hits, index, TYPES, 3, hits.length);
  hits = expandTaxContext(hits, index, q);
  hits = expandRedevContext(hits, index, q);
  return hits;
}

const only = process.argv.slice(2).join(" ");
if (only) {
  const hits = await search(only);
  console.log(`\n❓ ${only}  (세무질의=${TAX_INTENT.test(only)})`);
  hits.forEach((h, i) => console.log(`   ${i + 1}. ${h.ref ? "↳" : " "}${citation(h.chunk)}`));
} else {
  const failed = [], known = [];
  for (const [q, expect, note] of CASES) {
    const hits = await search(q);
    const ok = hits.some((h) => citation(h.chunk).includes(expect));
    if (!ok && note) { known.push(q); continue; }
    if (!ok) {
      failed.push(q);
      console.log(`\n❌ ${q}\n   기대: ${expect}`);
      hits.forEach((h, i) => console.log(`   ${i + 1}. ${h.ref ? "↳" : " "}${citation(h.chunk)}`));
    }
  }
  const total = CASES.length - known.length;
  console.log(`\n${"=".repeat(64)}\n[하이브리드] 통과 ${total - failed.length}/${total}  (미해결 ${known.length}건 별도)`);
  if (failed.length) process.exitCode = 1;
}
