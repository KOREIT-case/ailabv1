// style.js — 페이지 전체 CSS. 외부 요청 0개가 목표라 전부 인라인으로 넣는다.
//
// 원본 사이트가 불편했던 이유가 광고였으므로, 여기서는 광고·추적·외부 폰트·외부 스크립트를
// 하나도 쓰지 않는다. 글꼴은 기기에 이미 있는 것만 쓰고(다운로드 0), 색은 변수로 묶어
// 다크모드를 따라가게 한다.
export const CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{
  --bg:#f7f7f5; --card:#fff; --line:#e6e6e1; --tx:#191a17; --mut:#6b6d66;
  --acc:#3f5bd9; --acc-soft:#eef1fe;
  --m:#3f7fd9; --f:#d9557f; --m-soft:#9dc0ee; --f-soft:#eda9c0;
  --young:#5aa9e6; --work:#4c9f70; --old:#e0a458;
  --s1:#5b8def; --s2:#61b6a4; --s3:#d9a441;
  --r:14px; --pad:clamp(14px,3.6vw,22px);
}
@media (prefers-color-scheme:dark){:root{
  --bg:#131519; --card:#1c1f25; --line:#2b2f37; --tx:#e7e9ec; --mut:#9aa0ab;
  --acc:#8ea2ff; --acc-soft:#232840;
  --m:#6ea8f0; --f:#ef8fb0; --m-soft:#3c5f8c; --f-soft:#8c5169;
  --young:#4a90c9; --work:#43886a; --old:#c08c47;
}}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--tx);
  font:16px/1.65 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Malgun Gothic","Noto Sans KR",system-ui,sans-serif;
  word-break:keep-all;overflow-wrap:anywhere}
a{color:inherit;text-decoration:none}
.wrap{max-width:760px;margin:0 auto;padding:0 14px 64px}

header.top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);
  backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.top .in{max-width:760px;margin:0 auto;padding:10px 14px;display:flex;gap:12px;align-items:center}
.brand{font-weight:700;letter-spacing:-.02em;white-space:nowrap}
.brand span{color:var(--acc)}
form.find{flex:1;display:flex;gap:6px}
form.find input{flex:1;min-width:0;padding:8px 12px;border:1px solid var(--line);border-radius:999px;
  background:var(--card);color:var(--tx);font-size:15px}
form.find input:focus{outline:2px solid var(--acc);outline-offset:1px}
form.find button{padding:8px 14px;border:0;border-radius:999px;background:var(--acc);color:#fff;font-size:14px;cursor:pointer}

nav.crumb{display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:13px;color:var(--mut);margin:18px 0 10px}
nav.crumb a{padding:3px 9px;border-radius:999px;background:var(--card);border:1px solid var(--line)}
nav.crumb a:hover{border-color:var(--acc);color:var(--acc)}
nav.crumb b{padding:3px 9px;border-radius:999px;background:var(--acc-soft);color:var(--acc);font-weight:600}

h1{font-size:clamp(23px,5.4vw,31px);letter-spacing:-.03em;margin:6px 0 4px;line-height:1.28}
.sub{color:var(--mut);font-size:14px;margin:0 0 18px}

.hero{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:22px}
.hero .big{grid-column:1/-1;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:var(--pad)}
.hero .cell{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:var(--pad)}
.k{font-size:12.5px;color:var(--mut);letter-spacing:.01em}
.v{font-size:clamp(26px,7vw,38px);font-weight:700;letter-spacing:-.035em;line-height:1.15;margin-top:2px}
.v small{font-size:15px;font-weight:600;color:var(--mut);margin-left:3px;letter-spacing:0}
.v.sm{font-size:clamp(19px,4.6vw,24px)}
.split{display:flex;gap:14px;align-items:baseline;flex-wrap:wrap}
.split .m{color:var(--m);font-weight:700}
.split .f{color:var(--f);font-weight:700}

h2.sec{font-size:13px;color:var(--mut);letter-spacing:.06em;margin:30px 0 10px;font-weight:600}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:var(--pad);margin-bottom:12px}
.card > h3{margin:0;font-size:17px;letter-spacing:-.02em;display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.card > h3 em{font-style:normal;font-size:12.5px;color:var(--mut);font-weight:500;text-align:right}
.note{margin:12px 0 0;padding:10px 12px;background:var(--acc-soft);color:var(--acc);border-radius:10px;font-size:14px;font-weight:500}
.unit{font-size:12px;color:var(--mut);margin:14px 0 4px}

svg.chart{display:block;width:100%;height:auto;margin:6px 0 2px;overflow:visible}
svg.chart.stack{height:34px;border-radius:8px;overflow:hidden;margin:6px 0}
.chart .cap{font-size:11px;fill:var(--mut)}
.chart .axis{font-size:11.5px;fill:var(--mut)}
.chart .axis.on{fill:var(--acc);font-weight:700}
.chart .val{font-size:11px;fill:var(--mut)}
.chart .val.on{fill:var(--acc);font-weight:700}
.chart .bar-m{fill:var(--m-soft)}.chart .bar-f{fill:var(--f-soft)}
.chart .bar-m.peak{fill:var(--m)}.chart .bar-f.peak{fill:var(--f)}
.chart .bar-r{fill:var(--line)}.chart .bar-r.on{fill:var(--acc)}
.chart .seg.young{fill:var(--young)}.chart .seg.work{fill:var(--work)}.chart .seg.old{fill:var(--old)}
.chart .seg.s1{fill:var(--s1)}.chart .seg.s2{fill:var(--s2)}.chart .seg.s3{fill:var(--s3)}
.chart .seglab{font-size:12px;fill:#fff;font-weight:600}
.chart .trend-line{fill:none;stroke:var(--acc);stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}
.chart .trend-area{fill:var(--acc);opacity:.09}
.chart .dot{fill:var(--card);stroke:var(--acc);stroke-width:2.5}
.chart .dot.last{fill:var(--acc)}

.legend{display:flex;flex-wrap:wrap;gap:12px;font-size:13px;color:var(--mut);margin-top:8px}
.legend i{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:5px;vertical-align:-1px}
.legend .young{background:var(--young)}.legend .work{background:var(--work)}.legend .old{background:var(--old)}
.legend .s1{background:var(--s1)}.legend .s2{background:var(--s2)}.legend .s3{background:var(--s3)}
.legend .m{background:var(--m)}.legend .f{background:var(--f)}

table{width:100%;border-collapse:collapse;font-size:14.5px;margin-top:6px}
th,td{padding:9px 6px;border-bottom:1px solid var(--line);text-align:right}
th:first-child,td:first-child{text-align:left}
thead th{font-size:12.5px;color:var(--mut);font-weight:600}
tbody tr:last-child td{border-bottom:0}
tr.me td{background:var(--acc-soft);font-weight:700;color:var(--acc)}
td.up{color:#c2410c}td.down{color:#1d6fa5}
@media (prefers-color-scheme:dark){td.up{color:#f0a07a}td.down{color:#7cc0e8}}

.chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
.chips a{padding:6px 12px;border:1px solid var(--line);border-radius:999px;font-size:14px;background:var(--bg)}
.chips a:hover{border-color:var(--acc);color:var(--acc)}
.chips a b{font-weight:600}
.chips a span{color:var(--mut);font-size:12.5px;margin-left:4px}

.share{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}
.share code{flex:1;min-width:180px;padding:8px 12px;background:var(--bg);border:1px solid var(--line);
  border-radius:10px;font-size:13.5px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.share button{padding:8px 16px;border:1px solid var(--acc);border-radius:10px;background:var(--acc);
  color:#fff;font-size:14px;cursor:pointer}

details.faq{border-bottom:1px solid var(--line)}
details.faq:last-of-type{border-bottom:0}
details.faq summary{cursor:pointer;padding:12px 0;font-weight:600;font-size:15px;list-style:none;display:flex;justify-content:space-between;gap:10px}
details.faq summary::-webkit-details-marker{display:none}
details.faq summary::after{content:"+";color:var(--mut);font-weight:400}
details.faq[open] summary::after{content:"−"}
details.faq p{margin:0 0 14px;color:var(--mut);font-size:14.5px}

footer{margin-top:34px;padding-top:18px;border-top:1px solid var(--line);color:var(--mut);font-size:13px}
footer p{margin:6px 0}
footer a{text-decoration:underline;text-underline-offset:2px}
.src{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:var(--pad);font-size:13.5px;color:var(--mut)}
.src b{color:var(--tx)}
.noads{display:inline-block;margin-top:10px;font-size:12px;color:var(--mut);border:1px dashed var(--line);border-radius:999px;padding:3px 10px}
@media(max-width:420px){.hero{grid-template-columns:1fr}}
`;
