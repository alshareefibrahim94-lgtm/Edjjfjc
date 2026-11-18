#!/usr/bin/env node
// Fetches every source in sources.json and writes public/data/news.json.
// Each source is tried through its own RSS feeds first, then through news
// aggregator searches restricted to the publisher's domain, so one broken
// feed never empties a widget. If PREV_URL points at the previously published
// news.json, sources that fail completely keep their last known items.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseFeed, decodeBody, normalizeItems } from './feed.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'public/data/news.json');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MIN_ITEMS = 3;

async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*', 'accept-language': 'ar,en;q=0.8' },
    redirect: 'follow', signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = decodeBody(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type') || '');
  return parseFeed(xml);
}

function aggregatorUrls(src) {
  const q = `site:${src.domain}${src.query ? ' ' + src.query : ''}`;
  const g = src.lang === 'en' ? 'hl=en&gl=SA&ceid=SA:en' : 'hl=ar&gl=SA&ceid=SA:ar';
  return [
    ['gnews', `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:3d')}&${g}`],
    ['bing', `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=${src.lang}&cc=SA&qft=sortbydate%3d%221%22`],
  ];
}

async function loadSource(src) {
  const attempts = [...src.feeds.map((u) => ['direct', u]), ...aggregatorUrls(src)];
  const log = [];
  for (const [via, url] of attempts) {
    try {
      let raw = await fetchFeed(url);
      if (via !== 'direct') raw = raw.map((r) => ({ ...r, aggregated: true, image: '' }));
      const items = normalizeItems(raw, src);
      log.push(`${via}:${items.length}`);
      if (items.length >= MIN_ITEMS) return { items, via, log };
    } catch (e) {
      log.push(`${via}:✗ ${e.cause?.code || e.message}`);
    }
  }
  return { items: [], via: 'failed', log };
}

async function loadPrevious() {
  if (!process.env.PREV_URL) return null;
  try {
    const res = await fetch(process.env.PREV_URL, { signal: AbortSignal.timeout(15000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

const sources = JSON.parse(await readFile(join(root, 'sources.json'), 'utf8'));
const [prev, results] = await Promise.all([loadPrevious(), Promise.all(sources.map(loadSource))]);
const now = Date.now();
const items = [];
const meta = sources.map((src, k) => {
  let { items: got, via, log } = results[k];
  if (!got.length && prev?.items) {
    got = prev.items.filter((i) => i.s === src.id && now - i.d < 96 * 3600e3);
    if (got.length) via = 'stale';
  }
  items.push(...got);
  console.log(`${src.id.padEnd(13)} ${via.padEnd(7)} ${String(got.length).padStart(2)}  [${log.join(' | ')}]`);
  return { id: src.id, name: src.name, full: src.full, color: src.color, lang: src.lang, site: `https://${src.domain}`, via, count: got.length };
});

items.sort((a, b) => b.d - a.d);
console.log(`\n${items.length} items from ${meta.filter((m) => m.count).length}/${meta.length} sources`);
if (!items.length) { console.error('No items fetched from any source.'); process.exit(1); }

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ generatedAt: now, sources: meta, items }));
