#!/usr/bin/env node
/**
 * unanswered.mjs — 챗봇이 답하지 못한 질문을 검토하는 도구 (로컬 전용)
 * ------------------------------------------------------------------
 * 기록은 Worker 가 D1에 하고(chatbot/worker/unanswered.mjs), 조회·상태갱신은 여기서 한다.
 * 배포된 조회 엔드포인트는 일부러 두지 않았다 — 질문 원문이 담긴 API를 현재 인증
 * (고정 세션토큰 + SITE_PASSWORD 미설정 시 fail-open) 위에 올리지 않기 위해서다.
 *
 * 사전: wrangler 로그인 또는 CLOUDFLARE_API_TOKEN, 그리고 wrangler.toml 의 D1 database_id
 *
 * 사용법
 *   node scripts/unanswered.mjs --init              테이블 생성(최초 1회)
 *   node scripts/unanswered.mjs                     미처리 목록 (많이 막힌 순)
 *   node scripts/unanswered.mjs --all               상태 무관 전체
 *   node scripts/unanswered.mjs --reason 근거미표시  원인별로 보기
 *   node scripts/unanswered.mjs --stats             원인·상태별 집계
 *   node scripts/unanswered.mjs --id <qhash>        1건 상세 (검색 상위 청크까지)
 *   node scripts/unanswered.mjs --resolve <qhash> --status 자료추가 --note "지특법 §31 추가"
 *   node scripts/unanswered.mjs --resolve <qhash> --status 해결 \
 *        --expect "도시 및 주거환경정비법 제74조"    → tests/golden.jsonl 에 회귀셋 추가
 *
 * 검토 워크플로
 *   1) 목록 확인 — hit_count 가 큰 것부터. 여러 사람이 반복해 막힌 질문이 우선순위다.
 *   2) --id 로 top_hits 를 보고 원인을 가른다:
 *        · 검색 상위가 전부 무관 + 법률 무관 질의  → 범위밖   (무시)
 *        · 정비 질의인데 해당 조문이 corpus 에 없음 → 자료추가 (★ 본래 목표)
 *        · corpus 에는 있는데 상위에 못 올라옴      → 검색보정 (retrieve.mjs 동의어·가중치)
 *   3) 자료추가면 law-api-koreit 스킬로 조문을 받아 corpus/ 에 md 추가
 *   4) node scripts/build-index.mjs && bash scripts/kv-upload.sh
 *   5) ★ 그 질문을 다시 던져 답이 나오는지 확인 (kv-upload 후 최대 60초 대기 — 캐시 버전 반영)
 *   6) --resolve 로 상태 기록
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_DIR = join(ROOT, "chatbot", "worker");
const GOLDEN = join(ROOT, "tests", "golden.jsonl");
// 프롬프트보정: 자료도 맞고 검색도 맞는데 모델이 잘못 해석한 경우(신고 건에서 주로 나온다).
const STATUSES = ["미처리", "자료추가", "검색보정", "프롬프트보정", "범위밖", "보류", "해결"];

/* ── 인자 파싱 ── */
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i > -1 ? (argv[i + 1] ?? true) : null;
};
const has = (name) => argv.includes(name);

/* ── D1 실행 ──
 * wrangler d1 execute 는 --json 으로 [{results:[...], success, meta}] 를 준다.
 * 실패 시 stderr 를 그대로 보여준다(대개 database_id 미기입 또는 로그인 문제). */
function d1(sql) {
  let out;
  try {
    out = execFileSync(
      "npx",
      ["wrangler", "d1", "execute", "LOGS_DB", "--remote", "--json", "--command", sql],
      { cwd: WORKER_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 }
    );
  } catch (e) {
    const msg = (e.stderr || "") + (e.stdout || "");
    if (/REPLACE_WITH_D1_DATABASE_ID/.test(msg)) {
      console.error("✗ wrangler.toml 의 D1 database_id 가 아직 비어 있습니다.\n" +
                    "  npx wrangler d1 create jeongbi-logs  →  출력된 id 를 기입하세요.");
    } else if (/no such table/i.test(msg)) {
      console.error("✗ 테이블이 없습니다. 먼저 'node scripts/unanswered.mjs --init' 을 실행하세요.");
    } else {
      console.error(msg.trim() || String(e));
    }
    process.exit(1);
  }
  // wrangler 가 진행 로그를 함께 뱉는 경우가 있어 JSON 배열 부분만 잘라낸다.
  const i = out.indexOf("[");
  const j = out.lastIndexOf("]");
  if (i === -1 || j === -1) return [];
  try {
    return JSON.parse(out.slice(i, j + 1))[0]?.results ?? [];
  } catch {
    return [];
  }
}

// SQL 문자열 리터럴 이스케이프. 이 스크립트는 명근만 쓰지만 note 에 따옴표가 들어가면 깨진다.
const q = (s) => (s === null || s === undefined ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);

/* ── --init : 스키마 적용 ── */
if (has("--init")) {
  console.log("schema.sql 적용 중…");
  try {
    execFileSync("npx", ["wrangler", "d1", "execute", "LOGS_DB", "--remote", "--file=schema.sql"],
      { cwd: WORKER_DIR, stdio: "inherit" });
    console.log("✓ 완료");
  } catch {
    process.exit(1);
  }
  process.exit(0);
}

/* ── --stats : 집계 ── */
if (has("--stats")) {
  const byReason = d1(
    "SELECT reason, COUNT(*) AS 질문수, SUM(hit_count) AS 발생건수 FROM unanswered GROUP BY reason ORDER BY 발생건수 DESC"
  );
  const byStatus = d1("SELECT status, COUNT(*) AS 질문수 FROM unanswered GROUP BY status ORDER BY 질문수 DESC");
  const byType = d1(
    "SELECT q_type, COUNT(*) AS 질문수, SUM(hit_count) AS 발생건수 FROM unanswered WHERE status='미처리' GROUP BY q_type ORDER BY 발생건수 DESC LIMIT 10"
  );
  const show = (title, rows) => {
    console.log(`\n[${title}]`);
    if (!rows.length) return console.log("  (없음)");
    for (const r of rows) console.log("  " + Object.entries(r).map(([k, v]) => `${k}=${v}`).join("  "));
  };
  show("원인별", byReason);
  show("상태별", byStatus);
  show("미처리 질의유형 Top10", byType);
  console.log();
  process.exit(0);
}

/* ── --resolve : 상태 기록 ── */
const resolveId = flag("--resolve");
if (resolveId) {
  const status = flag("--status");
  if (!status || !STATUSES.includes(status)) {
    console.error(`✗ --status 가 필요합니다. 가능한 값: ${STATUSES.join(" | ")}`);
    process.exit(1);
  }
  const note = flag("--note");
  const rows = d1(`SELECT question FROM unanswered WHERE qhash=${q(resolveId)}`);
  if (!rows.length) {
    console.error(`✗ qhash=${resolveId} 를 찾을 수 없습니다.`);
    process.exit(1);
  }
  d1(
    `UPDATE unanswered SET status=${q(status)}, resolved_at=${q(new Date().toISOString())}` +
      (note ? `, note=${q(note)}` : "") +
      ` WHERE qhash=${q(resolveId)}`
  );
  console.log(`✓ ${resolveId} → ${status}${note ? ` (${note})` : ""}`);

  /* 골든셋 적립 — "이 질문에는 이 조문이 나와야 한다"를 남긴다.
   * 지금은 쌓기만 한다. 회귀 검증(test-retrieval.mjs 확장)은 표본이 모인 뒤 별건으로 붙인다. */
  const expect = flag("--expect");
  if (expect && expect !== true) {
    mkdirSync(dirname(GOLDEN), { recursive: true });
    appendFileSync(
      GOLDEN,
      JSON.stringify({
        question: rows[0].question,
        expect: String(expect).split("|").map((s) => s.trim()).filter(Boolean),
        qhash: resolveId,
        added: new Date().toISOString().slice(0, 10),
      }) + "\n"
    );
    console.log(`✓ tests/golden.jsonl 에 회귀 케이스 추가`);
  }
  process.exit(0);
}

/* ── --id : 1건 상세 ── */
const detailId = flag("--id");
if (detailId) {
  const rows = d1(`SELECT * FROM unanswered WHERE qhash=${q(detailId)}`);
  if (!rows.length) {
    console.error(`✗ qhash=${detailId} 를 찾을 수 없습니다.`);
    process.exit(1);
  }
  const r = rows[0];
  console.log(`\n질문     ${r.question}`);
  console.log(`원인     ${r.reason}      유형 ${r.q_type}      범위 ${r.scope}`);
  console.log(`발생     ${r.hit_count}회   ${r.first_ts?.slice(0, 16)} ~ ${r.last_ts?.slice(0, 16)}   사용자 ${r.user_hash || "-"}`);
  console.log(`상태     ${r.status}${r.note ? `  — ${r.note}` : ""}`);
  console.log(`\n답변 서두\n  ${(r.answer_head || "(없음)").replace(/\n/g, "\n  ")}`);
  const reported = r.reason === "사용자신고";
  console.log(`\n${reported ? "답변이 인용한 근거" : "검색 상위 (이걸 보고 원인을 가른다)"}`);
  let hits = [];
  try { hits = JSON.parse(r.top_hits || "[]"); } catch {}
  if (!hits.length) {
    console.log(reported
      ? "  (없음) → 근거 없이 답했다. 환각 가능성이 높으니 우선 확인할 것."
      : "  (없음) → 검색이 후보를 하나도 못 냈다. 범위 밖 질의이거나 corpus 에 자료가 전혀 없다.");
  } else {
    hits.forEach((h, i) => {
      const name = h.법령명 || h.사건번호 || "?";
      console.log(`  ${String(i + 1).padStart(2)}. [${h.자료유형}] ${name} ${h.조문 || ""}` +
                  (h.cited ? "" : `  score=${h.score}`) + (h.ref ? "  (참조조문)" : ""));
    });
  }
  console.log(reported ? `
판단 가이드 (사용자 신고 — 답은 나왔는데 틀렸다는 신고다)
  ★ 먼저 위 근거를 열어 답변 내용과 대조할 것. 신고 사유는 '답변 서두' 맨 위에 있다.
  · 인용한 조문 자체가 틀렸거나 개정 전 내용   → --status 자료추가  (law-api-koreit 로 현행 확인)
  · 엉뚱한 조문을 끌어와 답했다                 → --status 검색보정  (retrieve.mjs SYN/가중치)
  · 자료는 맞는데 모델이 잘못 해석했다          → --status 프롬프트보정 (pipeline.mjs SYSTEM_PROMPT)
  · 신고가 오해였다(답변이 맞다)                → --status 범위밖 --note "오신고"
` : `
판단 가이드
  · 위 목록이 질문과 전부 무관 + 법률 무관 질의  → --status 범위밖
  · 관련 조문이 corpus 에 아예 없다              → --status 자료추가  (law-api-koreit 로 조문 확보)
  · 관련 조문이 corpus 에 있는데 위에 안 보인다  → --status 검색보정  (retrieve.mjs SYN/가중치)
`);
  process.exit(0);
}

/* ── 기본: 목록 ── */
const where = [];
if (!has("--all")) where.push("status='미처리'");
const reason = flag("--reason");
if (reason && reason !== true) where.push(`reason=${q(reason)}`);
const limit = Number(flag("--limit")) || 30;

const rows = d1(
  `SELECT qhash, question, reason, q_type, hit_count, status, last_ts FROM unanswered` +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    // 사용자 신고를 맨 위로. 사람이 "이 답변 틀렸다"고 누른 건 자동 판별보다 강한 신호이고,
    // 대전제상 '못 답한 것'보다 '틀리게 답한 것'이 더 급하다.
    ` ORDER BY (reason='사용자신고') DESC, hit_count DESC, last_ts DESC LIMIT ${limit}`
);

if (!rows.length) {
  console.log(has("--all") ? "기록된 미답변 질문이 없습니다." : "미처리 항목이 없습니다. (--all 로 전체 보기)");
  process.exit(0);
}

const pad = (s, n) => {
  // 한글은 폭이 2라서 문자수로 맞추면 표가 어긋난다.
  const w = (t) => [...t].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  let out = "", cur = 0;
  for (const c of String(s ?? "")) {
    const cw = c.charCodeAt(0) > 0x2e80 ? 2 : 1;
    if (cur + cw > n) { out += "…"; cur += 1; break; }
    out += c; cur += cw;
  }
  return out + " ".repeat(Math.max(0, n - cur));
};

console.log(`\n${pad("qhash", 17)}${pad("회", 4)}${pad("원인", 12)}${pad("유형", 16)}${pad("질문", 52)}상태`);
console.log("─".repeat(110));
for (const r of rows) {
  console.log(
    pad(r.qhash, 17) + pad(r.hit_count, 4) + pad(r.reason, 12) +
    pad(r.q_type, 16) + pad(r.question, 52) + r.status
  );
}
console.log(`\n${rows.length}건. 상세: node scripts/unanswered.mjs --id <qhash>\n`);
