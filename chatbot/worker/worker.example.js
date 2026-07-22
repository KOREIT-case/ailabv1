/**
 * Cloudflare Worker — 챗봇 두뇌 (골격 예시)
 * ------------------------------------------------------------------
 * 이 파일은 아키텍처를 보여주는 골격입니다. 실제 배포 전 TODO를 채우세요.
 *
 * 역할:
 *   1) 프론트(index.html)에서 질문 수신
 *   2) corpus 벡터검색 → 관련 자료 조각 top-K 추출
 *   3) system-prompt + 자료 + 질문 결합 → DeepSeek 호출
 *   4) 답변 + 근거를 프론트로 반환
 *
 * 보안: DeepSeek API 키, 법령 API 키는 프론트에 두지 말고
 *       Cloudflare 환경변수(Secrets)로만 보관 (env.DEEPSEEK_API_KEY 등).
 */

export default {
  async fetch(request, env) {
    // CORS (사내 도메인만 허용하도록 좁히는 것을 권장)
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    try {
      const { question, history = [] } = await request.json();

      // 1) 검색(Retrieval): 질문 임베딩 → 벡터 인덱스에서 top-K 조각
      // TODO: 임베딩 모델 호출 + 벡터 저장소 조회로 교체
      const chunks = await retrieve(question, env); // [{text, meta}, ...]

      // 근거가 전혀 없으면 LLM 호출 없이 즉시 안내 (비용 절감 + 안전)
      if (!chunks.length) {
        return json({
          answer: "제공된 자료로는 정확히 답변할 수 없습니다. 담당자 확인이 필요합니다.",
          sources: [],
        }, cors);
      }

      // 2) 조립(Augmentation): system-prompt에 참고자료 삽입
      const context = chunks
        .map((c) => `--- ${formatMeta(c.meta)} ---\n${c.text}`)
        .join("\n\n");
      const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace("{PLACEHOLDER}", context);

      // 3) 생성(Generation): DeepSeek 호출
      const answer = await callDeepSeek(env, systemPrompt, history, question);

      // 4) 반환
      return json({ answer, sources: chunks.map((c) => c.meta) }, cors);
    } catch (e) {
      return json({ error: String(e) }, cors, 500);
    }
  },
};

// --- 헬퍼 (골격) -----------------------------------------------------

async function retrieve(question, env) {
  // TODO: 1) question을 임베딩  2) 벡터 저장소에서 코사인 유사도 top-K
  //       3) 메타데이터(자료유형/법령명/조문번호/시행일) 포함해 반환
  return []; // placeholder
}

async function callDeepSeek(env, systemPrompt, history, question) {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0, // 사실 기반 답변 → 창의성 최소화
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: question },
      ],
    }),
  });
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "(응답 없음)";
}

function formatMeta(m) {
  if (m.자료유형 === "법령") return `${m.법령명} ${m.조문 ?? ""} (시행 ${m.시행일자 ?? "?"})`;
  if (m.자료유형 === "판례") return `판례 ${m.사건번호}`;
  if (m.자료유형 === "유권해석") return `유권해석 ${m.문서번호}`;
  return "자료";
}

function json(obj, cors, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

// system-prompt.md 내용을 빌드 시 주입하거나 KV/상수로 보관.
// {PLACEHOLDER} 자리에 참고자료가 삽입됨.
const SYSTEM_PROMPT_TEMPLATE = `# system-prompt.md 의 내용을 여기에 넣으세요.
<참고자료>
{PLACEHOLDER}
</참고자료>`;
