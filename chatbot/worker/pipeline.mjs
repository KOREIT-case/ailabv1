/**
 * pipeline.mjs — 챗봇 두뇌 핵심 (검색 → 프롬프트 조립 → DeepSeek 생성)
 * ------------------------------------------------------------------
 * worker.js(배포)와 scripts/test-answer.mjs(로컬 테스트)가 이 모듈을 공용으로
 * 사용한다. 즉 로컬에서 통과한 로직이 배포본과 100% 동일하게 동작한다.
 */
import { retrieve, citation } from "./retrieve.mjs";

// system-prompt.md 의 환각 방지 규칙 (원문 동기화 — 수정 시 양쪽 함께).
export const SYSTEM_PROMPT = `당신은 한국토지신탁 도시정비사업 담당 주니어를 돕는 법률 안내 챗봇입니다.
도시정비사업 관련 법령·판례·유권해석에 근거하여 답변합니다.

## 절대 규칙
1. 제공된 자료만 사용: 답변은 <참고자료>에 담긴 내용에만 근거해야 합니다. 사전 지식·추측·외부 정보를 사용하지 마십시오.
2. 근거 없으면 답하지 않음: <참고자료>에 근거가 없거나 불충분하면 반드시 "제공된 자료로는 정확히 답변할 수 없습니다. 담당자 확인이 필요합니다."라고 답하십시오. 억지로 지어내지 마십시오.
3. 근거 명시 의무: 모든 답변 끝에 근거를 인용하십시오. 법령은 [근거: 법령명 제N조 (시행 YYYY-MM-DD)] 형식.
4. 법률 위계 준수: 자료 간 충돌 시 법령 > 판례 > 유권해석 순으로 상위 규범을 우선합니다.
5. 추측성 표현 금지: "아마도", "일 것으로 보입니다" 같은 불확실한 단정 대신 자료에 있는 사실만 전달합니다.
6. 개정 유의: 법령 답변에는 근거 자료의 시행일을 표기하고, 중요한 판단엔 "최신 개정 여부는 담당자 확인 권장"을 덧붙입니다.

## 답변 형식
1) 핵심 답변(간결) 2) 근거 설명(자료 인용) 3) 근거 출처(규칙 3 형식) 4) (해당 시) 실무 유의점

## 톤
주니어 대상이므로 쉽고 명확하게. 단, 법률 용어는 정확히. 단정적 자문이 아니라 "자료에 근거한 안내"임을 견지.`;

export const NO_EVIDENCE =
  "제공된 자료로는 정확히 답변할 수 없습니다. 담당자 확인이 필요합니다.";

/** 검색된 청크들을 <참고자료> 블록으로 조립 */
export function buildSystemMessage(hits) {
  const refs = hits
    .map((h) => `--- ${citation(h.chunk)} ---\n${h.chunk.text}`)
    .join("\n\n");
  return `${SYSTEM_PROMPT}\n\n<참고자료>\n${refs}\n</참고자료>`;
}

/** DeepSeek chat completions 호출 */
export async function callDeepSeek(env, systemMessage, history, question) {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.DEEPSEEK_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0, // 사실 기반 → 창의성 최소화
      messages: [
        { role: "system", content: systemMessage },
        ...history,
        { role: "user", content: question },
      ],
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "(응답 없음)";
}

/**
 * 전체 파이프라인: 질문 → 검색 → (근거 없으면 즉시 안내) → 생성.
 * @returns {{answer:string, sources:Array, retrieved:Array}}
 */
export async function answer(index, question, history, env, k = 5) {
  const hits = retrieve(index, question, k);
  if (!hits.length) {
    return { answer: NO_EVIDENCE, sources: [], retrieved: [] };
  }
  const systemMessage = buildSystemMessage(hits);
  const text = await callDeepSeek(env, systemMessage, history, question);
  const sources = hits.map((h) => ({
    자료유형: h.chunk.자료유형,
    법령명: h.chunk.법령명,
    조문: h.chunk.조문,
    시행일자: h.chunk.시행일자,
  }));
  return { answer: text, sources, retrieved: hits };
}
