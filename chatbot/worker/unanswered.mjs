/**
 * unanswered.mjs — 챗봇이 답하지 못한 질문을 D1에 기록한다.
 * ------------------------------------------------------------------
 * 목적: 챗봇이 스스로 약점을 드러내게 하고, 그 약점(=빠진 근거 자료)을 하나씩 메운다.
 *
 * ★ 이 모듈은 답변 경로에 절대 영향을 주지 않는다.
 *   worker.js 가 응답을 돌려준 뒤 ctx.waitUntil() 로 호출하며, 여기서 무슨 일이
 *   일어나도(바인딩 없음·D1 장애·SQL 오류) 사용자 답변은 이미 나간 뒤다.
 *   실패는 삼키고 로그만 남긴다.
 *
 * 검토는 로컬에서 한다: node scripts/unanswered.mjs
 *   (조회용 엔드포인트는 두지 않는다. 질문 원문이 담긴 API를 현재의 인증
 *    — 고정 세션토큰 + SITE_PASSWORD 미설정 시 fail-open — 위에 얹지 않기 위해서다.)
 */

/* 운영자 점검 계정 — 기록에서 제외한다.
 * healthcheck.mjs 는 대전제 검증을 위해 일부러 범위 밖 질문("오늘 서울 날씨 어때?")을
 * 던진다. 제외하지 않으면 점검을 돌릴 때마다 검토 큐에 쓰레기 행이 쌓인다.
 * 프론트 index.html 의 EXCLUDED_USERS(GA 제외 명단)와 같은 목적·같은 값으로 유지할 것. */
const EXCLUDED_USERS = ["박새", "상태점검"];

/* 질의유형 화이트리스트 — 프론트(index.html 의 Q_TYPES)가 계산해 보내는 값을 검증만 한다.
 * 분류 로직을 서버에 복제하지 않는 이유: 두 벌이 되면 반드시 어긋나고, 그러면 GA 집계와
 * D1 기록의 유형이 달라져 교차 확인이 불가능해진다. 목록만 동기화한다. */
const Q_TYPES = new Set([
  "재건축부담금", "매도청구·청산", "수용·손실보상", "세금", "관리처분·분양",
  "조합·추진위", "시공자·계약", "인가·계획", "소규모주택정비", "노후계획도시",
  "재건축진단", "신탁방식", "임대·주택규모", "기타",
]);

/**
 * 답변이 "실패"인지 판정한다. 실패가 아니면 null.
 *
 * 실패 3종 — 앞의 둘은 GA(result:근거없음)로도 보이지만, 셋째는 GA가 못 잡는다.
 *
 *  · 검색0건    : 검색이 후보를 하나도 못 냈다. pipeline 이 즉시 NO_EVIDENCE 를 돌려준다.
 *  · 모델거절   : 자료는 갔는데 DeepSeek 이 답을 못 도출했다.
 *  · 근거미표시 : ★ 거절도 아닌데 근거가 0건. usedSources() 가 답변에서 인용을 못 찾은 경우다.
 *                 원인은 둘 중 하나 — 모델이 인용 형식(규칙 3)을 안 지켰거나,
 *                 자료 없이 답했거나(=환각). 대전제상 가장 위험한 케이스라 반드시 본다.
 *                 프론트 GA 판별식은 /^\s*제공된 자료로는/ 이라 이걸 '답변'으로 집계한다.
 */
export function classifyFailure(answer, sources, hits) {
  if (!hits || hits.length === 0) return "검색0건";
  if (/^\s*제공된 자료로는/.test(answer || "")) return "모델거절";
  if (!sources || sources.length === 0) return "근거미표시";
  return null;
}

/* 네 번째 원인 — 사용자 신고.
 * 위 3종은 전부 "답을 못 한" 경우다. 답은 나왔는데 **틀린** 경우는 기계가 알 수 없다.
 * (근거를 갖춰 그럴듯하게 답하면 어떤 자동 판별에도 안 걸린다.)
 * 그래서 화면의 '이 답변 이상해요' 버튼으로 사람이 직접 넣는 경로를 둔다.
 * 환각 절대 금지가 최우선 가치인데 자동 판별만으로는 이 구멍이 안 막힌다. */
export const REPORTED = "사용자신고";

/* 답변 저장 상한. 신고 건은 "왜 틀렸나"를 판단해야 하므로 본문이 상당량 필요하다.
 * 자동 기록(거절 문구)은 어차피 짧아 이 상한에 걸리지 않는다. */
const ANSWER_MAX = 4000;
const NOTE_MAX = 500;

/** 검색범위 라벨. 클라이언트 값을 믿지 않고 서버가 해석한 값으로 만든다. */
export function scopeLabel(law, prec, ordRegion) {
  const parts = [];
  if (law) parts.push("법령");
  if (prec) parts.push("판례");
  if (ordRegion) parts.push(`조례(${ordRegion})`);
  return parts.join("+") || "없음";
}

/* 이름 → 8자리 해시(FNV-1a). index.html 의 nameHash 와 같은 알고리즘이라
 * GA 의 user_id 와 값이 일치한다 → GA 집계에서 본 사용자를 D1 기록에서 찾을 수 있다. */
function nameHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ("0000000" + (h >>> 0).toString(16)).slice(-8);
}

/* 질문 정규화 → 중복 집계 키.
 * 공백·문장부호를 걷어내 "조합설립 동의율?" 과 "조합설립 동의율은?" 을 같은 질문으로 묶는다.
 * (형태소 수준까지는 안 간다. 과하게 묶으면 서로 다른 질문이 한 행에 뭉개진다.) */
async function questionHash(q) {
  const norm = (q || "").toLowerCase().replace(/[\s?!.,·ㆍ~"'()[\]]/g, "");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/** 쿠키에서 로그인 이름 꺼내기 (login 시 who 쿠키에 encodeURIComponent 로 저장됨) */
function loginName(request) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === "who") {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ""; }
    }
  }
  return "";
}

/* 검토 큐에 한 행을 쓴다(자동 기록·사용자 신고 공용).
 *
 * UPSERT — 같은 질문이 또 들어오면 행을 늘리지 않고 hit_count 만 올린다.
 *
 * top_hits/answer_head 는 최신으로 덮는다: corpus 가 그새 바뀌었을 수 있어
 * 진단은 마지막 사건 기준이 맞다.
 *
 * reason 의 CASE — **사용자 신고가 자동 분류를 이긴다.** 사람이 직접 "이 답변 이상하다"고
 * 누른 건 기계 판별보다 강한 신호이고, 자동 기록이 나중에 덮어써서 신고를 지우면 안 된다.
 *
 * status 의 CASE 는 회귀 감지다 — '해결'로 닫았던 질문이 다시 실패하거나 신고되면
 * 자동으로 '미처리'로 되돌려 검토 큐에 다시 띄운다.
 */
async function writeRow(env, { qhash, question, reason, qType, scope, userHash, topHits, answerHead }) {
  const now = new Date().toISOString();
  await env.LOGS_DB.prepare(
    `INSERT INTO unanswered
       (qhash, question, reason, q_type, scope, user_hash, top_hits, answer_head,
        first_ts, last_ts, hit_count)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, 1)
     ON CONFLICT(qhash) DO UPDATE SET
       hit_count   = hit_count + 1,
       last_ts     = excluded.last_ts,
       reason      = CASE WHEN unanswered.reason = '${REPORTED}' THEN unanswered.reason
                          ELSE excluded.reason END,
       top_hits    = excluded.top_hits,
       answer_head = excluded.answer_head,
       status      = CASE WHEN unanswered.status = '해결' THEN '미처리' ELSE unanswered.status END`
  )
    .bind(qhash, question, reason, qType, scope, userHash, topHits, answerHead, now)
    .run();
}

/* 검색 결과 상위 7건을 진단용으로 직렬화. 원인 3분류의 판별 근거다.
 * 청크 본문은 넣지 않는다(용량↑, 그리고 key 만 있으면 corpus 에서 언제든 되찾을 수 있다). */
function serializeHits(hits) {
  return JSON.stringify(
    (hits || []).slice(0, 7).map((h) => ({
      자료유형: h.chunk.자료유형,
      법령명: h.chunk.법령명,
      조문: h.chunk.조문,
      사건번호: h.chunk.사건번호,
      key: h.chunk.key,
      score: Number((h.score || 0).toFixed(4)),
      ref: h.ref ? 1 : undefined, // expandReferences 가 끌어온 참조 조문
    }))
  );
}

/** 공통 전처리. 기록 대상이 아니면 null. */
async function prep(env, request, question) {
  if (!env.LOGS_DB) return null; // 바인딩 없음 → 기록 기능만 꺼진다(답변은 정상)
  const name = loginName(request).trim();
  if (EXCLUDED_USERS.includes(name)) return null; // 운영자 점검은 큐에 넣지 않는다
  return { qhash: await questionHash(question), userHash: name ? nameHash(name) : null };
}

/**
 * 실패한 질문을 D1에 기록한다. 성공 답변은 아무것도 하지 않는다.
 *
 * @param {Object}   env      Worker env
 * @param {Request}  request  로그인 이름(who 쿠키)을 읽기 위해
 * @param {Object}   p        { question, answer, sources, hits, law, prec, ordRegion, qType }
 */
export async function logIfUnanswered(env, request, p) {
  try {
    const reason = classifyFailure(p.answer, p.sources, p.hits);
    if (!reason) return; // 근거를 갖춘 정상 답변 → 기록 대상 아님
    const base = await prep(env, request, p.question);
    if (!base) return;
    await writeRow(env, {
      ...base,
      question: p.question,
      reason,
      qType: Q_TYPES.has(p.qType) ? p.qType : "기타",
      scope: scopeLabel(p.law, p.prec, p.ordRegion),
      topHits: serializeHits(p.hits),
      answerHead: (p.answer || "").slice(0, ANSWER_MAX),
    });
  } catch (e) {
    // 기록 실패가 답변을 망치면 안 된다. 로그만 남기고 삼킨다.
    console.log(`[unanswered] 기록 실패: ${e}`);
  }
}

/**
 * 사용자가 '이 답변 이상해요'를 누른 건을 기록한다.
 *
 * 자동 판별 3종은 전부 "답을 못 한" 경우만 잡는다. 근거를 갖춰 그럴듯하게 **틀리게**
 * 답하면 어떤 기계 판별에도 안 걸리므로, 사람이 넣는 이 경로가 유일한 탐지 수단이다.
 *
 * top_hits 에는 검색 상위 대신 **답변이 실제로 인용한 근거**를 넣는다(프론트가 보낸 값).
 * 신고는 답변이 나간 뒤에 오므로 그때의 검색 결과는 서버에 남아 있지 않다.
 * 검토 시에는 어차피 그 질문을 다시 던져 현재 검색 결과를 새로 보게 된다.
 *
 * @param {Object} p { question, answer, sources, note, qType, scope }
 */
export async function logReport(env, request, p) {
  const base = await prep(env, request, p.question);
  if (!base) return { ok: false, reason: "skipped" };
  const cited = (Array.isArray(p.sources) ? p.sources : []).slice(0, 7).map((s) => ({
    자료유형: s.자료유형, 법령명: s.법령명, 조문: s.조문,
    사건번호: s.사건번호, 지자체: s.지자체, cited: 1, // 검색 상위가 아니라 '인용된 근거'임을 표시
  }));
  const note = (p.note || "").toString().slice(0, NOTE_MAX).trim();
  await writeRow(env, {
    ...base,
    question: p.question,
    reason: REPORTED,
    qType: Q_TYPES.has(p.qType) ? p.qType : "기타",
    scope: (p.scope || "").toString().slice(0, 60),
    topHits: JSON.stringify(cited),
    // 신고 사유를 답변 앞에 붙여둔다 — 검토 화면(--id)에서 제일 먼저 보이게.
    answerHead: (note ? `【신고 사유】 ${note}\n\n` : "") + (p.answer || "").slice(0, ANSWER_MAX),
  });
  return { ok: true };
}
