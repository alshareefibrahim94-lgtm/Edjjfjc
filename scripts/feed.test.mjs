import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, normalizeItems, classify, normalizeAr, decodeBody, stripHtml } from './feed.mjs';

const now = Date.parse('2026-11-18T12:00:00Z');
const rss = `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:media="http://search.yahoo.com/mrss/"><channel><title>x</title>
<item><title><![CDATA[ولي العهد يستقبل وزير الخارجية &amp; الوفد]]></title><link>https://example.sa/a/1?x=1&amp;y=2</link>
<pubDate>Wed, 18 Nov 2026 13:30:00 +0300</pubDate><description><![CDATA[<p>نص <b>الخبر</b>&nbsp;هنا</p><img src="http://example.sa/p.jpg">]]></description></item>
<item><title>الهلال يفوز في دوري روشن</title><link>https://example.sa/a/2</link><pubDate>Wed, 18 Nov 2026 09:00:00 GMT</pubDate>
<media:content url="https://example.sa/m.jpg" type="image/jpeg"/><description>مباراة قوية</description></item>
<item><title>قديم</title><link>https://example.sa/a/3</link><pubDate>Wed, 01 Nov 2026 09:00:00 GMT</pubDate></item>
<item><title>الهلال يفوز في دوري روشن</title><link>https://example.sa/a/2-dup</link><pubDate>Wed, 18 Nov 2026 09:00:00 GMT</pubDate></item>
<item><title>bad link</title><link>javascript:alert(1)</link></item>
</channel></rss>`;

test('parses RSS items, CDATA, entities and images', () => {
  const raw = parseFeed(rss);
  assert.equal(raw.length, 4);
  assert.equal(raw[0].title, 'ولي العهد يستقبل وزير الخارجية & الوفد');
  assert.equal(raw[0].link, 'https://example.sa/a/1?x=1&y=2');
  assert.equal(raw[0].summary, 'نص الخبر هنا');
  assert.equal(raw[0].image, 'https://example.sa/p.jpg');
  assert.equal(raw[1].image, 'https://example.sa/m.jpg');
});

test('normalises: drops old + duplicate items, sorts, classifies', () => {
  const items = normalizeItems(parseFeed(rss), { id: 'x' }, { now });
  assert.deepEqual(items.map((i) => i.u), ['https://example.sa/a/1?x=1&y=2', 'https://example.sa/a/2']);
  assert.equal(items[0].c, 'politics');
  assert.equal(items[1].c, 'sports');
  assert.match(items[0].id, /^[0-9a-f]{12}$/);
});

test('parses Atom and strips aggregator publisher suffix', () => {
  const atom = `<feed><entry><title>عنوان</title><link rel="alternate" href="https://e.sa/1"/><updated>2026-11-18T08:00:00Z</updated><summary>ملخص</summary></entry></feed>`;
  assert.deepEqual(parseFeed(atom).map((i) => [i.title, i.link, i.summary]), [['عنوان', 'https://e.sa/1', 'ملخص']]);
  const g = `<rss><channel><item><title>أرامكو تعلن أرباحها - سبق</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Wed, 18 Nov 2026 09:00:00 GMT</pubDate><description>&lt;a href="x"&gt;أرامكو&lt;/a&gt;</description><source url="https://sabq.org">سبق</source></item></channel></rss>`;
  const [it] = normalizeItems(parseFeed(g).map((r) => ({ ...r, aggregated: true })), { id: 'sabq' }, { now });
  assert.equal(it.t, 'أرامكو تعلن أرباحها');
  assert.equal(it.x, undefined);
  assert.equal(it.c, 'economy');
});

test('saudiOnly sources keep only Saudi-related items', () => {
  const raw = [
    { title: 'انتخابات في فرنسا', link: 'https://e.sa/1', date: now, summary: '', image: '' },
    { title: 'السعودية تستضيف قمة', link: 'https://e.sa/2', date: now, summary: '', image: '' },
  ];
  assert.equal(normalizeItems(raw, { id: 'a', saudiOnly: true }, { now }).length, 1);
});

test('helpers', () => {
  assert.equal(normalizeAr('الرِّياضَة إلى'), 'الرياضه الي');
  assert.equal(classify('خبر عام'), 'local');
  assert.equal(stripHtml('<script>x</script>a &amp;amp; b'), 'a & b');
  const win1256 = Uint8Array.from([...Buffer.from('<?xml version="1.0" encoding="windows-1256"?><t>'), 0xd3, 0xe1]);
  assert.ok(decodeBody(win1256).endsWith('سل'));
});
