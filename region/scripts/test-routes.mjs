#!/usr/bin/env node
// test-routes.mjs — 배포 전에 주소 규칙과 숫자가 맞는지 확인한다.
//
// 이 서비스의 사고는 두 종류다.
//   1) 주소 규칙이 어긋남 — 짧은 주소가 엉뚱한 데로 가거나 404
//   2) 숫자가 어긋남 — 법정동 합계가 시군구 합계와 안 맞음(열 위치를 잘못 읽었을 때)
// 둘 다 눈으로는 잘 안 보이므로 스크립트로 잡는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KVDIR = path.join(ROOT, 'data', 'kv');

globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const env = { REGION_KV: { async get(key, type) {
  if (key.startsWith('og:')) {
    const pf = path.join(ROOT, 'data', 'og', `${key.slice(3)}.png`);
    if (!fs.existsSync(pf)) return null;
    const buf = fs.readFileSync(pf);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const f = key === 'names' ? 'names.json' : key === 'meta' ? 'meta.json'
    : key.startsWith('sgg:') ? `sgg-${key.slice(4)}.json` : null;
  const p = f && path.join(KVDIR, f);
  if (!p || !fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8');
  return type === 'json' ? JSON.parse(raw) : raw;
} } };
const ctx = { waitUntil: () => {} };
const { default: worker } = await import(path.join(ROOT, 'worker', 'worker.js'));
const { default: INDEX } = await import(path.join(ROOT, 'worker', 'index.js'));
const V = await import(path.join(ROOT, 'worker', 'render.js'));

let pass = 0; const fails = [];
const ok = (cond, label, detail = '') => {
  if (cond) pass++; else fails.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

const hit = async (p) => {
  const res = await worker.fetch(new Request(`https://x.dev${encodeURI(p)}`), env, ctx);
  return { status: res.status, loc: res.headers.get('location') && decodeURIComponent(res.headers.get('location')), res };
};

// ── 1) 주소 규칙
const cases = [
  ['/', 200], ['/대구', 200], ['/대구/중구', 200], ['/대구/중구/남산동', 200],
  ['/대구광역시/중구/남산동', 301, '/대구/중구/남산동'],   // 전체 이름 → 짧은 이름
  ['/2711015600', 301, '/대구/중구/남산동'],                // 법정동코드
  ['/c/g52bw', 301, '/대구/중구/남산동'],                   // 짧은 주소
  ['/세종/반곡동', 301, '/세종/세종/반곡동'],                // 시군구가 하나뿐인 시도
  ['/robots.txt', 200], ['/sitemap.xml', 200], ['/sitemap/2711000000.xml', 200],
  ['/api/meta', 200], ['/api/대구/중구/남산동', 200], ['/api/2711015600', 200],
  ['/s?q=남산', 200],
  ['/경기/정자동', 200],                                     // 시군구 건너뛰기(경기에 정자동 여럿 → 후보)
  ['/경기/분당구/정자동', 200], ['/경기/성남시', 200],        // 일반구 · 일반구를 둔 시
  ['/충북/영동군/영동읍', 200],                              // 리를 합산해 만든 읍
  ['/vs/중구 남산동/대봉동', 200],                           // 견주기 (이름이 겹치면 시군구를 앞에)
  ['/vs/남산동/대봉동', 200],                                // 겹치는 이름 → 후보 목록(200)
  ['/vs/중구 남산동/중구 대봉동', 302, '/vs/중구 남산동/대봉동'], // 불필요한 수식은 떼어 정식 주소로
  ['/vs?a=중구 남산동&b=대봉동', 302, '/vs/중구 남산동/대봉동'],
  ['/og/2711015600.svg', 200],                               // 공유 카드
  ['/대구/중구/남산동?card', 200],                            // 캡처용 화면
  ['/없는동네이름', 404], ['/대구/없는구/없는동', 404], ['/a/b/c/d', 404],
];
for (const [p, want, loc] of cases) {
  const r = await hit(p);
  ok(r.status === want, `${p} → ${want}`, `실제 ${r.status}`);
  if (loc) ok(r.loc === loc, `${p} → ${loc}`, `실제 ${r.loc}`);
}

// 짧은 주소 왕복
const { toShort, fromShort } = await import(path.join(ROOT, 'worker', 'code.js'));
ok(fromShort(toShort('2711015600')) === '2711015600', '짧은 주소 왕복');
ok(toShort('2711015600').length <= 6, '짧은 주소는 6글자 이하', toShort('2711015600'));

// 중복 이름은 후보 목록(200)으로 — 아무 데나 보내지 않는다
const dup = await hit('/중구');
ok(dup.status === 200, '/중구 (여러 시도에 있음) → 후보 목록', `실제 ${dup.status}`);

// ── 2) 숫자 정합성 — 법정동 합계 vs 시군구 합계
let checked = 0, offPop = 0, offHh = 0;
const byCode = new Map(INDEX.sgg.map((g) => [g.c, g]));
for (const g of INDEX.sgg) {
  const shard = JSON.parse(fs.readFileSync(path.join(KVDIR, `sgg-${g.c}.json`), 'utf8'));
  checked++;
  // 일반구를 둔 시는 밑에 동이 아니라 구가 달린다 — 구 합계와 맞는지 본다.
  if (g.k?.length) {
    const kidPop = g.k.reduce((a, c) => a + byCode.get(c).t, 0);
    const kidHh = g.k.reduce((a, c) => a + byCode.get(c).h, 0);
    if (kidPop !== g.t) offPop++;
    if (kidHh !== g.h) offHh++;
    continue;
  }
  const sum = shard.dongs.reduce((a, d) => a + d.t, 0);
  const sumH = shard.dongs.reduce((a, d) => a + d.h, 0);
  if (sum !== shard.self.t) offPop++;
  if (sumH !== shard.self.h) offHh++;
  // 연령 구간 합계 == 총인구
  for (const d of shard.dongs.slice(0, 3)) {
    const g10 = d.g.reduce((a, b) => a + b, 0), f10 = d.gf.reduce((a, b) => a + b, 0);
    ok(g10 === d.m && f10 === d.f, `${shard.self.n} ${d.n} 연령합 = 남/여 인구`, `${g10}/${d.m}, ${f10}/${d.f}`);
  }
}
ok(offPop === 0, '법정동 인구 합계 = 시군구 인구', `어긋난 시군구 ${offPop}곳`);
ok(offHh === 0, '법정동 세대 합계 = 시군구 세대', `어긋난 시군구 ${offHh}곳`);

// 전국 합계
const sidoSum = INDEX.sido.reduce((a, s) => a + s.t, 0);
ok(sidoSum === INDEX.nation.t, '시도 합계 = 전국 인구', `${sidoSum} vs ${INDEX.nation.t}`);

// ── 2-b) 전 지역 훑기 — 인구 1명짜리 동, 세대 0인 곳처럼 극단값에서 터지지 않는지.
//        기준선 게이지는 나눗셈이 많아서 이런 데서 조용히 NaN 이 되거나 예외가 난다.
{
  let swept = 0, bad = 0;
  for (const g of INDEX.sgg) {
    const shard = JSON.parse(fs.readFileSync(path.join(KVDIR, `sgg-${g.c}.json`), 'utf8'));
    if (!shard.dongs.length) continue;
    // 시군구마다 가장 작은 곳 하나 + 가장 큰 곳 하나
    for (const d of [shard.dongs[0], shard.dongs[shard.dongs.length - 1]]) {
      swept++;
      try {
        const page = V.dongPage({
          dong: d, sgg: shard.self, sido: shard.sido, nation: INDEX.nation,
          siblings: shard.dongs, path: '/x', origin: 'https://x.dev', month: INDEX.month,
          shortUrl: 'https://x.dev/c/x',
        });
        if (/NaN|undefined|Infinity/.test(page)) { bad++; if (bad < 4) console.log('   ! 값 이상:', shard.self.n, d.n); }
      } catch (e) { bad++; if (bad < 4) console.log('   ! 예외:', shard.self.n, d.n, e.message); }
    }
  }
  ok(bad === 0, `전 시군구 최대·최소 동네 ${swept}곳 렌더`, `문제 ${bad}곳`);
}

// ── 3) 광고·외부요청이 정말 없는지 (HTML 안에 외부 호스트가 있으면 실패)
const page = await (await worker.fetch(new Request('https://x.dev/%EB%8C%80%EA%B5%AC/%EC%A4%91%EA%B5%AC/%EB%82%A8%EC%82%B0%EB%8F%99'), env, ctx)).text();
const externals = [...page.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1])
  .filter((h) => !['schema.org', 'www.w3.org', 'jumin.mois.go.kr', 'www.sitemaps.org', 'x.dev'].includes(h));
ok(externals.length === 0, '외부 호스트 참조 0개', externals.join(', '));
ok(!/googlesyndication|doubleclick|adsbygoogle|googletagmanager|analytics/i.test(page), '광고·추적 스크립트 없음');
ok(!/<img|<iframe/i.test(page), '이미지·iframe 없음(요청 0개)');

console.log(`\n${fails.length ? '✗' : '✓'} ${pass}개 통과${fails.length ? `, ${fails.length}개 실패` : ''} (시군구 ${checked}곳 검산)`);
for (const f of fails) console.log(`   ✗ ${f}`);
process.exit(fails.length ? 1 : 0);
