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

/** 질문 → 키워드(스템) 집합 */
export function tokenize(q) {
  const raw = (q.match(/[가-힣]+|[A-Za-z0-9]+/g) || []).filter((t) => t.length >= 2);
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

  const N = pool.length;
  const lens = pool.map((c) => c.text.length);
  const avg = lens.reduce((a, b) => a + b, 0) / N || 1;

  // 각 term의 df (해당 term을 substring으로 포함한 청크 수)
  const df = {};
  for (const t of terms) {
    let d = 0;
    for (const c of pool) if (c.text.includes(t)) d++;
    df[t] = d;
  }

  const k1 = 1.5, b = 0.75;
  const scored = pool.map((c, i) => {
    let score = 0;
    const matched = [];
    for (const t of terms) {
      const d = df[t];
      if (!d) continue; // corpus 어디에도 없는 term은 스킵
      const tf = countOccurrences(c.text, t);
      if (!tf) continue;
      const idf = Math.log(1 + (N - d + 0.5) / (d + 0.5));
      const norm = tf * (k1 + 1) / (tf + k1 * (1 - b + b * (lens[i] / avg)));
      let s = idf * norm;
      // 조문 제목/헤딩에 등장하면 가중 (핵심 조문일 확률↑)
      if (c.heading && c.heading.includes(t)) s += idf * 1.5;
      score += s;
      matched.push(t);
    }
    return { chunk: c, score, matched };
  });

  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
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
