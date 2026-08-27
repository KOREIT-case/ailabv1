// chart.js — 그래프를 서버에서 SVG 로 그린다.
//
// 원본 사이트는 차트 라이브러리 + 광고 스크립트를 받아 와 그리지만, 여기 그리는 건
// 막대 몇 개뿐이라 자바스크립트가 필요 없다. 서버에서 SVG 를 찍어 보내면
// 외부 스크립트 0개, 첫 화면에서 바로 완성된 그림이 나온다(레이아웃 흔들림 없음).
// 색은 CSS 변수로만 지정해 다크모드가 따라오게 한다.

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const fmt = (n) => Number(n).toLocaleString('ko-KR');

// 남녀 인구 피라미드(가로 양방향 막대). 나이대별로 왼쪽 남 / 오른쪽 여.
export function pyramid(labels, male, female) {
  const rows = labels.length;
  // pad 는 막대 바깥에 찍는 숫자 자리다. 좁게 잡으면 큰 수가 잘린다(예: 2,712 → "2,7").
  const rowH = 26, gap = 6, labelW = 62, half = 118, pad = 46;
  const w = labelW + half * 2 + pad * 2;
  const h = rows * (rowH + gap) + 26;
  const max = Math.max(1, ...male, ...female);
  const cx = pad + labelW + half;
  const peak = male.map((v, i) => v + female[i]).reduce((b, v, i, a) => (v > a[b] ? i : b), 0);

  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="연령대별 남녀 인구">`;
  s += `<text x="${cx - half / 2}" y="12" class="cap" text-anchor="middle">남자</text>`;
  s += `<text x="${cx + half / 2}" y="12" class="cap" text-anchor="middle">여자</text>`;
  labels.forEach((lab, i) => {
    const y = 22 + i * (rowH + gap);
    const mw = (male[i] / max) * half, fw = (female[i] / max) * half;
    const hot = i === peak ? ' peak' : '';
    s += `<text x="${cx}" y="${y + rowH / 2 + 4}" class="axis" text-anchor="middle">${esc(lab)}</text>`;
    s += `<rect class="bar-m${hot}" x="${cx - labelW / 2 - mw}" y="${y}" width="${mw}" height="${rowH}" rx="3"/>`;
    s += `<rect class="bar-f${hot}" x="${cx + labelW / 2}" y="${y}" width="${fw}" height="${rowH}" rx="3"/>`;
    s += `<text x="${cx - labelW / 2 - mw - 5}" y="${y + rowH / 2 + 4}" class="val" text-anchor="end">${fmt(male[i])}</text>`;
    s += `<text x="${cx + labelW / 2 + fw + 5}" y="${y + rowH / 2 + 4}" class="val">${fmt(female[i])}</text>`;
  });
  return s + '</svg>';
}

// 100% 누적 가로 막대(연령 구성, 세대 구성). parts = [{label, value, cls}]
export function stacked(parts) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const w = 600, h = 34;
  let x = 0, s = `<svg class="chart stack" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="구성 비율">`;
  for (const p of parts) {
    const bw = (p.value / total) * w;
    s += `<rect class="seg ${p.cls}" x="${x}" y="0" width="${Math.max(0, bw)}" height="${h}"/>`;
    if (bw > 46) s += `<text x="${x + bw / 2}" y="${h / 2 + 5}" class="seglab" text-anchor="middle">${((p.value / total) * 100).toFixed(1)}%</text>`;
    x += bw;
  }
  return s + '</svg>';
}

// 연도별 추이(꺾은선 + 점). points = [[year, value], ...]
export function trend(points) {
  if (points.length < 2) return '';
  const w = 420, h = 170, padX = 30, padTop = 26, padBot = 26;
  const vals = points.map((p) => p[1]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || Math.max(1, hi * 0.02);
  const X = (i) => padX + (i * (w - padX * 2)) / (points.length - 1);
  const Y = (v) => padTop + (1 - (v - lo + span * 0.25) / (span * 1.5)) * (h - padTop - padBot);

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
  const area = `${line} L${X(points.length - 1).toFixed(1)},${h - padBot} L${padX},${h - padBot} Z`;
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="연도별 인구 추이">`;
  s += `<path class="trend-area" d="${area}"/><path class="trend-line" d="${line}"/>`;
  points.forEach((p, i) => {
    const last = i === points.length - 1;
    s += `<circle class="dot${last ? ' last' : ''}" cx="${X(i).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="${last ? 5 : 3.5}"/>`;
    s += `<text x="${X(i).toFixed(1)}" y="${(Y(p[1]) - 12).toFixed(1)}" class="val" text-anchor="middle">${fmt(p[1])}</text>`;
    s += `<text x="${X(i).toFixed(1)}" y="${h - 8}" class="axis" text-anchor="middle">${p[0]}</text>`;
  });
  return s + '</svg>';
}

// 순위 막대(같은 시군구 안에서 이 동네가 어디쯤인지). 상위 N개만 그리고 본인은 강조.
export function ranking(items, activeCode, limit = 12) {
  const shown = items.slice(0, limit);
  if (!shown.some((d) => d.c === activeCode)) {
    const me = items.find((d) => d.c === activeCode);
    if (me) shown[shown.length - 1] = me;
  }
  const max = Math.max(1, ...shown.map((d) => d.t));
  // viewBox 폭은 실제 렌더 폭(≈400px)에 맞춘다. 넓게 잡으면 축소되면서 글자가 깨알이 된다.
  const rowH = 20, gap = 5, nameW = 84, w = 400;
  const h = shown.length * (rowH + gap);
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="인구 순위">`;
  shown.forEach((d, i) => {
    const y = i * (rowH + gap);
    const bw = (d.t / max) * (w - nameW - 52);
    const on = d.c === activeCode;
    s += `<text x="${nameW - 6}" y="${y + rowH / 2 + 4}" class="axis${on ? ' on' : ''}" text-anchor="end">${esc(d.n)}</text>`;
    s += `<rect class="bar-r${on ? ' on' : ''}" x="${nameW}" y="${y}" width="${bw}" height="${rowH}" rx="3"/>`;
    s += `<text x="${nameW + bw + 6}" y="${y + rowH / 2 + 4}" class="val${on ? ' on' : ''}">${fmt(d.t)}</text>`;
  });
  return s + '</svg>';
}
