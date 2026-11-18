#!/usr/bin/env node
// Maintenance helper: looks up YouTube channels by search phrase so the right
// channel id can be put in public/videos.json. Usage:
//   node scripts/find-channels.mjs "قناة الإخبارية|صحيفة عكاظ"
// Prints, per phrase, the top channel matches with id, name, handle and how
// recent their latest upload is.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const get = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'ar,en;q=0.8', cookie: 'SOCS=CAI; CONSENT=YES+1' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

for (const phrase of (process.argv[2] || '').split('|').map((s) => s.trim()).filter(Boolean)) {
  console.log(`\n== ${phrase}`);
  try {
    // sp=EgIQAg== restricts results to channels
    const html = await get(`https://www.youtube.com/results?search_query=${encodeURIComponent(phrase)}&sp=EgIQAg%3D%3D`);
    const found = [...html.matchAll(/"channelRenderer":\{"channelId":"(UC[\w-]{22})","title":\{"simpleText":"([^"]+)"/g)].slice(0, 6);
    if (!found.length) console.log('no channels found');
    for (const m of found) {
      const tail = html.slice(m.index, m.index + 4000);
      const handle = (tail.match(/"canonicalBaseUrl":"\/(@[^"]+)"/) || [])[1] || '';
      let latest = 'feed ✗';
      try {
        const feed = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`);
        const dates = [...feed.matchAll(/<published>([^<]+)<\/published>/g)].map((d) => d[1]).slice(1);
        latest = dates.length ? `${dates.length} videos, latest ${dates.sort().at(-1).slice(0, 10)}` : 'no videos';
      } catch { /* keep marker */ }
      console.log(`${m[1]}  "${m[2]}"  ${decodeURIComponent(handle)}  ${latest}`);
    }
  } catch (e) { console.log(`✗ ${e.message}`); }
}
