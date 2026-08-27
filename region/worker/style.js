// style.js — 페이지 전체 CSS. 외부 요청 0개가 목표라 전부 인라인으로 넣는다.
//
// 원본 사이트가 불편했던 이유가 광고였으므로, 광고·추적·외부 폰트·외부 스크립트를
// 하나도 쓰지 않는다. 글꼴은 기기에 이미 있는 것만 쓰고(다운로드 0), 색은 변수로 묶어
// 다크모드를 따라가게 한다.
//
// 배치는 '대시보드'다. 좁은 화면에서는 한 줄, 넓은 화면에서는 두 단으로 접히고,
// 지표 카드는 네 칸으로 늘어선다. 이전에는 폭 760px 한 줄만 쓰고 좌우를 버렸다.
export const CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{
  --bg:#f6f6f4; --card:#fff; --line:#e5e5e0; --line2:#efefea;
  --tx:#17181a; --mut:#6a6c70; --mut2:#8b8d92;
  --acc:#3552d9; --acc-soft:#eaeeff; --acc-line:#c7d2fb;
  --m:#2f6fd0; --f:#cf4a76; --m-soft:#a8c6ec; --f-soft:#efadc4;
  --young:#4d9de0; --work:#3f9a6e; --old:#dc9a3f;
  --s1:#4f7fe8; --s2:#4faa9a; --s3:#d4a03c;
  --up:#c2410c; --down:#1668a5;
  --r:16px; --pad:clamp(15px,3.2vw,20px);
  --gap:12px;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#111317; --card:#1a1d22; --line:#292d34; --line2:#22262c;
  --tx:#e8eaee; --mut:#9ba1ab; --mut2:#7b818b;
  --acc:#8fa4ff; --acc-soft:#20263d; --acc-line:#3b4570;
  --m:#6ba4ee; --f:#ec87ac; --m-soft:#37587f; --f-soft:#834a61;
  --young:#4189c2; --work:#388264; --old:#bb8640;
  --s1:#4a6fc4; --s2:#3f8f82; --s3:#b78c37;
  --up:#ef9d76; --down:#79bde6;
}}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--tx);
  font:15.5px/1.6 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Malgun Gothic","Noto Sans KR",system-ui,sans-serif;
  font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;
  word-break:keep-all;overflow-wrap:anywhere}
a{color:inherit;text-decoration:none}
.wrap{max-width:1180px;margin:0 auto;padding:0 16px 72px}

/* ── 머리말 ───────────────────────────────────────────────────────────── */
header.top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 86%,transparent);
  backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top .in{max-width:1180px;margin:0 auto;padding:9px 16px;display:flex;gap:12px;align-items:center}
.brand{font-weight:800;letter-spacing:-.03em;white-space:nowrap;font-size:16px}
.brand span{color:var(--acc)}
form.find{flex:1;display:flex;gap:6px;max-width:420px;margin-left:auto}
form.find input{flex:1;min-width:0;padding:7px 13px;border:1px solid var(--line);border-radius:999px;
  background:var(--card);color:var(--tx);font-size:14.5px}
form.find input:focus{outline:2px solid var(--acc);outline-offset:1px}
form.find button{padding:7px 15px;border:0;border-radius:999px;background:var(--acc);color:#fff;font-size:14px;cursor:pointer}

nav.crumb{display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:12.5px;color:var(--mut);margin:16px 0 8px}
nav.crumb a{padding:3px 9px;border-radius:999px;background:var(--card);border:1px solid var(--line)}
nav.crumb a:hover{border-color:var(--acc);color:var(--acc)}
nav.crumb b{padding:3px 9px;border-radius:999px;background:var(--acc-soft);color:var(--acc);font-weight:600;
  border:1px solid var(--acc-line)}

/* ── 표제부 ───────────────────────────────────────────────────────────── */
.head{display:grid;gap:10px;margin:2px 0 18px}
h1{font-size:clamp(26px,5.6vw,40px);letter-spacing:-.04em;margin:0;line-height:1.2;font-weight:800}
h1 .sm{font-size:.52em;font-weight:600;color:var(--mut);letter-spacing:-.02em;display:block;margin-bottom:2px}
.stamp{color:var(--mut2);font-size:13px;margin:0}
.lede{font-size:clamp(16px,2.6vw,18.5px);line-height:1.62;margin:0;letter-spacing:-.015em;
  padding:14px 16px;background:var(--acc-soft);border:1px solid var(--acc-line);border-radius:var(--r);color:var(--tx)}
.lede b{color:var(--acc)}

/* ── 지표 카드 줄 ─────────────────────────────────────────────────────── */
.kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--gap);margin-bottom:var(--gap)}
@media(min-width:760px){.kpis{grid-template-columns:repeat(4,1fr)}}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:var(--pad);
  display:flex;flex-direction:column;gap:2px;min-width:0}
.kpi .k{font-size:12px;color:var(--mut);letter-spacing:.01em}
.kpi .v{font-size:clamp(24px,4.4vw,31px);font-weight:800;letter-spacing:-.045em;line-height:1.14}
.kpi .v small{font-size:14px;font-weight:600;color:var(--mut);margin-left:2px;letter-spacing:0}
.kpi .sub2{font-size:12.5px;color:var(--mut);margin-top:auto;padding-top:6px}
.kpi .sub2 b{color:var(--tx);font-weight:600}
.kpi .sub2 .m{color:var(--m);font-weight:700}.kpi .sub2 .f{color:var(--f);font-weight:700}

/* ── 격자 ─────────────────────────────────────────────────────────────── */
.grid{display:grid;grid-template-columns:1fr;gap:var(--gap);align-items:start}
@media(min-width:980px){.grid{grid-template-columns:1fr 1fr}.grid .wide{grid-column:1/-1}}
/* 넓은 카드 안은 다시 두 칸으로 — 그래프를 카드 폭만큼 늘리면 글자만 커진다 */
.cols{display:grid;gap:16px}
@media(min-width:980px){.cols{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}}
h2.sec{font-size:12px;color:var(--mut2);letter-spacing:.09em;margin:28px 0 10px;font-weight:700;text-transform:uppercase}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:var(--pad);min-width:0}
.card.tall{display:flex;flex-direction:column}
.card > h3{margin:0 0 4px;font-size:16px;letter-spacing:-.025em;font-weight:700;
  display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.card > h3 em{font-style:normal;font-size:12px;color:var(--mut);font-weight:500;text-align:right;white-space:nowrap}
.note{margin:12px 0 0;padding:9px 12px;background:var(--bg);border:1px solid var(--line2);
  border-radius:10px;font-size:13.5px;color:var(--mut);line-height:1.55}
.note b{color:var(--tx)}
.unit{font-size:11.5px;color:var(--mut2);margin:14px 0 2px;letter-spacing:.02em}

/* ── 그래프 ───────────────────────────────────────────────────────────── */
/* viewBox 는 400 폭 기준이라 그보다 크게 늘리면 글자가 부풀어 촌스러워진다 */
svg.chart{display:block;width:100%;max-width:540px;height:auto;margin:8px auto 2px;overflow:visible}
svg.chart.stack{max-width:none}
svg.chart.stack{height:30px;border-radius:7px;overflow:hidden;margin:8px 0 6px}
svg.chart.stack.compact{height:20px;border-radius:5px}
svg.chart.gauge{margin:2px auto 0;max-width:460px}
.chart text{fill:var(--mut)}
.chart .mid{text-anchor:middle}.chart .end{text-anchor:end}.chart .start{text-anchor:start}
.chart .cap{font-size:10.5px;fill:var(--mut2);text-anchor:middle}
.chart .axis{font-size:11.5px;fill:var(--mut)}
.chart .axis.on{fill:var(--acc);font-weight:700}
.chart .val{font-size:10.5px;fill:var(--mut2)}
.chart .val.on{fill:var(--acc);font-weight:700}
.chart .tiny{font-size:10px;fill:var(--mut2)}
.chart .bar-m{fill:var(--m-soft)}.chart .bar-f{fill:var(--f-soft)}
.chart .bar-m.peak{fill:var(--m)}.chart .bar-f.peak{fill:var(--f)}
.chart .cmp{fill:none;stroke:var(--tx);stroke-width:1.4;stroke-dasharray:3 2.5;opacity:.45}
.chart .bar-r{fill:var(--line)}.chart .bar-r.on{fill:var(--acc)}
.chart .bar-a{fill:var(--m-soft)}.chart .bar-a.win{fill:var(--m)}
.chart .bar-b{fill:var(--f-soft)}.chart .bar-b.win{fill:var(--f)}
.chart .seg.young{fill:var(--young)}.chart .seg.work{fill:var(--work)}.chart .seg.old{fill:var(--old)}
.chart .seg.s1{fill:var(--s1)}.chart .seg.s2{fill:var(--s2)}.chart .seg.s3{fill:var(--s3)}
.chart .seglab{font-size:11.5px;fill:#fff;font-weight:700}
.chart .trend-line{fill:none;stroke:var(--acc);stroke-width:2.4;stroke-linejoin:round;stroke-linecap:round}
.chart .trend-area{fill:var(--acc);opacity:.08}
.chart .dot{fill:var(--card);stroke:var(--acc);stroke-width:2.2}
.chart .dot.last{fill:var(--acc)}
.chart .track{fill:var(--line)}
.chart .track-fill{fill:var(--acc);opacity:.28}
.chart .tick{stroke:var(--mut2);stroke-width:1.2;opacity:.6}
.chart .rug{stroke:var(--mut2);stroke-width:1;opacity:.32}
.chart .knob{fill:var(--acc);stroke:var(--card);stroke-width:2.5}
.chart .knoblab{font-size:12px;fill:var(--tx);font-weight:800}

.gauges{display:grid;gap:14px;margin-top:4px}
.gauges .row .g-lab{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:2px 8px;font-size:13px}
.gauges .row .g-lab b{font-weight:600}
.gauges .row .g-lab span{color:var(--mut2);font-size:11.5px}

.legend{display:flex;flex-wrap:wrap;gap:10px 14px;font-size:12.5px;color:var(--mut);margin-top:8px}
.legend i{width:9px;height:9px;border-radius:2.5px;display:inline-block;margin-right:5px;vertical-align:0}
.legend .young{background:var(--young)}.legend .work{background:var(--work)}.legend .old{background:var(--old)}
.legend .s1{background:var(--s1)}.legend .s2{background:var(--s2)}.legend .s3{background:var(--s3)}
.legend .m{background:var(--m)}.legend .f{background:var(--f)}
.legend .dash{width:14px;height:0;border-top:1.5px dashed var(--tx);opacity:.5;border-radius:0;margin-right:6px}

/* ── 표 ───────────────────────────────────────────────────────────────── */
table{width:100%;border-collapse:collapse;font-size:14px;margin-top:4px}
th,td{padding:8px 5px;border-bottom:1px solid var(--line2);text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left;white-space:normal}
thead th{font-size:11.5px;color:var(--mut2);font-weight:600;letter-spacing:.02em}
tbody tr:last-child td{border-bottom:0}
tr.me td{background:var(--acc-soft);font-weight:700;color:var(--acc)}
tr.me td:first-child{border-radius:7px 0 0 7px}tr.me td:last-child{border-radius:0 7px 7px 0}
td.up{color:var(--up)}td.down{color:var(--down)}
td a{color:var(--acc)}
.scroll{overflow-x:auto;margin:0 calc(var(--pad) * -1);padding:0 var(--pad)}

/* ── 칩 ───────────────────────────────────────────────────────────────── */
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.chips a,.chips span.chip{padding:5px 11px;border:1px solid var(--line);border-radius:999px;font-size:13.5px;
  background:var(--bg);display:inline-flex;gap:5px;align-items:baseline}
.chips a:hover{border-color:var(--acc);color:var(--acc)}
.chips b{font-weight:600}
.chips .n{color:var(--mut2);font-size:12px}

/* ── 공유 ─────────────────────────────────────────────────────────────── */
.share{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
.share code{flex:1;min-width:170px;padding:8px 12px;background:var(--bg);border:1px solid var(--line);
  border-radius:10px;font-size:13px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.share button{padding:8px 15px;border:1px solid var(--acc);border-radius:10px;background:var(--acc);
  color:#fff;font-size:13.5px;cursor:pointer;white-space:nowrap}
.share button:hover{filter:brightness(1.08)}
.vsform{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.vsform input{flex:1;min-width:130px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;
  background:var(--bg);color:var(--tx);font-size:14px}
.vsform button{padding:8px 16px;border:1px solid var(--acc);border-radius:10px;background:var(--acc);color:#fff;
  font-size:14px;cursor:pointer}

details.faq{border-bottom:1px solid var(--line2)}
details.faq:last-of-type{border-bottom:0}
details.faq summary{cursor:pointer;padding:11px 0;font-weight:600;font-size:14.5px;list-style:none;
  display:flex;justify-content:space-between;gap:10px}
details.faq summary::-webkit-details-marker{display:none}
details.faq summary::after{content:"+";color:var(--mut2);font-weight:400}
details.faq[open] summary::after{content:"−"}
details.faq p{margin:0 0 12px;color:var(--mut);font-size:14px}

footer{margin-top:28px;padding-top:16px;border-top:1px solid var(--line);color:var(--mut2);font-size:12.5px}
footer p{margin:5px 0}
footer a{text-decoration:underline;text-underline-offset:2px}
.src{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:var(--pad);
  font-size:13px;color:var(--mut)}
.src b{color:var(--tx)}
.noads{display:inline-block;margin-top:8px;font-size:11.5px;color:var(--mut2);
  border:1px dashed var(--line);border-radius:999px;padding:3px 10px}

@media print{
  header.top,form.find,.share,.vsform,nav.crumb{display:none}
  body{background:#fff;font-size:11pt}
  .card,.kpi{break-inside:avoid;border-color:#ddd}
  .grid{grid-template-columns:1fr 1fr}
}
`;
