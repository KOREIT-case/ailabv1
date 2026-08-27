// render.js — 페이지 HTML 을 만든다.
//
// 서버에서 완성된 HTML 을 내보낸다. 이 화면에 필요한 상호작용이 사실상 없기 때문이다.
// 광고·차트 라이브러리·프레임워크를 걷어내면 남는 건 숫자와 막대뿐이고, 그건 SVG 로
// 미리 그려 보내면 된다. 브라우저가 실행하는 스크립트는 '주소 복사' 버튼 하나뿐이다.
//
// 배치 원칙(대시보드):
//   · 맨 위 한 줄이 이 동네가 어떤 곳인지 문장으로 답한다(insight.js).
//   · 지표 카드 넉 장이 핵심 숫자를 들고, 그 옆 게이지가 '전국·시도·시군구 대비
//     어디쯤'을 보여 준다. 숫자 하나만 덩그러니 두면 많은 건지 적은 건지 알 수 없다.
//   · 넓은 화면에서는 두 단으로 접어 스크롤을 줄인다.
import { CSS } from './style.js';
import { pyramid, stacked, trend, ranking, gauge, facing } from './chart.js';
import { toShort } from './code.js';
import { metrics, headline, gaugeRows } from './insight.js';

export const esc = (s) => String(s).replace(/[<>&"']/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const p1 = (n) => `${n.toFixed(1)}%`;
const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? fmt(n) : '—');
export const ym = (m) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
const U = encodeURIComponent;

// 군 지역의 하위 단위는 '법정동'이 아니라 읍·면이다. 목록을 보고 부르는 이름을 정한다.
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

export function derive(r) {
  const g = r.g?.length ? r.g : new Array(21).fill(0);
  const gf = r.gf?.length ? r.gf : new Array(21).fill(0);
  const all = g.map((v, i) => v + gf[i]);
  const sum = (a, from, to) => a.slice(from, to).reduce((x, y) => x + y, 0);
  const m10 = roll(g), f10 = roll(gf), a10 = roll(all);
  const s = r.hs?.length ? r.hs : new Array(10).fill(0);
  const y = r.y || [];
  const first = y[0], last = y[y.length - 1];
  return {
    m10, f10, a10, peak: a10.reduce((b, v, i, arr) => (v > arr[b] ? i : b), 0),
    young: sum(all, 0, 3), work: sum(all, 3, 13), old: sum(all, 13, 21),
    hh: { one: s[0] || 0, mid: (s[1] || 0) + (s[2] || 0), big: s.slice(3).reduce((x, y2) => x + y2, 0) },
    perHousehold: r.h ? r.t / r.h : 0,
    trendPoints: y,
    growth: first && last && first[1] ? ((last[1] - first[1]) / first[1]) * 100 : null,
    growthYears: first && last ? last[0] - first[0] : 0,
  };
}

// ── 문서 뼈대 ────────────────────────────────────────────────────────────────
export function shell({ title, desc, canonical, body, jsonld = [], noindex = false, ogImage = '' }) {
  return `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}"><meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">` : ''}
<meta name="theme-color" content="#f6f6f4" media="(prefers-color-scheme:light)">
<meta name="theme-color" content="#111317" media="(prefers-color-scheme:dark)">
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

const COPY_JS = `<script>
document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-copy]'); if (!b) return;
  var t = document.getElementById(b.getAttribute('data-copy')).textContent;
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { b.textContent = '복사됨'; }, function () {});
});
<\/script>`;

const shareBox = (short, long) => `
<div class="share">
  <code id="su">${esc(short)}</code>
  <button type="button" data-copy="su">주소 복사</button>
</div>
<p class="unit">긴 주소도 그대로 동작합니다 — ${esc(long)}</p>${COPY_JS}`;

const kpi = (k, v, unit, sub) => `<div class="kpi">
  <div class="k">${k}</div><div class="v">${v}${unit ? `<small>${unit}</small>` : ''}</div>
  <div class="sub2">${sub}</div></div>`;

// ── 읍면동 상세 ──────────────────────────────────────────────────────────────
export function dongPage({ dong, sgg, sido, nation, siblings, path, origin, shortUrl, month }) {
  const d = derive(dong);
  const mSelf = metrics(dong), mSgg = metrics(sgg), mNation = metrics(nation);
  const sorted = siblings;
  const rank = sorted.findIndex((x) => x.c === dong.c) + 1;
  const idx = rank - 1;
  const near = [sorted[idx - 1], sorted[idx + 1]].filter(Boolean);
  const unit = unitName(sorted);
  const lede = headline(dong, nation, sgg, d.trendPoints);
  const rows = gaugeRows(dong, sgg, sido, nation, sorted);
  const ageGap = +(dong.a - sgg.a).toFixed(1);
  const cmpSgg = derive(sgg);

  const title = `${sido.s} ${sgg.n} ${dong.n} 인구수 (${ym(month)})`;
  const desc = `인구 ${fmt(dong.t)}명(남 ${fmt(dong.m)}·여 ${fmt(dong.f)}), ${fmt(dong.h)}세대, 평균연령 ${dong.a}세. `
    + `${sgg.n} ${sorted.length}개 ${unit} 중 ${rank}위. 광고 없는 주민등록 인구통계.`;
  const faqs = faqBlocks(dong, sgg, sido, d, rank, sorted.length, month, unit);

  const body = `
${crumb([{ text: '전국', href: '/' }, { text: sido.s, href: `/${U(sido.s)}` },
  { text: sgg.n, href: `/${U(sido.s)}/${U(sgg.u)}` }, { text: dong.n }])}
<div class="head">
  <h1><span class="sm">${esc(sido.n)} ${esc(sgg.n)}</span>${esc(dong.n)}</h1>
  <p class="stamp">주민등록 인구통계 · ${esc(ym(month))} 기준 · 법정동코드 ${dong.c}</p>
  <p class="lede">${esc(lede)}</p>
</div>

<div class="kpis">
  ${kpi('총인구', fmt(dong.t), '명', `남 <span class="m">${fmt(dong.m)}</span> · 여 <span class="f">${fmt(dong.f)}</span>`)}
  ${kpi('평균연령', dong.a, '세', `${esc(sgg.n)} <b>${sgg.a}</b> · 전국 <b>${nation.a}</b>`)}
  ${kpi('세대수', fmt(dong.h), '세대', `세대당 <b>${d.perHousehold.toFixed(2)}명</b>`)}
  ${kpi('1인 세대', p1(mSelf.single), '', `${fmt(d.hh.one)}세대 · 전국 <b>${p1(mNation.single)}</b>`)}
</div>

<div class="grid">
  <div class="card tall">
    <h3>성별·연령대별 인구<em>10세 구간 · 단위 명</em></h3>
    ${pyramid(TEN_LABELS, d.m10, d.f10, { male: cmpSgg.m10, female: cmpSgg.f10 })}
    <div class="legend">
      <span><i class="m"></i>남 ${fmt(dong.m)}</span><span><i class="f"></i>여 ${fmt(dong.f)}</span>
      <span><i class="dash"></i>${esc(sgg.n)} 평균 분포(같은 인구로 환산)</span>
    </div>
    <p class="note"><b>${esc(TEN_LABELS[d.peak])}</b>가 ${fmt(d.a10[d.peak])}명으로 가장 많습니다.
      점선보다 막대가 길게 나온 구간이 이 동네에 유난히 많은 나이대입니다.</p>
  </div>

  <div class="card">
    <h3>기준 대비 위치<em>같은 ${esc(sgg.n)} ${unit} 분포 위에서</em></h3>
    <div class="gauges">
      ${rows.map((r) => `<div class="row">
        <div class="g-lab"><b>${esc(r.label)}</b><span>${r.marks.map((m) =>
          `${esc(m.label)} ${m.v.toFixed(r.digits)}${esc(r.unit)}`).join(' · ')}</span></div>
        ${gauge(r)}
      </div>`).join('')}
    </div>
    <p class="note">가로줄은 ${esc(sgg.n)} 안 ${unit} ${sorted.length}곳이 퍼져 있는 범위입니다.
      동그라미가 이 동네, 세로 눈금이 비교 기준입니다.</p>
  </div>

  <div class="card">
    <h3>연령 구성<em>단위 %</em></h3>
    ${stacked([{ value: d.young, cls: 'young' }, { value: d.work, cls: 'work' }, { value: d.old, cls: 'old' }])}
    <div class="legend">
      <span><i class="young"></i>유소년 0~14세 ${p1(mSelf.young)}</span>
      <span><i class="work"></i>생산연령 15~64세 ${p1(mSelf.working)}</span>
      <span><i class="old"></i>고령 65세+ ${p1(mSelf.old)}</span>
    </div>
    <p class="unit">전국 견줌</p>
    ${stacked([{ value: mNation.young, cls: 'young' }, { value: mNation.working, cls: 'work' }, { value: mNation.old, cls: 'old' }], { compact: true })}
    <p class="note">고령 인구가 유소년의 <b>${mSelf.young ? (mSelf.old / mSelf.young).toFixed(1) : '—'}배</b>입니다
      (전국 ${(mNation.old / mNation.young).toFixed(1)}배).</p>
  </div>

  <div class="card">
    <h3>세대 구성<em>${fmt(dong.h)}세대 · 세대당 ${d.perHousehold.toFixed(2)}명</em></h3>
    ${stacked([{ value: d.hh.one, cls: 's1' }, { value: d.hh.mid, cls: 's2' }, { value: d.hh.big, cls: 's3' }])}
    <div class="legend">
      <span><i class="s1"></i>1인 ${p1(pct(d.hh.one, dong.h))}</span>
      <span><i class="s2"></i>2~3인 ${p1(pct(d.hh.mid, dong.h))}</span>
      <span><i class="s3"></i>4인 이상 ${p1(pct(d.hh.big, dong.h))}</span>
    </div>
    <table><thead><tr><th>세대원 수</th><th>세대수</th><th>비중</th><th>전국 비중</th></tr></thead><tbody>
    ${[1, 2, 3, 4].map((k) => `<tr><td>${k}인</td><td>${fmt(dong.hs[k - 1])}</td>
      <td>${p1(pct(dong.hs[k - 1], dong.h))}</td>
      <td style="color:var(--mut2)">${p1(pct(nation.hs[k - 1], nation.h))}</td></tr>`).join('')}
    <tr><td>5인 이상</td><td>${fmt(dong.hs.slice(4).reduce((a, b) => a + b, 0))}</td>
      <td>${p1(pct(dong.hs.slice(4).reduce((a, b) => a + b, 0), dong.h))}</td>
      <td style="color:var(--mut2)">${p1(pct(nation.hs.slice(4).reduce((a, b) => a + b, 0), nation.h))}</td></tr>
    </tbody></table>
  </div>

  <div class="card wide">
    <h3>${esc(sgg.n)} 안에서<em>${sorted.length}개 ${unit} 중 ${rank}위</em></h3>
    <div class="cols"><div>
    ${ranking(sorted, dong.c)}
    </div><div>
    <p class="unit">비교 · 단위 명</p>
    <table><thead><tr><th>구분</th><th>인구수</th><th>세대수</th><th>평균연령</th><th>1인 세대</th></tr></thead><tbody>
      <tr class="me"><td>${esc(dong.n)}</td><td>${fmt(dong.t)}</td><td>${fmt(dong.h)}</td><td>${dong.a}세</td><td>${p1(mSelf.single)}</td></tr>
      <tr><td>${esc(sgg.n)} 전체</td><td>${fmt(sgg.t)}</td><td>${fmt(sgg.h)}</td><td>${sgg.a}세</td><td>${p1(mSgg.single)}</td></tr>
      <tr><td>${esc(sido.n)} 전체</td><td>${fmt(sido.t)}</td><td>${fmt(sido.h)}</td><td>${sido.a}세</td><td>${p1(metrics(sido).single)}</td></tr>
      <tr><td>전국</td><td>${fmt(nation.t)}</td><td>${fmt(nation.h)}</td><td>${nation.a}세</td><td>${p1(mNation.single)}</td></tr>
    </tbody></table>
    <p class="note">평균연령이 ${esc(sgg.n)} 평균보다 <b>${Math.abs(ageGap)}세 ${ageGap >= 0 ? '많습니다' : '적습니다'}</b>.</p>
    </div></div>
  </div>

  ${d.trendPoints.length > 1 ? `<div class="card">
    <h3>인구 변화<em>매년 ${Number(month.slice(5))}월 기준 · 단위 명</em></h3>
    ${trend(d.trendPoints)}
    <table><thead><tr><th>연월</th><th>인구수</th><th>전년 대비</th></tr></thead><tbody>
    ${[...d.trendPoints].reverse().map(([yr, v], i, arr) => {
      const prev = arr[i + 1];
      const diff = prev ? v - prev[1] : null;
      const cls = diff == null ? '' : diff > 0 ? ' class="up"' : diff < 0 ? ' class="down"' : '';
      return `<tr><td>${yr}년 ${Number(month.slice(5))}월</td><td>${fmt(v)}</td><td${cls}>${diff == null ? '—' : signed(diff)}</td></tr>`;
    }).join('')}
    </tbody></table>
    ${d.growth == null ? '' : `<p class="note">${d.growthYears}년 동안 <b>${Math.abs(d.growth).toFixed(1)}%
      ${d.growth >= 0 ? '늘었습니다' : '줄었습니다'}</b> (${signed(d.trendPoints.at(-1)[1] - d.trendPoints[0][1])}명).</p>`}
  </div>` : ''}

  ${near.length ? `<div class="card">
    <h3>비슷한 규모 동네<em>인구가 가장 가까운 곳</em></h3>
    <table><thead><tr><th>동네</th><th>인구수</th><th>평균연령</th><th></th></tr></thead><tbody>
    ${[sorted[idx - 1], dong, sorted[idx + 1]].filter(Boolean).map((x) => x.c === dong.c
      ? `<tr class="me"><td>${esc(x.n)}</td><td>${fmt(x.t)}</td><td>${x.a}세</td><td></td></tr>`
      : `<tr><td><a href="/${U(sido.s)}/${U(sgg.u)}/${U(x.n)}">${esc(x.n)}</a></td><td>${fmt(x.t)}</td><td>${x.a}세</td>
         <td><a href="/vs/${U(dong.n)}/${U(x.n)}">견주기 →</a></td></tr>`).join('')}
    </tbody></table>
    <p class="unit">다른 동네와 견주기</p>
    <form class="vsform" action="/vs" method="get">
      <input type="hidden" name="a" value="${esc(dong.n)}">
      <input name="b" placeholder="비교할 동네 (예: 대봉동)" aria-label="비교할 동네">
      <button type="submit">견주기</button>
    </form>
  </div>` : ''}

  ${dong.ri?.length ? `<div class="card wide">
    <h3>법정리 ${dong.ri.length}곳<em>${esc(dong.n)} 안에서 · 인구 많은 순</em></h3>
    <div class="chips">${dong.ri.map(([nm, t]) =>
      `<span class="chip"><b>${esc(nm)}</b><span class="n">${fmt(t)}</span></span>`).join('')}</div>
    <p class="note">주민등록 통계는 읍·면을 법정리 단위로 집계합니다. 위 숫자는 ${dong.ri.length}개 리를 합한 값입니다.</p>
  </div>` : ''}

  <div class="card wide">
    <h3>${esc(sgg.n)}의 다른 동네<em>${unit} ${sorted.length}곳 · 인구 많은 순</em></h3>
    <div class="chips">${sorted.filter((x) => x.c !== dong.c).slice(0, 44).map((x) =>
      `<a href="/${U(sido.s)}/${U(sgg.u)}/${U(x.n)}"><b>${esc(x.n)}</b><span class="n">${fmt(x.t)}</span></a>`).join('')}</div>
    ${sorted.length > 45 ? `<p class="unit"><a href="/${U(sido.s)}/${U(sgg.u)}" style="color:var(--acc)">${esc(sgg.n)} 전체 보기 →</a></p>` : ''}
  </div>

  <div class="card">
    <h3>공유<em>짧은 주소 · 이미지 카드</em></h3>
    ${shareBox(shortUrl, origin + decodeURIComponent(path))}
    <p class="unit">이미지 카드</p>
    <div class="chips">
      <a href="/og/${dong.c}.svg">카드 보기 (SVG) →</a>
      <a href="${esc(path)}?card">캡처용 화면 →</a>
    </div>
  </div>

  <div class="card">
    <h3>자주 묻는 질문</h3>
    ${faqs.map((f) => `<details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}
  </div>
</div>

${footer(month)}`;

  return shell({
    title: `${title} | 인구·동네`, desc, canonical: origin + path, body,
    ogImage: `${origin}/og/${dong.c}.png`,
    jsonld: [
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        ['전국', '/'], [sido.s, `/${sido.s}`], [sgg.n, `/${sido.s}/${sgg.u}`], [dong.n, path],
      ].map(([n, u], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: origin + u })) },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map((f) => ({
        '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    ],
  });
}

function faqBlocks(dong, sgg, sido, d, rank, total, month, unit = '법정동') {
  const when = ym(month);
  const m = metrics(dong);
  return [
    { q: `${sido.n} ${sgg.n} ${dong.n} 인구는 몇 명인가요?`,
      a: `${when} 기준 ${fmt(dong.t)}명입니다. 남자 ${fmt(dong.m)}명, 여자 ${fmt(dong.f)}명입니다.` },
    { q: `${dong.n}은 ${sgg.n}에서 몇 번째로 인구가 많나요?`,
      a: `${sgg.n}의 ${unit} ${total}곳 가운데 ${rank}번째입니다.` },
    { q: `${dong.n} 평균연령은 몇 살인가요?`,
      a: `${dong.a}세입니다(남자 ${dong.am}세, 여자 ${dong.af}세). ${sgg.n} 평균 ${sgg.a}세와 ${Math.abs(+(dong.a - sgg.a).toFixed(1))}세 차이입니다.` },
    { q: `${dong.n} 세대수는 몇 세대인가요?`,
      a: `${fmt(dong.h)}세대입니다. 세대당 인구는 ${d.perHousehold.toFixed(2)}명이고, 1인 세대 비중은 ${p1(m.single)}입니다.` },
    { q: '이 통계는 어디 자료인가요?',
      a: `행정안전부 주민등록 인구통계입니다. ${when} 말일 기준이며 매월 갱신됩니다. 공공누리 제1유형으로 제공됩니다.` },
    { q: '주민등록 인구와 인구총조사 인구는 왜 다른가요?',
      a: '주민등록 인구는 주민등록상 주소지 기준이고, 통계청 인구총조사는 실제 거주지 기준입니다. 대학가·산업단지처럼 주소를 옮기지 않고 사는 사람이 많은 곳은 두 숫자가 크게 벌어집니다.' },
  ];
}

// ── 캡처용 카드 화면 (1200×630 비율) ─────────────────────────────────────────
// 링크 미리보기가 안 뜨는 곳(사내 메신저 등)에서는 결국 사람이 캡처해서 붙인다.
// 그럴 때 페이지 전체를 찍으면 지저분하니, 카드 한 장만 있는 화면을 따로 둔다.
export function cardPage({ dong, sgg, sido, nation, rank, total, unit, month, origin, path, svg }) {
  const body = `
<div style="max-width:1200px;margin:22px auto">
  <div style="border:1px solid var(--line);border-radius:var(--r);overflow:hidden;background:var(--card)">${svg}</div>
  <p class="unit" style="margin-top:12px">이 화면을 그대로 캡처하거나,
    <a href="/og/${dong.c}.svg" style="color:var(--acc)">SVG 원본</a>을 내려받아 쓰세요.
    <a href="${esc(path)}" style="color:var(--acc)">← 페이지로 돌아가기</a></p>
</div>`;
  return shell({ title: `${sido.s} ${sgg.n} ${dong.n} 공유 카드`, noindex: true,
    desc: `${dong.n} 인구 ${fmt(dong.t)}명`, body });
}

// ── 두 동네 견주기 ───────────────────────────────────────────────────────────
export function comparePage({ A, B, nation, origin, path, month }) {
  const [a, b] = [A, B];
  const ma = metrics(a.dong), mb = metrics(b.dong);
  const da = derive(a.dong), db = derive(b.dong);
  const nameA = a.dong.n, nameB = b.dong.n;
  const rows = [
    { label: '총인구', a: a.dong.t, b: b.dong.t, fa: fmt(a.dong.t), fb: fmt(b.dong.t) },
    { label: '세대수', a: a.dong.h, b: b.dong.h, fa: fmt(a.dong.h), fb: fmt(b.dong.h) },
    { label: '평균연령', a: a.dong.a, b: b.dong.a, fa: `${a.dong.a}세`, fb: `${b.dong.a}세` },
    { label: '고령 비중', a: ma.old, b: mb.old, fa: p1(ma.old), fb: p1(mb.old) },
    { label: '유소년 비중', a: ma.young, b: mb.young, fa: p1(ma.young), fb: p1(mb.young) },
    { label: '1인 세대', a: ma.single, b: mb.single, fa: p1(ma.single), fb: p1(mb.single) },
    { label: '세대당 인구', a: ma.perHousehold, b: mb.perHousehold, fa: ma.perHousehold.toFixed(2), fb: mb.perHousehold.toFixed(2) },
  ];
  const bigger = a.dong.t >= b.dong.t ? a : b, smaller = a.dong.t >= b.dong.t ? b : a;
  const times = smaller.dong.t ? (bigger.dong.t / smaller.dong.t).toFixed(1) : '—';
  const older = a.dong.a >= b.dong.a ? a : b;

  const title = `${nameA} vs ${nameB} 인구 비교`;
  const desc = `${a.sido.s} ${a.sgg.n} ${nameA}(${fmt(a.dong.t)}명)와 ${b.sido.s} ${b.sgg.n} ${nameB}(${fmt(b.dong.t)}명)를 `
    + `인구·연령·세대 기준으로 나란히 봅니다.`;
  const body = `
${crumb([{ text: '전국', href: '/' }, { text: '견주기' }])}
<div class="head">
  <h1><span class="sm">나란히 보기</span>${esc(nameA)} <span style="color:var(--mut2)">vs</span> ${esc(nameB)}</h1>
  <p class="stamp">${esc(a.sido.s)} ${esc(a.sgg.n)} ${esc(nameA)} · ${esc(b.sido.s)} ${esc(b.sgg.n)} ${esc(nameB)} · ${esc(ym(month))} 기준</p>
  <p class="lede">${esc(bigger.dong.n)}가 ${esc(smaller.dong.n)}보다 <b>${times}배</b> 큽니다.
    평균연령은 ${esc(older.dong.n)}가 <b>${Math.abs(+(a.dong.a - b.dong.a).toFixed(1))}세</b> 많습니다.</p>
</div>

<div class="kpis">
  ${kpi(esc(nameA) + ' 인구', fmt(a.dong.t), '명', `평균 ${a.dong.a}세 · ${fmt(a.dong.h)}세대`)}
  ${kpi(esc(nameB) + ' 인구', fmt(b.dong.t), '명', `평균 ${b.dong.a}세 · ${fmt(b.dong.h)}세대`)}
  ${kpi('인구 차이', fmt(Math.abs(a.dong.t - b.dong.t)), '명', `${esc(bigger.dong.n)}가 더 많음`)}
  ${kpi('평균연령 차', Math.abs(+(a.dong.a - b.dong.a).toFixed(1)), '세', `${esc(older.dong.n)}가 더 많음`)}
</div>

<div class="grid">
  <div class="card wide">
    <h3>지표 견주기<em>막대가 긴 쪽이 큰 값</em></h3>
    ${facing(rows, nameA, nameB)}
  </div>
  <div class="card">
    <h3>${esc(nameA)}<em>${esc(a.sgg.n)}</em></h3>
    ${pyramid(TEN_LABELS, da.m10, da.f10, { male: db.m10, female: db.f10 })}
    <div class="legend"><span><i class="dash"></i>점선 = ${esc(nameB)} (같은 인구로 환산)</span></div>
  </div>
  <div class="card">
    <h3>${esc(nameB)}<em>${esc(b.sgg.n)}</em></h3>
    ${pyramid(TEN_LABELS, db.m10, db.f10, { male: da.m10, female: da.f10 })}
    <div class="legend"><span><i class="dash"></i>점선 = ${esc(nameA)} (같은 인구로 환산)</span></div>
  </div>
  <div class="card wide">
    <h3>표로 보기<em>전국 값을 함께</em></h3>
    <div class="scroll"><table>
      <thead><tr><th>지표</th><th>${esc(nameA)}</th><th>${esc(nameB)}</th><th>전국</th></tr></thead>
      <tbody>
        <tr><td>총인구</td><td>${fmt(a.dong.t)}</td><td>${fmt(b.dong.t)}</td><td style="color:var(--mut2)">${fmt(nation.t)}</td></tr>
        <tr><td>세대수</td><td>${fmt(a.dong.h)}</td><td>${fmt(b.dong.h)}</td><td style="color:var(--mut2)">${fmt(nation.h)}</td></tr>
        <tr><td>평균연령</td><td>${a.dong.a}세</td><td>${b.dong.a}세</td><td style="color:var(--mut2)">${nation.a}세</td></tr>
        <tr><td>고령 비중</td><td>${p1(ma.old)}</td><td>${p1(mb.old)}</td><td style="color:var(--mut2)">${p1(metrics(nation).old)}</td></tr>
        <tr><td>유소년 비중</td><td>${p1(ma.young)}</td><td>${p1(mb.young)}</td><td style="color:var(--mut2)">${p1(metrics(nation).young)}</td></tr>
        <tr><td>1인 세대</td><td>${p1(ma.single)}</td><td>${p1(mb.single)}</td><td style="color:var(--mut2)">${p1(metrics(nation).single)}</td></tr>
        <tr><td>세대당 인구</td><td>${ma.perHousehold.toFixed(2)}명</td><td>${mb.perHousehold.toFixed(2)}명</td>
          <td style="color:var(--mut2)">${metrics(nation).perHousehold.toFixed(2)}명</td></tr>
      </tbody></table></div>
    <div class="chips">
      <a href="/${U(a.sido.s)}/${U(a.sgg.u)}/${U(nameA)}">${esc(nameA)} 자세히 →</a>
      <a href="/${U(b.sido.s)}/${U(b.sgg.u)}/${U(nameB)}">${esc(nameB)} 자세히 →</a>
    </div>
  </div>
  <div class="card wide">
    <h3>다른 조합으로<em>이름만 넣으면 됩니다</em></h3>
    <form class="vsform" action="/vs" method="get">
      <input name="a" value="${esc(nameA)}" aria-label="첫째 동네">
      <input name="b" value="${esc(nameB)}" aria-label="둘째 동네">
      <button type="submit">견주기</button>
    </form>
    ${shareBox(`${origin}/vs/${U(nameA)}/${U(nameB)}`, origin + decodeURIComponent(path))}
  </div>
</div>
${footer(month)}`;
  return shell({ title: `${title} | 인구·동네`, desc, canonical: origin + path, body });
}

// ── 시군구 ───────────────────────────────────────────────────────────────────
export function sggPage({ sgg, sido, nation, dongs, origin, path, month }) {
  const d = derive(sgg);
  const m = metrics(sgg), mn = metrics(nation);
  const unit = unitName(dongs);
  const avg = dongs.length ? Math.round(sgg.t / dongs.length) : 0;
  const desc = `${sido.n} ${sgg.n} 인구 ${fmt(sgg.t)}명, ${fmt(sgg.h)}세대, 평균연령 ${sgg.a}세. ${unit} ${dongs.length}곳의 인구를 광고 없이 봅니다.`;
  const body = `
${crumb([{ text: '전국', href: '/' }, { text: sido.s, href: `/${U(sido.s)}` }, { text: sgg.n }])}
<div class="head">
  <h1><span class="sm">${esc(sido.n)}</span>${esc(sgg.n)}</h1>
  <p class="stamp">주민등록 인구통계 · ${esc(ym(month))} 기준 · ${unit} ${dongs.length}곳</p>
  <p class="lede">${esc(headline(sgg, nation, sido, d.trendPoints))}</p>
</div>
<div class="kpis">
  ${kpi('총인구', fmt(sgg.t), '명', `남 <span class="m">${fmt(sgg.m)}</span> · 여 <span class="f">${fmt(sgg.f)}</span>`)}
  ${kpi('평균연령', sgg.a, '세', `${esc(sido.s)} <b>${sido.a}</b> · 전국 <b>${nation.a}</b>`)}
  ${kpi('세대수', fmt(sgg.h), '세대', `세대당 <b>${d.perHousehold.toFixed(2)}명</b>`)}
  ${kpi('1인 세대', p1(m.single), '', `전국 <b>${p1(mn.single)}</b>`)}
</div>
<div class="grid">
  <div class="card">
    <h3>성별·연령대별 인구<em>10세 구간 · 단위 명</em></h3>
    ${pyramid(TEN_LABELS, d.m10, d.f10, { male: derive(nation).m10, female: derive(nation).f10 })}
    <div class="legend"><span><i class="dash"></i>점선 = 전국 평균 분포(같은 인구로 환산)</span></div>
  </div>
  <div class="card">
    <h3>연령 구성<em>단위 %</em></h3>
    ${stacked([{ value: d.young, cls: 'young' }, { value: d.work, cls: 'work' }, { value: d.old, cls: 'old' }])}
    <div class="legend"><span><i class="young"></i>유소년 ${p1(m.young)}</span>
    <span><i class="work"></i>생산연령 ${p1(m.working)}</span><span><i class="old"></i>고령 ${p1(m.old)}</span></div>
    <p class="unit">전국 견줌</p>
    ${stacked([{ value: mn.young, cls: 'young' }, { value: mn.working, cls: 'work' }, { value: mn.old, cls: 'old' }], { compact: true })}
    ${d.trendPoints.length > 1 ? `<p class="unit">연도별 추이 · 단위 명</p>${trend(d.trendPoints)}` : ''}
  </div>
  <div class="card wide">
    <h3>${unit} ${dongs.length}곳<em>인구 많은 순 · 평균 ${fmt(avg)}명</em></h3>
    <div class="scroll"><table><thead><tr><th>순위</th><th>${unit}</th><th>인구수</th><th>세대수</th><th>평균연령</th><th>1인 세대</th></tr></thead><tbody>
    ${dongs.map((x, i) => `<tr><td style="text-align:left;color:var(--mut2)">${i + 1}</td>
      <td><a href="/${U(sido.s)}/${U(sgg.u)}/${U(x.n)}">${esc(x.n)}</a></td>
      <td>${fmt(x.t)}</td><td>${fmt(x.h)}</td><td>${x.a}세</td><td>${p1(metrics(x).single)}</td></tr>`).join('')}
    </tbody></table></div>
  </div>
</div>
${footer(month)}`;
  return shell({ title: `${sido.n} ${sgg.n} 인구 통계 | 인구·동네`, desc, canonical: origin + path, body,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement:
      [['전국', '/'], [sido.s, `/${sido.s}`], [sgg.n, path]].map(([n, u], i) =>
        ({ '@type': 'ListItem', position: i + 1, name: n, item: origin + u })) }] });
}

// ── 일반구를 둔 시(수원·성남 등) ─────────────────────────────────────────────
export function cityPage({ sgg, sido, nation, gus, origin, path, month }) {
  const d = derive(sgg), m = metrics(sgg), mn = metrics(nation);
  const desc = `${sido.n} ${sgg.n} 인구 ${fmt(sgg.t)}명, ${fmt(sgg.h)}세대, 평균연령 ${sgg.a}세. 일반구 ${gus.length}곳.`;
  const body = `
${crumb([{ text: '전국', href: '/' }, { text: sido.s, href: `/${U(sido.s)}` }, { text: sgg.n }])}
<div class="head">
  <h1><span class="sm">${esc(sido.n)}</span>${esc(sgg.n)}</h1>
  <p class="stamp">주민등록 인구통계 · ${esc(ym(month))} 기준 · 일반구 ${gus.length}곳</p>
  <p class="lede">${esc(headline(sgg, nation, sido, d.trendPoints))}</p>
</div>
<div class="kpis">
  ${kpi('총인구', fmt(sgg.t), '명', `남 <span class="m">${fmt(sgg.m)}</span> · 여 <span class="f">${fmt(sgg.f)}</span>`)}
  ${kpi('평균연령', sgg.a, '세', `${esc(sido.s)} <b>${sido.a}</b> · 전국 <b>${nation.a}</b>`)}
  ${kpi('세대수', fmt(sgg.h), '세대', `세대당 <b>${d.perHousehold.toFixed(2)}명</b>`)}
  ${kpi('1인 세대', p1(m.single), '', `전국 <b>${p1(mn.single)}</b>`)}
</div>
<div class="grid">
  <div class="card">
    <h3>성별·연령대별 인구<em>10세 구간 · 단위 명</em></h3>
    ${pyramid(TEN_LABELS, d.m10, d.f10, { male: derive(nation).m10, female: derive(nation).f10 })}
    <div class="legend"><span><i class="dash"></i>점선 = 전국 평균 분포</span></div>
  </div>
  <div class="card">
    <h3>구별 인구<em>${esc(sgg.n)} 안</em></h3>
    <table><thead><tr><th>구</th><th>인구수</th><th>세대수</th><th>평균연령</th></tr></thead><tbody>
    ${[...gus].sort((a, b) => b.t - a.t).map((g) => `<tr>
      <td><a href="/${U(sido.s)}/${U(g.u)}">${esc(g.u)}</a></td>
      <td>${fmt(g.t)}</td><td>${fmt(g.h)}</td><td>${g.a}세</td></tr>`).join('')}
    </tbody></table>
    <p class="note">법정동 단위 인구는 각 구 페이지에서 볼 수 있습니다.</p>
  </div>
</div>
${footer(month)}`;
  return shell({ title: `${sido.n} ${sgg.n} 인구 통계 | 인구·동네`, desc, canonical: origin + path, body });
}

// ── 시도 ─────────────────────────────────────────────────────────────────────
export function sidoPage({ sido, nation, sggs, origin, path, month }) {
  const cities = sggs.filter((g) => g.k?.length);
  const leaves = sggs.filter((g) => !g.k?.length);
  const d = derive(sido), m = metrics(sido), mn = metrics(nation);
  const desc = `${sido.n} 인구 ${fmt(sido.t)}명, 시군구 ${leaves.length}곳. 광고 없는 주민등록 인구통계.`;
  const body = `
${crumb([{ text: '전국', href: '/' }, { text: sido.s }])}
<div class="head">
  <h1>${esc(sido.n)}</h1>
  <p class="stamp">주민등록 인구통계 · ${esc(ym(month))} 기준 · 시군구 ${leaves.length}곳</p>
  <p class="lede">${esc(headline(sido, nation, nation, d.trendPoints))}</p>
</div>
<div class="kpis">
  ${kpi('총인구', fmt(sido.t), '명', `전국의 <b>${p1(pct(sido.t, nation.t))}</b>`)}
  ${kpi('평균연령', sido.a, '세', `전국 <b>${nation.a}세</b>`)}
  ${kpi('세대수', fmt(sido.h), '세대', `세대당 <b>${d.perHousehold.toFixed(2)}명</b>`)}
  ${kpi('1인 세대', p1(m.single), '', `전국 <b>${p1(mn.single)}</b>`)}
</div>
<div class="grid">
  <div class="card">
    <h3>성별·연령대별 인구<em>10세 구간 · 단위 명</em></h3>
    ${pyramid(TEN_LABELS, d.m10, d.f10, { male: derive(nation).m10, female: derive(nation).f10 })}
    <div class="legend"><span><i class="dash"></i>점선 = 전국 평균 분포</span></div>
  </div>
  <div class="card">
    <h3>연령 구성<em>단위 %</em></h3>
    ${stacked([{ value: d.young, cls: 'young' }, { value: d.work, cls: 'work' }, { value: d.old, cls: 'old' }])}
    <div class="legend"><span><i class="young"></i>유소년 ${p1(m.young)}</span>
    <span><i class="work"></i>생산연령 ${p1(m.working)}</span><span><i class="old"></i>고령 ${p1(m.old)}</span></div>
    ${cities.length ? `<p class="unit">일반구를 둔 시</p><div class="chips">${[...cities].sort((a, b) => b.t - a.t).map((x) =>
      `<a href="/${U(sido.s)}/${U(x.u)}"><b>${esc(x.u)}</b><span class="n">${fmt(x.t)}</span></a>`).join('')}</div>` : ''}
  </div>
  <div class="card wide">
    <h3>시군구별 인구<em>인구 많은 순</em></h3>
    <div class="scroll"><table><thead><tr><th>순위</th><th>시군구</th><th>인구수</th><th>세대수</th><th>평균연령</th></tr></thead><tbody>
    ${[...leaves].sort((a, b) => b.t - a.t).map((x, i) => `<tr><td style="text-align:left;color:var(--mut2)">${i + 1}</td>
      <td><a href="/${U(sido.s)}/${U(x.u)}">${esc(x.n)}</a></td>
      <td>${fmt(x.t)}</td><td>${fmt(x.h)}</td><td>${x.a}세</td></tr>`).join('')}
    </tbody></table></div>
  </div>
</div>
${footer(month)}`;
  return shell({ title: `${sido.n} 인구 통계 | 인구·동네`, desc, canonical: origin + path, body });
}

// ── 전국 ─────────────────────────────────────────────────────────────────────
export function homePage({ index, origin, month }) {
  const n = index.nation;
  const d = derive(n), m = metrics(n);
  const dongCount = index.sgg.reduce((a, s) => a + s.d, 0);
  const body = `
<div class="head" style="margin-top:22px">
  <h1><span class="sm">광고 없는 주민등록 인구통계</span>우리 동네 인구</h1>
  <p class="stamp">행정안전부 자료를 법정동(읍·면) 단위까지 · ${esc(ym(month))} 기준 · ${fmt(dongCount)}곳</p>
  <p class="lede">숫자만 보여 주지 않습니다. 지표마다 <b>전국·시도·시군구 대비 어디쯤인지</b>를 같이 그려서,
    45.3세가 많은 건지 적은 건지 페이지가 답하게 했습니다.</p>
</div>
<div class="kpis">
  ${kpi('전국 인구', fmt(n.t), '명', `남 <span class="m">${fmt(n.m)}</span> · 여 <span class="f">${fmt(n.f)}</span>`)}
  ${kpi('평균연령', n.a, '세', `고령 <b>${p1(m.old)}</b> · 유소년 <b>${p1(m.young)}</b>`)}
  ${kpi('세대수', fmt(n.h), '세대', `세대당 <b>${d.perHousehold.toFixed(2)}명</b>`)}
  ${kpi('1인 세대', p1(m.single), '', `${fmt(n.hs[0])}세대`)}
</div>
<div class="grid">
  <div class="card">
    <h3>시도 고르기<em>${index.sido.length}곳</em></h3>
    <div class="chips">${index.sido.map((s) =>
      `<a href="/${U(s.s)}"><b>${esc(s.s)}</b><span class="n">${fmt(s.t)}</span></a>`).join('')}</div>
  </div>
  <div class="card">
    <h3>두 동네 견주기<em>원본 사이트에 없는 기능</em></h3>
    <form class="vsform" action="/vs" method="get">
      <input name="a" placeholder="남산동" aria-label="첫째 동네">
      <input name="b" placeholder="대봉동" aria-label="둘째 동네">
      <button type="submit">견주기</button>
    </form>
    <p class="note">인구 피라미드를 서로 겹쳐 보여 주므로, 어느 나이대가 다른지 한눈에 보입니다.</p>
  </div>
  <div class="card">
    <h3>전국 인구 피라미드<em>10세 구간 · 단위 명</em></h3>
    ${pyramid(TEN_LABELS, d.m10, d.f10)}
  </div>
  <div class="card">
    <h3>주소가 짧습니다<em>공유하기 편하라고</em></h3>
    <table><tbody>
      <tr><td style="color:var(--mut)">동네</td><td style="text-align:left"><code>/대구/중구/남산동</code></td></tr>
      <tr><td style="color:var(--mut)">더 짧게</td><td style="text-align:left"><code>/중구/남산동</code> · <code>/남산동</code></td></tr>
      <tr><td style="color:var(--mut)">가장 짧게</td><td style="text-align:left"><code>/c/${toShort('2711015600')}</code></td></tr>
      <tr><td style="color:var(--mut)">견주기</td><td style="text-align:left"><code>/vs/남산동/대봉동</code></td></tr>
      <tr><td style="color:var(--mut)">JSON</td><td style="text-align:left"><code>/api/대구/중구/남산동</code></td></tr>
    </tbody></table>
    <p class="note">이름만으로 찾을 수 있으면 시도·시군구를 생략해도 됩니다. 겹치면 후보를 보여 줍니다.</p>
  </div>
</div>
${footer(month)}`;
  return shell({ title: '인구·동네 — 광고 없는 우리 동네 인구 통계',
    desc: `행정안전부 주민등록 인구통계를 법정동 단위로. 광고·추적 없이 ${fmt(dongCount)}개 동네의 인구·세대·연령을 보고, 두 동네를 나란히 견줍니다.`,
    canonical: origin + '/', body });
}

// ── 검색 / 후보 목록 ─────────────────────────────────────────────────────────
export function listPage({ heading, sub, items, origin, month, query = '' }) {
  const body = `
${crumb([{ text: '전국', href: '/' }, { text: heading }])}
<div class="head"><h1>${esc(heading)}</h1><p class="stamp">${esc(sub)}</p></div>
<div class="card">
  ${items.length ? `<div class="scroll"><table><thead><tr><th>동네</th><th>인구수</th><th>평균연령</th></tr></thead><tbody>
  ${items.map((x) => `<tr><td><a href="${esc(x.href)}">${esc(x.label)}</a></td>
    <td>${fmt(x.t)}</td><td>${x.a}세</td></tr>`).join('')}</tbody></table></div>`
    : `<p style="color:var(--mut);margin:0">찾는 이름이 없습니다. 법정동 이름 전체(예: <b>남산동</b>)로 다시 검색해 보세요.</p>`}
</div>
${footer(month)}`;
  return shell({ title: `${heading} | 인구·동네`, desc: sub, body, noindex: true,
    canonical: query ? '' : origin });
}

export function errorPage({ code, message, month }) {
  const body = `<div class="head" style="margin-top:40px"><h1>${code}</h1><p class="stamp">${esc(message)}</p></div>
  <div class="card"><p style="margin:0"><a href="/" style="color:var(--acc)">전국 목록으로 →</a></p></div>
  ${month ? footer(month) : ''}`;
  return shell({ title: `${code} | 인구·동네`, desc: message, body, noindex: true });
}
