/**
 * worker.js — Cloudflare Worker (배포본)
 * ------------------------------------------------------------------
 * 프론트(index.html)에서 질문을 받아 corpus 검색 → DeepSeek 답변을 반환한다.
 * 핵심 로직은 pipeline.mjs 에 있고, 이 파일은 HTTP 래퍼일 뿐이다.
 *
 * 배포 전 준비:
 *   1) node scripts/build-index.mjs   → corpus-index.json 생성/갱신
 *   2) DeepSeek 키를 시크릿으로 등록:  wrangler secret put DEEPSEEK_KEY
 *   3) wrangler deploy
 *   4) 배포 후 나온 주소를 chatbot/public/index.html 의 WORKER_URL 에 기입
 */
import index from "./corpus-index.json";
import { answer } from "./pipeline.mjs";
import CHAT_HTML from "../public/index.html"; // 채팅 화면 (wrangler Text 룰로 문자열 번들)

// 운영 시 사내 도메인으로 좁히는 것을 권장 (예: "https://intra.example.co.kr").
const ALLOW_ORIGIN = "*";

function cors() {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors() },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors() });

    // 브라우저로 주소를 열면(GET) 채팅 화면을 직접 서빙한다. (같은 URL이 API도 겸함)
    if (request.method === "GET") {
      return new Response(CHAT_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
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
