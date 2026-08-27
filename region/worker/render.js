// render.js — 페이지 HTML 을 만든다.
//
// 서버에서 완성된 HTML 을 내보내는 이유: 이 화면에 필요한 상호작용이 사실상 없다.
// 광고·차트 라이브러리·프레임워크를 걷어내면 남는 건 숫자와 막대뿐이고, 그건 SVG 로
// 미리 그려 보내면 된다. 브라우저가 실행하는 스크립트는 '주소 복사' 버튼 하나뿐이다.
import { CSS } from './style.js';
import { pyramid, stacked, trend, ranking } from './chart.js';
import { toShort } from './code.js';

export const esc = (s) => String(s).replace(/[<>&"']/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
const pct = (a, b) => (b ? (a / b) * 100 : 0);
// '2026-07' → '2026년 7월' (앞자리 0 을 떼야 사람이 읽는 표기가 된다)
export const ym = (m) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
const p1 = (n) => `${n.toFixed(1)}%`;
const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? fmt(n) : '—');

// 군 지역의 하위 단위는 '법정동'이 아니라 읍·면이다. 목록을 보고 부르는 이름을 정한다.
// (원본 사이트가 군에서도 '행정구역'이라고만 써서 무슨 단위인지 알기 어려웠다)
export function unitName(list) {
  const town = list.filter((x) => /[읍면]$/.test(x.n)).length;
  if (town === list.length && town) return '읍·면';
  if (town === 0) return '법정동';
  return '읍·면·동';
}

// 5세 구간 21칸 → 화면용 10세 구간 11칸
const TEN = [[0, 2], [2, 4], [4, 6], [6, 8], [8, 10], [10, 12], [12, 14], [14, 16], [16, 18], [18, 20], [20, 21]];
export const TEN_LABELS = ['0~9세', '10대', '20대', '30대', '40대', '50대', '60대', '70대', '80대', '90대', '100세+'];
const roll = (arr) => TEN.map(([a, b]) => arr.slice(a, b).reduce((x, y) => x + y, 0));

// 페이지에 필요한 파생값을 한 번에 계산한다. 원본 통계에 없는 건 전부 여기서 나온다.
export function derive(r) {
  const g = r.g?.length ? r.g : new Array(21).fill(0);
  const gf = r.gf?.length ? r.gf : new Array(21).fill(0);
  const all = g.map((v, i) => v + gf[i]);
  const sum = (a, from, to) => a.slice(from, to).reduce((x, y) => x + y, 0);
  const m10 = roll(g), f10 = roll(gf), a10 = roll(all);
  const peak = a10.reduce((b, v, i, arr) => (v > arr[b] ? i : b), 0);
  const s = r.s?.length ? r.s : new Array(10).fill(0);
  const hh = { one: s[0] || 0, mid: (s[1] || 0) + (s[2] || 0), big: s.slice(3).reduce((x, y) => x + y, 0) };
  const y = r.y || [];
  const first = y[0], last = y[y.length - 1];
  return {
    m10, f10, a10, peak,
    young: sum(all, 0, 3), work: sum(all, 3, 13), old: sum(all, 13, 21),
    hh, perHousehold: r.h ? r.t / r.h : 0,
    sexRatio: r.f ? r.m / r.f : 0,
    trendPoints: y,
    growth: first && last && first[1] ? ((last[1] - first[1]) / first[1]) * 100 : null,
    growthYears: first && last ? last[0] - first[0] : 0,
  };
}

// ── 문서 뼈대 ────────────────────────────────────────────────────────────────
export function shell({ title, desc, canonical, body, jsonld = [], noindex = false }) {
  return `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
<meta name="theme-color" content="#f7f7f5" media="(prefers-color-scheme:light)">
<meta name="theme-color" content="#131519" media="(prefers-color-scheme:dark)">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%F0%9F%93%8D%3C/text%3E%3C/svg%3E">
<style>${CSS}</style>
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('')}
</head><body>
<header class="top"><div class="in">
  <a class="brand" href="/">인구<span>·</span>동네</a>
  <form class="find" action="/s" role="search">
    <input name="q" type="search" placeholder="동네 이름 (예: 남산동)" aria-label="동네 검색" autocomplete="off">
    <button type="submit">찾기</button>
  </form>
</div></header>
<main class="wrap">${body}</main>
</body></html>`;
}

const crumb = (items) => `<nav class="crumb">${items.map((i) =>
  i.href ? `<a href="${esc(i.href)}">${esc(i.text)}</a>` : `<b>${esc(i.text)}</b>`).join('')}</nav>`;

const footer = (month, extra = '') => `
<h2 class="sec">자료 출처</h2>
<div class="src">
  <p><b>행정안전부 주민등록 인구통계</b> — ${esc(ym(month))} 말일 기준, 매월 갱신.
  공공누리 제1유형(출처표시)으로 제공되는 공공데이터입니다.</p>
  <p>주민등록 인구는 <b>주민등록상 주소지</b> 기준이라, 통계청 인구총조사(실거주지 기준)와는 숫자가 다릅니다.</p>
  ${extra}
  <span class="noads">광고 없음 · 추적 없음 · 외부 스크립트 0개</span>
</div>
<footer>
  <p>원자료: <a href="https://jumin.mois.go.kr" rel="nofollow noopener">jumin.mois.go.kr</a> (행정안전부)</p>
  <p>이 페이지는 공공데이터를 가공해 보여 줄 뿐이며, 행정안전부와 무관합니다.</p>
</footer>`;

const shareBox = (url) => `
<div class="share">
  <code id="su">${esc(url)}</code>
  <button type="button" id="cp">주소 복사</button>
</div>
<script>
document.getElementById('cp').addEventListener('click', function () {
  var t = document.getElementById('su').textContent;
  var done = function () { this.textContent = '복사됨'; }.bind(this);
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(done, function () {});
  else { var s = getSelection(); s.removeAllRanges();
    var r = document.createRange(); r.selectNode(document.getElementById('su')); s.addRange(r); }
});
<\/script>`;

// ── 읍면동 상세 ──────────────────────────────────────────────────────────────
export function dongPage({ dong, sgg, sido, siblings, path, origin, shortUrl, month }) {
  const d = derive(dong);
  const sorted = siblings; // 인구 내림차순으로 미리 정렬돼 있다
  const rank = sorted.findIndex((x) => x.c === dong.c) + 1;
  const sggAvgPop = sorted.length ? Math.round(sgg.t / sorted.length) : 0;
  const idx = rank - 1;
  const near = [sorted[idx - 1], sorted[idx + 1]].filter(Boolean);
  const ageGap = +(dong.a - sgg.a).toFixed(1);
  const unit = unitName(sorted);
  const title = `${sido.s} ${sgg.n} ${dong.n} 인구수 (${ym(month)})`;
  const desc = `${sido.n} ${sgg.n} ${dong.n} 인구 ${fmt(dong.t)}명(남 ${fmt(dong.m)}·여 ${fmt(dong.f)}), `
    + `${fmt(dong.h)}세대, 평균연령 ${dong.a}세. ${sgg.n} ${sorted.length}개 ${unit} 중 ${rank}위. 광고 없는 주민등록 인구통계.`;

  const body = `
${crumb([{ text: '전국', href: '/' }, { text: sido.s, href: `/${sido.s}` },
  { text: sgg.n, href: `/${encodeURIComponent(sido.s)}/${encodeURIComponent(sgg.u)}` }, { text: dong.n }])}
<h1>${esc(sido.n)} ${esc(sgg.n)} ${esc(dong.n)}</h1>
<p class="sub">주민등록 인구통계 · ${esc(ym(month))} 기준</p>

<div class="hero">
  <div class="big">
    <div class="k">총인구</div>
    <div class="v">${fmt(dong.t)}<small>명</small></div>
    <div class="split" style="margin-top:8px">
      <span class="k">남 <b class="m">${fmt(dong.m)}</b></span>
      <span class="k">여 <b class="f">${fmt(dong.f)}</b></span>
      <span class="k">성비 ${d.sexRatio ? d.sexRatio.toFixed(2) : '—'}</span>
    </div>
  </div>
  <div class="cell"><div class="k">평균연령</div><div class="v sm">${dong.a}<small>세</small></div></div>
  <div class="cell"><div class="k">세대수</div><div class="v sm">${fmt(dong.h)}<small>세대</small></div></div>
</div>

<h2 class="sec">인구 현황</h2>

<div class="card">
  <h3>성별·연령대별 인구<em>10세 구간 · 단위 명</em></h3>
  ${pyramid(TEN_LABELS, d.m10, d.f10)}
  <div class="legend"><span><i class="m"></i>남 ${fmt(dong.m)}</span><span><i class="f"></i>여 ${fmt(dong.f)}</span></div>
  <p class="note">${esc(TEN_LABELS[d.peak])}가 ${fmt(d.a10[d.peak])}명으로 가장 많습니다.</p>
</div>

<div class="card">
  <h3>연령 구성<em>단위 %</em></h3>
  ${stacked([
    { value: d.young, cls: 'young' }, { value: d.work, cls: 'work' }, { value: d.old, cls: 'old' },
  ])}
  <div class="legend">
    <span><i class="young"></i>유소년(0~14세) ${p1(pct(d.young, dong.t))}</span>
    <span><i class="work"></i>생산연령(15~64세) ${p1(pct(d.work, dong.t))}</span>
    <span><i class="old"></i>고령(65세 이상) ${p1(pct(d.old, dong.t))}</span>
  </div>
  <p class="note">고령 인구가 ${p1(pct(d.old, dong.t))}로, 유소년 인구(${p1(pct(d.young, dong.t))})의
    ${d.young ? (d.old / d.young).toFixed(1) : '—'}배입니다.</p>
</div>

<div class="card">
  <h3>세대 구성<em>${fmt(dong.h)}세대 · 세대당 ${d.perHousehold.toFixed(2)}명</em></h3>
  ${stacked([{ value: d.hh.one, cls: 's1' }, { value: d.hh.mid, cls: 's2' }, { value: d.hh.big, cls: 's3' }])}
  <div class="legend">
    <span><i class="s1"></i>1인 ${p1(pct(d.hh.one, dong.h))}</span>
    <span><i class="s2"></i>2~3인 ${p1(pct(d.hh.mid, dong.h))}</span>
    <span><i class="s3"></i>4인 이상 ${p1(pct(d.hh.big, dong.h))}</span>
  </div>
  <p class="unit">세대원 수별 상세 · 단위 세대</p>
  <table><thead><tr><th>세대원 수</th><th>세대수</th><th>비중</th></tr></thead><tbody>
  ${[1, 2, 3, 4].map((k) => `<tr><td>${k}인 세대</td><td>${fmt(dong.s[k - 1])}</td><td>${p1(pct(dong.s[k - 1], dong.h))}</td></tr>`).join('')}
  <tr><td>5인 이상</td><td>${fmt(dong.s.slice(4).reduce((a, b) => a + b, 0))}</td><td>${p1(pct(dong.s.slice(4).reduce((a, b) => a + b, 0), dong.h))}</td></tr>
  </tbody></table>
  <p class="note">혼자 사는 세대가 ${p1(pct(d.hh.one, dong.h))}이고, 한 세대에 평균 ${d.perHousehold.toFixed(2)}명이 삽니다.</p>
</div>

<h2 class="sec">${esc(sgg.n)} 안에서</h2>

<div class="card">
  <h3>인구 순위<em>${esc(sgg.n)} ${sorted.length}개 ${unit} 중 ${rank}위</em></h3>
  ${ranking(sorted, dong.c)}
  <p class="unit">비교 · 단위 명</p>
  <table><thead><tr><th>구분</th><th>인구수</th><th>평균연령</th></tr></thead><tbody>
    <tr class="me"><td>${esc(dong.n)}</td><td>${fmt(dong.t)}</td><td>${dong.a}세</td></tr>
    <tr><td>${esc(sgg.n)} ${unit} 평균</td><td>${fmt(sggAvgPop)}</td><td>${sgg.a}세</td></tr>
    <tr><td>${esc(sgg.n)} 전체</td><td>${fmt(sgg.t)}</td><td>${sgg.a}세</td></tr>
    <tr><td>${esc(sido.n)} 전체</td><td>${fmt(sido.t)}</td><td>${sido.a}세</td></tr>
  </tbody></table>
  <p class="note">평균연령이 ${esc(sgg.n)} 평균보다 ${Math.abs(ageGap)}세 ${ageGap >= 0 ? '높습니다' : '낮습니다'}.</p>
</div>

${near.length ? `<div class="card">
  <h3>비슷한 규모 동네<em>인구가 가장 가까운 곳</em></h3>
  <table><thead><tr><th>동네</th><th>인구수</th><th>평균연령</th></tr></thead><tbody>
  ${[sorted[idx - 1], dong, sorted[idx + 1]].filter(Boolean).map((x) => x.c === dong.c
    ? `<tr class="me"><td>${esc(x.n)}</td><td>${fmt(x.t)}</td><td>${x.a}세</td></tr>`
    : `<tr><td><a href="/${encodeURIComponent(sido.s)}/${encodeURIComponent(sgg.u)}/${encodeURIComponent(x.n)}">${esc(x.n)}</a></td><td>${fmt(x.t)}</td><td>${x.a}세</td></tr>`).join('')}
  </tbody></table>
</div>` : ''}

${dong.ri?.length ? `<div class="card">
  <h3>법정리 ${dong.ri.length}곳<em>${esc(dong.n)} 안에서 · 인구 많은 순</em></h3>
  <div class="chips">${dong.ri.map(([nm, t]) =>
    `<span style="padding:6px 12px;border:1px solid var(--line);border-radius:999px;font-size:14px"><b>${esc(nm)}</b> <span style="color:var(--mut);font-size:12.5px">${fmt(t)}</span></span>`).join('')}</div>
  <p class="note">주민등록 통계는 읍·면을 법정리 단위로 집계합니다. 위 숫자는 ${dong.ri.length}개 리를 합한 값입니다.</p>
</div>` : ''}

${d.trendPoints.length > 1 ? `
<h2 class="sec">인구 변화</h2>
<div class="card">
  <h3>연도별 추이<em>매년 ${Number(month.slice(5))}월 기준 · 단위 명</em></h3>
  ${trend(d.trendPoints)}
  <table><thead><tr><th>연월</th><th>인구수</th><th>전년 대비</th></tr></thead><tbody>
  ${[...d.trendPoints].reverse().map(([yr, v], i, arr) => {
    const prev = arr[i + 1];
    const diff = prev ? v - prev[1] : null;
    const cls = diff == null ? '' : diff > 0 ? ' class="up"' : diff < 0 ? ' class="down"' : '';
    return `<tr><td>${yr}년 ${Number(month.slice(5))}월</td><td>${fmt(v)}</td><td${cls}>${diff == null ? '—' : signed(diff)}</td></tr>`;
  }).join('')}
  </tbody></table>
  ${d.growth == null ? '' : `<p class="note">${d.growthYears}년 동안 ${Math.abs(d.growth).toFixed(1)}%
    ${d.growth >= 0 ? '늘었습니다' : '줄었습니다'} (${signed(d.trendPoints.at(-1)[1] - d.trendPoints[0][1])}명).</p>`}
</div>` : ''}

<h2 class="sec">${esc(sgg.n)}의 다른 동네</h2>
<div class="card">
  <h3>${unit} ${sorted.length}곳<em>인구 많은 순</em></h3>
  <div class="chips">${sorted.filter((x) => x.c !== dong.c).slice(0, 40).map((x) =>
    `<a href="/${encodeURIComponent(sido.s)}/${encodeURIComponent(sgg.u)}/${encodeURIComponent(x.n)}"><b>${esc(x.n)}</b><span>${fmt(x.t)}</span></a>`).join('')}</div>
  ${sorted.length > 41 ? `<p class="unit"><a href="/${encodeURIComponent(sido.s)}/${encodeURIComponent(sgg.u)}" style="color:var(--acc)">${esc(sgg.n)} 전체 보기 →</a></p>` : ''}
</div>

<h2 class="sec">짧은 주소</h2>
<div class="card">
  <h3>이 페이지 공유<em>Cloudflare 에서 바로 펼쳐집니다</em></h3>
  ${shareBox(shortUrl)}
  <p class="unit">긴 주소도 그대로 동작합니다 — <code style="background:none;border:0;padding:0">${esc(origin + decodeURIComponent(path))}</code></p>
</div>

<h2 class="sec">자주 묻는 질문</h2>
<div class="card">
${faqBlocks(dong, sgg, sido, d, rank, sorted.length, month, unit).map((f) =>
  `<details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}
</div>

${footer(month, `<p>${esc(dong.n)}의 법정동코드는 <b>${dong.c}</b> 입니다.</p>`)}`;

  const faqs = faqBlocks(dong, sgg, sido, d, rank, sorted.length, month, unit);
  return shell({
    title: `${title} | 인구·동네`,
    desc, canonical: origin + path, body,
    jsonld: [
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        ['전국', '/'], [sido.s, `/${sido.s}`], [sgg.n, `/${encodeURIComponent(sido.s)}/${encodeURIComponent(sgg.u)}`], [dong.n, path],
      ].map(([n, u], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: origin + u })) },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map((f) => ({
        '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    ],
  });
}

function faqBlocks(dong, sgg, sido, d, rank, total, month, unit = '법정동') {
  const when = ym(month);
  return [
    { q: `${sido.n} ${sgg.n} ${dong.n} 인구는 몇 명인가요?`,
      a: `${when} 기준 ${fmt(dong.t)}명입니다. 남자 ${fmt(dong.m)}명, 여자 ${fmt(dong.f)}명입니다.` },
    { q: `${dong.n}은 ${sgg.n}에서 몇 번째로 인구가 많나요?`,
      a: `${sgg.n}의 ${unit} ${total}곳 가운데 ${rank}번째입니다.` },
    { q: `${dong.n} 평균연령은 몇 살인가요?`,
      a: `${dong.a}세입니다(남자 ${dong.am}세, 여자 ${dong.af}세). ${sgg.n} 평균 ${sgg.a}세와 ${Math.abs(+(dong.a - sgg.a).toFixed(1))}세 차이입니다.` },
    { q: `${dong.n} 세대수는 몇 세대인가요?`,
      a: `${fmt(dong.h)}세대입니다. 세대당 인구는 ${d.perHousehold.toFixed(2)}명이고, 1인 세대 비중은 ${p1(pct(d.hh.one, dong.h))}입니다.` },
    { q: '이 통계는 어디 자료인가요?',
      a: `행정안전부 주민등록 인구통계입니다. ${when} 말일 기준이며 매월 갱신됩니다. 공공누리 제1유형으로 제공됩니다.` },
    { q: '주민등록 인구와 인구총조사 인구는 왜 다른가요?',
      a: '주민등록 인구는 주민등록상 주소지 기준이고, 통계청 인구총조사는 실제 거주지 기준입니다. 대학가·산업단지처럼 주소를 옮기지 않고 사는 사람이 많은 곳은 두 숫자가 크게 벌어집니다.' },
  ];
}

// ── 시군구 ───────────────────────────────────────────────────────────────────
export function sggPage({ sgg, sido, dongs, origin, path, month }) {
  const d = derive(sgg);
  const unit = unitName(dongs);
  const avg = dongs.length ? Math.round(sgg.t / dongs.length) : 0;
  const title = `${sido.n} ${sgg.n} 인구 통계`;
  const desc = `${sido.n} ${sgg.n} 인구 ${fmt(sgg.t)}명, ${fmt(sgg.h)}세대, 평균연령 ${sgg.a}세. ${unit} ${dongs.length}곳의 인구를 광고 없이 봅니다.`;
  const body = `
${crumb([{ text: '전국', href: '/' }, { text: sido.s, href: `/${sido.s}` }, { text: sgg.n }])}
<h1>${esc(sido.n)} ${esc(sgg.n)}</h1>
<p class="sub">주민등록 인구통계 · ${esc(ym(month))} 기준 · ${unit} ${dongs.length}곳</p>
<div class="hero">
  <div class="big"><div class="k">총인구</div><div class="v">${fmt(sgg.t)}<small>명</small></div>
    <div class="split" style="margin-top:8px"><span class="k">남 <b class="m">${fmt(sgg.m)}</b></span>
    <span class="k">여 <b class="f">${fmt(sgg.f)}</b></span></div></div>
  <div class="cell"><div class="k">평균연령</div><div class="v sm">${sgg.a}<small>세</small></div></div>
  <div class="cell"><div class="k">세대수</div><div class="v sm">${fmt(sgg.h)}<small>세대</small></div></div>
</div>

<div class="card">
  <h3>성별·연령대별 인구<em>10세 구간 · 단위 명</em></h3>
  ${pyramid(TEN_LABELS, d.m10, d.f10)}
</div>
<div class="card">
  <h3>연령 구성<em>단위 %</em></h3>
  ${stacked([{ value: d.young, cls: 'young' }, { value: d.work, cls: 'work' }, { value: d.old, cls: 'old' }])}
  <div class="legend"><span><i class="young"></i>유소년 ${p1(pct(d.young, sgg.t))}</span>
  <span><i class="work"></i>생산연령 ${p1(pct(d.work, sgg.t))}</span>
  <span><i class="old"></i>고령 ${p1(pct(d.old, sgg.t))}</span></div>
</div>
${d.trendPoints.length > 1 ? `<div class="card"><h3>연도별 추이<em>단위 명</em></h3>${trend(d.trendPoints)}</div>` : ''}

<h2 class="sec">${unit} ${dongs.length}곳</h2>
<div class="card">
  <h3>인구 많은 순<em>평균 ${fmt(avg)}명</em></h3>
  <table><thead><tr><th>순위</th><th>${unit}</th><th>인구수</th><th>세대수</th><th>평균연령</th></tr></thead><tbody>
  ${dongs.map((x, i) => `<tr><td style="text-align:left;color:var(--mut)">${i + 1}</td>
    <td><a href="/${encodeURIComponent(sido.s)}/${encodeURIComponent(sgg.u)}/${encodeURIComponent(x.n)}" style="color:var(--acc)">${esc(x.n)}</a></td>
    <td>${fmt(x.t)}</td><td>${fmt(x.h)}</td><td>${x.a}세</td></tr>`).join('')}
  </tbody></table>
</div>
${footer(month)}`;
  return shell({ title: `${title} | 인구·동네`, desc, canonical: origin + path, body,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement:
      [['전국', '/'], [sido.s, `/${sido.s}`], [sgg.n, path]].map(([n, u], i) =>
        ({ '@type': 'ListItem', position: i + 1, name: n, item: origin + u })) }] });
}

// ── 일반구를 둔 시(수원·성남 등) ─────────────────────────────────────────────
// 이런 시는 밑에 동이 아니라 구가 달린다. 동 목록 대신 구 목록을 보여 준다.
export function cityPage({ sgg, sido, gus, origin, path, month }) {
  const d = derive(sgg);
  const desc = `${sido.n} ${sgg.n} 인구 ${fmt(sgg.t)}명, ${fmt(sgg.h)}세대, 평균연령 ${sgg.a}세. 일반구 ${gus.length}곳.`;
  const body = `
${crumb([{ text: '전국', href: '/' }, { text: sido.s, href: `/${encodeURIComponent(sido.s)}` }, { text: sgg.n }])}
<h1>${esc(sido.n)} ${esc(sgg.n)}</h1>
<p class="sub">주민등록 인구통계 · ${esc(ym(month))} 기준 · 일반구 ${gus.length}곳</p>
<div class="hero">
  <div class="big"><div class="k">총인구</div><div class="v">${fmt(sgg.t)}<small>명</small></div>
    <div class="split" style="margin-top:8px"><span class="k">남 <b class="m">${fmt(sgg.m)}</b></span>
    <span class="k">여 <b class="f">${fmt(sgg.f)}</b></span></div></div>
  <div class="cell"><div class="k">평균연령</div><div class="v sm">${sgg.a}<small>세</small></div></div>
  <div class="cell"><div class="k">세대수</div><div class="v sm">${fmt(sgg.h)}<small>세대</small></div></div>
</div>
<div class="card">
  <h3>성별·연령대별 인구<em>10세 구간 · 단위 명</em></h3>
  ${pyramid(TEN_LABELS, d.m10, d.f10)}
</div>
<div class="card">
  <h3>구별 인구<em>${esc(sgg.n)} 안</em></h3>
  <table><thead><tr><th>구</th><th>인구수</th><th>세대수</th><th>평균연령</th></tr></thead><tbody>
  ${[...gus].sort((a, b) => b.t - a.t).map((g) => `<tr>
    <td><a href="/${encodeURIComponent(sido.s)}/${encodeURIComponent(g.u)}" style="color:var(--acc)">${esc(g.u)}</a></td>
    <td>${fmt(g.t)}</td><td>${fmt(g.h)}</td><td>${g.a}세</td></tr>`).join('')}
  </tbody></table>
  <p class="note">법정동 단위 인구는 각 구 페이지에서 볼 수 있습니다.</p>
</div>
${footer(month)}`;
  return shell({ title: `${sido.n} ${sgg.n} 인구 통계 | 인구·동네`, desc, canonical: origin + path, body });
}

// ── 시도 ─────────────────────────────────────────────────────────────────────
export function sidoPage({ sido, sggs, origin, path, month }) {
  // 수원시와 수원시 장안구가 표에 함께 있으면 인구가 두 번 세어진 것처럼 보인다.
  // 표에는 실제 단위(구)만 넣고, 시는 따로 칩으로 건다.
  const cities = sggs.filter((g) => g.k?.length);
  const leaves = sggs.filter((g) => !g.k?.length);
  const desc = `${sido.n} 인구 ${fmt(sido.t)}명, 시군구 ${leaves.length}곳. 광고 없는 주민등록 인구통계.`;
  const body = `
${crumb([{ text: '전국', href: '/' }, { text: sido.s }])}
<h1>${esc(sido.n)}</h1>
<p class="sub">주민등록 인구통계 · ${esc(ym(month))} 기준 · 시군구 ${leaves.length}곳</p>
<div class="hero">
  <div class="big"><div class="k">총인구</div><div class="v">${fmt(sido.t)}<small>명</small></div></div>
  <div class="cell"><div class="k">평균연령</div><div class="v sm">${sido.a}<small>세</small></div></div>
  <div class="cell"><div class="k">세대수</div><div class="v sm">${fmt(sido.h)}<small>세대</small></div></div>
</div>
${cities.length ? `<div class="card">
  <h3>일반구를 둔 시<em>${cities.length}곳</em></h3>
  <div class="chips">${[...cities].sort((a, b) => b.t - a.t).map((x) =>
    `<a href="/${encodeURIComponent(sido.s)}/${encodeURIComponent(x.u)}"><b>${esc(x.u)}</b><span>${fmt(x.t)}</span></a>`).join('')}</div>
</div>` : ''}
<div class="card">
  <h3>시군구별 인구<em>인구 많은 순</em></h3>
  <table><thead><tr><th>순위</th><th>시군구</th><th>인구수</th><th>세대수</th><th>평균연령</th></tr></thead><tbody>
  ${[...leaves].sort((a, b) => b.t - a.t).map((x, i) => `<tr><td style="text-align:left;color:var(--mut)">${i + 1}</td>
    <td><a href="/${encodeURIComponent(sido.s)}/${encodeURIComponent(x.u)}" style="color:var(--acc)">${esc(x.n)}</a></td>
    <td>${fmt(x.t)}</td><td>${fmt(x.h)}</td><td>${x.a}세</td></tr>`).join('')}
  </tbody></table>
</div>
${footer(month)}`;
  return shell({ title: `${sido.n} 인구 통계 | 인구·동네`, desc, canonical: origin + path, body });
}

// ── 전국 ─────────────────────────────────────────────────────────────────────
export function homePage({ index, origin, month }) {
  const n = index.nation;
  const body = `
<h1 style="margin-top:26px">우리 동네 인구, 광고 없이</h1>
<p class="sub">행정안전부 주민등록 인구통계를 법정동 단위까지 그대로 보여 줍니다.
  ${esc(ym(month))} 기준 · 읍면동 ${fmt(index.sgg.reduce((a, s) => a + s.d, 0))}곳.</p>
<div class="hero">
  <div class="big"><div class="k">전국 인구</div><div class="v">${fmt(n.t)}<small>명</small></div>
    <div class="split" style="margin-top:8px"><span class="k">남 <b class="m">${fmt(n.m)}</b></span>
    <span class="k">여 <b class="f">${fmt(n.f)}</b></span></div></div>
  <div class="cell"><div class="k">평균연령</div><div class="v sm">${n.a}<small>세</small></div></div>
  <div class="cell"><div class="k">세대수</div><div class="v sm">${fmt(n.h)}<small>세대</small></div></div>
</div>
<div class="card">
  <h3>시도 고르기<em>${index.sido.length}곳</em></h3>
  <div class="chips">${index.sido.map((s) =>
    `<a href="/${encodeURIComponent(s.s)}"><b>${esc(s.s)}</b><span>${fmt(s.t)}</span></a>`).join('')}</div>
</div>
<div class="card">
  <h3>주소가 짧습니다<em>공유하기 편하라고</em></h3>
  <table><tbody>
    <tr><td style="color:var(--mut)">동네</td><td style="text-align:left"><code>/대구/중구/남산동</code></td></tr>
    <tr><td style="color:var(--mut)">더 짧게</td><td style="text-align:left"><code>/중구/남산동</code> · <code>/남산동</code></td></tr>
    <tr><td style="color:var(--mut)">가장 짧게</td><td style="text-align:left"><code>/c/${toShort('2711015600')}</code> (법정동코드)</td></tr>
    <tr><td style="color:var(--mut)">JSON</td><td style="text-align:left"><code>/api/대구/중구/남산동</code></td></tr>
  </tbody></table>
  <p class="note">이름만으로 찾을 수 있으면 시도·시군구를 생략해도 됩니다. 겹치면 후보를 보여 줍니다.</p>
</div>
${footer(month)}`;
  return shell({ title: '인구·동네 — 광고 없는 우리 동네 인구 통계',
    desc: `행정안전부 주민등록 인구통계를 법정동 단위로. 광고·추적 없이 ${fmt(index.sgg.reduce((a, s) => a + s.d, 0))}개 동네의 인구·세대·연령을 봅니다.`,
    canonical: origin + '/', body });
}

// ── 검색 / 후보 목록 ─────────────────────────────────────────────────────────
export function listPage({ heading, sub, items, origin, month, query = '' }) {
  const body = `
${crumb([{ text: '전국', href: '/' }, { text: heading }])}
<h1>${esc(heading)}</h1>
<p class="sub">${esc(sub)}</p>
<div class="card">
  ${items.length ? `<table><thead><tr><th>동네</th><th>인구수</th><th>평균연령</th></tr></thead><tbody>
  ${items.map((x) => `<tr><td><a href="${esc(x.href)}" style="color:var(--acc)">${esc(x.label)}</a></td>
    <td>${fmt(x.t)}</td><td>${x.a}세</td></tr>`).join('')}</tbody></table>`
    : `<p style="color:var(--mut);margin:0">찾는 이름이 없습니다. 법정동 이름 전체(예: <b>남산동</b>)로 다시 검색해 보세요.</p>`}
</div>
${footer(month)}`;
  return shell({ title: `${heading} | 인구·동네`, desc: sub, body, noindex: true,
    canonical: query ? '' : origin });
}

export function errorPage({ code, message, month }) {
  const body = `<h1 style="margin-top:40px">${code}</h1><p class="sub">${esc(message)}</p>
  <div class="card"><p style="margin:0"><a href="/" style="color:var(--acc)">전국 목록으로 →</a></p></div>
  ${month ? footer(month) : ''}`;
  return shell({ title: `${code} | 인구·동네`, desc: message, body, noindex: true });
}
