#!/usr/bin/env node
// make-og.mjs — 공유 카드(SVG)를 PNG 로 미리 구워 KV 에 올릴 파일을 만든다.
//
// 왜 필요한가: og:image 로 SVG 를 받아 주지 않는 서비스가 많다(카카오톡 포함).
// 워커는 /og/{코드}.png 를 먼저 찾고 없으면 SVG 로 넘기므로, 여기서 구워 둔 곳만
// 링크 미리보기에 그림이 뜬다. 전국 5천 곳을 다 굽는 건 KV 쓰기 한도(무료 1,000회/일)에
// 걸리므로 인구 많은 곳부터 N개만 굽는 게 기본값이다.
//
// 사용:
//   node region/scripts/make-og.mjs              # 인구 상위 300곳
//   node region/scripts/make-og.mjs --top 800
//   node region/scripts/make-og.mjs --code 2711015600   # 특정 동네만
// 그다음:  bash region/scripts/kv-upload.sh
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KVDIR = path.join(ROOT, 'data', 'kv');
const OUT = path.join(ROOT, 'data', 'og');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const top = Number(arg('--top', '300'));
const only = arg('--code', null);

const { ogCard } = await import(path.join(ROOT, 'worker', 'ogcard.js'));
const { unitName } = await import(path.join(ROOT, 'worker', 'render.js'));
const { default: INDEX } = await import(path.join(ROOT, 'worker', 'index.js'));

// 후보 모으기 — 샤드를 한 번씩 읽어 인구 순으로 줄 세운다.
const cands = [];
for (const g of INDEX.sgg) {
  const file = path.join(KVDIR, `sgg-${g.c}.json`);
  if (!fs.existsSync(file)) continue;
  const shard = JSON.parse(fs.readFileSync(file, 'utf8'));
  const unit = unitName(shard.dongs);
  shard.dongs.forEach((d, i) => cands.push({
    dong: d, sgg: shard.self, sido: shard.sido, rank: i + 1, total: shard.dongs.length, unit,
  }));
}
const picked = only
  ? cands.filter((c) => c.dong.c === only)
  : cands.sort((a, b) => b.dong.t - a.dong.t).slice(0, top);

if (!picked.length) { console.error('✗ 대상이 없습니다.'); process.exit(1); }

// playwright 는 이 저장소의 의존성이 아니라 '있으면 쓰는' 도구다.
// 프로젝트에 깔았든 전역에 깔았든 잡히도록 후보를 몇 개 둔다.
const loadChromium = async () => {
  const tries = ['playwright', 'playwright-core', process.env.PLAYWRIGHT_MODULE].filter(Boolean);
  for (const spec of tries) {
    try { return (await import(spec)).chromium; } catch { /* 다음 후보 */ }
  }
  const { execSync } = await import('node:child_process');
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return (await import(`${root}/playwright/index.mjs`)).chromium;
  } catch { /* 없음 */ }
  return null;
};
const chromium = await loadChromium();
if (!chromium) {
  console.error('✗ playwright 가 필요합니다.  npm i -D playwright  (또는 PLAYWRIGHT_MODULE 로 경로 지정)');
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
const bulk = [];
let done = 0;
for (const c of picked) {
  const svg = ogCard({ ...c, month: INDEX.month });
  await page.setContent(`<body style="margin:0">${svg}</body>`, { waitUntil: 'load' });
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 630 } });
  fs.writeFileSync(path.join(OUT, `${c.dong.c}.png`), buf);
  bulk.push({ key: `og:${c.dong.c}`, value: buf.toString('base64'), base64: true });
  if (++done % 50 === 0) process.stdout.write(`  ${done}/${picked.length}\n`);
}
await browser.close();

fs.writeFileSync(path.join(ROOT, 'data', 'og-bulk.json'), JSON.stringify(bulk));
const mb = (fs.statSync(path.join(ROOT, 'data', 'og-bulk.json')).size / 1e6).toFixed(1);
console.log(`✓ 카드 ${bulk.length}장 → data/og/ , data/og-bulk.json (${mb}MB)`);
console.log(`  다음: bash region/scripts/kv-upload.sh   (KV 쓰기 ${bulk.length}회)`);
