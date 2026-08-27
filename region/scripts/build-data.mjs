#!/usr/bin/env node
// build-data.mjs — 원천 CSV(region/data/raw) → 워커가 읽는 JSON 으로 굽는다.
//
// 산출물 둘로 나뉜다.
//   region/worker/index.js   시도·시군구 목록. 작아서 워커 번들에 그대로 넣는다.
//   region/data/kv/*.json    시군구 한 개당 파일 하나. Cloudflare KV 로 올린다.
// 왜 나눴나: 읍면동 전수는 1MB 를 넘어 번들(무료 한도)에 넣기엔 크고, 페이지 한 장을
// 그리는 데 필요한 건 '그 동네가 속한 시군구' 하나뿐이다. 시군구 단위로 쪼개면
// 요청당 KV 읽기 1회로 순위·평균비교·이웃목록까지 전부 그릴 수 있다.
//
// 원자료에 함정이 둘 있다 — 둘 다 여기서 흡수한다.
//   1) 읍·면에는 합계 행이 없고 '리' 행만 있다. 그대로 쓰면 군 지역이 통째로 빈다.
//      → 리를 읍·면으로 합산하고, 리 목록은 그 안에 끼워 둔다.
//   2) 수원·성남처럼 일반구를 둔 시는 시와 구가 둘 다 '시군구' 행으로 들어온다.
//      → 구를 실제 단위로 쓰고, 시는 '구 목록' 페이지로 남긴다(합계 이중계산 방지).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const KV = path.join(ROOT, 'data', 'kv');
const BANDS = 21; // 5세 구간: 0~4 … 95~99, 100세 이상

// ── CSV 파서. 값 안에 쉼표가 들어가므로(따옴표로 감싸져 있다) 직접 훑는다.
function parseCsv(text) {
  const rows = [];
  let row = [], val = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { val += '"'; i++; } else q = false; }
      else val += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(val); val = ''; }
    else if (ch === '\n') { row.push(val); if (row.some((c) => c !== '')) rows.push(row); row = []; val = ''; }
    else if (ch !== '\r') val += ch;
  }
  row.push(val);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

const num = (s) => {
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const readCsv = (file) => parseCsv(fs.readFileSync(path.join(RAW, file), 'utf8'));

// "대구광역시 중구 남산동 (2711015600)" → { full, code }
const splitLabel = (label) => {
  const m = /^(.*?)\s*\((\d{10})\)$/.exec(label.trim());
  return m ? { full: m[1].replace(/\s+/g, ' ').trim(), code: m[2] } : null;
};

const levelOf = (code) => {
  if (code === '1000000000') return 'nation';
  if (code.slice(2) === '00000000') return 'sido';
  if (code.slice(5) === '00000') return 'sgg';
  if (code.slice(8) === '00') return 'dong';
  return 'ri';
};

// 시도 짧은 이름. URL 을 짧게 만드는 핵심이라 규칙을 눈에 보이게 적어 둔다.
const SIDO_SHORT = {
  서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천',
  대전광역시: '대전', 울산광역시: '울산', 광주광역시: '광주', 세종특별자치시: '세종',
  경기도: '경기', 강원특별자치도: '강원', 충청북도: '충북', 충청남도: '충남',
  전라북도: '전북', 전북특별자치도: '전북', 전라남도: '전남',
  경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주',
  전남광주통합특별시: '전남광주',
};
const shortSido = (name) =>
  SIDO_SHORT[name] || name.replace(/(특별자치시|특별자치도|통합특별시|특별시|광역시|도)$/, '') || name;

const blank = () => ({
  t: 0, h: 0, m: 0, f: 0, a: 0, am: 0, af: 0,
  g: new Array(BANDS).fill(0), gf: new Array(BANDS).fill(0), s: new Array(10).fill(0),
  y: new Map(),
});
const addInto = (dst, src, weight) => {
  dst.t += src.t; dst.h += src.h; dst.m += src.m; dst.f += src.f;
  for (let i = 0; i < BANDS; i++) { dst.g[i] += src.g[i]; dst.gf[i] += src.gf[i]; }
  for (let i = 0; i < 10; i++) dst.s[i] += src.s[i];
  // 평균연령은 합이 아니라 인구 가중평균이다.
  weight.a += src.a * src.t; weight.am += src.am * src.m; weight.af += src.af * src.f;
  for (const [yr, v] of src.y) weight.y.set(yr, (weight.y.get(yr) || 0) + v);
};

const main = () => {
  const month = fs.readFileSync(path.join(RAW, 'month.txt'), 'utf8').trim(); // YYYY-MM
  const [, M] = month.split('-');
  const stamp = month.replace('-', '');

  // ── 1) 기준 월: 인구·세대 (리까지 전부 읽는다)
  const rec = new Map();
  for (const r of readCsv(`pplt-${stamp}.csv`).slice(1)) {
    const s = splitLabel(r[0]); if (!s) continue;
    rec.set(s.code, { c: s.code, full: s.full, lv: levelOf(s.code), ...blank(),
      t: num(r[1]), h: num(r[2]), m: num(r[4]), f: num(r[5]) });
  }

  // ── 2) 5세 구간 연령별. 열: [라벨] 계(총,구간,21) 남(총,구간,21) 여(총,구간,21)
  const mOff = 1 + (2 + BANDS) + 2, fOff = 1 + (2 + BANDS) * 2 + 2;
  for (const r of readCsv(`age-${stamp}.csv`).slice(1)) {
    const s = splitLabel(r[0]); if (!s) continue;
    const o = rec.get(s.code); if (!o) continue;
    for (let i = 0; i < BANDS; i++) { o.g[i] = num(r[mOff + i]); o.gf[i] = num(r[fOff + i]); }
  }

  // ── 3) 세대원수별 세대수 (1인 … 10인이상)
  for (const r of readCsv(`hsmb-${stamp}.csv`).slice(1)) {
    const s = splitLabel(r[0]); if (!s) continue;
    const o = rec.get(s.code); if (!o) continue;
    for (let i = 0; i < 10; i++) o.s[i] = num(r[2 + i]);
  }

  // ── 4) 평균연령 (계/남/여)
  for (const r of readCsv(`avg-${stamp}.csv`).slice(1)) {
    const s = splitLabel(r[0]); if (!s) continue;
    const o = rec.get(s.code); if (!o) continue;
    o.a = num(r[1]); o.am = num(r[2]); o.af = num(r[3]);
  }

  // ── 5) 연도별 추이 (같은 달 기준)
  const pastYears = fs.readdirSync(RAW)
    .map((f) => /^pplt-(\d{4})(\d{2})\.csv$/.exec(f))
    .filter((m) => m && m[2] === M).map((m) => m[1]).sort();
  for (const y of pastYears) {
    for (const r of readCsv(`pplt-${y}${M}.csv`).slice(1)) {
      const s = splitLabel(r[0]); if (!s) continue;
      const o = rec.get(s.code); if (!o) continue;
      const v = num(r[1]);
      if (v > 0) o.y.set(Number(y), v); // 그 해 자료가 없으면 0 으로 온다 — 점을 찍지 않는다
    }
  }

  // ── 6) 리 → 읍·면 합산. 원자료에 읍·면 합계 행이 없어서 여기서 만든다.
  const riByParent = new Map();
  for (const o of rec.values()) {
    if (o.lv !== 'ri') continue;
    const pc = o.c.slice(0, 8) + '00';
    if (!riByParent.has(pc)) riByParent.set(pc, []);
    riByParent.get(pc).push(o);
  }
  for (const [pc, ris] of riByParent) {
    const exists = rec.get(pc);
    if (exists && exists.t > 0) continue; // 이미 합계 행이 있으면 그대로 둔다
    const agg = { c: pc, lv: 'dong', ...blank() };
    const w = { a: 0, am: 0, af: 0, y: new Map() };
    for (const ri of ris) addInto(agg, ri, w);
    agg.a = agg.t ? +(w.a / agg.t).toFixed(1) : 0;
    agg.am = agg.m ? +(w.am / agg.m).toFixed(1) : 0;
    agg.af = agg.f ? +(w.af / agg.f).toFixed(1) : 0;
    agg.y = w.y;
    // 읍·면 이름 = 리 전체이름에서 마지막 마디(리 이름)를 뗀 것
    const sample = ris[0].full.split(' ');
    agg.full = sample.slice(0, -1).join(' ');
    // 리 목록(이름·인구)은 페이지에 그대로 보여 준다
    agg.ri = ris.filter((x) => x.t > 0)
      .sort((a, b) => b.t - a.t)
      .map((x) => [x.full.split(' ').pop(), x.t]);
    rec.set(pc, agg);
  }

  // ── 7) 계층 정리 — 표시용 이름은 '부모 이름을 뗀 나머지'
  const parentCode = (o) => (o.lv === 'dong' ? o.c.slice(0, 5) + '00000'
    : o.lv === 'sgg' ? o.c.slice(0, 2) + '00000000' : null);
  for (const o of rec.values()) {
    if (o.lv === 'ri' || o.lv === 'nation') continue;
    const p = rec.get(parentCode(o) || '');
    o.n = p && o.full.startsWith(p.full) ? o.full.slice(p.full.length).trim() : o.full;
    if (!o.n) o.n = o.full;
  }

  const nation = rec.get('1000000000');
  const sidos = [...rec.values()].filter((o) => o.lv === 'sido').sort((a, b) => a.c.localeCompare(b.c));
  const allSgg = [...rec.values()].filter((o) => o.lv === 'sgg').sort((a, b) => a.c.localeCompare(b.c));
  const dongs = [...rec.values()].filter((o) => o.lv === 'dong' && o.t > 0);

  // ── 8) 일반구를 둔 시 가려내기.
  //    코드로만 보면 안 된다 — 충북 영동군(43740)과 증평군(43745)처럼 앞자리가 겹치는
  //    남남인 군이 있어서, 한때 증평군을 영동군의 '구'로 잡았다. 이름으로 판정한다:
  //    구는 시의 전체 이름으로 시작한다("경기도 수원시" ⊂ "경기도 수원시 장안구").
  const kidsOf = new Map(); // 시 코드 → [구, ...]
  for (const g of allSgg) {
    const parent = allSgg.find((x) => x.c !== g.c && g.full.startsWith(x.full + ' '));
    if (!parent) continue;
    if (!kidsOf.has(parent.c)) kidsOf.set(parent.c, []);
    kidsOf.get(parent.c).push(g);
  }

  // URL 조각(slug) — 이름의 마지막 마디만 쓴다("성남시 분당구" → "분당구").
  // 세종처럼 시도명 == 시군구명 인 곳은 시도 약칭을 쓴다(/세종/세종/반곡동).
  for (const g of allSgg) {
    const sido = rec.get(g.c.slice(0, 2) + '00000000');
    g.slug = g.full === sido.full ? shortSido(sido.full) : g.n.split(' ').pop();
  }
  // 같은 시도 안에서 slug 가 겹치면 주소가 어디로 갈지 모른다 — 빌드에서 잡는다.
  const seen = new Map();
  for (const g of allSgg) {
    const key = `${g.c.slice(0, 2)}|${g.slug}`;
    if (seen.has(key)) throw new Error(`시도 안에서 주소가 겹칩니다: ${g.full} vs ${seen.get(key).full} (${g.slug})`);
    seen.set(key, g);
  }

  const dongsOf = (g) => dongs.filter((d) => d.c.slice(0, 5) === g.c.slice(0, 5))
    .sort((a, b) => b.t - a.t);

  // ── 9) 워커 번들용 index.js
  //    기준선(전국·시도 대비 어디쯤인지)을 그리려면 비교 대상의 연령·세대 분포도
  //    같이 있어야 한다. 전국은 번들에, 시도는 각 샤드에 통째로 넣는다(둘 다 작다).
  const pack = (o) => ({
    c: o.c, n: o.n, t: o.t, h: o.h, m: o.m, f: o.f, a: o.a, am: o.am, af: o.af,
    g: o.g, gf: o.gf, hs: o.s,   // hs = 세대원수별 세대수. 시도 약칭 키(s)와 겹치지 않게 이름을 나눴다
    y: [...o.y.entries()].sort((a, b) => a[0] - b[0]),
    ...(o.ri?.length ? { ri: o.ri } : {}),
  });
  const slim = (o) => ({ c: o.c, n: o.n, t: o.t, h: o.h, a: o.a });
  const index = {
    month, built: new Date().toISOString(),
    nation: { ...pack(nation), n: '전국' },
    sido: sidos.map((o) => ({ ...slim(o), s: shortSido(o.full) })),
    sgg: allSgg.map((o) => ({
      ...slim(o), u: o.slug, p: o.c.slice(0, 2) + '00000000',
      d: dongsOf(o).length,
      ...(kidsOf.has(o.c) ? { k: kidsOf.get(o.c).map((x) => x.c) } : {}),
    })),
  };
  fs.mkdirSync(path.join(ROOT, 'worker'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'worker', 'index.js'),
    `// 자동 생성 — region/scripts/build-data.mjs 가 만든다. 직접 고치지 말 것.\nexport default ${JSON.stringify(index)};\n`);

  // ── 10) KV 샤드 — 시군구 하나당 파일 하나
  fs.rmSync(KV, { recursive: true, force: true });
  fs.mkdirSync(KV, { recursive: true });
  let bytes = 0;
  for (const g of allSgg) {
    const sido = rec.get(g.c.slice(0, 2) + '00000000');
    const json = JSON.stringify({
      month,
      sido: { ...pack(sido), n: sido.full, s: shortSido(sido.full) },
      self: { ...pack(g), u: g.slug },
      dongs: dongsOf(g).map(pack),
    });
    bytes += Buffer.byteLength(json);
    fs.writeFileSync(path.join(KV, `sgg-${g.c}.json`), json);
  }

  // ── 11) 이름 색인 — 짧은 주소(/남산동)와 검색에 쓴다.
  const names = {};
  const add = (name, code) => { (names[name] ||= []).push(code); };
  for (const d of dongs) add(d.n, d.c);
  for (const g of allSgg) { add(g.slug, g.c); if (g.n !== g.slug) add(g.n, g.c); }
  fs.writeFileSync(path.join(KV, 'names.json'), JSON.stringify(names));

  fs.writeFileSync(path.join(KV, 'meta.json'), JSON.stringify({
    month, built: index.built,
    counts: { sido: sidos.length, sgg: allSgg.length, dong: dongs.length },
  }));

  // ── 12) KV 일괄 업로드 파일 (키를 하나씩 올리면 271번 호출해야 한다)
  const bulk = fs.readdirSync(KV).map((f) => ({
    key: f === 'names.json' ? 'names' : f === 'meta.json' ? 'meta' : `sgg:${f.slice(4, -5)}`,
    value: fs.readFileSync(path.join(KV, f), 'utf8'),
  }));
  fs.writeFileSync(path.join(ROOT, 'data', 'kv-bulk.json'), JSON.stringify(bulk));

  const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
  const merged = [...riByParent.keys()].length;
  console.log(`기준 월 ${month} (추이: ${pastYears.join(', ')})`);
  console.log(`  시도 ${sidos.length} · 시군구 ${allSgg.length}(일반구 모시 ${kidsOf.size}) · 읍면동 ${dongs.length}`);
  console.log(`  리 → 읍·면 합산: ${merged}곳`);
  console.log(`  worker/index.js    ${kb(fs.statSync(path.join(ROOT, 'worker', 'index.js')).size)}`);
  console.log(`  data/kv/           샤드 ${allSgg.length}개, 합계 ${kb(bytes)} (평균 ${kb(bytes / allSgg.length)})`);
  console.log(`  data/kv/names.json ${kb(fs.statSync(path.join(KV, 'names.json')).size)}`);
  console.log(`  data/kv-bulk.json  ${kb(fs.statSync(path.join(ROOT, 'data', 'kv-bulk.json')).size)} (키 ${bulk.length}개)`);
  console.log(`\n다음: node region/scripts/test-routes.mjs`);
};

main();
