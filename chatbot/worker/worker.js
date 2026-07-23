/**
 * worker.js — Cloudflare Worker (배포본)
 * ------------------------------------------------------------------
 * 같은 URL이 GET=채팅화면, POST /login=로그인, POST /=질문 API 를 겸한다.
 * 핵심 답변 로직은 pipeline.mjs 에 있고, 이 파일은 HTTP·인증 래퍼다.
 *
 * 배포 전 준비:
 *   1) node scripts/build-index.mjs         → corpus-index.json 생성/갱신
 *   2) wrangler secret put DEEPSEEK_KEY      → DeepSeek 키
 *   3) wrangler secret put SITE_PASSWORD     → 접속 비밀번호 (예: koreit)
 *   4) wrangler deploy
 */
import index from "./corpus-index.json";
import { answer } from "./pipeline.mjs";
import CHAT_HTML from "../public/index.html"; // 채팅 화면 (wrangler Text 룰로 문자열 번들)
import bg1 from "./bg/bg1.jpg"; // 배경 이미지 4종 (Data 룰 → ArrayBuffer)
import bg2 from "./bg/bg2.jpg";
import bg3 from "./bg/bg3.jpg";
import bg4 from "./bg/bg4.jpg";
const BGS = { "1": bg1, "2": bg2, "3": bg3, "4": bg4 };

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
      const { question, history = [] } = await request.json();
      if (!question || !question.trim()) return json({ error: "질문이 비어 있습니다" }, 400);

      const { answer: text, sources } = await answer(index, question, history, env);
      return json({ answer: text, sources });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  },
};
