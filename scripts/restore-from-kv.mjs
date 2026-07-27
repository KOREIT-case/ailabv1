/**
 * 사용: node scripts/restore-from-kv.mjs <kv-index.json>
 *   (KV 덤프: cd chatbot/worker && npx wrangler kv key get "corpus-index" --binding CORPUS_KV --remote > kv.json)
 *
 * KV 인덱스에만 남아 있던 심판례·유권해석을 원본 md 로 복원한다.
 *
 * 배경: 이 자료들은 corpus/ 에 md 원본이 없고 KV(운영 인덱스)에만 존재했다.
 *       KV 청크에 본문 전체와 메타데이터가 살아 있어 md 재구성이 가능하다.
 * 원칙: 청크 경계(= 조문 라벨)를 그대로 헤딩으로 박아, 현재 build-index.mjs 로
 *       재빌드해도 KV 와 동일한 청크 시퀀스가 나오게 한다. (KV 벡터를 계속 쓸 수 있음)
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const kv = JSON.parse(fs.readFileSync(process.argv[2] || "kvindex.json", "utf-8"));

const DIR = { 심판례: path.join(ROOT, "corpus", "tribunals"),
              유권해석: path.join(ROOT, "corpus", "interpretations") };
// front matter 로 되살릴 필드 (청크 단위 필드인 조문/제목/heading/text/id/파일 은 제외)
const META_KEYS = ["자료유형","법령명","사건번호","사건명","기관","의결일자","세목","관련법령","쟁점","문서번호","회신일자","질의기관"];

const targets = kv.filter((c) => c.자료유형 === "심판례" || c.자료유형 === "유권해석");
const byFile = new Map();               // 파일 → 청크[] (KV 등장 순서 유지)
for (const c of targets) {
  if (!byFile.has(c.파일)) byFile.set(c.파일, []);
  byFile.get(c.파일).push(c);
}

for (const d of Object.values(DIR)) fs.mkdirSync(d, { recursive: true });

let written = 0, chunkTotal = 0;
for (const [file, chunks] of byFile) {
  const head = chunks[0];
  const fm = ["---"];
  for (const k of META_KEYS) {
    const v = head[k];
    if (v === undefined || v === "") continue;
    // 콜론·따옴표가 든 값은 단순 파서가 깨지지 않도록 큰따옴표로 감싼다
    fm.push(`${k}: ${/[:#"]/.test(String(v)) ? JSON.stringify(String(v)) : v}`);
  }
  fm.push("출처: KV 운영 인덱스에서 복원 (원본 md 유실)");
  fm.push(`최종확인일: ${new Date().toISOString().slice(0, 10)}`);
  fm.push("---", "");

  const body = [];
  for (const c of chunks) {
    const lines = (c.text || "").split("\n");
    // 첫 줄이 인덱서가 붙인 머리글(heading 그대로거나 "사건번호 (판단)")이면 떼어낸다.
    // 머리글 판정: heading 그대로이거나, "사건번호(또는 법령명) (판단)" 형태의 접두어
    const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const firstIsHead = lines[0] === c.heading ||
      [c.법령명, c.사건번호].filter(Boolean)
        .some((key) => new RegExp(`^${esc(key)}\\s*\\(`).test(lines[0]));
    const content = (firstIsHead ? lines.slice(1) : lines).join("\n").trim();
    body.push(`## ${c.조문}`, "", content, "");
    chunkTotal++;
  }

  fs.writeFileSync(path.join(DIR[head.자료유형], file), fm.join("\n") + body.join("\n").trimEnd() + "\n", "utf-8");
  written++;
}
console.log(`복원 완료: ${written}개 파일 / ${chunkTotal}청크`);
console.log("  심판례 :", fs.readdirSync(DIR.심판례).length, "파일");
console.log("  유권해석:", fs.readdirSync(DIR.유권해석).filter(f=>!f.startsWith("_")).length, "파일");
