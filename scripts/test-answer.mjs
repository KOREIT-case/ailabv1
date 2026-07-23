#!/usr/bin/env node
/**
 * test-answer.mjs — 종단 테스트 (검색→프롬프트→DeepSeek 생성)
 * worker.js와 동일한 pipeline.mjs를 사용한다.
 *
 * 실행: DEEPSEEK_KEY=sk-... node scripts/test-answer.mjs "질문"
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { answer } from "../chatbot/worker/pipeline.mjs";
import { citation } from "../chatbot/worker/retrieve.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(
  readFileSync(join(ROOT, "chatbot", "worker", "corpus-index.json"), "utf-8")
);

const env = { DEEPSEEK_KEY: process.env.DEEPSEEK_KEY };
if (!env.DEEPSEEK_KEY) {
  console.error("환경변수 DEEPSEEK_KEY 필요");
  process.exit(1);
}

const q = process.argv.slice(2).join(" ") || "재건축사업에서 매도청구는 어떻게 하나요?";

console.log(`❓ 질문: ${q}\n${"=".repeat(70)}`);
const { answer: text, retrieved } = await answer(index, q, [], env);

console.log("🔎 검색된 근거 조문(프롬프트에 삽입됨):");
retrieved.forEach((h, i) =>
  console.log(`   ${i + 1}. ${citation(h.chunk)}  [score ${h.score.toFixed(1)}]`)
);
console.log(`\n💬 DeepSeek 답변:\n${"-".repeat(70)}\n${text}\n${"-".repeat(70)}`);
