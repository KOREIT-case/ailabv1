#!/usr/bin/env node
// preview.mjs — 배포하지 않고 로컬에서 워커를 그대로 띄운다.
//
// Cloudflare 계정 없이도 화면을 확인할 수 있어야 고치는 속도가 난다.
// KV 는 region/data/kv 의 파일로, 엣지 캐시는 no-op 으로 갈아 끼우고
// worker.js 를 그대로 부른다(코드는 한 벌만 유지).
//
// 사용:  node region/scripts/preview.mjs [포트]
//        node region/scripts/preview.mjs --dump /대구/중구/남산동   (HTML 을 표준출력으로)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KVDIR = path.join(ROOT, 'data', 'kv');

globalThis.caches = { default: { match: async () => null, put: async () => {} } };

const env = {
  REGION_KV: {
    async get(key, type) {
      const file = key === 'names' ? 'names.json'
        : key === 'meta' ? 'meta.json'
        : key.startsWith('sgg:') ? `sgg-${key.slice(4)}.json` : null;
      if (!file) return null;
      const p = path.join(KVDIR, file);
      if (!fs.existsSync(p)) return null;
      const raw = fs.readFileSync(p, 'utf8');
      return type === 'json' ? JSON.parse(raw) : raw;
    },
  },
};
const ctx = { waitUntil: () => {} };

const { default: worker } = await import(path.join(ROOT, 'worker', 'worker.js'));

const dumpIdx = process.argv.indexOf('--dump');
if (dumpIdx >= 0) {
  const p = process.argv[dumpIdx + 1] || '/';
  const res = await worker.fetch(new Request(`http://localhost${encodeURI(p)}`), env, ctx);
  process.stderr.write(`HTTP ${res.status} ${res.headers.get('location') ? '→ ' + decodeURIComponent(res.headers.get('location')) : ''}\n`);
  process.stdout.write(await res.text());
  process.exit(0);
}

const port = Number(process.argv[2]) || 8788;
http.createServer(async (req, res) => {
  try {
    const r = await worker.fetch(new Request(`http://localhost:${port}${req.url}`), env, ctx);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(e.stack || e));
  }
}).listen(port, () => console.log(`미리보기: http://localhost:${port}/대구/중구/남산동`));
