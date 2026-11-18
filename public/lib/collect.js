// Collects news and videos from every configured source. Shared by the
// scheduled Node job and the Android app; the caller supplies `http(url)`,
// which resolves to { bytes: Uint8Array, type: contentTypeHeader } or throws.
//
// Each source is tried through its own RSS feeds first, then through news
// aggregator searches restricted to the publisher's domain, so one broken
// feed never empties a widget. Sources that fail completely keep the items
// from `prev` (the previously collected data), marked as stale.
import { parseFeed, decodeBody, normalizeItems, parseYouTube, findChannelId } from './feed.js';

const MIN_ITEMS = 3;
const MAX_AGE = 96 * 3600e3;
const why = (e) => e?.cause?.code || e?.message || 'error';

function aggregatorUrls(src) {
  const q = `site:${src.domain}${src.query ? ' ' + src.query : ''}`;
  const g = src.lang === 'en' ? 'hl=en&gl=SA&ceid=SA:en' : 'hl=ar&gl=SA&ceid=SA:ar';
  return [
    ['gnews', `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:3d')}&${g}`],
    ['bing', `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=${src.lang}&cc=SA&qft=sortbydate%3d%221%22`],
  ];
}

async function loadSource(src, text) {
  const attempts = [...src.feeds.map((u) => ['direct', u]), ...aggregatorUrls(src)];
  const log = [];
  for (const [via, url] of attempts) {
    try {
      let raw = parseFeed(await text(url));
      if (via !== 'direct') raw = raw.map((r) => ({ ...r, aggregated: true, image: '' }));
      const items = normalizeItems(raw, src);
      log.push(`${via}:${items.length}`);
      if (items.length >= MIN_ITEMS) return { items, via, log };
    } catch (e) {
      log.push(`${via}:✗ ${why(e)}`);
    }
  }
  return { items: [], via: 'failed', log };
}

// Videos come from each outlet's YouTube channel feed. A channel is given by
// channelId, or by @handles that are resolved to an id from the channel page.
async function loadVideos(ch, text, now) {
  const log = [];
  const ids = ch.channelId ? [ch.channelId] : [];
  for (const h of ch.handles || []) {
    if (ids.length) break;
    try {
      const id = findChannelId(await text(`https://www.youtube.com/@${h}`));
      log.push(`@${h}:${id || 'no id'}`);
      if (id) ids.push(id);
    } catch (e) { log.push(`@${h}:✗ ${why(e)}`); }
  }
  for (const id of ids) {
    try {
      const vids = parseYouTube(await text(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`))
        .map((v) => ({ id: v.id, s: ch.id, t: v.title, d: Math.min(v.date ?? now, now) }))
        .filter((v) => now - v.d < 14 * 86400e3).sort((a, b) => b.d - a.d).slice(0, 8);
      log.push(`feed:${vids.length}`);
      return { vids, log };
    } catch (e) { log.push(`feed:✗ ${why(e)}`); }
  }
  return { vids: [], log };
}

// A topic (e.g. a football club) is followed through news searches rather than
// one publisher's feed; each item keeps its publisher's name in `sn`.
async function loadTopic(topic, text) {
  const g = topic.lang === 'en' ? 'hl=en&gl=SA&ceid=SA:en' : 'hl=ar&gl=SA&ceid=SA:ar';
  const log = [];
  const raw = (await Promise.all(topic.queries.map(async (q) => {
    try {
      const got = parseFeed(await text(`https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:3d')}&${g}`));
      log.push(String(got.length));
      return got;
    } catch (e) { log.push(`✗ ${why(e)}`); return []; }
  }))).flat().map((r) => ({ ...r, aggregated: true, image: '' }));
  return { items: normalizeItems(raw, { id: topic.id, cat: 'sports', topic: true }, { max: 80 }), log };
}

export async function collect({ sources, channels, topics = [], http, prev = null, log = () => {} }) {
  const text = async (url) => { const r = await http(url); return decodeBody(r.bytes, r.type); };
  const now = Date.now();
  const [results, vResults, tResults] = await Promise.all([
    Promise.all(sources.map((s) => loadSource(s, text))),
    Promise.all(channels.map((c) => loadVideos(c, text, now))),
    Promise.all(topics.map((t) => loadTopic(t, text))),
  ]);

  const items = [];
  const meta = sources.map((src, k) => {
    let { items: got, via, log: l } = results[k];
    if (!got.length && prev?.items) {
      got = prev.items.filter((i) => i.s === src.id && now - i.d < MAX_AGE);
      if (got.length) via = 'stale';
    }
    items.push(...got);
    log(`${src.id.padEnd(13)} ${via.padEnd(7)} ${String(got.length).padStart(2)}  [${l.join(' | ')}]`);
    return { id: src.id, name: src.name, full: src.full, color: src.color, lang: src.lang, site: `https://${src.domain}`, via, count: got.length };
  });
  items.sort((a, b) => b.d - a.d);
  log(`\n${items.length} items from ${meta.filter((m) => m.count).length}/${meta.length} sources\n\nVideos`);

  const videos = [];
  const videoSources = channels.map((ch, k) => {
    let { vids, log: l } = vResults[k];
    if (!vids.length && prev?.videos) { vids = prev.videos.filter((v) => v.s === ch.id); if (vids.length) l.push('stale'); }
    videos.push(...vids);
    log(`${ch.id.padEnd(13)} ${String(vids.length).padStart(2)}  [${l.join(' | ')}]`);
    return { id: ch.id, name: ch.name, color: ch.color, count: vids.length, ...(ch.club && { club: true }) };
  });
  videos.sort((a, b) => b.d - a.d);

  log('\nTopics');
  const topicItems = {};
  topics.forEach((t, k) => {
    let { items: got, log: l } = tResults[k];
    if (!got.length && prev?.topics?.[t.id]) { got = prev.topics[t.id].filter((i) => now - i.d < MAX_AGE); l.push('stale'); }
    topicItems[t.id] = got;
    log(`${t.id.padEnd(13)} ${String(got.length).padStart(2)}  [${l.join(' | ')}]`);
  });

  return { generatedAt: now, sources: meta, items, videoSources, videos, topics: topicItems };
}
