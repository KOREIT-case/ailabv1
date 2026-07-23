#!/usr/bin/env node
/**
 * test-retrieval.mjs — 실제 질문이 올바른 조문을 검색해오는지 검증
 * 실행: node scripts/test-retrieval.mjs  (또는 인자로 질문 직접 전달)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { retrieve, tokenize, citation } from "../chatbot/worker/retrieve.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(
  readFileSync(join(ROOT, "chatbot", "worker", "corpus-index.json"), "utf-8")
);

const questions = process.argv.slice(2).length
  ? [process.argv.slice(2).join(" ")]
  : [
      "재건축사업에서 매도청구는 어떻게 하나요?",
      "조합원의 자격은 어떻게 되나요?",
      "관리처분계획의 인가 절차가 궁금해요",
      "정비사업 공사비 검증은 누구에게 요청하나요?",
      "조합 임원의 결격사유는 무엇인가요?",
      "안전진단(재건축진단)은 어떻게 신청하나요?",
    ];

console.log(`인덱스: ${index.length} 청크\n${"=".repeat(70)}`);
for (const q of questions) {
  console.log(`\n❓ ${q}`);
  console.log(`   키워드: ${tokenize(q).join(", ")}`);
  const hits = retrieve(index, q, 4);
  if (!hits.length) {
    console.log("   → 검색 결과 없음");
    continue;
  }
  hits.forEach((h, i) => {
    const snip = h.chunk.text.replace(/\n+/g, " ").slice(0, 60);
    console.log(
      `   ${i + 1}. [${h.score.toFixed(2)}] ${citation(h.chunk)}` +
        `\n        ${snip}…  (matched: ${h.matched.join("/")})`
    );
  });
}
