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
  join(ROOT, "corpus", "tribunals"),   // 심판례(조세심판원 결정)
  join(ROOT, "corpus", "interpretations"), // 유권해석(법제처 등)
];
// ※ 이 배열의 순서가 청크 id 순서를 정하고, id 는 KV 벡터의 오프셋이다.
//   순서를 바꾸거나 중간에 폴더를 끼워 넣으면 기존 벡터와 어긋나므로, 새 폴더는 반드시 끝에 추가할 것.
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
    const artM = line.match(/^##\s+(제\d+조(?:의\d+)?)\s*(?:\((.*)\))?\s*$/); // 조문
    const tblM = line.match(/^###\s+\[별표\]\s*(.*)$/); // 별표
    // 조문(제N조)이 아닌 ## 헤딩(예: 고시의 "제1장 총칙", "별표(첨부서식)") — 조문식이 아닌
    // 행정규칙을 통째로 놓치지 않도록 일반 헤딩도 청크로 만든다. (법령은 전부 제N조라 무영향)
    const genM = !artM && line.match(/^##\s+(.+?)\s*$/);
    if (artM) {
      push();
      cur = {
        자료유형,
        법령명: meta["법령명"],
        지자체: meta["지자체"],   // 조례만 값 존재(지역 필터용). 법령·판례는 undefined.
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
        지자체: meta["지자체"],   // 조례만 값 존재(지역 필터용). 법령·판례는 undefined.
        시행일자: meta["시행일자"],
        조문: `[별표] ${tblM[1]}`.trim(),
        제목: tblM[1] || "",
        heading: `[별표] ${tblM[1]}`.trim(),
        text: line + "\n",
      };
    } else if (genM) {
      push();
      cur = {
        자료유형,
        법령명: meta["법령명"],
        지자체: meta["지자체"],   // 조례만 값 존재(지역 필터용). 법령·판례는 undefined.
        시행일자: meta["시행일자"],
        // 심판례(조세심판원)·유권해석 전용 메타. 다른 자료유형에서는 undefined 라
        // JSON 직렬화 시 자동 생략되므로 인덱스 크기에 영향이 없다.
        사건번호: meta["사건번호"],
        사건명: meta["사건명"],
        기관: meta["기관"],
        의결일자: meta["의결일자"],
        세목: meta["세목"],
        관련법령: meta["관련법령"],
        쟁점: meta["쟁점"],
        조문: genM[1].trim(),
        제목: "",
        heading: genM[1].trim(),
        text: line + "\n",
      };
    } else if (cur) {
      cur.text += line + "\n";
    }
  }
  push();

  // 정의 조문(조문제목에 '정의')은 호(號) 단위로도 서브청크를 만든다.
  // → "가로주택정비사업이 뭐야?" 처럼 특정 용어 정의를 콕 집어 검색되게.
  const subs = [];
  for (const c of chunks) {
    if (!(c.제목 && /정의/.test(c.제목))) continue;
    const bodyLines = c.text.split("\n").slice(1); // 헤딩 제외
    let buf = null;
    const flush = () => {
      if (buf && buf.text.trim()) {
        subs.push({
          자료유형: c.자료유형,
          법령명: c.법령명,
          지자체: c.지자체,
          시행일자: c.시행일자,
          조문: `${c.조문} ${buf.no}`,
          제목: c.제목,
          heading: `${c.heading} ${buf.no}`,
          text: `${c.heading} ${buf.no}\n${buf.text.trim()}`,
        });
      }
    };
    for (const ln of bodyLines) {
      const hoM = ln.match(/^\s*(\d+(?:의\d+)?)\.\s/);  // 호: "1." "1의2."
      const mokM = ln.match(/^\s*([가-힣])\.\s/);        // 목: "가." "나."
      if (hoM) { flush(); buf = { no: `제${hoM[1]}호`, text: ln + "\n" }; }
      else if (mokM) { flush(); buf = { no: `${mokM[1]}목`, text: ln + "\n" }; }
      else if (buf) buf.text += ln + "\n";
    }
    flush();
  }
  return chunks.concat(subs);
}

/* 청크 안정 키 — 벡터를 찾아가는 주소.
 * id(순번)는 파일이 하나만 추가돼도 뒤가 전부 밀려 벡터와 어긋난다.
 * 그래서 벡터 조회는 "파일명#조문"이라는 내용 기반 키로 한다.
 * 이 키는 파일이 추가·삭제·이동돼도 그 청크를 계속 같은 이름으로 가리킨다.
 * (같은 파일에 같은 조문 라벨이 둘 이상이면 ~2, ~3 을 덧붙여 유일성을 보장) */
const keySeen = new Map();
function stableKey(file, c) {
  const label = (c.조문 || c.heading || "").trim();
  const base = label ? `${file}#${label}` : file;
  const n = (keySeen.get(base) || 0) + 1;
  keySeen.set(base, n);
  return n === 1 ? base : `${base}~${n}`;
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
    for (const c of chunks) index.push({ id: id++, key: stableKey(f, c), 파일: f, ...c });
    console.log(`  ${f}: ${chunks.length} 청크 (${meta["법령명"]})`);
  }
}

// 키 유일성 검증 — 중복되면 서로 다른 조문이 같은 벡터를 가리키게 되므로 빌드를 멈춘다.
const dup = index.length - new Set(index.map((c) => c.key)).size;
if (dup > 0) throw new Error(`청크 키 중복 ${dup}건 — stableKey 규칙 확인 필요`);

writeFileSync(OUT, JSON.stringify(index, null, 0), "utf-8");
console.log(`\n✓ ${index.length} 청크 → ${OUT.replace(ROOT + "/", "")}`);
