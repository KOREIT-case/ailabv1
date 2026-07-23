#!/usr/bin/env node
/**
 * build-index.mjs — corpus/laws/*.md → chatbot/worker/corpus-index.json
 *
 * 각 법령 md를 조(條)/별표 단위 청크로 쪼개 메타데이터와 함께 JSON으로 저장한다.
 * 이 인덱스를 Worker(retrieve.mjs)와 로컬 테스트가 공용으로 사용한다.
 *
 * 실행: node scripts/build-index.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS_DIRS = [
  join(ROOT, "corpus", "laws"),        // 법령(법·시행령·시행규칙)
  join(ROOT, "corpus", "admin_rules"), // 행정규칙(고시)
  join(ROOT, "corpus", "ordinances"),  // 자치법규(서울시 조례·규칙)
  join(ROOT, "corpus", "precedents"),  // 판례
];
const OUT = join(ROOT, "chatbot", "worker", "corpus-index.json");

/** 아주 단순한 front matter 파서 (key: value 라인만) */
function parseFrontMatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^([^:]+):\s*(.*)$/);
    if (mm) meta[mm[1].trim()] = mm[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return { meta, body: md.slice(m[0].length) };
}

/** 본문을 ## 제N조 / ### [별표] 단위 청크로 분할 */
function splitChunks(body, meta) {
  const lines = body.split("\n");
  const chunks = [];
  let cur = null;
  const push = () => {
    if (cur && cur.text.trim()) {
      cur.text = cur.text.trim();
      chunks.push(cur);
    }
  };
  const 자료유형 = meta["자료유형"] || "법령";

  // 판례는 조문 구조가 아니라 사건 단위 → 문서 전체를 한 청크로.
  if (자료유형 === "판례") {
    const text = body.replace(/^#\s+.*$/m, "").trim(); // 최상단 '# 대법원 …' 제목줄 제거
    if (!text) return [];
    return [{
      자료유형,
      법령명: meta["법령명"],       // "대법원 2005다68769"
      사건번호: meta["사건번호"],
      사건명: meta["사건명"],
      법원: meta["법원"],
      선고일자: meta["선고일자"],
      쟁점: meta["쟁점"] || "",
      조문: "",
      heading: `${meta["법원"] || ""} ${meta["사건번호"] || ""} ${meta["사건명"] || ""}`.trim(),
      text,
    }];
  }

  for (const line of lines) {
    const artM = line.match(/^##\s+(제\S+)\s*(?:\((.*)\))?\s*$/); // 조문
    const tblM = line.match(/^###\s+\[별표\]\s*(.*)$/); // 별표
    if (artM) {
      push();
      cur = {
        자료유형,
        법령명: meta["법령명"],
        시행일자: meta["시행일자"],
        조문: artM[1],
        제목: artM[2] || "",
        heading: line.replace(/^##\s+/, "").trim(),
        text: line + "\n",
      };
    } else if (tblM) {
      push();
      cur = {
        자료유형,
        법령명: meta["법령명"],
        시행일자: meta["시행일자"],
        조문: `[별표] ${tblM[1]}`.trim(),
        제목: tblM[1] || "",
        heading: `[별표] ${tblM[1]}`.trim(),
        text: line + "\n",
      };
    } else if (cur) {
      cur.text += line + "\n";
    }
  }
  push();
  return chunks;
}

const index = [];
let id = 0;
for (const dir of CORPUS_DIRS) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  } catch {
    continue; // 폴더 없으면 건너뜀
  }
  for (const f of files) {
    const md = readFileSync(join(dir, f), "utf-8");
    const { meta, body } = parseFrontMatter(md);
    const chunks = splitChunks(body, meta);
    for (const c of chunks) index.push({ id: id++, 파일: f, ...c });
    console.log(`  ${f}: ${chunks.length} 청크 (${meta["법령명"]})`);
  }
}

writeFileSync(OUT, JSON.stringify(index, null, 0), "utf-8");
console.log(`\n✓ ${index.length} 청크 → ${OUT.replace(ROOT + "/", "")}`);
