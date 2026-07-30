#!/usr/bin/env node
/**
 * test-tax.mjs — 세무 질의 검색 회귀 스위트 (키 불필요, 검색 계층만 검증)
 *
 * worker.js 와 같은 순서로 검색한다: retrieve → expandReferences → expandTaxContext.
 * 케이스는 scripts/tax-cases.json 에 누적한다 — 질문을 추가할 때마다 과거 케이스가
 * 함께 돌아, 검색을 손대다 예전 질문을 깨뜨리면 그 자리에서 잡힌다.
 *
 * 실행:
 *   node scripts/test-tax.mjs              전체 회귀 (실패만 상세 출력)
 *   node scripts/test-tax.mjs -v           전체 회귀 (전부 상세 출력)
 *   node scripts/test-tax.mjs "질문"        단발 질의 확인
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { retrieve, expandReferences, expandTaxContext, expandRedevContext, citation, TAX_INTENT } from "../chatbot/worker/retrieve.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "chatbot", "worker", "corpus-index.json"), "utf-8"));
// 케이스는 두 파일에 나눠 둔다 — 세무(tax-cases)와 절차(proc-cases).
// 나눈 이유는 성격이 달라서일 뿐, 회귀는 항상 둘을 합쳐서 돈다. 한쪽을 고치다 다른 쪽을
// 깨뜨리는 일이 실제로 잦았고(세무 라우팅이 절차 질의를 오염시키는 형태), 그건 합쳐 돌려야만 잡힌다.
const CASES = ["tax-cases.json", "proc-cases.json"].flatMap((f) => {
  const p = join(ROOT, "scripts", f);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : [];
});
const TYPES = ["법령", "행정규칙", "유권해석", "심판례"]; // 기본 범위(법령 체크 상태)

/** worker.js 와 동일한 검색 경로 */
export function search(q) {
  let hits = retrieve(index, q, TAX_INTENT.test(q) ? 9 : 7, TYPES, null);
  hits = expandReferences(hits, index, TYPES, 3, hits.length);
  hits = expandTaxContext(hits, index, q);
  hits = expandRedevContext(hits, index, q);
  return hits;
}

function show(hits) {
  hits.forEach((h, i) => {
    const t = h.chunk.자료유형;
    const tag = t === "심판례" ? "[심판례]" : t === "유권해석" ? "[해석]" : t === "판례" ? "[판례]" : "";
    console.log(`   ${String(i + 1).padStart(2)}. ${h.ref ? "↳" : " "}${tag} ${citation(h.chunk)}`);
  });
}

const argv = process.argv.slice(2);
const verbose = argv.includes("-v");
const only = argv.filter((a) => a !== "-v").join(" ");

if (only) {
  const hits = search(only);
  console.log(`❓ ${only}  (세무질의=${TAX_INTENT.test(only)})`);
  show(hits);
} else {
  // 케이스 형식: [질문, 기대근거] 또는 [질문, 기대근거, "known: 사유"]
  // known 은 원인을 규명했지만 지금 구조로는 못 고치는 것 — 통과로 위장하지 않고 따로 센다.
  const failed = [], known = [];
  for (const [q, expect, note] of CASES) {
    const hits = search(q);
    const ok = hits.some((h) => citation(h.chunk).includes(expect));
    if (!ok && note) { known.push([q, note]); continue; }
    if (!ok) failed.push(q);
    if (verbose || !ok) {
      console.log(`\n${ok ? "✅" : "❌"} ${q}\n   기대: ${expect}  (세무질의=${TAX_INTENT.test(q)})`);
      show(hits);
    }
  }
  console.log(`\n${"=".repeat(64)}\n통과 ${CASES.length - failed.length - known.length}/${CASES.length - known.length}  (미해결 ${known.length}건 별도)`);
  if (known.length) {
    console.log("미해결(원인 규명됨):");
    known.forEach(([q, n]) => console.log(`  - ${q}\n      ${n}`));
  }
  if (failed.length) {
    console.log("실패:");
    failed.forEach((q) => console.log(`  - ${q}`));
    process.exitCode = 1;
  }
}
