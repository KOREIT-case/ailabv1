// worker.js — 라우팅과 자료 조회.
//
// 설계 요지
//   · 시도·시군구 목록(index.json)은 작아서 번들에 넣는다 → 대부분의 요청이 KV 0회.
//   · 읍면동 상세는 '시군구 한 덩어리'로 KV 에 있다 → 상세 페이지 1장 = KV 읽기 1회.
//     한 덩어리 안에 형제 동네가 다 들어 있어서 순위·평균비교·이웃목록까지 그 한 번으로 끝난다.
//   · 주소를 짧게 만드는 규칙을 라우터가 직접 안다. /대구/중구/남산동 이 정식 주소이고,
//     /중구/남산동 · /남산동 · /c/{코드} 는 모두 정식 주소로 301 한다.
import INDEX from './index.js';
import * as V from './render.js';
import { toShort, fromShort } from './code.js';
import { ogCard } from './ogcard.js';

// ── 번들 색인에서 조회표를 만든다(콜드스타트 1회) ───────────────────────────
const SIDO_BY_KEY = new Map();   // '대구' | '대구광역시' → sido
const SGG_BY_KEY = new Map();    // '2700000000|중구' → sgg
const SGG_BY_NAME = new Map();   // '중구' → [sgg, ...]
const SGG_BY_CODE = new Map();
for (const s of INDEX.sido) {
  SIDO_BY_KEY.set(s.s, s);
  SIDO_BY_KEY.set(s.n, s);
}
for (const g of INDEX.sgg) {
  // g.u 가 주소 조각("분당구"), g.n 은 표시 이름("성남시 분당구"). 둘 다 받아 준다.
  SGG_BY_KEY.set(`${g.p}|${g.u}`, g);
  if (g.n !== g.u) SGG_BY_KEY.set(`${g.p}|${g.n}`, g);
  for (const key of new Set([g.u, g.n])) {
    if (!SGG_BY_NAME.has(key)) SGG_BY_NAME.set(key, []);
    SGG_BY_NAME.get(key).push(g);
  }
  SGG_BY_CODE.set(g.c, g);
}
const sidoOf = (sgg) => SIDO_BY_KEY.get(INDEX.sido.find((s) => s.c === sgg.p)?.s);

// ── KV (isolate 안에서 재사용) ───────────────────────────────────────────────
const memo = new Map();
async function kv(env, key) {
  if (memo.has(key)) return memo.get(key);
  const v = await env.REGION_KV.get(key, 'json');
  if (v) { if (memo.size > 300) memo.clear(); memo.set(key, v); }
  return v;
}
const shardOf = (env, sggCode) => kv(env, `sgg:${sggCode}`);
const namesIndex = (env) => kv(env, 'names');

const dongIn = (shard, name) => shard?.dongs.find((d) => d.n === name) || null;

// 시도의 연령·세대 분포는 번들 색인에 없다(요약만 있다). 아무 샤드나 하나 열면 들어 있다.
async function sidoFullOf(env, sido) {
  const any = INDEX.sgg.find((g) => g.p === sido.c);
  if (!any) return sido;
  const shard = await shardOf(env, any.c);
  return shard?.sido || sido;
}

// ── 응답 도우미 ──────────────────────────────────────────────────────────────
const html = (body, status = 200, maxAge = 21600) => new Response(body, {
  status,
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': `public, max-age=600, s-maxage=${maxAge}`,
    // 광고가 없다는 걸 정책으로도 박아 둔다 — 외부에서 아무것도 못 불러온다.
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  },
});
const json = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=600, s-maxage=21600',
    'access-control-allow-origin': '*',
  },
});
const redirect = (to, status = 301) => new Response(null, {
  status, headers: { location: to, 'cache-control': 'public, max-age=86400' },
});

const url = (...parts) => '/' + parts.map(encodeURIComponent).join('/');
const canonicalDong = (sido, sgg, dong) => url(sido.s, sgg.u, dong.n);

// ── 주소 해석 ────────────────────────────────────────────────────────────────
// 반환: {kind:'dong'|'sgg'|'sido'|'choose'|'none', ...}
async function resolve(env, segs) {
  const [a, b, c] = segs;

  if (segs.length === 3) {
    const sido = SIDO_BY_KEY.get(a);
    if (!sido) return { kind: 'none' };
    const sgg = SGG_BY_KEY.get(`${sido.c}|${b}`);
    if (!sgg) return { kind: 'none' };
    const shard = await shardOf(env, sgg.c);
    const dong = dongIn(shard, c);
    return dong ? { kind: 'dong', sido, sgg, dong, shard } : { kind: 'none' };
  }

  if (segs.length === 2) {
    const sido = SIDO_BY_KEY.get(a);
    // /대구/중구 — 시군구 페이지
    if (sido) {
      const sgg = SGG_BY_KEY.get(`${sido.c}|${b}`);
      if (sgg) return { kind: 'sgg', sido, sgg, shard: await shardOf(env, sgg.c) };
      // /세종/반곡동, /경기/정자동 — 시군구를 건너뛴 경우. 이름 색인에서 그 시도 것만 고른다.
      // (시군구를 앞에서부터 뒤져 보는 방식은 시군구가 많은 시도에서 앞 몇 곳만 보게 돼
      //  '어떤 동은 되고 어떤 동은 안 되는' 이상한 동작이 된다.)
      const names = await namesIndex(env);
      const inSido = (names?.[b] || []).filter((code) => code.slice(0, 2) === sido.c.slice(0, 2));
      const found = [];
      for (const code of inSido.slice(0, 20)) {
        const g = SGG_BY_CODE.get(code.slice(0, 5) + '00000');
        if (!g) continue;
        const shard = await shardOf(env, g.c);
        const dong = shard?.dongs.find((x) => x.c === code);
        if (dong) found.push({ sido, sgg: g, dong, shard });
      }
      if (found.length === 1) return { kind: 'dong', ...found[0] };
      if (found.length > 1) return { kind: 'choose', name: b, hits: found };
      return { kind: 'none' };
    }
    // /중구/남산동 — 시군구 이름이 전국에서 유일할 때만
    const cands = SGG_BY_NAME.get(a) || [];
    const hits = [];
    for (const g of cands) {
      const shard = await shardOf(env, g.c);
      const dong = dongIn(shard, b);
      if (dong) hits.push({ sido: sidoOf(g), sgg: g, dong, shard });
    }
    if (hits.length === 1) return { kind: 'dong', ...hits[0] };
    if (hits.length > 1) return { kind: 'choose', name: b, hits };
    return { kind: 'none' };
  }

  if (segs.length === 1) {
    const sido = SIDO_BY_KEY.get(a);
    if (sido) return { kind: 'sido', sido, sidoFull: await sidoFullOf(env, sido) };
    const cands = SGG_BY_NAME.get(a) || [];
    if (cands.length === 1) return { kind: 'sgg', sido: sidoOf(cands[0]), sgg: cands[0], shard: await shardOf(env, cands[0].c) };
    if (cands.length > 1) {
      return { kind: 'choose', name: a, hits: cands.map((g) => ({ sido: sidoOf(g), sgg: g })) };
    }
    // 동 이름 하나만 적은 경우 — 이름 색인에서 푼다
    const names = await namesIndex(env);
    const codes = names?.[a] || [];
    if (!codes.length) return { kind: 'none' };
    const hits = [];
    for (const code of codes.slice(0, 30)) {
      const sgg = SGG_BY_CODE.get(code.slice(0, 5) + '00000');
      if (!sgg) continue;
      const shard = await shardOf(env, sgg.c);
      const dong = shard?.dongs.find((d) => d.c === code);
      if (dong) hits.push({ sido: sidoOf(sgg), sgg, dong, shard });
    }
    if (hits.length === 1) return { kind: 'dong', ...hits[0] };
    if (hits.length > 1) return { kind: 'choose', name: a, hits };
    return { kind: 'none' };
  }
  return { kind: 'none' };
}

async function byCode(env, code) {
  if (code.slice(5) === '00000') {
    const sgg = SGG_BY_CODE.get(code);
    return sgg ? { kind: 'sgg', sido: sidoOf(sgg), sgg, shard: await shardOf(env, sgg.c) } : { kind: 'none' };
  }
  if (code.slice(2) === '00000000') {
    const sido = INDEX.sido.find((s) => s.c === code);
    return sido ? { kind: 'sido', sido, sidoFull: await sidoFullOf(env, sido) } : { kind: 'none' };
  }
  const sgg = SGG_BY_CODE.get(code.slice(0, 5) + '00000');
  if (!sgg) return { kind: 'none' };
  const shard = await shardOf(env, sgg.c);
  const dong = shard?.dongs.find((d) => d.c === code);
  return dong ? { kind: 'dong', sido: sidoOf(sgg), sgg, dong, shard } : { kind: 'none' };
}

// ── 페이지 조립 ──────────────────────────────────────────────────────────────
// 모든 화면이 '전국'을 기준선으로 쓰므로 어디서나 INDEX.nation 을 함께 넘긴다.
function renderResolved(r, { origin, path, card = false }) {
  const month = INDEX.month;
  const nation = INDEX.nation;
  if (r.kind === 'dong') {
    const sorted = r.shard.dongs;
    const rank = sorted.findIndex((x) => x.c === r.dong.c) + 1;
    if (card) {
      return V.cardPage({
        dong: r.dong, sgg: r.shard.self, sido: r.shard.sido, nation, month, origin, path,
        rank, total: sorted.length, unit: V.unitName(sorted),
        svg: ogCard({ dong: r.dong, sgg: r.shard.self, sido: r.shard.sido, month,
          rank, total: sorted.length, unit: V.unitName(sorted) }),
      });
    }
    return V.dongPage({
      dong: r.dong, sgg: r.shard.self, sido: r.shard.sido, nation, siblings: sorted,
      path, origin, month, shortUrl: `${origin}/c/${toShort(r.dong.c)}`,
    });
  }
  if (r.kind === 'sgg') {
    const meta = SGG_BY_CODE.get(r.sgg.c);
    // 수원·성남처럼 일반구를 둔 시는 밑에 동이 아니라 구가 달린다.
    if (meta?.k?.length) {
      return V.cityPage({ sgg: r.shard.self, sido: r.shard.sido, nation, origin, path, month,
        gus: meta.k.map((c) => SGG_BY_CODE.get(c)).filter(Boolean) });
    }
    return V.sggPage({ sgg: r.shard.self, sido: r.shard.sido, nation, dongs: r.shard.dongs, origin, path, month });
  }
  if (r.kind === 'sido') {
    // r.sido 는 번들 색인의 요약본이라 연령 분포가 없다 — 샤드에 실어 둔 전체본을 쓴다.
    return V.sidoPage({ sido: r.sidoFull || r.sido, nation,
      sggs: INDEX.sgg.filter((g) => g.p === r.sido.c), origin, path, month });
  }
  return null;
}

const chooseList = (r, origin) => V.listPage({
  heading: `'${r.name}' — 어느 곳인가요?`,
  sub: `같은 이름이 ${r.hits.length}곳 있습니다. 골라 주세요.`,
  origin, month: INDEX.month,
  items: r.hits.map((h) => h.dong
    ? { href: canonicalDong(h.sido, h.sgg, h.dong), label: `${h.sido.s} ${h.sgg.n} ${h.dong.n}`, t: h.dong.t, a: h.dong.a }
    : { href: url(h.sido.s, h.sgg.n), label: `${h.sido.s} ${h.sgg.n}`, t: h.sgg.t, a: h.sgg.a }),
});

// 검색 — 이름 색인에서 부분일치. 사전 없이도 "남산" 만 쳐도 나오게 한다.
async function search(env, q, origin) {
  const names = (await namesIndex(env)) || {};
  const keys = Object.keys(names);
  const exact = keys.filter((k) => k === q);
  const starts = keys.filter((k) => k !== q && k.startsWith(q));
  const inside = keys.filter((k) => !k.startsWith(q) && k.includes(q));
  const picked = [...exact, ...starts, ...inside].slice(0, 40);

  const items = [];
  for (const name of picked) {
    for (const code of names[name].slice(0, 8)) {
      if (items.length >= 60) break;
      const sggCode = code.slice(5) === '00000' ? code : code.slice(0, 5) + '00000';
      const sgg = SGG_BY_CODE.get(sggCode);
      if (!sgg) continue;
      const sido = sidoOf(sgg);
      if (code === sggCode) { items.push({ href: url(sido.s, sgg.u), label: `${sido.s} ${sgg.n}`, t: sgg.t, a: sgg.a }); continue; }
      const shard = await shardOf(env, sggCode);
      const dong = shard?.dongs.find((d) => d.c === code);
      if (dong) items.push({ href: canonicalDong(sido, sgg, dong), label: `${sido.s} ${sgg.n} ${dong.n}`, t: dong.t, a: dong.a });
    }
  }
  return V.listPage({
    heading: `'${q}' 검색 결과`, sub: `${items.length}곳을 찾았습니다.`,
    items, origin, month: INDEX.month, query: q,
  });
}

// ── API ──────────────────────────────────────────────────────────────────────
function apiPayload(r, origin) {
  const base = { month: INDEX.month, source: '행정안전부 주민등록 인구통계', license: '공공누리 제1유형' };
  if (r.kind === 'dong') {
    const d = V.derive(r.dong);
    return {
      ...base, level: '법정동', code: r.dong.c,
      name: { sido: r.shard.sido.n, sgg: r.shard.self.n, dong: r.dong.n },
      population: { total: r.dong.t, male: r.dong.m, female: r.dong.f },
      households: { total: r.dong.h, perHousehold: +d.perHousehold.toFixed(2), bySize: r.dong.hs },
      age: { average: r.dong.a, male: r.dong.am, female: r.dong.af,
        bandsBy10: { labels: V.TEN_LABELS, male: d.m10, female: d.f10 },
        structure: { young0_14: d.young, working15_64: d.work, old65plus: d.old } },
      trend: r.dong.y.map(([year, total]) => ({ year, month: Number(INDEX.month.slice(5)), total })),
      rank: { within: r.shard.self.n, position: r.shard.dongs.findIndex((x) => x.c === r.dong.c) + 1, of: r.shard.dongs.length },
      links: { canonical: origin + canonicalDong(r.shard.sido, r.shard.self, r.dong), short: `${origin}/c/${toShort(r.dong.c)}` },
    };
  }
  if (r.kind === 'sgg') {
    return { ...base, level: '시군구', code: r.sgg.c, name: { sido: r.shard.sido.n, sgg: r.shard.self.n },
      population: { total: r.shard.self.t, male: r.shard.self.m, female: r.shard.self.f },
      households: { total: r.shard.self.h }, age: { average: r.shard.self.a },
      dongs: r.shard.dongs.map((d) => ({ code: d.c, name: d.n, total: d.t, households: d.h, averageAge: d.a })) };
  }
  if (r.kind === 'sido') {
    return { ...base, level: '시도', code: r.sido.c, name: { sido: r.sido.n },
      population: { total: r.sido.t }, households: { total: r.sido.h }, age: { average: r.sido.a },
      sggs: INDEX.sgg.filter((g) => g.p === r.sido.c).map((g) => ({ code: g.c, name: g.n, total: g.t, averageAge: g.a })) };
  }
  return null;
}

// ── 견주기 ───────────────────────────────────────────────────────────────────
// 이름 하나(또는 '중구 남산동' 처럼 두 마디)를 받아 동네 한 곳으로 좁힌다.
async function resolveOne(env, text) {
  const segs = String(text || '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
  if (!segs.length) return { kind: 'none' };
  return resolve(env, segs);
}

// ── sitemap ──────────────────────────────────────────────────────────────────
const xml = (s) => new Response(s, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=86400' } });

export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    const origin = u.origin;

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }

    // 엣지 캐시. 자료는 한 달에 한 번 바뀌므로 캐시가 대부분을 처리한다.
    const cache = caches.default;
    const hit = await cache.match(request);
    if (hit) return hit;

    const respond = (res) => {
      if (res.status === 200) ctx.waitUntil(cache.put(request, res.clone()));
      return res;
    };

    let segs;
    try {
      segs = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      return respond(html(V.errorPage({ code: 400, message: '주소를 읽을 수 없습니다.', month: INDEX.month }), 400));
    }

    // robots / sitemap
    if (u.pathname === '/robots.txt') {
      return respond(new Response(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`,
        { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' } }));
    }
    if (u.pathname === '/sitemap.xml') {
      return respond(xml(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`
        + INDEX.sgg.map((g) => `<sitemap><loc>${origin}/sitemap/${g.c}.xml</loc></sitemap>`).join('')
        + `</sitemapindex>`));
    }
    if (segs[0] === 'sitemap' && /^\d{10}\.xml$/.test(segs[1] || '')) {
      const sgg = SGG_BY_CODE.get(segs[1].slice(0, 10));
      if (!sgg) return respond(new Response('Not Found', { status: 404 }));
      const shard = await shardOf(env, sgg.c);
      const sido = shard.sido;
      const locs = [url(sido.s, sgg.u), ...shard.dongs.map((d) => url(sido.s, sgg.u, d.n))];
      return respond(xml(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`
        + locs.map((l) => `<url><loc>${origin}${l.split('/').map(encodeURI).join('/')}</loc></url>`).join('')
        + `</urlset>`));
    }

    // 짧은 주소 /c/{36진수}
    if (segs[0] === 'c' && segs.length === 2) {
      const code = fromShort(segs[1]);
      const r = code ? await byCode(env, code) : { kind: 'none' };
      if (r.kind === 'dong') return respond(redirect(canonicalDong(r.sido, r.sgg, r.dong)));
      if (r.kind === 'sgg') return respond(redirect(url(r.sido.s, r.sgg.u)));
      if (r.kind === 'sido') return respond(redirect(url(r.sido.s)));
      return respond(html(V.errorPage({ code: 404, message: '그런 짧은 주소는 없습니다.', month: INDEX.month }), 404));
    }

    // 법정동코드 10자리를 그대로 적은 경우
    if (segs.length === 1 && /^\d{10}$/.test(segs[0])) {
      const r = await byCode(env, segs[0]);
      if (r.kind === 'dong') return respond(redirect(canonicalDong(r.sido, r.sgg, r.dong)));
      if (r.kind === 'sgg') return respond(redirect(url(r.sido.s, r.sgg.u)));
      if (r.kind === 'sido') return respond(redirect(url(r.sido.s)));
    }

    // 공유 카드 — .png 는 미리 구워 KV 에 올려 둔 것, 없으면 .svg 로 넘긴다.
    if (segs[0] === 'og' && segs.length === 2) {
      const mm = /^(\d{10})\.(svg|png)$/.exec(segs[1]);
      if (!mm) return respond(new Response('Not Found', { status: 404 }));
      const [, code, ext] = mm;
      if (ext === 'png') {
        const png = await env.REGION_KV.get(`og:${code}`, 'arrayBuffer');
        if (png) {
          return respond(new Response(png, { headers: {
            'content-type': 'image/png',
            'cache-control': 'public, max-age=86400, s-maxage=604800',
          } }));
        }
        return respond(redirect(`/og/${code}.svg`, 302));
      }
      const r0 = await byCode(env, code);
      if (r0.kind !== 'dong') return respond(new Response('Not Found', { status: 404 }));
      const sorted = r0.shard.dongs;
      const svg = ogCard({
        dong: r0.dong, sgg: r0.shard.self, sido: r0.shard.sido, month: INDEX.month,
        rank: sorted.findIndex((x) => x.c === r0.dong.c) + 1,
        total: sorted.length, unit: V.unitName(sorted),
      });
      return respond(new Response(svg, { headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'public, max-age=86400, s-maxage=604800',
      } }));
    }

    // 견주기 — /vs/남산동/대봉동  또는  /vs?a=…&b=…
    if (segs[0] === 'vs' || segs[0] === '견주기') {
      const qa = u.searchParams.get('a'), qb = u.searchParams.get('b');
      const A0 = qa ?? segs[1], B0 = qb ?? segs[2];
      if (!A0 || !B0) {
        return respond(html(V.listPage({
          heading: '두 동네 견주기', sub: '주소를 /vs/남산동/대봉동 처럼 쓰거나, 위 검색으로 동네를 고르세요.',
          items: [], origin, month: INDEX.month,
        }), 400));
      }
      const [ra, rb] = [await resolveOne(env, A0), await resolveOne(env, B0)];

      // 한쪽 이름이 여러 곳이면 후보를 보여 주되, '반대쪽'을 주소에 그대로 들고 간다.
      // 그냥 동네 페이지로 보내 버리면 사용자가 방금 고른 비교 대상이 사라진다.
      for (const [side, r0, raw, other] of [['a', ra, A0, B0], ['b', rb, B0, A0]]) {
        if (r0.kind !== 'choose') continue;
        return respond(html(V.listPage({
          heading: `'${raw}' — 어느 곳인가요?`,
          sub: `같은 이름이 ${r0.hits.length}곳 있습니다. 고르면 ${other} 와 나란히 놓입니다.`,
          origin, month: INDEX.month,
          items: r0.hits.filter((h) => h.dong).map((h) => {
            const q = `${h.sgg.u} ${h.dong.n}`;
            const href = side === 'a'
              ? `/vs/${encodeURIComponent(q)}/${encodeURIComponent(other)}`
              : `/vs/${encodeURIComponent(other)}/${encodeURIComponent(q)}`;
            return { href, label: `${h.sido.s} ${h.sgg.n} ${h.dong.n}`, t: h.dong.t, a: h.dong.a };
          }),
        })));
      }
      for (const [r0, raw] of [[ra, A0], [rb, B0]]) {
        if (r0.kind !== 'dong') {
          return respond(html(V.errorPage({
            code: 404, message: `'${raw}' 를 찾지 못했습니다. 법정동 이름으로 적어 주세요.`, month: INDEX.month,
          }), 404));
        }
      }

      // 이름이 겹치는 곳이면 주소에도 시군구를 남겨야 링크가 같은 곳을 다시 연다.
      const names = await namesIndex(env);
      const label = (r0) => ((names?.[r0.dong.n]?.length || 0) > 1 ? `${r0.shard.self.u} ${r0.dong.n}` : r0.dong.n);
      const canon = `/vs/${encodeURIComponent(label(ra))}/${encodeURIComponent(label(rb))}`;
      if (decodeURIComponent(u.pathname) !== decodeURIComponent(canon) || qa || qb) {
        return respond(redirect(canon, 302));
      }
      return respond(html(V.comparePage({
        A: { dong: ra.dong, sgg: ra.shard.self, sido: ra.shard.sido },
        B: { dong: rb.dong, sgg: rb.shard.self, sido: rb.shard.sido },
        nation: INDEX.nation, origin, path: canon, month: INDEX.month,
      })));
    }

    // 검색
    if (segs[0] === 's' || segs[0] === '검색') {
      const q = (u.searchParams.get('q') || '').trim();
      if (!q) return respond(redirect('/', 302));
      return respond(html(await search(env, q, origin)));
    }

    // JSON API — 화면과 같은 주소 규칙을 쓴다
    if (segs[0] === 'api') {
      const rest = segs.slice(1);
      if (rest[0] === 'meta' || rest.length === 0) {
        return respond(json({ month: INDEX.month, built: INDEX.built, nation: INDEX.nation,
          counts: { sido: INDEX.sido.length, sgg: INDEX.sgg.length, dong: INDEX.sgg.reduce((a, s) => a + s.d, 0) },
          source: '행정안전부 주민등록 인구통계' }));
      }
      const r = /^\d{10}$/.test(rest[0]) && rest.length === 1
        ? await byCode(env, rest[0]) : await resolve(env, rest);
      const payload = apiPayload(r, origin);
      return respond(payload ? json(payload) : json({ error: 'not_found', path: '/' + rest.join('/') }, 404));
    }

    // 전국
    if (segs.length === 0) return respond(html(V.homePage({ index: INDEX, origin, month: INDEX.month })));

    if (segs.length > 3) {
      return respond(html(V.errorPage({ code: 404, message: '주소가 너무 깁니다. /시도/시군구/동 까지만 있습니다.', month: INDEX.month }), 404));
    }

    const r = await resolve(env, segs);

    // 정식 주소가 아니면(전체 이름을 썼거나 앞을 생략했으면) 301 로 모아 준다.
    if (r.kind === 'dong') {
      const canon = canonicalDong(r.sido, r.sgg, r.dong);
      if (canon !== u.pathname && decodeURIComponent(u.pathname) !== decodeURIComponent(canon)) {
        return respond(redirect(canon));
      }
      const card = u.searchParams.has('card');
      return respond(html(renderResolved(r, { origin, path: canon, card })));
    }
    if (r.kind === 'sgg') {
      const canon = url(r.sido.s, r.sgg.u);
      if (decodeURIComponent(u.pathname) !== decodeURIComponent(canon)) return respond(redirect(canon));
      return respond(html(renderResolved(r, { origin, path: canon })));
    }
    if (r.kind === 'sido') {
      const canon = url(r.sido.s);
      if (decodeURIComponent(u.pathname) !== decodeURIComponent(canon)) return respond(redirect(canon));
      return respond(html(renderResolved(r, { origin, path: canon })));
    }
    if (r.kind === 'choose') return respond(html(chooseList(r, origin)));

    return respond(html(V.errorPage({
      code: 404,
      message: `'${segs.join(' ')}' 를 찾지 못했습니다. 위 검색창에 동네 이름을 넣어 보세요.`,
      month: INDEX.month,
    }), 404));
  },
};
