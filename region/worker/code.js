// code.js — 법정동코드 ↔ 짧은 주소.
//
// 법정동코드는 10자리인데 끝 두 자리(리 구분)는 이 서비스에서 항상 00 이다.
// 떼고 36진수로 적으면 5글자로 줄어든다: 2711015600 → 27110156 → 'g52bw'
// 한글 주소는 URL 인코딩되면 45자가 넘어가므로, 공유용으로는 이쪽이 훨씬 짧다.
export const toShort = (code) => (Number(code) / 100).toString(36);
export const fromShort = (s) => {
  const n = parseInt(s, 36);
  if (!Number.isFinite(n) || n <= 0) return null;
  const code = String(n * 100).padStart(10, '0');
  return code.length === 10 ? code : null;
};
