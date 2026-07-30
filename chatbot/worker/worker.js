/**
 * worker.js — Cloudflare Worker (배포본)
 * ------------------------------------------------------------------
 * 같은 URL이 GET=채팅화면, POST /login=로그인, POST /=질문 API 를 겸한다.
 * 핵심 답변 로직은 pipeline.mjs 에 있고, 이 파일은 HTTP·인증 래퍼다.
 *
 * 배포 전 준비:
 *   1) node scripts/build-index.mjs         → corpus-index.json 생성/갱신
 *   2) (최초 1회) wrangler kv namespace create CORPUS_KV → id 를 wrangler.toml 에 기입
 *   3) bash scripts/kv-upload.sh             → corpus-index.json 을 KV 에 업로드
 *   4) wrangler secret put DEEPSEEK_KEY      → DeepSeek 키
 *   5) wrangler secret put SITE_PASSWORD     → 접속 비밀번호 (코드·문서에 적지 말 것)
 *   6) wrangler deploy
 */
import { generate } from "./pipeline.mjs";
import { retrieve, retrieveHybrid, normalizeVec, expandReferences } from "./retrieve.mjs";
import { logIfUnanswered, logReport } from "./unanswered.mjs";
import CHAT_HTML from "../public/index.html"; // 채팅 화면 (wrangler Text 룰로 문자열 번들)
import bg1 from "./bg/bg1.jpg"; // 배경 이미지 4종 (Data 룰 → ArrayBuffer)
import bg2 from "./bg/bg2.jpg";
import bg3 from "./bg/bg3.jpg";
import bg4 from "./bg/bg4.jpg";
const BGS = { "1": bg1, "2": bg2, "3": bg3, "4": bg4 };

/* ── corpus 인덱스: Cloudflare KV 에서 로드 ──
 * corpus-index.json 은 Worker 번들에 넣지 않고 KV(CORPUS_KV)의 'corpus-index' 키에 둔다.
 * → Worker 번들 1MB(무료) 한도와 무관하게 corpus 를 계속 키울 수 있다.
 * 콜드스타트에 KV에서 1회 읽어 파싱하고 모듈 스코프에 캐시 → 웜 요청은 재사용.
 * 업로드 절차: node scripts/build-index.mjs  →  bash scripts/kv-upload.sh
 *
 * ★ 캐시 무효화(버전 키)
 *   예전에는 한 번 캐시하면 영영 놓지 않아, KV를 갱신해도 살아있는 isolate 는 옛 인덱스를
 *   계속 썼다. 미답변 질문 보완 루프의 마지막 단계가 "자료를 넣고 그 질문을 다시 던져
 *   답이 나오는지 확인"인데, 그 확인이 옛 인덱스에 걸리면 제대로 보완하고도 실패로
 *   오판하게 된다. 그래서 KV의 'corpus-version'(kv-upload.sh 가 함께 올림)을
 *   최대 60초에 한 번만 확인하고, 값이 바뀌었으면 인덱스와 벡터 캐시를 버린다.
 *   → 갱신이 늦어도 1분 안에 전 isolate 에 퍼진다. 추가 비용은 60초당 KV 읽기 1회.
 *   'corpus-version' 키가 아직 없으면(null) 값이 늘 같으므로 종전과 동일하게 동작한다.
 */
const VER_TTL_MS = 60_000;
let INDEX_CACHE = null;
let INDEX_VER = null;    // 현재 캐시가 만들어진 시점의 corpus-version
let VER_CHECKED_AT = 0;  // 마지막 버전 확인 시각
async function loadIndex(env) {
  if (INDEX_CACHE && Date.now() - VER_CHECKED_AT < VER_TTL_MS) return INDEX_CACHE;
  if (!env.CORPUS_KV) {
    throw new Error("CORPUS_KV 바인딩이 없습니다 (wrangler.toml 의 [[kv_namespaces]] 확인).");
  }
  // 버전을 인덱스보다 "먼저" 읽는다. 도중에 업로드가 끼어들면 (옛 버전 + 새 인덱스)가 되어
  // 다음 확인 때 한 번 더 재로드할 뿐이다. 반대 순서면 새 버전에 옛 인덱스를 붙여 굳힌다.
  const ver = await env.CORPUS_KV.get("corpus-version");
  if (INDEX_CACHE && ver === INDEX_VER) {
    VER_CHECKED_AT = Date.now();
    return INDEX_CACHE;
  }
  const data = await env.CORPUS_KV.get("corpus-index", { type: "json" });
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("KV에 corpus-index 가 없거나 비어 있습니다 — scripts/kv-upload.sh 로 업로드하세요.");
  }
  if (INDEX_CACHE) {
    console.log(`[index] corpus-version 변경 (${INDEX_VER} → ${ver}) — 캐시 재로드 ${data.length}청크`);
    VEC_CACHE = undefined; // 벡터도 함께 다시 읽는다(재임베딩됐을 수 있음)
  }
  INDEX_CACHE = data;
  INDEX_VER = ver;
  VER_CHECKED_AT = Date.now();
  return INDEX_CACHE;
}

/* corpus 벡터(int8, 정규화됨) + 키 매니페스트를 KV에서 로드해 캐시.
 *
 * 매니페스트('corpus-vector-keys')는 "N번째 벡터가 어느 청크(안정 키)의 것인가"를 담은
 * 배열이다. 이게 있어야 청크↔벡터를 순번이 아니라 이름으로 잇는다.
 * 없거나 개수가 안 맞으면 벡터를 통째로 버리고 BM25 단독으로 폴백한다
 * (어긋난 벡터로 조용히 오염된 순위를 내느니, 의미검색을 끄는 편이 안전하다).
 *
 * 캐시는 undefined(미로드) / null(사용 불가) / 객체 를 구분한다.
 * → '없음'도 캐시해야 매 요청마다 KV를 다시 읽지 않는다.
 */
const VEC_DIM = 1024;
let VEC_CACHE;
async function loadVectors(env) {
  if (VEC_CACHE !== undefined) return VEC_CACHE;
  const [buf, keys] = await Promise.all([
    env.CORPUS_KV.get("corpus-vectors", { type: "arrayBuffer" }),
    env.CORPUS_KV.get("corpus-vector-keys", { type: "json" }),
  ]);
  if (!buf || !Array.isArray(keys) || keys.length * VEC_DIM !== buf.byteLength) {
    console.log(
      `[vectors] 매니페스트 불일치 → 의미검색 끄고 BM25 폴백 ` +
      `(bytes=${buf ? buf.byteLength : "none"}, keys=${Array.isArray(keys) ? keys.length : "none"})`
    );
    VEC_CACHE = null;
    return null;
  }
  const offsetOf = new Map();
  keys.forEach((k, i) => offsetOf.set(k, i));
  VEC_CACHE = { data: new Int8Array(buf), offsetOf };
  return VEC_CACHE;
}

// 질의 → bge-m3 임베딩(정규화). 실패 시 null(어휘검색 폴백).
async function embedQuery(env, q) {
  try {
    const r = await env.AI.run("@cf/baai/bge-m3", { text: [q] });
    return r?.data?.[0] ? normalizeVec(r.data[0]) : null;
  } catch (e) {
    return null;
  }
}

/* ── 채팅 화면에 GA4 측정 ID 주입 ──
 * index.html 의 "__GA_ID__" 자리를 env.GA_ID(wrangler.toml [vars])로 치환해 서빙한다.
 * GA_ID 를 비워두면 빈 문자열로 치환 → 프론트가 GA 스크립트를 아예 로드하지 않는다(측정 끔).
 * 치환 결과는 모듈 스코프에 캐시(요청마다 문자열 재생성 방지).
 */
let CHAT_HTML_CACHE = null;
function chatHtml(env) {
  if (CHAT_HTML_CACHE === null) {
    CHAT_HTML_CACHE = CHAT_HTML.replaceAll("__GA_ID__", (env.GA_ID || "").trim());
  }
  return CHAT_HTML_CACHE;
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

/* ── 인증 (공용 비밀번호 + 서버 발급 쿠키) ── */
const SESSION_HOURS = 12;

async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// 세션 토큰 = 비밀번호의 해시. 비밀번호를 모르면 위조 불가.
async function sessionToken(env) {
  return sha256hex("dosijeongbi-sid|" + (env.SITE_PASSWORD || ""));
}
function parseCookies(request) {
  const out = {};
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
async function isAuthed(request, env) {
  if (!env.SITE_PASSWORD) return true; // 비번 미설정 시 개방(로컬 테스트용)
  const sid = parseCookies(request)["sid"];
  return sid && sid === (await sessionToken(env));
}

export default {
  // ctx 는 미답변 질문 기록을 응답 이후로 미루기 위해 받는다(ctx.waitUntil).
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    /* 임베딩 배치 — corpus 재임베딩 작업용.
     * 로그인만으로 열어두면 접속 가능한 누구나 Workers AI를 임의 호출(=과금)할 수 있어,
     * 별도 시크릿(EMBED_TOKEN)이 설정돼 있고 헤더가 일치할 때만 동작한다.
     * 평소에는 시크릿을 두지 않아 404 로 닫혀 있고, 재임베딩할 때만 잠시 연다:
     *   npx wrangler secret put EMBED_TOKEN     # 작업 시작 시
     *   npx wrangler secret delete EMBED_TOKEN  # 작업 끝나면 반드시 삭제
     * 호출: -H "X-Embed-Token: <값>" (로그인 세션도 함께 필요)
     */
    if (request.method === "POST" && path === "/_embed") {
      if (!env.EMBED_TOKEN) return new Response("Not Found", { status: 404 });
      if (request.headers.get("X-Embed-Token") !== env.EMBED_TOKEN) {
        return json({ error: "unauthorized" }, 401);
      }
      if (!(await isAuthed(request, env))) return json({ error: "unauthorized" }, 401);
      try {
        const { texts } = await request.json();
        if (!Array.isArray(texts) || !texts.length) return json({ error: "texts 필요" }, 400);
        const r = await env.AI.run("@cf/baai/bge-m3", { text: texts });
        return json({ vectors: r.data });
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    // 배경 이미지: GET /bg/N.jpg
    if (request.method === "GET" && path.startsWith("/bg/")) {
      const n = path.slice(4).replace(".jpg", "");
      const img = BGS[n];
      if (!img) return new Response("Not Found", { status: 404 });
      return new Response(img, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=604800",
        },
      });
    }

    // GET → 채팅 화면 (로그인은 화면 내에서 처리)
    if (request.method === "GET") {
      return new Response(chatHtml(env), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

    // 로그인: 비밀번호 확인 → 세션 쿠키 발급
    if (path === "/login") {
      if (!env.SITE_PASSWORD) return json({ ok: false, error: "서버에 SITE_PASSWORD 미설정" }, 500);
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const name = (body.name || "").toString().trim().slice(0, 40) || "사용자";
      if ((body.password || "") !== env.SITE_PASSWORD) {
        return json({ ok: false, error: "비밀번호가 올바르지 않습니다." }, 401);
      }
      const token = await sessionToken(env);
      const maxAge = SESSION_HOURS * 3600;
      const common = `Path=/; Max-Age=${maxAge}; Secure; SameSite=Lax`;
      const res = json({ ok: true, name });
      res.headers.append("Set-Cookie", `sid=${token}; HttpOnly; ${common}`);
      res.headers.append("Set-Cookie", `who=${encodeURIComponent(name)}; ${common}`);
      // 접속 기록(경량 감사) — Cloudflare 로그에 남음
      console.log(`[login] ${name} @ ${new Date().toISOString()}`);
      return res;
    }

    // 로그아웃: 쿠키 만료
    if (path === "/logout") {
      const res = json({ ok: true });
      const expire = "Path=/; Max-Age=0; Secure; SameSite=Lax";
      res.headers.append("Set-Cookie", `sid=; HttpOnly; ${expire}`);
      res.headers.append("Set-Cookie", `who=; ${expire}`);
      return res;
    }

    // 질문 API·신고 API: 인증 필수
    if (!(await isAuthed(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }

    /* 답변 신고 — 화면의 '이 답변 이상해요' 버튼.
     * 자동 판별(검색0건·모델거절·근거미표시)은 "답을 못 한" 경우만 잡는다.
     * 근거를 갖춰 그럴듯하게 틀리게 답하는 건 기계가 알 수 없어, 사람이 넣는 이 경로가
     * 유일한 탐지 수단이다. 자동 기록과 같은 테이블에 reason='사용자신고'로 들어가
     * 검토 워크플로(scripts/unanswered.mjs)를 그대로 탄다.
     * 실패해도 사용자에게는 조용히 넘어간다 — 신고가 안 됐다고 화면을 깨뜨릴 이유가 없다. */
    if (path === "/report") {
      try {
        const b = await request.json();
        const q = (b.question || "").toString().trim();
        if (!q) return json({ ok: false }, 400);
        if (q.length > 2000) return json({ ok: false, error: "질문이 너무 깁니다" }, 400);
        const r = await logReport(env, request, {
          question: q,
          answer: (b.answer || "").toString(),
          sources: b.sources,
          note: b.note,
          qType: b.q_type,
          scope: b.scope,
        });
        return json({ ok: !!r.ok });
      } catch (e) {
        console.log(`[report] 실패: ${e}`);
        return json({ ok: false }, 200); // 신고 실패로 화면이 깨지지 않게
      }
    }
    if (!env.DEEPSEEK_KEY) return json({ error: "서버에 DEEPSEEK_KEY 미설정" }, 500);

    try {
      const { question, history = [], scope = {}, q_type: qType } = await request.json();
      if (!question || !question.trim()) return json({ error: "질문이 비어 있습니다" }, 400);

      /* 클라이언트 입력 검증.
       * history 는 그대로 DeepSeek 의 messages 에 펼쳐지므로, 검증 없이 받으면
       * role:"system" 객체를 끼워 넣어 환각 방지 규칙을 통째로 덮을 수 있다.
       * 이 프로젝트의 가드레일이 클라이언트 입력으로 뚫리면 안 되므로 화이트리스트로 거른다.
       * 길이·개수 상한은 프롬프트 비용이 무한정 늘어나는 것도 함께 막는다. */
      const MAX_Q = 2000, MAX_TURNS = 20, MAX_MSG = 4000;
      if (question.length > MAX_Q) {
        return json({ error: `질문이 너무 깁니다 (최대 ${MAX_Q}자)` }, 400);
      }
      const safeHistory = (Array.isArray(history) ? history : [])
        .filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
        .slice(-MAX_TURNS)
        .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MSG) }));

      // 검색 범위. scope = { law, prec, ordRegion } 객체.
      //  · 기본은 법령(+행정규칙)만. 판례는 opt-in. 조례는 "지역을 고른 경우에만" 포함.
      //  · 조례는 지자체마다 문구가 비슷해, 지역을 지정하지 않으면 검색에서 제외한다
      //    (여러 지자체 조례가 뒤섞여 엉뚱한 지역을 인용하는 사고를 원천 차단).
      //  · 구버전 문자열 scope("law"/"prec"/"both")도 하위호환 처리.
      let law, prec, ordRegion;
      if (typeof scope === "string") {
        law = scope === "law" || scope === "both";
        prec = scope === "prec" || scope === "both";
        ordRegion = null;
      } else {
        law = scope.law !== false; // 미지정 시 켜짐
        prec = !!scope.prec;
        ordRegion = scope.ordRegion || null;
      }
      // '법령' 범위에는 유권해석(법령 해석)과 심판례(조세심판원 결정)도 포함한다.
      // 이 둘이 어느 목록에도 없어 검색 후보에서 통째로 빠져 있었다(자료는 있는데 한 번도 안 쓰임).
      const LAW_TYPES = ["법령", "행정규칙", "유권해석", "심판례"];
      const allowedTypes = [];
      if (law) allowedTypes.push(...LAW_TYPES);
      if (prec) allowedTypes.push("판례");
      if (ordRegion) allowedTypes.push("조례");
      if (!allowedTypes.length) allowedTypes.push(...LAW_TYPES); // 안전 기본
      const region = ordRegion;

      const index = await loadIndex(env);
      // 하이브리드 검색: 질의 임베딩 + corpus 벡터가 있으면 BM25+벡터 융합, 없으면 어휘검색.
      const [vecStore, qv] = await Promise.all([loadVectors(env), embedQuery(env, question)]);
      // k=7: 핵심 정의 조문이 상위 5 바로 밖(예: 관리처분계획 제74조는 6위)에 놓이는
      // 경우가 있어 여유를 둔다. 답변 본문이 근거로 삼는 조문이 footer에도 실리도록.
      let hits = (vecStore && qv)
        ? retrieveHybrid(index, vecStore, qv, question, 7, allowedTypes, VEC_DIM, region)
        : retrieve(index, question, 7, allowedTypes, region);
      // 참조 조문 추적 — "제N조에 따른/준용" 등 위임 참조를 따라가 정답 완성도↑ (판례 전용이면 생략)
      // 검색결과 전체를 스캔(핵심 조문이 상위 밖일 수 있음), 최대 8개 참조 추가.
      if (law || ordRegion) hits = expandReferences(hits, index, allowedTypes, 3, hits.length);
      const { answer: text, sources } = await generate(question, safeHistory, env, hits);

      /* 답하지 못한 질문을 기록한다(D1). 응답을 먼저 돌려주고 뒤에서 쓴다 —
       * 기록이 느리거나 실패해도 사용자 답변은 이미 나간 뒤다.
       * 무엇이 '실패'인지, 무엇을 남기는지는 unanswered.mjs 참조. */
      ctx?.waitUntil(
        logIfUnanswered(env, request, {
          question, answer: text, sources, hits, law, prec, ordRegion, qType,
        })
      );
      return json({ answer: text, sources });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  },
};
