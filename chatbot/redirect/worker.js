/**
 * 구주소 리다이렉트 워커 — dosijeongbi-chatbot → jeongbi
 * ------------------------------------------------------------------
 * 왜 필요한가
 *   배포 주소를 dosijeongbi-chatbot → jeongbi 로 줄였는데(커밋 27d688e), 이름만 바꾼 게
 *   아니라 새 워커가 생긴 것이라 **옛 워커가 그대로 살아 있었다**. 실측(2026-07-26):
 *   구주소가 GET 200 + 로그인까지 정상 동작했다.
 *
 *   문제는 그게 '옛 버전 법률 챗봇'이라는 점이다. 구주소 워커에는
 *     · 조세심판례·유권해석 corpus 없음 (세무 질문에 근거가 반쪽)
 *     · 세무 답변 가드 없음 (세목 명시·추징 동반·세액 계산 거절·심판례 개별사안 문구)
 *     · 폐기된 DeepSeek 모델명(deepseek-chat) → 질문하면 400 에러
 *   북마크로 들어온 주니어가 틀린 답이나 에러를 받게 된다. 법률 도구에서 구버전이
 *   조용히 살아 있는 것은 그 자체로 사고 위험이다.
 *
 * 왜 삭제가 아니라 리다이렉트인가
 *   이미 공유된 링크·북마크가 있다. 삭제하면 Cloudflare 오류 페이지가 뜰 뿐이라
 *   사용자는 "챗봇이 없어졌다"고 오해한다. 리다이렉트면 그냥 현행 주소로 옮겨진다.
 *
 * 배포 (구주소 워커를 이 코드로 덮어쓴다)
 *   cd chatbot/redirect && npx wrangler deploy
 *   → name = "dosijeongbi-chatbot" 이므로 기존 워커가 이 리다이렉트로 교체된다.
 *
 * 나중에 구주소를 완전히 정리하려면
 *   npx wrangler delete --name dosijeongbi-chatbot
 */
const TARGET = "https://jeongbi.explozn87.workers.dev";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 화면 진입(GET)은 현행 주소로 그대로 넘긴다. 경로·쿼리는 보존한다.
    // 301(영구)로 두면 브라우저가 이후 구주소를 아예 거치지 않는다 — 의도한 동작이다.
    if (request.method === "GET" || request.method === "HEAD") {
      return Response.redirect(TARGET + url.pathname + url.search, 301);
    }

    // API 호출(POST)은 리다이렉트하지 않는다. 본문·쿠키가 함께 넘어가지 않아
    // 조용히 실패하느니, 무슨 일인지 분명히 알려주는 편이 낫다.
    return new Response(
      JSON.stringify({
        error: "이 주소는 사용이 종료되었습니다. 새 주소로 접속하세요: " + TARGET,
        moved_to: TARGET,
      }),
      { status: 410, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  },
};
