/**
 * retrieve.mjs — 어휘 기반 검색(BM25-lite)
 * ------------------------------------------------------------------
 * Worker와 로컬 테스트가 공용으로 쓰는 순수 검색 로직 (외부 의존성 없음).
 *
 * 왜 벡터검색이 아니라 어휘검색인가 (초기 단계 결정):
 *   - corpus가 아직 작고(수백 청크), 법률 질문은 조문과 용어가 그대로 겹친다
 *     (예: "매도청구", "관리처분계획", "조합설립인가"). 어휘검색이 잘 맞는다.
 *   - 임베딩 API·벡터DB 없이 즉시 배포·테스트 가능(비용 0, 결정론적).
 *   - 판례·유권해석이 대량 추가되면 이 모듈만 벡터검색으로 교체하면 된다.
 *     (worker.js 인터페이스 retrieve(index, question, k)는 유지)
 */

// 질문 끝에 흔히 붙는 조사·어미 (스템 추출용). 명사에 붙는 조사 + 용언(하다/되다) 어미.
// 실무 질문은 "해임하려면·해제되면·받아야·상실되는"처럼 동사형으로 끝나는 경우가 많아,
// 조사만 벗기면 핵심 명사(해임·해제·상실)가 검색어에서 빠진다. 용언 어미도 함께 벗긴다.
const JOSA = [
  // 조사
  "으로써", "에서의", "에서", "으로", "라는", "이라는", "이란", "란",
  "은", "는", "이", "가", "을", "를", "의", "에", "와", "과", "도",
  "만", "나", "로", "께", "부터", "까지", "마다", "보다", "처럼",
  "한테", "에게", "에게는", "한테는", "더러", "게",
  "인가요", "인가", "입니까", "인지", "나요", "가요", "요",
  // 용언 어미(하다/되다/받다 등) — "해임하려면"→"해임", "해제되면"→"해제"
  "하려면", "하려는", "으려면", "려면", "하나요", "되나요", "하는", "되는",
  "하면", "되면", "해야", "되어야", "하기", "되기", "하고", "되고", "하여", "되어",
  "하도록", "되도록", "합니다", "됩니다", "했", "됐", "하는가", "되는가",
  "받으려면", "받아야", "받는", "가능해", "가능한가", "가능", "되면은",
  "된", "될", "됨", "돼", "함", "할",
];

// 법령 용어의 가운뎃점(ㆍ·・) 제거 정규화. "노후ㆍ불량건축물"↔"노후불량건축물",
// "시ㆍ도지사"↔"시도지사", "시장ㆍ군수"↔"시장군수" 를 같게 매칭시킨다.
export function norm(s) {
  return (s || "").replace(/[ㆍ·・]/g, "");
}

// 실무 약어 → 정식 명칭(확장 토큰). 질의에 약어가 있으면 정식명 토큰도 함께 검색.
const ABBR = {
  "도정법": "도시 주거환경정비법", "도시정비법": "도시 주거환경정비법",
  "빈소법": "빈집 소규모주택 정비 특례법", "소규모주택정비법": "빈집 소규모주택 정비 특례법",
  "소규모정비법": "빈집 소규모주택 정비 특례법",
  "노후계획도시특별법": "노후계획도시 정비 지원 특별법", "노후도시특별법": "노후계획도시 정비 지원 특별법",
  "수도권정비법": "수도권정비계획법",
  "지특법": "지방세특례제한법", "조특법": "조세특례제한법", "종부세법": "종합부동산세법",
  "lh": "한국토지주택공사 토지주택공사", "sh": "서울주택도시공사",
};

// 정비 실무 복합어 → 법령 본문 표현으로 분해. 사용자는 "관리처분인가"처럼 붙여 쓰지만
// 법령은 "관리처분계획의 인가"라 한 덩어리 토큰으로는 매칭이 안 된다. 구성어로 쪼개
// 실제 조문("관리처분계획의 인가 등" 제74조)이 검색되게 한다.
// 질의어 → 검색어(공백 구분). RHS가 곧 실제 검색할 토큰 목록이며, 원형(LHS)이
// RHS에 없으면 검색어에서 제외한다(치환). 이유:
//  · 구어체가 엉뚱한 부분문자열에 걸리는 것 방지 — "도시정비사업"은 "노후계획도시정비사업"의
//    부분문자열이라 그대로 두면 노후계획도시 특별법이 상위를 독차지한다. 법령 용어 "정비사업"으로 치환.
//  · 사↔자 표기차 — 실무 "시공사/시행사/설계사" vs 법령 "시공자/시행자/설계자".
//  · 붙여 쓴 "관리처분인가"는 법령의 "관리처분계획의 인가"와 매칭 안 됨 → 구성어로 분해.
// RHS에 원형을 함께 적으면(예: "관리처분계획인가") 그 조어형이 실제 corpus에 있어 유지한다.
const SYN = {
  "관리처분인가": "관리처분계획 인가",
  "관리처분계획인가": "관리처분계획인가 관리처분계획 인가",
  "사업시행인가": "사업시행계획 인가",
  "사업시행계획인가": "사업시행계획인가 사업시행계획 인가",
  "조합설립인가": "조합설립인가 조합설립 인가",
  "정비구역지정": "정비구역 지정",
  "시공사": "시공자", "시행사": "시행자", "설계사": "설계자",
  // 신탁방식은 명근 본업인데 실무어가 조문어와 하나도 안 맞았다.
  // 조문은 "신탁업자"(제27조 지정개발자의 한 유형)라 하고, "신탁사"·"신탁방식"이라는 말은 없다.
  // 신탁업자 시행 시 총회에 해당하는 것도 "토지등소유자 전체회의"(제48조)로 이름이 다르다.
  "신탁사": "신탁업자", "신탁회사": "신탁업자",
  "신탁방식": "신탁업자 지정개발자", "신탁방식으로": "신탁업자 지정개발자",
  // 신탁업자 시행 시 조합 총회에 해당하는 기구는 "토지등소유자 전체회의"(제48조)다.
  // '총회'를 치환하면 일반 총회 질의(제45조)가 깨지므로 원형을 남기고 토큰만 더한다.
  "총회": "총회 전체회의",
  "도시정비사업": "정비사업",
  // 현금청산: 법 조문은 "현금으로 청산"(제76조)·"청산금"(제89·90조)이라 쓰고, 대상자는
  // "분양신청을 하지 아니한 자"(제73조)로 규정 → 붙여 쓴 "현금청산"을 관련 법령어로 확장.
  "현금청산": "현금 청산 청산금 분양신청", "현금청산대상자": "현금 청산 청산금 분양신청",
  "현금청산자": "현금 청산 청산금 분양신청",
  // 현금청산 '금'을 받는 쪽은 양도소득 문제다. 소득세법은 "양도"(제88조)·"양도소득의 범위"
  // (제94조)로 규정하지 정비 실무어를 쓰지 않아, 양도 토큰을 함께 얹어야 소득세법에 닿는다.
  "현금청산금": "현금 청산금 양도 양도소득",
  // 손실보상 항목(주거이전비·이주정착금·영업보상·지장물)은 토지보상법 소관이나 도정법
  // 제65조가 이를 준용 → "손실보상/보상" 토큰을 더해 제62·65조로 향하게(정확한 준용 근거 안내).
  "주거이전비": "주거이전비 손실보상 보상", "이주정착금": "이주정착금 손실보상 보상",
  "영업보상": "영업보상 손실보상 보상", "지장물": "지장물 손실보상 보상",
  // 도시재정비촉진 관련 복합어 — corpus는 "재정비촉진"·"존치"로 담고 있어 붙여 쓴 질의어를 분해.
  "도시재정비촉진지구": "재정비촉진 촉진지구", "재정비촉진지구": "재정비촉진 촉진지구",
  "재정비촉진사업": "재정비촉진", "존치지역": "존치 존치지역",
  // 세무 실무어 → 세법 표현. 세법 조문은 실무 조어를 쓰지 않는다.
  //  · 무상귀속: 도정법은 "무상귀속"(제97조)이라 쓰지만, 취득세 비과세 근거인 지방세법
  //    제9조제2항은 "귀속 또는 기부채납"이라고만 쓴다 → 조어를 구성어로 풀어 조문에 닿게 한다.
  "무상귀속": "무상 귀속 기부채납", "무상귀속분": "무상 귀속 기부채납",
  "무상양여": "무상 양여 귀속",
  // "최소납부세제"는 실무 용어일 뿐 조문에 없다. 근거 조문(지특법 제177조의2)의 제목은
  // "지방세 감면 특례의 제한"이라, 실무어 그대로는 영원히 매칭되지 않는다.
  "최소납부세제": "감면 특례 제한 최소납부", "최소납부": "감면 특례 제한 최소납부",
  // 실무는 붙여 쓰고 조문은 띄어 쓴다 — "신고납부" vs 지방세법 제20조 "신고 및 납부".
  "신고납부": "신고 납부", "신고납부기한": "신고 납부 기한",
  // 추징의 구어체. 조문은 "추징"(지특법 제178조)이라고만 쓴다.
  "토해내": "추징", "토해내나요": "추징", "토해낼": "추징", "환수": "추징 환수", "반납": "추징",
  // 실무 "상가" ↔ 법령 "복리시설". 재건축 상가 동의요건은 도정법 제35조제3항이 "복리시설의
  // 경우에는 …전체를 하나의 동으로 본다"고 규정할 뿐 '상가'라는 말을 쓰지 않는다.
  "상가": "상가 복리시설", "상가소유자": "복리시설 구분소유자",
  // 붙여 쓴 실무 조어 → 조문의 분리 표기. 도정법 제65조는 "수용"과 "재결"을 따로 쓴다.
  "수용재결": "수용 재결", "재결신청": "재결 신청", "협의취득": "협의 취득",
  // 조문은 "정비사업전문관리업"(제102조)이고 실무는 "전문관리업자"라 부른다 — 어미가 달라 매칭 실패.
  "전문관리업자": "정비사업전문관리업 전문관리업", "정비업체": "정비사업전문관리업 전문관리업",
  // 실무 "정보공개"는 조문 제목에 두 갈래로 나뉜다 — 제120조(정비사업의 정보공개, 시장·군수의
  // 의무)와 제124조(관련 자료의 공개 등, 조합의 의무). 조합 쪽을 물으면 후자가 답인데
  // '정보공개'라는 말이 제124조에는 없어 매번 제120조만 왔다.
  "정보공개": "정보공개 자료 공개 열람", "자료공개": "자료 공개 열람",
  // 이주 거부 국면의 구어체. 조문은 "사용ㆍ수익의 중지"(도정법 제81조)라고만 쓴다.
  "내보내": "사용 수익 중지 인도", "내보내나요": "사용 수익 중지 인도",
  "버티": "사용 수익 중지 인도", "안 나가": "사용 수익 중지 인도",
  // 실무는 붙여 쓰고 조문은 띄어 쓴다 — "다음날" vs 도정법 제86조 "이전고시가 있은 날의 다음 날".
  // 소유권 취득시기의 핵심 문구라 이 한 칸 때문에 근거 조문이 통째로 안 잡혔다.
  "다음날": "다음 날 이전고시", "익일": "다음 날 이전고시",
};

// 세법 법령 — 세금 질의가 아닐 때 감점(정비 절차 질의에서 "조합원/대상자/양도" 등
// 흔한 단어가 세법의 무관 조문(영농조합법인 조합원 과세 등)을 상위로 끌어올리는 것 차단).
const TAX_LAW = /^(지방세법|지방세특례제한법|지방세기본법|조세특례제한법|소득세법|종합부동산세법|농어촌특별세법)/;
// 세금 의도 신호. "세입자/세대" 오검출을 피하려 단독 "세"는 쓰지 않는다.
// 세목 이름이 안 나오는 세무 질의가 실제로 많다 — "비조합원용 토지 취득시기는 언제인가요"는
// 순도 100% 세무 질문(취득세 납세의무 성립일)인데 세목 단어가 없어 게이트가 닫혔다.
// → 세무 실무에서만 쓰는 어휘(취득시기·납세의무·시가표준액·비조합원용 등)도 신호에 포함한다.
export const TAX_INTENT = /취득세|재산세|양도소득|양도세|상속세|증여세|종합부동산|종부세|지방세|법인세|부가가치세|부가세|과세|비과세|세액|세율|세금|납세|감면|추징|부담금|등록면허세|과세표준|취득시기|시가표준액|시가인정액|간주취득|최소납부|일몰|비조합원용|농어촌특별세|농특세|취득으로 보|취득한 것으로 보|취득한 걸로 보|취득에 해당|양도로 보|양도한 것으로 보|양도에 해당|현물출자|가산세|납부지연|무신고|과소신고|가산금|배당소득|사업소득|기타소득|소득세|익금|손금|소득으로|소득에 해당|과세소득/;
// ※ "취득으로 보나요"·"양도로 보나요"는 세목 단어가 없지만 과세 여부(의제) 판단을 묻는
//   전형적 세무 질의다. 이 표현을 빼면 세법이 감점돼 토지보상법 정의 조문이 상위를 덮는다.

// 세법 안에서의 오매칭 차단.
// "정비사업 조합이 취득하는 토지 취득세 감면" 질의에서 지특법의 농협·새마을금고·노동조합
// 감면 조문이 상위를 차지한다 — "조합/취득하는/토지/취득세/감면" 토큰이 전부 겹치기 때문.
// 정비 질의임이 분명하면 다른 조직 유형의 감면 조문을 감점한다.
// '조합' 단독도 신호에 넣는다. 도시정비 챗봇에서 '조합'은 사실상 정비조합이고, 이 신호로
// 감점되는 건 농협·노조 등 명백히 다른 조직의 감면 조문뿐이라 부작용 범위가 좁다.
// (실측: "조합이 미분양분을 보유하면 재산세 중과되나요"에서 노동조합·농협 감면이 3·4위였다)
const REDEV_INTENT = /정비사업|재개발|재건축|관리처분|정비구역|조합|도시정비|가로주택|소규모주택|추진위원회/;
const OTHER_ORG = /농업협동조합|수산업협동조합|산림조합|신용협동조합|새마을금고|노동조합|중소기업협동조합|생활협동조합|영농조합|엽연초|축산업협동조합/;

// 노후계획도시 특별법은 1기 신도시 등 특정 대상 법이라, 일반 정비사업 질의에서
// "정비사업/시행자/구역지정" 같은 단어로 상위를 차지해 도정법 본법을 밀어낸다.
// 질의에 노후계획도시 신호가 없으면 감점.
const NOG_LAW = /^노후계획도시/;
// 정비 관련 법률(하한 보장용) — 세법 하한을 채우다 절차 근거가 통째로 빠지는 것을 막는다.
const REDEV_LAW = /^(도시 및 주거환경정비법|빈집 및 소규모주택 정비에 관한 특례법|노후계획도시)/;
const NOG_INTENT = /노후계획도시|노후도시|노계|특별정비|재정비촉진|1기\s*신도시|신도시/;

// 심판례(조세심판원 재결)·유권해석은 세무 질의에서만 참전시킨다.
// 왜 강한 감점인가: 심판례 본문은 실무 구어체(사실관계 서술)라 질문 어휘와 지나치게 잘 겹친다.
// 세무 질의에서는 그게 장점이지만("체비지 취득세 감면"), 절차 질의("조합 임원 결격사유")에서는
// 세무 재결이 도정법 조문을 밀어낸다. → 세금 의도가 없으면 사실상 배제 수준으로 낮춘다.
const TAX_DOC = /^(심판례|유권해석)$/;

// 세목 라우팅 — 세무 질의라고 다 같은 세무가 아니다.
// "조합원입주권 취득시기"(양도소득세)에 취득세 심판례가 상위를 독식하는 일이 생긴다.
// 두 질문 다 '취득시기'를 묻지만 세목이 다르고 결론도 다르다.
// 심판례는 메타에 세목(취득/재산/종합부동산 등)을 갖고 있으니, 질의 세목과 어긋나면 감점한다.
const SEMOK_INTENT = [
  ["양도", /양도소득|양도세|입주권|1세대\s*1주택|양도차익|취득가액/],
  ["취득", /취득세|간주취득|등록면허세|시가표준액|과점주주/],
  ["재산", /재산세|분리과세|합산과세/],
  ["종합부동산", /종합부동산|종부세/],
];
function semokIntent(question) {
  return new Set(SEMOK_INTENT.filter(([, re]) => re.test(question)).map(([s]) => s));
}

// 단일 세목 법률은 법령명만으로 세목을 안다. 심판례에만 있던 세목 라우팅을 법령까지 넓힌다.
// (실측: "조합이 미분양분 보유하면 재산세 중과되나요"의 1위가 소득세법 제95조였다)
// 지방세법·지방세특례제한법은 취득·재산·등록면허를 함께 담아 조문별로 갈리므로 제외한다.
const LAW_SEMOK = { "소득세법": "양도", "종합부동산세법": "종합부동산" };
function chunkSemok(chunk) {
  if (chunk.세목) return String(chunk.세목).trim();
  const base = String(chunk.법령명 || "").replace(/\s*(시행령|시행규칙)$/, "");
  return LAW_SEMOK[base] || "";
}

// 주변 법령 감점 배수. 세법·노후계획도시법은 해당 의도가 없으면 감점해 도정법 본법을 우선.
// 어휘(retrieve)·하이브리드(retrieveHybrid) 양쪽 최종 점수에 동일 적용(벡터 rerank가 감점을
// 무시하고 세법 조문을 끌어올리는 것 방지).
function domainPenalty(name, taxIntent, nogIntent, 자료유형, 제목, redevIntent, 세목, semok) {
  let p = 1;
  // 질의 세목이 특정됐는데 자료 세목이 다르면 감점(양도세 질문에 취득세 재결이 오는 것 차단).
  if (semok && semok.size && 세목 && !semok.has(String(세목).trim())) p *= 0.25;
  if (!taxIntent && TAX_LAW.test(name || "")) p *= 0.35;
  if (!nogIntent && NOG_LAW.test(name || "")) p *= 0.5;
  // 심판례·해석례는 세금 의도가 없을 때만 배제한다(0.15).
  // ※ 세무 질의에서도 완만히 감점(0.6~0.85)해 법령을 올려보려 했으나 회귀가 37/39→34/39로
  //   나빠졌다. 심판례가 상위를 차지하는 건 대개 그게 실제 정답 경로이기 때문이다.
  //   법령이 밀리는 문제는 감점이 아니라 하한 보장(applyTypeFloor)으로 푼다.
  if (TAX_DOC.test(자료유형 || "")) p *= taxIntent ? 1 : 0.15;
  // 정비 질의인데 다른 조직(농협·새마을금고·노조 등) 감면 조문이면 감점.
  if (redevIntent && OTHER_ORG.test(제목 || "")) p *= 0.25;
  return p;
}

/**
 * 같은 심판례·해석례에서 나온 청크 수를 제한한다.
 * 한 재결이 요지·판단 여러 청크로 쪼개져 있어, 검색어와 잘 맞으면 상위를 3~4칸씩 독식한다.
 * 그만큼 법령 조문과 다른 재결이 밀려난다(실측: "무상귀속" 질의에서 한 재결이 상위 3칸 차지).
 * 같은 사건은 대표 2청크(요지+판단)면 충분하다.
 */
function capPerSource(ranked, max = 2) {
  const n = new Map();
  return ranked.filter((r) => {
    if (!TAX_DOC.test(r.chunk.자료유형 || "")) return true;
    const k = (r.chunk.사건번호 || r.chunk.법령명 || "") + "";
    const c = (n.get(k) || 0) + 1;
    n.set(k, c);
    return c <= max;
  });
}

/**
 * 자료유형 하한 보장 — 상위 k 안에 법령(·행정규칙)을 최소 minLaw개 남긴다.
 * 심판례가 검색어와 잘 맞아 상위를 독식하면 정작 근거 조문이 프롬프트에서 빠진다.
 * 법률 위계상 결론의 근거는 법령이어야 하므로, 자리 일부를 법령에 예약한다.
 */
function applyTypeFloor(sorted, k, minLaw = 3, taxIntent = false, minTaxLaw = 2, redevIntent = false) {
  const isLaw = (r) => r.chunk.자료유형 === "법령" || r.chunk.자료유형 === "행정규칙";
  const isTaxLaw = (r) => isLaw(r) && TAX_LAW.test(r.chunk.법령명 || "");
  let top = sorted.slice(0, k);
  const rest = () => sorted.filter((r) => !top.includes(r));

  // 하한을 채우는 공통 절차: 조건에 맞는 항목을 뒤쪽에서 끌어와, 조건에 안 맞는 하위 항목을 밀어낸다.
  // 시행령·시행규칙은 위임 내용만 담고 요건·세율 본문은 본법에 있다. 하한 자리가 하나뿐일 때
  // 시행규칙이 그 자리를 먹으면 정작 근거 본문이 빠진다(실측: 도정법 제86조 대신 시행규칙 제13조).
  // → 하한을 채울 땐 본법을 먼저 쓰고, 모자랄 때만 하위법령으로 채운다.
  // ※ 본법 우선은 자리가 하나뿐인 하한(정비법)에만 쓴다. 법령·세법 하한에도 걸었더니
  //   시행령이 정답인 케이스 3건이 깨졌다(비조합원용 취득시기=지방세법 시행령 제11조의2 등).
  //   자리가 여러 개면 시행령도 같이 들어오므로 굳이 순서를 강제할 이유가 없다.
  const isMainLaw = (r) => !/\s(시행령|시행규칙)$/.test(String(r.chunk.법령명 || ""));
  const fill = (ok, min, keep, preferMain = false) => {
    const need = min - top.filter(ok).length;
    if (need <= 0) return;
    const pool = rest().filter(ok);
    const ordered = preferMain
      ? [...pool.filter(isMainLaw), ...pool.filter((r) => !isMainLaw(r))]
      : pool;
    const extra = ordered.slice(0, need);
    if (!extra.length) return;
    const kept = [];
    let drop = extra.length;
    for (let i = top.length - 1; i >= 0; i--) {
      if (!keep(top[i]) && drop > 0) { drop--; continue; }
      kept.unshift(top[i]);
    }
    top = kept.concat(extra).sort((a, b) => b.score - a.score);
  };

  // 1) 법령 하한 — 결론의 근거는 법령이어야 하므로 심판례가 상위를 독식해도 자리를 남긴다.
  fill(isLaw, minLaw, isLaw);
  // 2) 세법 하한 — 세무 질의인데 도정법·빈집법이 법령 자리를 다 채우면 세법 조문이 한 건도
  //    안 들어온다(실측: "토지등소유자가 직접 시행하는 경우 취득세"의 상위 9건이 전부 정비법이었다).
  //    법령 하한만으로는 이 경우가 안 걸린다 — 정비법도 법령이기 때문이다.
  if (taxIntent) fill(isTaxLaw, minTaxLaw, (r) => isTaxLaw(r) || r.ref);
  // 3) 정비법 하한 — "조합원 지위 양도 제한이 세금에도 영향 있나요"처럼 절차와 세무에 걸친
  //    질문에서, 세법 하한을 채우고 나면 정작 절차 근거인 도정법이 한 건도 안 남는다.
  //    세무 신호와 정비 신호가 함께 잡힌 질의에 한해 정비법 1건을 예약한다.
  if (taxIntent && redevIntent) {
    // 하한 충족 판정을 '정비 본법'으로 좁힌다. 시행규칙도 정비법이라 그것만으로 하한이
    // 충족돼 버리면, 정작 요건 본문이 있는 본법(도정법 제86조 등)이 영영 안 들어온다.
    const isRedevMain = (r) => isLaw(r) && REDEV_LAW.test(r.chunk.법령명 || "") && isMainLaw(r);
    fill(isRedevMain, 1, (r) => isRedevMain(r) || isTaxLaw(r) || r.ref, true);
  }
  return top.slice(0, k);
}

/** 질문 → 키워드(스템) 집합 */
export function tokenize(q) {
  const out = new Set();
  // 토큰과 그 스템(조사·용언 어미 제거)을 함께 넣는다.
  const addWithStem = (t) => {
    out.add(t);
    if (/[가-힣]/.test(t)) {
      for (const j of JOSA) {
        if (t.length > j.length + 1 && t.endsWith(j)) { out.add(t.slice(0, -j.length)); break; }
      }
    }
  };
  const base = (norm(q).match(/[가-힣]+|[A-Za-z0-9]+/g) || []).filter((t) => t.length >= 2);
  for (const t of base) addWithStem(t);

  // 과세 여부를 묻는 질의("취득세 내나요", "과세대상인가요")는 답이 비과세 조문에 있는 경우가
  // 많은데, 질문에는 '비과세'라는 말이 나오지 않는다. 답의 어휘를 검색어에 얹어 준다.
  // (실측: "신탁등기 말소하고 조합원에게 이전할 때 취득세 내나요"의 근거는 지방세법 제9조 비과세)
  if (/내나요|내야|내는|과세대상|과세되나요|부과되나요|발생하나요|물어야|납부해야|과세되는지|대상인가요|안 ?내도|안 ?내는|면제되나요|두 번|이중과세|중복 과세/.test(q)) {
    out.add("비과세");
  }
  // 납부한 뒤 사정이 바뀐 국면("이미 낸 취득세는 어떻게 되나요", "취소되면 돌려받나요")은
  // 환급·경정청구 조문(지방세기본법 제50·60조)이 답인데, 질문에 그 단어가 안 나온다.
  if (/이미 낸|이미 납부|돌려받|돌려주|되돌려|취소되면|무효가? ?되면|변경되면|잘못 냈/.test(q)) {
    out.add("환급"); out.add("경정");
  }
  // "신고를 안 하면" = 무신고. 조문은 '무신고가산세'(지방세기본법 제53조)라고만 쓴다.
  if (/신고.{0,4}안 ?하|미신고|신고 ?누락|신고를 ?빠뜨/.test(q)) out.add("무신고");
  // "1+1 분양"은 실무 조어이고 조문은 "…범위에서 2주택을 공급"(도정법 제76조)이라 쓴다.
  // 게다가 '1+1'은 한 글자 숫자라 토큰화 단계에서 아예 사라진다 → 패턴으로 직접 얹는다.
  if (/1\s*\+\s*1/.test(q)) { out.add("2주택"); out.add("주거전용면적"); }
  // "언제 내나요"·"언제까지"는 신고·납부 기한(지방세법 제20조)을 묻는 것이다.
  // ※ 감면 '일몰기한'을 묻는 질의("체비지 감면은 언제까지")에까지 얹으면 신고·납부 조문이
  //   지특법 감면 조문을 밀어낸다(실측). 감면 맥락이면 적용하지 않는다.
  if (/언제 ?내|언제까지|기한이? ?언제|납부 ?시기/.test(q) && !/감면|면제|경감/.test(q)) {
    out.add("신고"); out.add("납부");
  }
  // 추진위 단계에서 쓴 비용이 조합으로 넘어가는지 묻는 질의. 조문(도정법 제34조제3·4항)은
  // "권리ㆍ의무는 조합이 포괄승계"·"사용경비를 기재한 회계장부…인계"라고만 쓰고
  // '돈/갚다/떠안다' 같은 실무어를 쓰지 않아, 그대로는 운영규정 고시만 상위에 올라왔다.
  if (/추진위/.test(q) && /돈|비용|경비|자금|채무|빚|갚|부담|떠안|승계/.test(q)) {
    out.add("사용경비"); out.add("포괄승계"); out.add("인계");
  }
  // 준공 이후 소유권이 넘어오는 국면. 실무는 "공사 다 끝나면 등기 언제 넘어오나요"라고 묻지만
  // 조문에는 '넘어오다'도 '공사 완료'라는 표제도 없다. 준공인가(제83조) → 이전고시(제86조:
  // "소유권을 이전"·"고시가 있은 날의 다음 날에 소유권을 취득") → 등기(제88조)로 이어진다.
  if (/공사.{0,4}(끝|완료|마치)|준공/.test(q) && /소유권|등기|이전|명의/.test(q)) {
    out.add("이전고시"); out.add("소유권"); out.add("준공인가");
  }
  // 분담금·청산금을 안 내는 국면. 조문은 "부과금"·"연체료"·"체납처분"(도정법 제93조)이라 쓰고
  // 실무는 "분담금 안 내면 어떻게 받아내나요"라고 묻는다.
  if (/분담금|부과금|청산금/.test(q) && /안 ?내|미납|체납|연체|받아내|징수|못 ?받/.test(q)) {
    out.add("부과금"); out.add("연체료"); out.add("체납"); out.add("징수");
  }
  // 조합이 소멸하는 국면. 조문은 "해산"(제86조의2)·"청산인"이라 쓴다.
  if (/조합/.test(q) && /없어지|사라지|소멸|정리되|해산|청산인/.test(q)) {
    out.add("해산"); out.add("청산인");
  }

  // 약어·복합어 확장 — 원형뿐 아니라 스템("이주정착금은"→"이주정착금")에도 적용해야
  // 조사 붙은 질의어도 SYN에 걸린다. (ABBR: 약어→정식명, 원형 유지 / SYN: 구어체→법령어 치환)
  const drop = new Set();
  for (const w of [...out, ...(norm(q).toLowerCase().match(/[a-z]+/g) || [])]) {
    const ab = ABBR[w.toLowerCase()];
    if (ab) for (const e of ab.split(" ")) addWithStem(e);
    const sy = SYN[w];
    if (sy) {
      const parts = sy.split(" ");
      for (const e of parts) addWithStem(e);
      if (!parts.includes(w)) drop.add(w); // 구어체 원형은 오매칭 유발 → 검색어에서 제외
    }
  }
  return [...out].filter((t) => t.length >= 2 && !drop.has(t));
}

function countOccurrences(hay, needle) {
  if (!needle) return 0;
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

/**
 * BM25-lite 검색.
 * @param {Array} index  build-index.mjs가 만든 청크 배열
 * @param {string} question
 * @param {number} k  상위 몇 개
 * @param {string[]|null} allowedTypes  허용 자료유형 필터(예: ["법령","행정규칙"]). null이면 전체.
 * @param {string|null} region  조례 지역 필터(예: "서울특별시"). 조례는 이 지역만 검색된다.
 *   region이 없으면 조례는 전량 제외 — 여러 지자체 조례가 뒤섞여 엉뚱한 지역을 인용하는 사고 방지.
 * @returns {Array} [{chunk, score, matched}]
 */
export function retrieve(index, question, k = 5, allowedTypes = null, region = null) {
  const terms = tokenize(question);
  if (!terms.length) return [];

  let pool = allowedTypes
    ? index.filter((c) => allowedTypes.includes(c.자료유형))
    : index;
  // 조례는 선택된 지역만 남긴다(지역 미지정 시 조례 전량 제외).
  pool = pool.filter((c) => c.자료유형 !== "조례" || (region && c.지자체 === region));
  if (!pool.length) return [];

  // 정의 질의 — "…이 뭐야" 뿐 아니라 "…로 보나요/해당하나요"(해당 여부)도 정의·의제 조문을 묻는 것이다.
  // 실측: "종전 주택을 조합에 넘길 때 양도로 보나요"의 근거는 소득세법 제88조(양도의 정의)다.
  const defIntent = /뭐|무엇|무슨|정의|이란|개념|뜻/.test(question);
  // "…로 보나요/해당하나요"(해당 여부)도 정의·의제 조문을 묻는 것이지만, 정의 질의만큼
  // 강하게 가중하면 무관한 법의 정의 조문이 상위를 독식한다(실측: 빈집법 제2조 각 목이 1~4위).
  // "…인가요"로 성질을 묻는 것도 정의 조문을 묻는 것이다("조합 분담금도 지방세인가요").
  const defWeak = !defIntent && /로 보나요|으로 보나요|해당하나요|볼 수 있나요|보는지|지방세인가요|세금인가요|조세인가요|부담금인가요/.test(question);
  const taxIntent = TAX_INTENT.test(question); // 세금 질의 여부(아니면 세법 청크 감점)
  const nogIntent = NOG_INTENT.test(question); // 노후계획도시 질의 여부(아니면 노후법 감점)
  const redevIntent = REDEV_INTENT.test(question); // 정비 질의 여부(다른 조직 감면조문 감점)
  const semok = semokIntent(question);             // 질의 세목(양도/취득/재산/종합부동산)
  // 매칭용 정규화 텍스트를 청크에 캐시(모듈 스코프 index 재사용 시 1회만 계산).
  // 매칭텍스트에 법령명을 덧붙여 "지방세법 취득세"처럼 법 지정 질의가 그 법으로 향하게.
  for (const c of pool) if (c.__n === undefined) {
    c.__n = norm(c.text + " " + (c.법령명 || ""));
    c.__h = norm((c.heading || "") + " " + (c.법령명 || ""));
  }

  const N = pool.length;
  const lens = pool.map((c) => c.__n.length);
  const avg = lens.reduce((a, b) => a + b, 0) / N || 1;

  // 각 term의 df (해당 term을 substring으로 포함한 청크 수)
  const df = {};
  for (const t of terms) {
    let d = 0;
    for (const c of pool) if (c.__n.includes(t)) d++;
    df[t] = d;
  }

  // b(길이 정규화)를 0.55로 완화 → 정의 조문 등 긴 본조가 과도하게 밀리지 않도록.
  const k1 = 1.5, b = 0.55;
  const scored = pool.map((c, i) => {
    let score = 0;
    const matched = [];
    for (const t of terms) {
      const d = df[t];
      if (!d) continue; // corpus 어디에도 없는 term은 스킵
      const tf = countOccurrences(c.__n, t);
      if (!tf) continue;
      const idf = Math.log(1 + (N - d + 0.5) / (d + 0.5));
      const bm = tf * (k1 + 1) / (tf + k1 * (1 - b + b * (lens[i] / avg)));
      let s = idf * bm;
      // 조문 제목/헤딩에 등장하면 가중 (핵심 조문일 확률↑)
      if (c.__h && c.__h.includes(t)) s += idf * 2;
      score += s;
      matched.push(t);
    }
    // 세법·노후계획도시법·세무자료(심판례/해석례)는 해당 의도가 아니면 감점.
    score *= domainPenalty(c.법령명, taxIntent, nogIntent, c.자료유형, c.제목, redevIntent, chunkSemok(c), semok);
    // 별표(서식·표)는 참고자료로, 본조문보다 낮춤 → 서식 노이즈가 조문을 밀어내지 않게.
    if (typeof c.조문 === "string" && c.조문.startsWith("[별표]")) score *= 0.6;
    // 정의 조문 가중. 특히 호/목 단위 정의 서브청크(용어 하나만 담김)는 tf가 낮아
    // 밀리므로 더 강하게. "뭐야/이란/정의" 같은 정의 질의면 훨씬 강하게 우선.
    if (score > 0 && c.제목 && /정의/.test(c.제목)) {
      const isSub = typeof c.조문 === "string" && /(호|목)$/.test(c.조문);
      score *= defIntent ? (isSub ? 3 : 1.6) : defWeak ? (isSub ? 1.8 : 1.3) : (isSub ? 1.5 : 1.15);
    }
    return { chunk: c, score, matched };
  });

  const ranked = capPerSource(scored.filter((r) => r.score > 0).sort((a, b) => b.score - a.score));
  // 세무 질의에서 심판례가 상위를 독식해도 근거 조문(법령)이 프롬프트에 남도록 하한 보장.
  return taxIntent ? applyTypeFloor(ranked, k, 4, true, 2, redevIntent) : ranked.slice(0, k);
}

/**
 * 하이브리드 검색: BM25(어휘) + 벡터(의미)를 RRF로 융합.
 * @param {Array} index  청크 배열 (index[i].id === i 가정)
 * @param {Int8Array} vectors  corpus 벡터(int8, 정규화됨). i번째 청크 = vectors[i*dim .. ]
 * @param {Float32Array|number[]} queryVec  질의 임베딩(정규화된 float)
 * @param {string} question
 * @param {number} k
 * @param {string[]|null} allowedTypes
 * @param {string|null} region  조례 지역 필터(retrieve로 전달)
 */
export function retrieveHybrid(index, vectors, queryVec, question, k = 5, allowedTypes = null, dim = 1024, region = null) {
  // ★ 벡터-인덱스 정합성 검사. corpus 를 키우고 인덱스만 다시 올리면 벡터는 옛 청크수 그대로라
  //   id→벡터 매핑이 어긋난다. 실제로 심판례 51건을 넣은 뒤 KV 벡터가 4,277(구) vs 인덱스
  //   4,550(신)이 되어, 새로 들어온 심판례·해석례 273청크의 유사도가 전부 NaN 이 됐다.
  //   NaN 은 정렬에서 조용히 무시돼 순위만 뒤틀리고 오류는 안 난다 — 그래서 더 위험하다.
  //   길이가 안 맞으면 벡터를 버리고 어휘검색으로 간다(회귀 스위트가 검증한 경로).
  if (!vectors || vectors.length !== index.length * dim) {
    return retrieve(index, question, k, allowedTypes, region);
  }
  // 어휘(BM25)로 후보군(top-20)을 뽑고, 그 후보 "안에서만" 벡터로 재순위한다.
  // → 의미 검색이 관련 낮은 새 청크를 끌어와 정밀도를 떨어뜨리는 것을 방지(안전한 rerank).
  const bm = retrieve(index, question, 20, allowedTypes, region);
  if (bm.length <= 1) return bm.slice(0, k);

  const withVec = bm.map((h, bmRank) => {
    let dot = 0;
    const off = h.chunk.id * dim;
    for (let j = 0; j < dim; j++) dot += queryVec[j] * vectors[off + j];
    return { chunk: h.chunk, bmRank, vec: dot };
  });
  const vRank = new Map();
  [...withVec].sort((a, b) => b.vec - a.vec).forEach((x, r) => vRank.set(x.chunk.id, r));

  // RRF는 점수가 아닌 "순위"로 융합하므로, retrieve()의 세법/노후 감점이 여기서 무시된다.
  // → 벡터가 세법 조문(예: 소득세법 양도의 정의)을 끌어올리는 걸 막기 위해 최종 점수에도 감점 적용.
  const taxIntent = TAX_INTENT.test(question);
  const nogIntent = NOG_INTENT.test(question);
  const redevIntent = REDEV_INTENT.test(question);
  const semok = semokIntent(question);
  // RRF 융합(어휘 순위 + 벡터 순위). 어휘 후보 안에서 의미까지 상위인 것을 끌어올림.
  const RK = 20;
  const ranked = withVec
    .map((x) => ({
      chunk: x.chunk,
      score: (1 / (RK + x.bmRank) + 1 / (RK + vRank.get(x.chunk.id)))
        * domainPenalty(x.chunk.법령명, taxIntent, nogIntent, x.chunk.자료유형, x.chunk.제목, redevIntent, chunkSemok(x.chunk), semok),
    }))
    .sort((a, b) => b.score - a.score);
  const capped = capPerSource(ranked);
  return taxIntent ? applyTypeFloor(capped, k, 4, true, 2, redevIntent) : capped.slice(0, k);
}

/**
 * 참조 조문 자동 추적: 검색된 조문이 "제N조"를 참조하면 같은 법령의 그 조문도 추가.
 * 위임·준용("제35조에 따른 동의요건 이상" 등)이 흔한 법률 특성상 정답 완성도를 크게 높인다.
 * @param {Array} hits  retrieveHybrid/retrieve 결과
 * @param {Array} index  전체 청크
 */
export function expandReferences(hits, index, allowedTypes = null, maxAdd = 4, fromTop = 3) {
  const have = new Set(hits.map((h) => h.chunk.id));
  const byRef = new Map(); // "법령명|제N조" → 본조 청크
  for (const c of index) {
    if (c.자료유형 === "판례") continue;
    if (typeof c.조문 === "string" && /^제\d+조(?:의\d+)?$/.test(c.조문)) {
      byRef.set(c.법령명 + "|" + c.조문, c);
    }
  }
  const added = [];
  for (const h of hits.slice(0, fromTop)) {
    if (added.length >= maxAdd) break;
    const t = h.chunk.text;
    const seen = new Set();
    for (const m of t.matchAll(/제(\d+)조(?:의(\d+))?/g)) {
      // 타법 참조("「○○법」 제N조")는 스킵(제N조 앞 6자에 닫는 」).
      if (t.slice(Math.max(0, m.index - 6), m.index).includes("」")) continue;
      // ★위임/준용/근거 참조만 따라간다 — 참조 뒤 40자 내에 아래 신호가 있어야 함.
      //  · 위임·준용: "이상/준용/예에 따라/요건에 따라/에 준하여"
      //  · 근거계획 지정: "에 따라 인가/수립/결정된 …계획" — 그 계획을 정의하는 조문이 실체적 근거
      //    (예: 제79조가 "제74조에 따라 인가받은 관리처분계획"을 말하면 제74조가 핵심 근거)
      // (단순 인용 "제35조제3항에 따른 …자" 등은 조작적 근거가 아니므로 제외해 노이즈 방지)
      const after = t.slice(m.index, m.index + 40);
      if (!/이상|준용|예에 따라|요건에 따라|요건 이상|에 준하여|에 따라 인가|에 따라 수립|에 따라 결정|에 따른 인가/.test(after)) continue;
      const label = "제" + m[1] + "조" + (m[2] ? "의" + m[2] : "");
      if (seen.has(label)) continue;
      seen.add(label);
      const c = byRef.get(h.chunk.법령명 + "|" + label);
      if (c && !have.has(c.id) && (!allowedTypes || allowedTypes.includes(c.자료유형))) {
        have.add(c.id);
        added.push({ chunk: c, score: 0, ref: true });
        if (added.length >= maxAdd) break;
      }
    }
  }
  return hits.concat(added);
}

/**
 * 세무 자료 → 근거 조문 역참조 + 감면 짝 조문 동반.
 *
 * (1) 역참조: 심판례·해석례는 `관련법령`("지방세특례제한법 제74조")을 스스로 밝힌다.
 *     질의 어휘가 조문과 안 겹쳐 조문이 검색에 안 걸려도, 재결이 걸리면 근거 조문을 따라갈 수 있다.
 *     심판례를 "질의어 → 조문"의 다리로 쓰는 것이 이 corpus를 넣은 핵심 이유다.
 * (2) 감면 짝: 감면 조문만 답하고 추징·최소납부세제·농어촌특별세를 빠뜨리는 것이 실무 사고
 *     1순위다. 지특법 감면 조문이 검색되면 그 짝 조문(제177조의2 최소납부, 제178조 추징)을
 *     함께 넣어, 답변이 감면만 말하고 끝나지 않게 한다.
 *
 * @param {Array} hits  검색 결과
 * @param {Array} index 전체 청크
 * @param {boolean} taxIntent 세무 질의 여부(아니면 아무것도 하지 않음)
 * @param {number} maxAdd 추가 상한. 5인 이유: 세무 질의는 k=9로 검색폭이 넓어 역참조 대상도
 *   많아지는데, 4로 두면 참조 조문이 예산을 다 먹고 추징·최소납부 조문이 밀려난다(실측).
 */
export function expandTaxContext(hits, index, question, maxAdd = 6) {
  const taxIntent = typeof question === "boolean" ? question : TAX_INTENT.test(question || "");
  const q = typeof question === "string" ? question : "";
  if (!taxIntent || !hits.length) return hits;
  const have = new Set(hits.map((h) => h.chunk.id));
  const key = (법령명, 조문) => norm(String(법령명 || "")).replace(/\s/g, "") + "|" + 조문;
  const byRef = new Map();
  for (const c of index) {
    if (typeof c.조문 === "string" && /^제\d+조(?:의\d+)?$/.test(c.조문)) {
      byRef.set(key(c.법령명, c.조문), c);
    }
  }
  const added = [];
  const push = (c) => {
    if (c && !have.has(c.id) && added.length < maxAdd) {
      have.add(c.id);
      added.push({ chunk: c, score: 0, ref: true });
    }
  };

  // (맨 앞) 세목별 기본 근거 조문 동반 — 예산(maxAdd)이 역참조로 먼저 소진되면
  // 답변의 뼈대가 빠진다. 그래서 다른 확장보다 먼저 채운다.
  // 세법 답변은 늘 같은 축으로 구성된다 — 취득세면 "누가(납세의무자)·얼마에(과세표준)",
  // 조합이 주체면 "조합은 법인세 과세특례 대상인가". 그런데 이 총론 조문들은 4천 자짜리라
  // BM25에서 매번 밀린다(지방세법 제7조가 여러 질의에서 20위 밖). 검색으로 못 올리면
  // 세목이 특정된 질의에 한해 기본 근거로 얹어 준다 — 답변의 뼈대가 빠지는 것보다 낫다.
  if (/취득세|취득으로 보|취득한 것으로 보|취득한 걸로 보|간주취득/.test(q)) {
    push(byRef.get(key("지방세법", "제7조")));   // 납세의무자 — 누가 내나
    // 과세표준·금액이 걸린 질의면 제10조. 취득세 답변의 두 번째 축이다.
    if (/과세표준|가격|가액|금액|평가액|감정평가|인수가|분담금|보수|이자|대금/.test(q)) {
      push(byRef.get(key("지방세법", "제10조")));
    }
    // 과세 여부(비과세) 국면이면 제9조. 신탁 종료·기부채납·무상귀속이 전형이다.
    if (/비과세|기부채납|무상|귀속|해지|해제|말소|종료|발생하나요|내나요|내야|안 ?내도|수익권|과세대상/.test(q)) {
      push(byRef.get(key("지방세법", "제9조")));
    }
  }
  // 취득세라는 말이 없어도 과세표준(가액·평가액)을 묻는 세무 질의면 제10조를 붙인다.
  // "종전자산 감정평가액이 낮으면 세금이 줄어드나요"가 전형 — 답은 취득세 과세표준 문제다.
  if (taxIntent && /과세표준|평가액|감정평가|가액|가격|분양가|차액|차이/.test(q)) {
    push(byRef.get(key("지방세법", "제10조")));
  }
  // 등록면허세도 축이 있다 — 누가(제24조 납세의무자)·얼마에(제28조 세율).
  if (/등록면허세|등록세|등기.{0,6}세금/.test(q)) {
    push(byRef.get(key("지방세법", "제24조")));
    push(byRef.get(key("지방세법", "제28조")));
  }
  // 양도소득세 축 — 양도의 정의(제88조)와 비과세(제89조). 정의 조문이라 서브청크로 쪼개져
  // 있어 벡터 rerank 에서 밀리기 쉽다(실측: 하이브리드 경로에서만 제88조가 9위 밖으로 나갔다).
  if (/양도소득|양도세|입주권|1세대\s*1주택|현금청산금|양도로 보|양도한 것으로 보/.test(q)) {
    push(byRef.get(key("소득세법", "제88조")));
    push(byRef.get(key("소득세법", "제89조")));
  }
  // 종합부동산세도 축이 정해져 있다 — 누가(제7조 납세의무자)·얼마에(제8조 과세표준).
  if (/종합부동산|종부세/.test(q)) {
    push(byRef.get(key("종합부동산세법", "제7조")));
    push(byRef.get(key("종합부동산세법", "제8조")));
  }
  // 신고·납부 시기를 묻는 질의는 근거가 지방세법 제20조(신고 및 납부)로 정해져 있다.
  if (/언제 ?내|언제까지|기한이? ?언제|납부 ?시기|신고납부/.test(q) && !/감면|면제|경감/.test(q)) {
    push(byRef.get(key("지방세법", "제20조")));
  }
  // 감면 요건을 못 채우는 국면은 추징 문제다. 상위에 감면 조문이 안 잡혀도 짝 조문을 붙인다
  // ("착공 지연되면 감면 요건을 못 채우나요").
  if (/감면|면제|경감/.test(q) && /못 ?채우|미달|지연|위반|어기|사후|취소|해제/.test(q)) {
    push(byRef.get(key("지방세특례제한법", "제178조")));
  }
  // 조합(법인)이 파는·나누는·버는 국면이면 법인세 문제다. 질의 어휘가 '양도세'여도 마찬가지다.
  // 비용·이자·손금처럼 '버는 쪽'의 반대편 어휘도 결국 조합 법인세 과세특례 문제다.
  if (/조합/.test(q) && /법인세|수입|매각|처분|팔면|해산|청산|분배|과세|비용|손금|익금|이자|경비/.test(q)) {
    push(byRef.get(key("조세특례제한법", "제104조의7")));
  }

  // (0) 시행령·시행규칙 → 모법 조문. 시행령 조문은 "법 제28조제2항에서 …"처럼 모법을 가리키는데,
  // 위임 내용만 담고 세율·요건 본문은 모법에 있다. 시행령만 검색되고 모법이 빠지면 답의 근거가
  // 반쪽이 된다(실측: "대도시 법인 등록면허세 중과"에서 시행령 제27조만 오고 지방세법 제28조가 빠짐).
  for (const h of hits) {
    const nm = String(h.chunk.법령명 || "");
    const parent = nm.replace(/\s*(시행령|시행규칙)$/, "");
    if (parent === nm) continue;
    let n = 0;
    for (const m of String(h.chunk.text || "").matchAll(/([법영])\s*제(\d+)조(?:\s*의\s*(\d+))?/g)) {
      if (n++ >= 3) break; // 앞쪽 참조만 — 조문 하나가 여러 조를 인용하면 노이즈가 된다
      // "법 제N조"는 모법, "영 제N조"는 시행령을 가리킨다(시행규칙은 대개 영을 인용한다).
      const target = m[1] === "법" ? parent : `${parent} 시행령`;
      push(byRef.get(key(target, `제${m[2]}조${m[3] ? "의" + m[3] : ""}`)));
    }
  }

  // (1) 심판례·해석례가 밝힌 관련법령을 조문 청크로 끌어온다.
  // 관련법령 표기가 두 가지다: "「지방세특례제한법」 제74조" 와 "지방세특례제한법제74조".
  // 낫표(「」)를 선택적으로 허용해야 둘 다 잡힌다 — 없으면 낫표 있는 쪽이 통째로 빠진다.
  const REF = /「?\s*([가-힣]+법(?:\s*시행령|\s*시행규칙)?)\s*」?\s*제(\d+)조(?:\s*의\s*(\d+))?/g;
  for (const h of hits) {
    if (!TAX_DOC.test(h.chunk.자료유형 || "")) continue;
    const src = `${h.chunk.관련법령 || ""} ${h.chunk.조문 === "요지" ? h.chunk.text : ""}`;
    for (const m of src.matchAll(REF)) {
      push(byRef.get(key(m[1], `제${m[2]}조${m[3] ? "의" + m[3] : ""}`)));
    }
  }
  // (2) 지특법 감면 조문이 있으면 최소납부세제·추징 조문을 동반한다.
  const 감면있음 = hits.some((h) =>
    /^지방세특례제한법$/.test(String(h.chunk.법령명 || "").trim()) && /감면|경감|면제/.test(h.chunk.제목 || ""));
  if (감면있음) {
    push(byRef.get(key("지방세특례제한법", "제177조의2")));
    push(byRef.get(key("지방세특례제한법", "제178조")));
  }
  return hits.concat(added);
}

/**
 * 정비 질의에 준용 근거 조문을 동반한다.
 *
 * 준용 조문은 준용 대상 법률을 어휘로 이길 수 없다. 도정법 제65조(토지보상법 준용)에는
 * "재결"이 한 번 나오는데 토지보상법 본문에는 수십 번 나온다. 그래서 "재개발 조합이
 * 수용재결 신청은 언제까지" 같은 질의는 토지보상법 조문만 잔뜩 오고, 정작 "정비사업에
 * 왜 그 법이 적용되는지"와 사업시행기간 특례를 정한 준용 근거가 빠진다.
 * → 정비 질의에서 준용 대상 법률이 상위에 오면 그 준용 근거를 얹어 준다.
 *   (세무에서 감면 조문에 추징·최소납부를 동반시킨 것과 같은 발상)
 */
export function expandRedevContext(hits, index, question, maxAdd = 2) {
  const q = question || "";
  if (!hits.length) return hits;
  const have = new Set(hits.map((h) => h.chunk.id));
  const added = [];
  const push = (법령명, 조문) => {
    if (added.length >= maxAdd) return;
    const c = index.find((x) => x.법령명 === 법령명 && x.조문 === 조문);
    if (c && !have.has(c.id)) { have.add(c.id); added.push({ chunk: c, score: 0, ref: true }); }
  };
  // 고시·지침은 위임받은 세부기준(비율·산식)만 담고 근거는 법에 있다. "임대주택 몇 퍼센트"의
  // 실제 답은 고시가 맞지만, 그것만 주면 왜 그 고시를 따르는지가 빠진다 → 위임 근거를 얹는다.
  for (const h of hits) {
    if (h.chunk.자료유형 !== "행정규칙") continue;
    // 근거는 대개 고시 제1조(목적)에만 적혀 있고, 검색에 걸리는 건 세부기준 조문이다.
    // → 같은 파일의 청크 전체에서 위임 근거를 찾는다.
    const sameFile = index.filter((c) => c.파일 === h.chunk.파일);
    for (const c of sameFile) {
      const m = String(c.text || "").match(/「?도시 및 주거환경정비법」?[^\n]{0,24}?제(\d+)조(?:의(\d+))?/);
      if (m) { push("도시 및 주거환경정비법", `제${m[1]}조${m[2] ? "의" + m[2] : ""}`); break; }
    }
    break;
  }
  // 토지보상법이 잡혔다 = 수용·보상 국면. 정비사업에서는 늘 준용 규정을 거쳐 적용된다.
  // ※ 이쪽만 정비 신호를 요구한다. 토지보상법은 정비 밖에서도 쓰이는 법이라 무조건 준용
  //   근거를 붙이면 엉뚱해진다. 반면 위 행정규칙 블록은 우리 corpus의 고시가 전부 정비
  //   관련이라 게이트 없이 돌려도 안전하다("임대주택 몇 퍼센트"엔 정비 단어가 없다).
  const 보상법 = REDEV_INTENT.test(q) && hits.some((h) => /^공익사업을 위한 토지/.test(h.chunk.법령명 || ""));
  if (보상법) {
    if (/소규모|가로주택|자율주택|빈집/.test(q)) push("빈집 및 소규모주택 정비에 관한 특례법", "제35조의2");
    else push("도시 및 주거환경정비법", "제65조");
  }
  return hits.concat(added);
}

/** 질의 임베딩 벡터를 L2 정규화 (코사인용) */
export function normalizeVec(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

/**
 * 근거 인용 라벨.
 *   법령    "…법 제64조 (시행 2026-07-01)"
 *   판례    "대법원 2005다68769 (선고 2006-11-23)"
 *   심판례  "조심 2024지0504 (의결 2024-06-21, 조세심판원)"
 *   유권해석 "법제처 해석 22-0530 (회신 2022-09-08)"
 * 심판례·해석례는 '의결/회신 당시 법령' 기준 판단이라 날짜를 반드시 함께 노출한다.
 */
export function citation(chunk) {
  if (chunk.자료유형 === "판례") {
    const base = `${chunk.법원 || ""} ${chunk.사건번호 || ""}`.trim();
    return chunk.선고일자 ? `${base} (선고 ${chunk.선고일자})` : base;
  }
  if (chunk.자료유형 === "심판례") {
    const base = chunk.법령명 || chunk.사건번호 || "";
    const 기관 = chunk.기관 ? `, ${chunk.기관}` : "";
    return chunk.의결일자 ? `${base} (의결 ${chunk.의결일자}${기관})` : base;
  }
  if (chunk.자료유형 === "유권해석") {
    const base = chunk.법령명 || chunk.사건번호 || "";
    return chunk.의결일자 ? `${base} (회신 ${chunk.의결일자})` : base;
  }
  const base = `${chunk.법령명} ${chunk.조문}`.trim();
  return chunk.시행일자 ? `${base} (시행 ${chunk.시행일자})` : base;
}
