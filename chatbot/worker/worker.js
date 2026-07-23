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

    // 브라우저로 주소를 직접 열면(GET) 안내 페이지를 보여준다 (에러 아님).
    if (request.method === "GET") {
      const html = `<!doctype html><html lang="ko"><meta charset="utf-8">
<title>도시정비 법률 챗봇 API</title>
<body style="font-family:system-ui;max-width:640px;margin:60px auto;padding:0 20px;line-height:1.6;color:#222">
<h2>도시정비 법률 챗봇 — 백엔드 API</h2>
<p>이 주소는 <b>API 엔드포인트</b>입니다. 브라우저로 직접 열면 답변이 나오지 않습니다.</p>
<p>실제 사용은 채팅 화면(<code>chatbot/public/index.html</code>)을 열어서 질문하세요.
이 화면이 아래처럼 POST 요청을 보냅니다.</p>
<pre style="background:#f4f4f6;padding:12px;border-radius:8px;overflow:auto">curl -X POST ${new URL(request.url).origin} \\
  -H "Content-Type: application/json" \\
  -d '{"question":"재건축 매도청구는 언제까지 하나요?"}'</pre>
<p style="color:#888;font-size:13px">상태: 정상 동작 중 ✓</p>
</body></html>`;
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", ...cors() },
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
