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

// 질문 끝에 흔히 붙는 조사·어미 (스템 추출용)
const JOSA = [
  "으로써", "에서의", "에서", "으로", "라는", "이라는", "이란", "란",
  "은", "는", "이", "가", "을", "를", "의", "에", "와", "과", "도",
  "만", "나", "로", "께", "부터", "까지", "마다", "보다", "처럼",
  "인가요", "인가", "입니까", "인지", "나요", "가요", "요",
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

/** 질문 → 키워드(스템) 집합 */
export function tokenize(q) {
  const raw = (norm(q).match(/[가-힣]+|[A-Za-z0-9]+/g) || []).filter((t) => t.length >= 2);
  // 약어 확장 토큰 추가
  for (const w of raw.concat(norm(q).toLowerCase().match(/[a-z]+/g) || [])) {
    const ex = ABBR[w.toLowerCase()];
    if (ex) for (const e of ex.split(" ")) raw.push(e);
  }
  const out = new Set();
  for (const t of raw) {
    out.add(t);
    // 한글 토큰은 끝의 조사/어미를 벗겨 스템도 후보에 추가
    if (/[가-힣]/.test(t)) {
      for (const j of JOSA) {
        if (t.length > j.length + 1 && t.endsWith(j)) {
          out.add(t.slice(0, -j.length));
          break;
        }
      }
    }
  }
  // 너무 짧은(1글자) 스템 제거
  return [...out].filter((t) => t.length >= 2);
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
 * @returns {Array} [{chunk, score, matched}]
 */
export function retrieve(index, question, k = 5, allowedTypes = null) {
  const terms = tokenize(question);
  if (!terms.length) return [];

  const pool = allowedTypes
    ? index.filter((c) => allowedTypes.includes(c.자료유형))
    : index;
  if (!pool.length) return [];

  const defIntent = /뭐|무엇|무슨|정의|이란|개념|뜻/.test(question); // 정의 질의 여부
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
    // 별표(서식·표)는 참고자료로, 본조문보다 낮춤 → 서식 노이즈가 조문을 밀어내지 않게.
    if (typeof c.조문 === "string" && c.조문.startsWith("[별표]")) score *= 0.6;
    // 정의 조문 가중. 특히 호/목 단위 정의 서브청크(용어 하나만 담김)는 tf가 낮아
    // 밀리므로 더 강하게. "뭐야/이란/정의" 같은 정의 질의면 훨씬 강하게 우선.
    if (score > 0 && c.제목 && /정의/.test(c.제목)) {
      const isSub = typeof c.조문 === "string" && /(호|목)$/.test(c.조문);
      score *= defIntent ? (isSub ? 3 : 1.6) : (isSub ? 1.5 : 1.15);
    }
    return { chunk: c, score, matched };
  });

  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * 하이브리드 검색: BM25(어휘) + 벡터(의미)를 RRF로 융합.
 * @param {Array} index  청크 배열 (index[i].id === i 가정)
 * @param {Int8Array} vectors  corpus 벡터(int8, 정규화됨). i번째 청크 = vectors[i*dim .. ]
 * @param {Float32Array|number[]} queryVec  질의 임베딩(정규화된 float)
 * @param {string} question
 * @param {number} k
 * @param {string[]|null} allowedTypes
 */
export function retrieveHybrid(index, vectors, queryVec, question, k = 5, allowedTypes = null, dim = 1024) {
  // 어휘(BM25)로 후보군(top-20)을 뽑고, 그 후보 "안에서만" 벡터로 재순위한다.
  // → 의미 검색이 관련 낮은 새 청크를 끌어와 정밀도를 떨어뜨리는 것을 방지(안전한 rerank).
  const bm = retrieve(index, question, 20, allowedTypes);
  if (bm.length <= 1) return bm.slice(0, k);

  const withVec = bm.map((h, bmRank) => {
    let dot = 0;
    const off = h.chunk.id * dim;
    for (let j = 0; j < dim; j++) dot += queryVec[j] * vectors[off + j];
    return { chunk: h.chunk, bmRank, vec: dot };
  });
  const vRank = new Map();
  [...withVec].sort((a, b) => b.vec - a.vec).forEach((x, r) => vRank.set(x.chunk.id, r));

  // RRF 융합(어휘 순위 + 벡터 순위). 어휘 후보 안에서 의미까지 상위인 것을 끌어올림.
  const RK = 20;
  return withVec
    .map((x) => ({
      chunk: x.chunk,
      score: 1 / (RK + x.bmRank) + 1 / (RK + vRank.get(x.chunk.id)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
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
      // ★위임/준용 참조만 따라간다 — 참조 뒤 40자 내에 "이상/준용/예에 따라/요건에 따라"가 있어야 함.
      // (단순 인용 "제35조제3항에 따른 …자" 등은 답의 조작적 근거가 아니므로 제외해 노이즈 방지)
      const after = t.slice(m.index, m.index + 40);
      if (!/이상|준용|예에 따라|요건에 따라|요건 이상|에 준하여/.test(after)) continue;
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

/** 질의 임베딩 벡터를 L2 정규화 (코사인용) */
export function normalizeVec(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

/** 근거 인용 라벨. 법령: "…법 제64조 (시행 2026-07-01)" / 판례: "대법원 2005다68769 (선고 …)" */
export function citation(chunk) {
  if (chunk.자료유형 === "판례") {
    const base = `${chunk.법원 || ""} ${chunk.사건번호 || ""}`.trim();
    return chunk.선고일자 ? `${base} (선고 ${chunk.선고일자})` : base;
  }
  const base = `${chunk.법령명} ${chunk.조문}`.trim();
  return chunk.시행일자 ? `${base} (시행 ${chunk.시행일자})` : base;
}
