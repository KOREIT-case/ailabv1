#!/usr/bin/env node
/**
 * test-golden.mjs — 검색 품질 회귀 테스트
 * ------------------------------------------------------------------
 * scripts/golden-set.json 의 질문 50개를 worker.js 와 동일한 경로로 돌려,
 * 기대 조문이 상위 몇 위에 오는지 측정한다. 튜닝 상수를 건드릴 때마다 실행해
 * "이 질문은 고쳤는데 저 질문이 깨졌다"를 잡는 것이 목적이다.
 *
 * 실행:
 *   node scripts/test-golden.mjs                             # 현재 상태 표 출력
 *   node scripts/test-golden.mjs --diff scripts/golden-baseline.json   # 회귀 확인 ★
 *   node scripts/test-golden.mjs --out scripts/golden-baseline.json    # 기준선 갱신
 *
 * 종료코드: --diff 를 준 경우, 기준선보다 순위가 내려간 케이스가 있으면 1.
 * (미검색 12건은 아직 안 고친 결함 P2·P3·P12 등이 원인이라 그 자체로는 실패가 아니다.
 *  중요한 건 "고친 것이 다시 깨지지 않는가"이므로 판정 기준을 기준선 대비 회귀로 둔다.)
 *
 * 주의 — 로컬엔 KV 벡터가 없어 BM25 단독으로 측정한다. 배포본(하이브리드)은
 * BM25 상위 20 안에서만 재순위하므로, BM25가 놓친 조문은 배포본도 놓친다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { retrieve, expandReferences, citation } from "../chatbot/worker/retrieve.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(
  readFileSync(join(ROOT, "chatbot", "worker", "corpus-index.json"), "utf-8")
);
const golden = JSON.parse(readFileSync(join(ROOT, "scripts", "golden-set.json"), "utf-8"));

const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};

/** worker.js 와 동일한 검색 경로 */
function search(q, scope = {}) {
  const { law = true, prec = false, region = null } = scope;
  const allowedTypes = [];
  if (law) allowedTypes.push("법령", "행정규칙");
  if (prec) allowedTypes.push("판례");
  if (region) allowedTypes.push("조례");
  if (!allowedTypes.length) allowedTypes.push("법령", "행정규칙");
  let hits = retrieve(index, q, 7, allowedTypes, region);
  if (law || region) hits = expandReferences(hits, index, allowedTypes, 3, hits.length);
  return hits;
}

const results = [];
for (const c of golden.cases) {
  const hits = search(c.q, c.scope);
  const cits = hits.map((h) => citation(h.chunk));
  const topScore = hits.length ? +(hits[0].score ?? 0).toFixed(1) : 0;

  if (c.expectNone) {
    // 근거 없음이 정답인 질의 — 순위가 아니라 1위 점수만 기록(P12 하한선 캘리브레이션용)
    results.push({ id: c.id, loop: c.loop, kind: "none", rank: null, topScore, top: cits[0] || "-" });
    continue;
  }
  const re = new RegExp(c.expect);
  const rank = cits.findIndex((x) => re.test(x)) + 1; // 0 = 미검색
  results.push({ id: c.id, loop: c.loop, kind: "expect", rank, topScore, top: cits[0] || "-" });
}

const mark = (r) =>
  r.kind === "none" ? "·" : r.rank === 0 ? "❌" : r.rank === 1 ? "✅" : "⚠️";

let loop = 0;
for (const r of results) {
  if (r.loop !== loop) { loop = r.loop; console.log(`\n─── 루프 ${loop} ───`); }
  const c = golden.cases.find((x) => x.id === r.id);
  const pos = r.kind === "none" ? `점수 ${r.topScore}` : r.rank === 0 ? "미검색" : `${r.rank}위`;
  console.log(`${mark(r)} ${String(r.id).padStart(2)} ${pos.padEnd(9)} ${c.q}`);
  if (r.kind === "expect" && r.rank !== 1) console.log(`      1위: ${r.top}`);
}

const exp = results.filter((r) => r.kind === "expect");
const hit1 = exp.filter((r) => r.rank === 1).length;
const hitN = exp.filter((r) => r.rank > 1).length;
const miss = exp.filter((r) => r.rank === 0).length;
const none = results.filter((r) => r.kind === "none");
console.log(`\n${"=".repeat(60)}`);
console.log(`1위 적중 ${hit1} / 상위권 ${hitN} / 미검색 ${miss}  (기대조문 있는 ${exp.length}건)`);
console.log(`근거없음 질의 ${none.length}건 1위 점수: ${none.map((r) => r.topScore).join(", ")}`);
console.log(`정상 질의 1위 점수 범위: ${Math.min(...exp.map((r) => r.topScore))} ~ ${Math.max(...exp.map((r) => r.topScore))}`);

const out = argOf("--out");
if (out) { writeFileSync(out, JSON.stringify(results, null, 2)); console.log(`\n→ ${out} 저장`); }

const diff = argOf("--diff");
let regressions = 0;
if (diff) {
  const before = JSON.parse(readFileSync(diff, "utf-8"));
  const byId = new Map(before.map((r) => [r.id, r]));
  const rows = results
    .map((r) => ({ r, b: byId.get(r.id) }))
    .filter(({ r, b }) => b && (r.rank !== b.rank || r.topScore !== b.topScore));
  console.log(`\n─── ${diff} 대비 변화 ───`);
  if (!rows.length) console.log("  변화 없음");
  for (const { r, b } of rows) {
    const f = (x) => (x.kind === "none" ? `점수 ${x.topScore}` : x.rank === 0 ? "미검색" : `${x.rank}위`);
    // 근거없음 질의는 점수가 낮아지는 쪽이 개선(P12 하한선으로 거를 여지가 커짐).
    const better = r.kind === "none" ? r.topScore < b.topScore
      : (r.rank !== 0 && (b.rank === 0 || r.rank < b.rank));
    const worse = r.kind === "none" ? r.topScore > b.topScore
      : (r.rank === 0 && b.rank !== 0) || (r.rank !== 0 && b.rank !== 0 && r.rank > b.rank);
    if (worse) regressions++;
    console.log(`  ${better ? "↑" : worse ? "↓ 회귀" : " "} ${String(r.id).padStart(2)}  ${f(b)} → ${f(r)}`);
  }
  console.log(regressions ? `\n회귀 ${regressions}건 — 확인 필요` : "\n회귀 없음");
}

process.exit(regressions > 0 ? 1 : 0);
