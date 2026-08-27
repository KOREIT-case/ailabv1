#!/usr/bin/env node
// fetch-jumin.mjs — 주민등록 인구통계 원천 CSV 를 region/data/raw/ 로 내려받는다.
//
// 받는 것
//   · 최신 월  : 인구·세대 / 5세구간 연령별 / 세대원수별 세대수 / 평균연령
//   · 과거 4년 : 같은 달의 인구·세대 (연도별 추이용)
// 이미 받아 둔 파일은 건너뛴다(--force 로 다시 받음). 통계는 확정 후 바뀌지 않으므로
// 과거 월 파일은 사실상 영구 캐시다.
//
// 사용:
//   node region/scripts/fetch-jumin.mjs                 # 최신 월 자동 감지
//   node region/scripts/fetch-jumin.mjs --month 2026-06 # 특정 월 고정
//   node region/scripts/fetch-jumin.mjs --years 6       # 추이 연도 수(기본 5)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { latestMonth, availableYears, download, retry } from './jumin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const force = argv.includes('--force');
const years = Number(arg('--years', '5'));

const main = async () => {
  fs.mkdirSync(RAW, { recursive: true });

  let year, month;
  const fixed = arg('--month', null);
  if (fixed) {
    const m = /^(\d{4})-(\d{2})$/.exec(fixed);
    if (!m) throw new Error('--month 은 YYYY-MM 형식');
    [, year, month] = m;
  } else {
    ({ year, month } = await retry(latestMonth, { label: '최신 연월 조회' }));
  }
  console.log(`기준 월: ${year}년 ${month}월`);

  // 법정동 통계가 없는 연도는 '전부 0' CSV 가 오므로 아예 받지 않는다.
  const avail = await retry(availableYears, { label: '조회 가능 연도' });
  const wanted = Array.from({ length: years }, (_, i) => String(Number(year) - i))
    .filter((y) => avail.includes(y))
    .sort();
  console.log(`추이 연도: ${wanted.join(', ')} (사이트 제공 범위 ${avail[0]}~${avail.at(-1)})`);

  // 최신 월 4종 + 과거 연도의 인구·세대
  const jobs = [
    ...['pplt', 'age', 'hsmb', 'avg'].map((k) => ({ kind: k, year, month })),
    ...wanted.filter((y) => y !== year).map((y) => ({ kind: 'pplt', year: y, month })),
  ];

  for (const { kind, year: y, month: m } of jobs) {
    const file = path.join(RAW, `${kind}-${y}${m}.csv`);
    if (!force && fs.existsSync(file) && fs.statSync(file).size > 1000) {
      console.log(`  · ${path.basename(file)} (캐시)`);
      continue;
    }
    const csv = await retry(() => download(kind, y, m), { label: `${kind} ${y}-${m}` });
    fs.writeFileSync(file, csv, 'utf8');
    const rows = csv.split('\n').length - 1;
    console.log(`  ✓ ${path.basename(file)} — ${rows.toLocaleString()}행, ${(Buffer.byteLength(csv) / 1e6).toFixed(1)}MB`);
  }

  fs.writeFileSync(path.join(RAW, 'month.txt'), `${year}-${month}\n`);
  console.log(`\n완료. 다음: node region/scripts/build-data.mjs`);
};

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
