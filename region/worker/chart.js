// chart.js — 그래프를 서버에서 SVG 로 그린다.
//
// 원본 사이트는 차트 라이브러리 + 광고 스크립트를 받아 와 그리지만, 여기 그리는 건
// 막대 몇 개뿐이라 자바스크립트가 필요 없다. 서버에서 SVG 를 찍어 보내면
// 외부 스크립트 0개, 첫 화면에서 바로 완성된 그림이 나온다(레이아웃 흔들림 없음).
// 색은 CSS 변수로만 지정해 다크모드가 따라오게 한다.
//
// viewBox 폭은 실제 렌더 폭(대략 340~420px)에 맞춘다. 넓게 잡으면 축소되면서
// 글자만 깨알처럼 작아진다 — 한 번 겪고 나서 폭을 전부 400 근처로 통일했다.

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const fmt = (n) => Number(n).toLocaleString('ko-KR');
const r1 = (n) => Math.round(n * 10) / 10;

// ── 인구 피라미드 ────────────────────────────────────────────────────────────
// cmp 를 주면 '같은 인구로 환산한 비교 대상의 분포'를 점선 윤곽으로 덧그린다.
// 숫자만으로는 이 동네가 어디가 튀는지 안 보인다 — 겹쳐 놔야 보인다.
export function pyramid(labels, male, female, cmp = null) {
  const rows = labels.length;
  const rowH = 24, gap = 5, labelW = 58, half = 116, pad = 46;
  const w = labelW + half * 2 + pad * 2;
  const h = rows * (rowH + gap) + 26;
  const total = male.reduce((a, b) => a + b, 0) + female.reduce((a, b) => a + b, 0);

  // 비교 분포를 이 동네 인구 규모로 환산
  let cm = null, cf = null;
  if (cmp) {
    const ct = cmp.male.reduce((a, b) => a + b, 0) + cmp.female.reduce((a, b) => a + b, 0);
    if (ct > 0 && total > 0) {
      cm = cmp.male.map((v) => (v / ct) * total);
      cf = cmp.female.map((v) => (v / ct) * total);
    }
  }
  const max = Math.max(1, ...male, ...female, ...(cm || []), ...(cf || []));
  const cx = pad + labelW + half;
  const peak = male.map((v, i) => v + female[i]).reduce((b, v, i, a) => (v > a[b] ? i : b), 0);
  const yOf = (i) => 22 + i * (rowH + gap);

  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="연령대별 남녀 인구">`;
  s += `<text x="${cx - half / 2}" y="12" class="cap">남자</text>`;
  s += `<text x="${cx + half / 2}" y="12" class="cap">여자</text>`;
  labels.forEach((lab, i) => {
    const y = yOf(i);
    const mw = (male[i] / max) * half, fw = (female[i] / max) * half;
    const hot = i === peak ? ' peak' : '';
    s += `<text x="${cx}" y="${y + rowH / 2 + 4}" class="axis mid">${esc(lab)}</text>`;
    s += `<rect class="bar-m${hot}" x="${cx - labelW / 2 - mw}" y="${y}" width="${mw}" height="${rowH}" rx="2.5"/>`;
    s += `<rect class="bar-f${hot}" x="${cx + labelW / 2}" y="${y}" width="${fw}" height="${rowH}" rx="2.5"/>`;
    s += `<text x="${cx - labelW / 2 - mw - 5}" y="${y + rowH / 2 + 4}" class="val end">${fmt(male[i])}</text>`;
    s += `<text x="${cx + labelW / 2 + fw + 5}" y="${y + rowH / 2 + 4}" class="val">${fmt(female[i])}</text>`;
  });

  if (cm) {
    // 계단형 윤곽선 — 막대 위에 겹쳐도 값이 가려지지 않게 얇은 점선으로.
    const step = (arr, dir) => {
      let d = '';
      arr.forEach((v, i) => {
        const x = cx + dir * (labelW / 2 + (v / max) * half);
        const y0 = yOf(i), y1 = y0 + rowH;
        d += `${i ? 'L' : 'M'}${x.toFixed(1)},${y0} L${x.toFixed(1)},${y1} `;
      });
      return d;
    };
    s += `<path class="cmp" d="${step(cm, -1)}"/><path class="cmp" d="${step(cf, 1)}"/>`;
  }
  return s + '</svg>';
}

// ── 100% 누적 가로 막대 ──────────────────────────────────────────────────────
export function stacked(parts, { compact = false } = {}) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const w = 400, h = compact ? 20 : 30;
  let x = 0, s = `<svg class="chart stack${compact ? ' compact' : ''}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="구성 비율">`;
  for (const p of parts) {
    const bw = (p.value / total) * w;
    s += `<rect class="seg ${p.cls}" x="${x}" y="0" width="${Math.max(0, bw)}" height="${h}"/>`;
    if (bw > 40 && !compact) s += `<text x="${x + bw / 2}" y="${h / 2 + 4}" class="seglab mid">${((p.value / total) * 100).toFixed(1)}%</text>`;
    x += bw;
  }
  return s + '</svg>';
}

// ── 기준선 게이지 ────────────────────────────────────────────────────────────
// 하나의 지표를 '같은 시군구 동네들의 분포' 위에 올려놓고, 시군구·시도·전국 평균을
// 눈금으로 찍는다. 45.3세가 많은 건지 적은 건지를 이 한 줄이 답한다.
export function gauge({ value, marks, lo, hi, unit = '', digits = 1, dist = [] }) {
  const w = 400, h = 44, padX = 6, trackY = 17;
  const X = (v) => padX + ((v - lo) / (hi - lo)) * (w - padX * 2);
  let s = `<svg class="chart gauge" viewBox="0 0 ${w} ${h}" role="img" aria-label="기준 대비 위치">`;
  s += `<rect class="track" x="${padX}" y="${trackY - 3}" width="${w - padX * 2}" height="6" rx="3"/>`;
  s += `<rect class="track-fill" x="${padX}" y="${trackY - 3}" width="${Math.max(0, X(value) - padX)}" height="6" rx="3"/>`;
  // 같은 시군구 동네들을 실선 눈금으로 뿌린다(rug). 이게 없으면 '분포 위에서'라고 써 놔도
  // 빈 막대만 보여서, 오른쪽이 왜 비었는지 알 수 없다.
  for (const v of dist) {
    if (!Number.isFinite(v) || v < lo || v > hi) continue;
    s += `<line class="rug" x1="${X(v).toFixed(1)}" y1="${trackY - 3}" x2="${X(v).toFixed(1)}" y2="${trackY + 3}"/>`;
  }

  // 눈금에는 이름만 적는다. 숫자까지 넣으면 기준 셋이 가까이 붙는 지표에서 반드시 겹친다
  // (한 번 '전국46.2대구46.8' 처럼 포개져서 읽을 수 없게 나왔다).
  // 실제 값은 게이지 위 캡션 줄에 나란히 적어 둔다 → render.js
  // 그래도 가까운 것끼리는 이름을 묶어 한 번만 쓴다.
  const sorted = [...marks].sort((a, b) => a.v - b.v);
  const clusters = [];
  for (const m of sorted) {
    const x = X(m.v);
    const last = clusters[clusters.length - 1];
    if (last && x - last.x < 26) { last.names.push(m.label); last.x = (last.x + x) / 2; }
    else clusters.push({ x, names: [m.label] });
    s += `<line class="tick" x1="${x.toFixed(1)}" y1="${trackY - 7}" x2="${x.toFixed(1)}" y2="${trackY + 7}"/>`;
  }
  for (const c of clusters) {
    const label = c.names.join('·');
    const halfW = label.length * 5.6;
    const anchor = c.x < halfW + 2 ? 'start' : c.x > w - halfW - 2 ? 'end' : 'mid';
    const tx = anchor === 'start' ? 1 : anchor === 'end' ? w - 1 : c.x;
    s += `<text x="${tx.toFixed(1)}" y="${trackY + 19}" class="tiny ${anchor}">${esc(label)}</text>`;
  }
  s += `<circle class="knob" cx="${X(value).toFixed(1)}" cy="${trackY}" r="6.5"/>`;
  s += `<text x="${X(value).toFixed(1)}" y="${trackY - 10}" class="knoblab mid">${value.toFixed(digits)}${esc(unit)}</text>`;
  return s + '</svg>';
}

// ── 연도별 추이 ──────────────────────────────────────────────────────────────
export function trend(points) {
  if (points.length < 2) return '';
  const w = 400, h = 150, padX = 30, padTop = 26, padBot = 24;
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
    s += `<circle class="dot${last ? ' last' : ''}" cx="${X(i).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="${last ? 4.5 : 3}"/>`;
    s += `<text x="${X(i).toFixed(1)}" y="${(Y(p[1]) - 10).toFixed(1)}" class="val mid">${fmt(p[1])}</text>`;
    s += `<text x="${X(i).toFixed(1)}" y="${h - 6}" class="axis mid">${p[0]}</text>`;
  });
  return s + '</svg>';
}

// ── 시군구 안 순위 ───────────────────────────────────────────────────────────
export function ranking(items, activeCode, limit = 12) {
  const shown = items.slice(0, limit);
  if (!shown.some((d) => d.c === activeCode)) {
    const me = items.find((d) => d.c === activeCode);
    if (me) shown[shown.length - 1] = me;
  }
  const max = Math.max(1, ...shown.map((d) => d.t));
  const rowH = 19, gap = 5, nameW = 82, w = 400;
  const h = shown.length * (rowH + gap);
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="인구 순위">`;
  shown.forEach((d, i) => {
    const y = i * (rowH + gap);
    const bw = (d.t / max) * (w - nameW - 52);
    const on = d.c === activeCode;
    s += `<text x="${nameW - 6}" y="${y + rowH / 2 + 4}" class="axis end${on ? ' on' : ''}">${esc(d.n)}</text>`;
    s += `<rect class="bar-r${on ? ' on' : ''}" x="${nameW}" y="${y}" width="${bw}" height="${rowH}" rx="2.5"/>`;
    s += `<text x="${nameW + bw + 6}" y="${y + rowH / 2 + 4}" class="val${on ? ' on' : ''}">${fmt(d.t)}</text>`;
  });
  return s + '</svg>';
}

// ── 두 동네 나란히 비교(마주 보는 막대) ──────────────────────────────────────
export function facing(rows, leftName, rightName) {
  const rowH = 22, gap = 16, midW = 128, side = 118, w = midW + side * 2 + 8;
  const h = rows.length * (rowH + gap) + 16;
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="두 지역 비교">`;
  s += `<text x="${side / 2 + 4}" y="10" class="cap mid">${esc(leftName)}</text>`;
  s += `<text x="${side * 1.5 + midW + 4}" y="10" class="cap mid">${esc(rightName)}</text>`;
  rows.forEach((r, i) => {
    const y = 20 + i * (rowH + gap);
    const max = Math.max(r.a, r.b) || 1;
    const aw = (r.a / max) * side, bw = (r.b / max) * side;
    s += `<text x="${side + midW / 2 + 4}" y="${y + rowH / 2 + 4}" class="axis mid">${esc(r.label)}</text>`;
    s += `<rect class="bar-a${r.a >= r.b ? ' win' : ''}" x="${side - aw + 4}" y="${y}" width="${aw}" height="${rowH}" rx="2.5"/>`;
    s += `<rect class="bar-b${r.b > r.a ? ' win' : ''}" x="${side + midW + 4}" y="${y}" width="${bw}" height="${rowH}" rx="2.5"/>`;
    s += `<text x="${side - aw - 1}" y="${y + rowH / 2 + 4}" class="val end">${esc(r.fa)}</text>`;
    s += `<text x="${side + midW + bw + 9}" y="${y + rowH / 2 + 4}" class="val">${esc(r.fb)}</text>`;
  });
  return s + '</svg>';
}
