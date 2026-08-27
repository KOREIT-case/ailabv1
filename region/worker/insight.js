// insight.js — 숫자를 읽어 '이 동네가 어떤 곳인지' 한 줄로 뽑는다.
//
// 표가 아무리 정확해도, 45.3세가 많은 건지 적은 건지는 다른 숫자를 알아야 판단된다.
// 그래서 전국·시도·시군구를 기준으로 삼아 편차가 큰 항목부터 문장으로 만든다.
// 규칙은 전부 여기 모아 둔다 — 화면 곳곳에 흩어지면 말이 서로 어긋난다.

const pct = (a, b) => (b ? (a / b) * 100 : 0);
const sum = (a, from, to) => a.slice(from, to).reduce((x, y) => x + y, 0);

// 비교에 쓰는 지표를 한 벌로 뽑는다(동네·시군구·시도·전국 모두 같은 함수를 쓴다).
export function metrics(r) {
  const g = r.g?.length ? r.g : new Array(21).fill(0);
  const gf = r.gf?.length ? r.gf : new Array(21).fill(0);
  const all = g.map((v, i) => v + gf[i]);
  const s = r.hs?.length ? r.hs : new Array(10).fill(0);
  const hh = s.reduce((a, b) => a + b, 0) || r.h || 0;
  return {
    total: r.t, households: r.h,
    avgAge: r.a,
    young: pct(sum(all, 0, 3), r.t),
    working: pct(sum(all, 3, 13), r.t),
    old: pct(sum(all, 13, 21), r.t),
    single: pct(s[0] || 0, hh),
    perHousehold: r.h ? r.t / r.h : 0,
    femaleRatio: r.t ? pct(r.f, r.t) : 0,
  };
}

// 화면에 기준선으로 깔 항목들. domain 은 게이지의 눈금 범위를 정하는 데 쓴다.
export const GAUGES = [
  { key: 'avgAge', label: '평균연령', unit: '세', digits: 1 },
  { key: 'old', label: '고령 인구 비중', unit: '%', digits: 1 },
  { key: 'young', label: '유소년 비중', unit: '%', digits: 1 },
  { key: 'single', label: '1인 세대 비중', unit: '%', digits: 1 },
  { key: 'perHousehold', label: '세대당 인구', unit: '명', digits: 2 },
];

const fmt1 = (n, d) => n.toFixed(d).replace(/\.0+$/, (m) => (d ? m : ''));

// 편차가 큰 것부터 문장으로. 기준은 전국 — 시군구는 바로 옆 카드에서 따로 비교한다.
export function headline(target, nation, sgg, trend) {
  const t = metrics(target), n = metrics(nation), g = metrics(sgg);
  const bits = [];

  // 나누는 수 = '이 정도 차이는 흔하다' 는 기준. 크게 잡을수록 문장에 잘 안 뽑힌다.
  // 성비는 웬만한 동네가 50±3 안에 들어서, 작게 잡으면 아무 정보 없는 문장이 1등이 된다.
  const cand = [
    { w: Math.abs(t.old - n.old) / 4,
      s: `고령 인구가 ${fmt1(t.old, 1)}%로 전국(${fmt1(n.old, 1)}%)보다 ${t.old >= n.old ? '많습니다' : '적습니다'}` },
    { w: Math.abs(t.single - n.single) / 6,
      s: `혼자 사는 세대가 ${fmt1(t.single, 1)}%로 전국(${fmt1(n.single, 1)}%)보다 ${t.single >= n.single ? '많습니다' : '적습니다'}` },
    { w: Math.abs(t.young - n.young) / 3,
      s: `유소년이 ${fmt1(t.young, 1)}%로 전국(${fmt1(n.young, 1)}%)보다 ${t.young >= n.young ? '많습니다' : '적습니다'}` },
    { w: Math.abs(t.avgAge - n.avgAge) / 3,
      s: `평균연령이 ${fmt1(t.avgAge, 1)}세로 전국(${fmt1(n.avgAge, 1)}세)보다 ${fmt1(Math.abs(t.avgAge - n.avgAge), 1)}세 ${t.avgAge >= n.avgAge ? '많습니다' : '적습니다'}` },
    { w: Math.abs(t.perHousehold - n.perHousehold) / 0.35,
      s: `한 세대에 평균 ${fmt1(t.perHousehold, 2)}명이 살아 전국(${fmt1(n.perHousehold, 2)}명)보다 ${t.perHousehold >= n.perHousehold ? '많습니다' : '적습니다'}` },
    { w: Math.max(0, Math.abs(t.femaleRatio - 50) - 2) / 5,
      s: `여자가 ${fmt1(t.femaleRatio, 1)}%로 남자보다 뚜렷이 ${t.femaleRatio >= 50 ? '많습니다' : '적습니다'}` },
  ].sort((a, b) => b.w - a.w);

  bits.push(cand[0].s);
  if (cand[1] && cand[1].w > 0.45) bits.push(cand[1].s);

  // 같은 시군구 안에서의 위치는 늘 궁금한 값이라 한 마디 붙인다.
  const ageGap = +(t.avgAge - g.avgAge).toFixed(1);
  if (Math.abs(ageGap) >= 1 && sgg.n !== target.n) {
    bits.push(`평균연령은 ${sgg.n} 평균보다 ${Math.abs(ageGap)}세 ${ageGap > 0 ? '많고,' : '적고,'}`);
  }

  if (trend && trend.length > 1) {
    const [y0, v0] = trend[0], [y1, v1] = trend[trend.length - 1];
    const rate = v0 ? ((v1 - v0) / v0) * 100 : 0;
    if (Math.abs(rate) >= 0.5) {
      bits.push(`${y1 - y0}년 사이 인구가 ${fmt1(Math.abs(rate), 1)}% ${rate > 0 ? '늘었습니다' : '줄었습니다'}`);
    }
  }

  // '…보다 많고, …보다 적습니다' 처럼 이어 붙이면 문장이 늘어진다. 두 문장으로 끊는다.
  const head = bits.slice(0, 2).join('. ');
  const tail = bits.slice(2).join(' ');
  return (head + (tail ? `. ${tail}` : '') + '.').replace(/,\.$/, '.').replace(/\s+/g, ' ');
}

// 게이지 한 줄에 필요한 값 — 대상값 + 비교 눈금 + 눈금 범위
export function gaugeRows(target, sgg, sido, nation, siblings) {
  const t = metrics(target), g = metrics(sgg), s = metrics(sido), n = metrics(nation);
  const sibMetrics = siblings.map(metrics);
  return GAUGES.map((def) => {
    const value = t[def.key];
    const marks = [
      { label: sgg.n, v: g[def.key] },
      { label: sido.s, v: s[def.key] },
      { label: '전국', v: n[def.key] },
    ];
    // 눈금 범위는 같은 시군구 동네들의 분포로 잡는다. 그래야 '이 동네가 어디쯤'이 보인다.
    // 다만 최소~최대를 그대로 쓰면 극단값 한 곳(평균연령 70세짜리 동 하나)이 축을 늘려
    // 기준선 셋이 한 점에 뭉친다. 위아래 5%를 잘라 낸 범위를 쓴다.
    const vals = sibMetrics.map((m) => m[def.key]).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    const q = (p) => (vals.length ? vals[Math.min(vals.length - 1, Math.max(0, Math.round((vals.length - 1) * p)))] : value);
    let lo = Math.min(value, q(0.05), ...marks.map((m) => m.v));
    let hi = Math.max(value, q(0.95), ...marks.map((m) => m.v));
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const padding = (hi - lo) * 0.06;
    return { ...def, value, marks, dist: vals, lo: lo - padding, hi: hi + padding };
  });
}
