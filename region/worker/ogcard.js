// ogcard.js — 링크 공유용 1200×630 카드를 SVG 로 만든다.
//
// 카톡·슬랙에 주소만 붙이면 "무슨 페이지지?" 로 끝난다. 인구·평균연령까지 썸네일에
// 들어가 있으면 링크 자체가 정보가 된다. 페이지와 같은 자료로 그리므로 어긋날 일이 없다.
//
// 주의: SVG 를 og:image 로 받아 주지 않는 서비스가 많다(카카오톡 포함).
// 그래서 워커는 /og/{코드}.png 를 먼저 찾고(빌드 때 미리 구워 KV 에 올린 것),
// 없으면 이 SVG 로 넘긴다. → region/scripts/make-og.mjs
import { metrics } from './insight.js';

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
const FONT = `-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Pretendard','Malgun Gothic','Noto Sans KR',sans-serif`;

export function ogCard({ dong, sgg, sido, month, rank, total, unit }) {
  const m = metrics(dong);
  const W = 1200, H = 630;
  const g = dong.g || [], gf = dong.gf || [];
  const all = g.map((v, i) => v + (gf[i] || 0));
  const ten = [[0, 2], [2, 4], [4, 6], [6, 8], [8, 10], [10, 12], [12, 14], [14, 16], [16, 18], [18, 21]]
    .map(([a, b]) => all.slice(a, b).reduce((x, y) => x + y, 0));
  const tenMax = Math.max(1, ...ten);
  const peak = ten.indexOf(tenMax);
  const labels = ['0대', '10대', '20대', '30대', '40대', '50대', '60대', '70대', '80대', '90+'];

  // 세로 간격은 글자 크기에 맞춰 넉넉히 벌린다. 큰 숫자(66px)는 내림획이 20px 가까이
  // 내려가서, 다음 줄을 30px 아래에 두면 겹친다(한 번 겹쳐서 나왔다).
  const bar = { x: 72, y: 470, w: 470, h: 26 };
  let acc = 0;
  const segs = [
    { v: m.young, c: '#4d9de0' }, { v: m.working, c: '#3f9a6e' }, { v: m.old, c: '#dc9a3f' },
  ].map((p) => {
    const w = (p.v / 100) * bar.w, x = bar.x + acc; acc += w;
    return `<rect x="${x.toFixed(1)}" y="${bar.y}" width="${w.toFixed(1)}" height="${bar.h}" fill="${p.c}"/>`;
  }).join('');

  const BX = 688, BSTEP = 44, BW = 33, BBOT = 462, BMAX = 148;
  const bars = ten.map((v, i) => {
    const x = BX + i * BSTEP, h = (v / tenMax) * BMAX;
    return `<rect x="${x}" y="${(BBOT - h).toFixed(1)}" width="${BW}" height="${h.toFixed(1)}" rx="4" fill="${i === peak ? '#3552d9' : '#c7d2fb'}"/>`
      + `<text x="${x + BW / 2}" y="${BBOT + 22}" font-size="15" fill="#8b8d92" text-anchor="middle">${labels[i]}</text>`;
  }).join('');

  const stat = (x, k, v) =>
    `<text x="${x}" y="396" font-size="19" fill="#6a6c70">${esc(k)}</text>`
    + `<text x="${x}" y="436" font-size="34" font-weight="700" fill="#17181a" letter-spacing="-1.2">${esc(v)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <rect width="${W}" height="${H}" fill="#f6f6f4"/>
  <rect x="0" y="0" width="${W}" height="10" fill="#3552d9"/>

  <text x="72" y="84" font-size="26" fill="#6a6c70" letter-spacing="-0.5">${esc(sido.n)} ${esc(sgg.n)}</text>
  <text x="72" y="168" font-size="80" font-weight="800" fill="#17181a" letter-spacing="-4">${esc(dong.n)}</text>
  <text x="72" y="212" font-size="22" fill="#3552d9" font-weight="600">${esc(sgg.n)} ${esc(unit)} ${total}곳 중 ${rank}위</text>

  <text x="72" y="272" font-size="21" fill="#6a6c70">총인구</text>
  <text x="72" y="336" font-size="66" font-weight="800" fill="#17181a" letter-spacing="-2.5">${fmt(dong.t)}<tspan font-size="27" font-weight="600" fill="#6a6c70" dx="10">명</tspan></text>

  ${stat(72, '평균연령', `${dong.a}세`)}
  ${stat(280, '세대수', fmt(dong.h))}
  ${stat(470, '1인 세대', `${m.single.toFixed(1)}%`)}

  ${segs}
  <text x="72" y="524" font-size="17" fill="#6a6c70">유소년 ${m.young.toFixed(1)}% · 생산연령 ${m.working.toFixed(1)}% · 고령 ${m.old.toFixed(1)}%</text>

  <text x="${BX}" y="296" font-size="21" fill="#6a6c70">연령대별 인구</text>
  ${bars}

  <line x1="72" y1="560" x2="1128" y2="560" stroke="#e5e5e0" stroke-width="1"/>
  <text x="72" y="594" font-size="18" fill="#8b8d92">행정안전부 주민등록 인구통계 · ${esc(month.slice(0, 4))}년 ${Number(month.slice(5))}월 기준</text>
  <text x="1128" y="594" font-size="18" fill="#3552d9" font-weight="700" text-anchor="end">인구·동네 — 광고 없음</text>
</svg>`;
}
