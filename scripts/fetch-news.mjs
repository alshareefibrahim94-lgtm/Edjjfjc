#!/usr/bin/env node
// Scheduled job: collects all sources and writes public/data/news.json for the
// web app. If PREV_URL points at the previously published news.json, sources
// that fail completely keep their last known items.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { collect } from '../public/lib/collect.js';

const pub = join(dirname(fileURLToPath(import.meta.url)), '../public');
const OUT = join(pub, 'data/news.json');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function http(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*', 'accept-language': 'ar,en;q=0.8',
      ...(new URL(url).hostname.endsWith('youtube.com') && { cookie: 'SOCS=CAI; CONSENT=YES+1' }),
    },
    redirect: 'follow', signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') || '' };
}

async function loadPrevious() {
  if (!process.env.PREV_URL) return null;
  try {
    const res = await fetch(process.env.PREV_URL, { signal: AbortSignal.timeout(15000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

const json = async (f) => JSON.parse(await readFile(join(pub, f), 'utf8'));
const data = await collect({ sources: await json('sources.json'), channels: await json('videos.json'), topics: await json('topics.json'), gaming: await json('gaming.json'), http, prev: await loadPrevious(), log: console.log });
if (!data.items.length) { console.error('No items fetched from any source.'); process.exit(1); }

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(data));
