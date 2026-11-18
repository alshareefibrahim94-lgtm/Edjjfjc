// Dependency-free RSS/Atom parsing and item normalisation helpers.
// Runs unchanged in Node (scheduled fetch) and in the browser (Android app).

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…', rlm: '', lrm: '', zwnj: '' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

const unCdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

export function stripHtml(html) {
  return decodeEntities(
    decodeEntities(unCdata(html))
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blocks = (xml, tag) => xml.match(new RegExp(`<${esc(tag)}[\\s>][\\s\\S]*?</${esc(tag)}>`, 'gi')) || [];
function inner(block, tag) {
  const m = block.match(new RegExp(`<${esc(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc(tag)}>`, 'i'));
  return m ? unCdata(m[1]).trim() : '';
}
function attr(block, tag, name, where) {
  const re = new RegExp(`<${esc(tag)}\\s[^>]*>`, 'gi');
  for (const t of block.match(re) || []) {
    if (where && !where(t)) continue;
    const m = t.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
    if (m) return decodeEntities(m[2] ?? m[3]).trim();
  }
  return '';
}

export function safeUrl(u, base) {
  try {
    const url = new URL(u.trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

function findImage(block, html) {
  const candidates = [
    attr(block, 'media:content', 'url', (t) => !/type\s*=\s*["']video/i.test(t)),
    attr(block, 'media:thumbnail', 'url'),
    attr(block, 'enclosure', 'url', (t) => /type\s*=\s*["']image/i.test(t) || /\.(jpe?g|png|webp)/i.test(t)),
    inner(block, 'image').startsWith('http') ? inner(block, 'image') : '',
    (decodeEntities(html).match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i) || [])[1] || '',
  ];
  for (const c of candidates) {
    const u = safeUrl(c || '');
    if (u) return u.replace(/^http:/, 'https:');
  }
  return '';
}

/** Parse an RSS 2.0 / RDF / Atom document into raw items. */
export function parseFeed(xml) {
  const isAtom = !/<item[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  return blocks(xml, isAtom ? 'entry' : 'item').map((b) => {
    const html = inner(b, 'content:encoded') || inner(b, 'description') || inner(b, 'summary') || inner(b, 'content');
    let link = isAtom
      ? attr(b, 'link', 'href', (t) => !/rel\s*=/i.test(t) || /rel\s*=\s*["']alternate/i.test(t))
      : decodeEntities(inner(b, 'link')) || attr(b, 'link', 'href');
    if (!link) { const g = decodeEntities(inner(b, 'guid')); if (/^https?:/i.test(g)) link = g; }
    const dateStr = inner(b, 'pubDate') || inner(b, 'dc:date') || inner(b, 'published') || inner(b, 'updated');
    const t = Date.parse(dateStr);
    return {
      title: stripHtml(inner(b, 'title')),
      link: safeUrl(link || ''),
      date: Number.isFinite(t) ? t : null,
      summary: stripHtml(html),
      image: findImage(b, html),
      origin: stripHtml(inner(b, 'source')),
    };
  }).filter((i) => i.title && i.link);
}

/** Decode a fetched body honouring the charset from headers or the XML prolog. */
export function decodeBody(buf, contentType = '') {
  const head = String.fromCharCode(...buf.slice(0, 200));
  const cs = (contentType.match(/charset=([\w-]+)/i) || head.match(/encoding=["']([\w-]+)["']/i) || [])[1] || 'utf-8';
  try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

/** Fold Arabic text for matching: strip diacritics/tatweel, unify alef/yaa/taa forms. */
export function normalizeAr(s) {
  return s.toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const CATS = {
  sports: ['الهلال', 'النصر', 'نادي الاتحاد', 'دوري روشن', 'كاس', 'مباراه', 'المنتخب', 'لاعب', 'مدرب', 'كره القدم', 'الدوري', 'بطوله', 'رياضه', 'رونالدو', 'ملعب', 'football', 'league', 'match', 'club'],
  economy: ['اقتصاد', 'اسهم', 'تاسي', 'تداول', 'ارامكو', 'النفط', 'مليار', 'مليون ريال', 'استثمار', 'البنك', 'التضخم', 'ارباح', 'صندوق الاستثمارات', 'ميزانيه', 'السوق الماليه', 'الاكتتاب', 'عقار', 'economy', 'aramco', 'oil', 'investment', 'stocks', 'billion'],
  politics: ['ولي العهد', 'خادم الحرمين', 'وزير الخارجيه', 'مجلس الوزراء', 'القمه', 'سفير', 'الامم المتحده', 'مباحثات', 'الرئيس', 'يستقبل', 'غزه', 'مجلس الشوري', 'crown prince', 'minister', 'summit', 'talks'],
  tech: ['الذكاء الاصطناعي', 'تقنيه', 'رقمي', 'سدايا', 'سيبراني', 'تطبيق', 'الفضاء', 'ابتكار', 'technology', 'digital', 'cyber'],
  culture: ['ثقافه', 'مهرجان', 'موسم الرياض', 'فيلم', 'معرض', 'الفنون', 'ترفيه', 'سياحه', 'العلا', 'التراث', 'مسرح', 'culture', 'festival', 'tourism', 'film'],
};

export function classify(text, fallback = 'local') {
  const n = ` ${normalizeAr(text)} `;
  let best = fallback, score = 0;
  for (const [cat, words] of Object.entries(CATS)) {
    const s = words.reduce((a, w) => a + (n.includes(w) ? 1 : 0), 0);
    if (s > score) { score = s; best = cat; }
  }
  return best;
}

const SAUDI_RE = /سعودي|المملكه|الرياض|جده|مكه|المدينه المنوره|الدمام|نيوم|ارامكو|ولي العهد|خادم الحرمين|saudi|riyadh|jeddah/;
export const mentionsSaudi = (text) => SAUDI_RE.test(normalizeAr(text));

/** Stable 12-hex-digit id for a link (two FNV-1a passes; not cryptographic). */
export function itemId(link) {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < link.length; i++) {
    const c = link.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x811c9dc5) >>> 0;
  }
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')).slice(0, 12);
}

/** Turn raw parsed items into the compact shape the app consumes. */
export function normalizeItems(raw, source, { now = Date.now(), maxAgeH = 96, max = 30 } = {}) {
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    let title = r.title;
    // Aggregator titles look like "Headline - Publisher"
    if (r.origin && title.endsWith(` - ${r.origin}`)) title = title.slice(0, -(r.origin.length + 3)).trim();
    const key = normalizeAr(title);
    if (!key || seen.has(key) || seen.has(r.link)) continue;
    seen.add(key); seen.add(r.link);
    const date = Math.min(r.date ?? now, now);
    if (now - date > maxAgeH * 3600e3) continue;
    let summary = r.aggregated ? '' : r.summary;
    if (normalizeAr(summary) === key) summary = '';
    if (summary.length > 300) summary = summary.slice(0, 297).replace(/\s+\S*$/, '') + '…';
    if (source.saudiOnly && !r.aggregated && !mentionsSaudi(`${title} ${summary}`)) continue;
    out.push({
      id: itemId(r.link), s: source.id, t: title, u: r.link, d: date,
      ...(summary && { x: summary }), ...(r.image && { i: r.image }), ...(source.topic && r.origin && { sn: r.origin }),
      c: source.cat || classify(`${title} ${summary}`),
    });
  }
  return out.sort((a, b) => b.d - a.d).slice(0, max);
}

/** Parse a YouTube channel Atom feed into [{ id, title, date }]. */
export function parseYouTube(xml) {
  return blocks(xml, 'entry').map((b) => {
    const t = Date.parse(inner(b, 'published') || inner(b, 'updated'));
    return { id: inner(b, 'yt:videoId'), title: stripHtml(inner(b, 'title')), date: Number.isFinite(t) ? t : null };
  }).filter((v) => /^[\w-]{11}$/.test(v.id) && v.title);
}

/** Pull the channel id (UC…) out of a YouTube channel page. */
export function findChannelId(html) {
  const m = html.match(/"(?:externalId|channelId|browseId)":"(UC[\w-]{22})"/) || html.match(/channel(?:_id=|\/)(UC[\w-]{22})/);
  return m ? m[1] : '';
}
