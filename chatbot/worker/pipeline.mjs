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
2. 근거 없으면 답하지 않음: <참고자료>에 근거가 **전혀 없거나 핵심이 빠져** 답을 도출할 수 없을 때만 "제공된 자료로는 정확히 답변할 수 없습니다. 담당자 확인이 필요합니다."라고 답하십시오. 억지로 지어내지 마십시오. ★반대로, 자료(참조 조문 포함)로 답을 도출할 수 있으면 이 회피 문구로 **시작하지 말고** 곧바로 핵심 답변부터 제시하십시오. 결론을 낼 수 있는데 앞에 "답변할 수 없습니다"를 붙이지 마십시오.
3. 근거 명시 의무: 모든 답변 끝에 근거를 인용하십시오. 법령은 [근거: 법령명 제N조 (시행 YYYY-MM-DD)] 형식.
   판례·심판례는 사건번호를(예: 2011두8291, 조심 2017지0032), 유권해석은 문서번호를(예: 법제처 해석 22-0530) 본문에 반드시 밝히십시오.
   ★ 밝히지 않으면 그 자료는 근거로 집계되지 않아 화면에 표시되지 않습니다.
4. 법률 위계 준수: 자료 간 충돌 시 법령 > 판례 > 행정규칙(고시) > 심판례·유권해석 순으로 상위 규범을 우선합니다.
   판례·고시·심판례·유권해석은 법령의 해석·적용 참고자료입니다. 특히 심판례(조세심판원 결정)와 유권해석은
   개별 사안에 대한 판단이므로, 일반화하지 말고 "유사 사안에서 이렇게 판단한 사례가 있다"는 수준으로 인용하십시오.
5. 추측성 표현 금지: "아마도", "일 것으로 보입니다" 같은 불확실한 단정 대신 자료에 있는 사실만 전달합니다.
6. 개정 유의: 법령 답변에는 근거 자료의 시행일을 표기하고, 중요한 판단엔 "최신 개정 여부는 담당자 확인 권장"을 덧붙입니다.
7. 판례 유의: 판례에 근거해 답할 때는 사건번호와 선고일자를 함께 밝히고, "판례는 이후 변경될 수 있으므로 최신 판례 확인 권장"을 반드시 덧붙입니다. 판례가 법령과 어긋나면 법령을 우선합니다.
8. 위임·참조 조문 결합: 한 조문이 다른 조문을 "제N조에 따른/준용/이상" 형태로 가리키고 그 참조 조문도 <참고자료>에 함께 있으면, 두 조문을 결합해 **구체적 결론(수치·요건)까지 도출**해 답하십시오. 참조 조문 내용이 자료에 있는데도 "명확하지 않다/적용 여부가 불명확하다"고 회피하지 마십시오.
   - 예: A조가 "재건축은 B조에 따른 조합설립 동의요건 이상"을 요구하고, B조가 재건축에 대해 "전체 구분소유자 70% 이상"이라고 정하면 → "재건축의 경우 B조의 재건축 요건이 적용되어 **최소 70% 이상**"이라고 결론지어 답하십시오. "이상"은 그 수치를 **최소 기준**으로 제시하면 됩니다.
   - 재개발이면 B조의 재개발 요건을, 재건축이면 B조의 재건축 요건을 골라 적용합니다. (참조 조문이 자료에 없을 때만 규칙 2를 따름)

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
  // 응답이 오지 않을 때 요청이 무한정 매달리지 않도록 상한을 둔다(사용자 대기 + 비용 방어).
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);
  let res;
  try {
    res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      signal: ac.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.DEEPSEEK_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0, // 사실 기반 → 창의성 최소화
        max_tokens: 2000, // 답변 길이 상한(비용 예측 가능하게)
        messages: [
          { role: "system", content: systemMessage },
          ...history,
          { role: "user", content: question },
        ],
      }),
    });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "DeepSeek 응답 시간 초과(60초)" : String(e));
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "(응답 없음)";
}

/**
 * 전체 파이프라인: 질문 → 검색 → (근거 없으면 즉시 안내) → 생성.
 * @returns {{answer:string, sources:Array, retrieved:Array}}
 */
function toSources(hits) {
  return hits.map((h) => ({
    자료유형: h.chunk.자료유형,
    법령명: h.chunk.법령명,
    지자체: h.chunk.지자체,   // 조례만 값 존재(근거 표시·지역 확인용)
    조문: h.chunk.조문,
    시행일자: h.chunk.시행일자,
    사건번호: h.chunk.사건번호,
    선고일자: h.chunk.선고일자,
  }));
}

// 앞에 붙는 헛거절 제거: 뒤에 실제 근거([근거: … 제N조])가 있으면 도출된 답이므로
// 서두의 "제공된 자료로는 … 답변할 수 없습니다 …" 문장을 떼어낸다. (진짜 거절은 근거 인용이 없음)
function stripFalseRefusal(text) {
  const lead = /^\s*제공된 자료로는[^\n]*?답변(?:할 수 없습니다|이 어렵습니다)[^\n]*\n+/;
  if (lead.test(text)) {
    const rest = text.replace(lead, "");
    if (/\[근거:[^\]]*제\d+조/.test(rest) || /제\d+조[^\n]{0,20}(?:에 따라|이상|충족)/.test(rest)) {
      return rest.trim();
    }
  }
  return text;
}

/* 답변에 실제로 인용된 근거만 남긴다(검색은 됐지만 답변에 안 쓰인 조문은 근거 표시 X).
 *
 * ★ 이 프로젝트의 대전제: 모르면 모른다고 한다.
 *   따라서 "근거를 못 찾았을 때 그럴듯한 걸 채워 넣는" 폴백을 두지 않는다.
 *   인용을 못 찾으면 빈 배열을 돌려주고 화면에 근거를 아예 표시하지 않는다.
 *   (예전에는 검색 상위 3개를 근거인 척 붙여, 답변을 거절하면서도 조문을 인용한 것처럼
 *    보이는 일이 있었다. 근거 표시가 사실과 다른 건 근거가 없는 것보다 나쁘다.)
 */
function usedSources(sources, answer) {
  /* 거절 답변에는 근거를 붙이지 않는다.
   * 모델이 "왜 답할 수 없는지"를 설명하며 조문 번호를 나열하는 경우가 있다
   * (예: "참고자료에는 …법 제2조(정의), 제6조(납부의무자), 제12조(부과율)만 있습니다").
   * 그러면 아래 인용 매칭이 그걸 '인용'으로 인식해, 화면에 "답변할 수 없습니다" 옆에
   * 근거가 붙는다. 답을 못 했는데 근거는 있는 것처럼 보이는 상태다.
   * 대전제상 근거 표시가 사실과 다른 것은 근거가 없는 것보다 나쁘다.
   * (앞에 붙은 헛거절은 stripFalseRefusal 이 이미 떼어냈다 — 여기 남아 있으면 진짜 거절이다.) */
  if (/^\s*제공된 자료로는/.test(answer || "")) return [];

  const flat = (s) => (s || "").replace(/\s+/g, ""); // "조심 2017지0032" ↔ "조심2017지0032"
  const body = flat(answer);
  const used = sources.filter((s) => {
    // 판례·심판례: 사건번호를 밝혔을 때만 근거로 인정
    if (s.자료유형 === "판례" || s.자료유형 === "심판례") {
      return s.사건번호 && body.includes(flat(s.사건번호));
    }
    // 유권해석: 문서번호(예: 22-0530) 또는 그 표기(법제처 해석 22-0530)
    if (s.자료유형 === "유권해석") {
      return [s.사건번호, s.문서번호, s.법령명].some((v) => v && body.includes(flat(v)));
    }
    const m = (s.조문 || "").match(/제\d+조(?:의\d+)?/); // "제12조", "제2조 나목"→"제2조"
    return m && answer.includes(m[0]);
  });
  // 중복(법령명+조문) 제거
  const seen = new Set();
  return used.filter((s) => {
    const k = (s.법령명 || "") + "|" + (s.조문 || "").replace(/\s.*$/, "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 이미 검색된 hits로 답변 생성 (하이브리드 검색을 worker에서 수행 후 호출) */
export async function generate(question, history, env, hits) {
  if (!hits.length) return { answer: NO_EVIDENCE, sources: [], retrieved: [] };
  const systemMessage = buildSystemMessage(hits);
  const text = stripFalseRefusal(await callDeepSeek(env, systemMessage, history, question));
  return { answer: text, sources: usedSources(toSources(hits), text), retrieved: hits };
}

/** BM25 단독 경로 (로컬 테스트용). worker는 하이브리드를 쓴다. */
export async function answer(index, question, history, env, k = 5, allowedTypes = null) {
  return generate(question, history, env, retrieve(index, question, k, allowedTypes));
}
