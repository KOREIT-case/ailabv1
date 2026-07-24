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
 *   5) wrangler secret put SITE_PASSWORD     → 접속 비밀번호 (예: koreit)
 *   6) wrangler deploy
 */
import { generate } from "./pipeline.mjs";
import { retrieve, retrieveHybrid, normalizeVec, expandReferences } from "./retrieve.mjs";
import CHAT_HTML from "../public/index.html"; // 채팅 화면 (wrangler Text 룰로 문자열 번들)
import bg1 from "./bg/bg1.jpg"; // 배경 이미지 4종 (Data 룰 → ArrayBuffer)
import bg2 from "./bg/bg2.jpg";
import bg3 from "./bg/bg3.jpg";
import bg4 from "./bg/bg4.jpg";
const BGS = { "1": bg1, "2": bg2, "3": bg3, "4": bg4 };

/* ── corpus 인덱스: Cloudflare KV 에서 로드 ──
 * corpus-index.json 은 Worker 번들에 넣지 않고 KV(CORPUS_KV)의 'corpus-index' 키에 둔다.
 * → Worker 번들 1MB(무료) 한도와 무관하게 corpus 를 계속 키울 수 있다.
 * 콜드스타트에 KV에서 1회 읽어 파싱하고 모듈 스코프에 캐시 → 웜 요청은 재사용(0회 읽기).
 * 업로드 절차: node scripts/build-index.mjs  →  bash scripts/kv-upload.sh
 */
let INDEX_CACHE = null;
async function loadIndex(env) {
  if (INDEX_CACHE) return INDEX_CACHE;
  if (!env.CORPUS_KV) {
    throw new Error("CORPUS_KV 바인딩이 없습니다 (wrangler.toml 의 [[kv_namespaces]] 확인).");
  }
  const data = await env.CORPUS_KV.get("corpus-index", { type: "json" });
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("KV에 corpus-index 가 없거나 비어 있습니다 — scripts/kv-upload.sh 로 업로드하세요.");
  }
  INDEX_CACHE = data;
  return INDEX_CACHE;
}

// corpus 벡터(int8, 정규화됨)를 KV에서 로드해 캐시. 하이브리드 검색의 의미 검색용.
let VEC_CACHE = null;
async function loadVectors(env) {
  if (VEC_CACHE) return VEC_CACHE;
  const buf = await env.CORPUS_KV.get("corpus-vectors", { type: "arrayBuffer" });
  VEC_CACHE = buf ? new Int8Array(buf) : null;
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
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 임베딩 배치 (인증 필요) — corpus 임베딩 오케스트레이션·질의 임베딩에 사용.
    if (request.method === "POST" && path === "/_embed") {
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
      return new Response(CHAT_HTML, {
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

    // 질문 API: 인증 필수
    if (!(await isAuthed(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!env.DEEPSEEK_KEY) return json({ error: "서버에 DEEPSEEK_KEY 미설정" }, 500);

    try {
      const { question, history = [], scope = {} } = await request.json();
      if (!question || !question.trim()) return json({ error: "질문이 비어 있습니다" }, 400);

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
      const allowedTypes = [];
      if (law) allowedTypes.push("법령", "행정규칙");
      if (prec) allowedTypes.push("판례");
      if (ordRegion) allowedTypes.push("조례");
      if (!allowedTypes.length) allowedTypes.push("법령", "행정규칙"); // 안전 기본
      const region = ordRegion;

      const index = await loadIndex(env);
      // 하이브리드 검색: 질의 임베딩 + corpus 벡터가 있으면 BM25+벡터 융합, 없으면 어휘검색.
      const [vectors, qv] = await Promise.all([loadVectors(env), embedQuery(env, question)]);
      // k=7: 핵심 정의 조문이 상위 5 바로 밖(예: 관리처분계획 제74조는 6위)에 놓이는
      // 경우가 있어 여유를 둔다. 답변 본문이 근거로 삼는 조문이 footer에도 실리도록.
      let hits = (vectors && qv)
        ? retrieveHybrid(index, vectors, qv, question, 7, allowedTypes, 1024, region)
        : retrieve(index, question, 7, allowedTypes, region);
      // 참조 조문 추적 — "제N조에 따른/준용" 등 위임 참조를 따라가 정답 완성도↑ (판례 전용이면 생략)
      // 검색결과 전체를 스캔(핵심 조문이 상위 밖일 수 있음), 최대 8개 참조 추가.
      if (law || ordRegion) hits = expandReferences(hits, index, allowedTypes, 3, hits.length);
      const { answer: text, sources } = await generate(question, history, env, hits);
      return json({ answer: text, sources });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  },
};
