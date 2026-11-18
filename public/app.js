// أخبار السعودية — single-page app.
// On the web, data comes from data/news.json, which the GitHub Actions workflow
// rebuilds every ~20 minutes. Inside the Android app (NATIVE) the phone collects
// the feeds itself through the app's local /proxy endpoint and opens stories in
// a built-in reader view instead of the publisher's page.
import { decodeBody } from './lib/feed.js';

const NATIVE = location.hostname === 'appassets.androidplatform.net';
const CATS = { all: 'الكل', local: 'محليات', politics: 'سياسة', economy: 'اقتصاد', sports: 'رياضة', tech: 'تقنية', culture: 'ثقافة ومنوعات' };
const SUGGESTED = ['رؤية 2030', 'ولي العهد', 'أرامكو', 'الهلال', 'النصر', 'موسم الرياض', 'نيوم', 'الطقس', 'التعليم', 'الإسكان'];
// Al-Ittihad Club section. News is matched by wording; "الاتحاد" alone is
// ambiguous (federations, the EU, the airline), hence the exclusions.
const CLUB_STRICT = /نادي الاتحاد|فريق الاتحاد|بنزيما|الاتحاديين|جماهير الاتحاد|جمهور الاتحاد|مدرب الاتحاد|لاعب الاتحاد|لاعبي الاتحاد|al.?ittihad/;
const CLUB_LOOSE = /الاتحاد|العميد|ittihad/;
const CLUB_NOT = /الاتحاد (الاوروبي|الدولي|الاسيوي|العربي|الخليجي|الافريقي|الانجليزي|الاسباني|الايطالي|الالماني|الفرنسي|المصري|الاماراتي|السعودي ل|للطيران)|اتحاد (الكره|القدم|كره|اللعبه|الغرف)|طيران الاتحاد|الاتحاد السكندري|اتحاد جده لل|etihad/;
const RUMOR = /صفق|انتقال|ينتقل|مفاوضات|يفاوض|تفاوض|عرض |عرضا|يقترب|تعاقد|رحيل|يرحل|تجديد|يجدد|شائع|مصادر|ميركاتو|يضم |اعاره|فسخ|بديل/;
const CLUB_LINKS = [
  ['إكس (تويتر)', [['الحساب الرسمي @ittihad', 'https://x.com/ittihad'], ['آخر التغريدات: #الاتحاد', 'https://x.com/search?q=%23%D8%A7%D9%84%D8%A7%D8%AA%D8%AD%D8%A7%D8%AF&f=live'], ['آخر التغريدات: #العميد', 'https://x.com/search?q=%23%D8%A7%D9%84%D8%B9%D9%85%D9%8A%D8%AF&f=live'], ['صفقات وشائعات الاتحاد', 'https://x.com/search?q=%D8%A7%D9%84%D8%A7%D8%AA%D8%AD%D8%A7%D8%AF%20(%D8%B5%D9%81%D9%82%D8%A9%20OR%20%D9%85%D9%81%D8%A7%D9%88%D8%B6%D8%A7%D8%AA%20OR%20%D8%A7%D9%86%D8%AA%D9%82%D8%A7%D9%84)&f=live']]],
  ['تيك توك', [['الحساب الرسمي @ittihadclub', 'https://www.tiktok.com/@ittihadclub'], ['وسم #الاتحاد', 'https://www.tiktok.com/tag/%D8%A7%D9%84%D8%A7%D8%AA%D8%AD%D8%A7%D8%AF'], ['بحث: نادي الاتحاد', 'https://www.tiktok.com/search?q=%D9%86%D8%A7%D8%AF%D9%8A%20%D8%A7%D9%84%D8%A7%D8%AA%D8%AD%D8%A7%D8%AF']]],
  ['يوتيوب', [['القناة الرسمية', 'https://www.youtube.com/@ittihadclub'], ['أحدث المقاطع عن نادي الاتحاد', 'https://www.youtube.com/results?search_query=%D9%86%D8%A7%D8%AF%D9%8A+%D8%A7%D9%84%D8%A7%D8%AA%D8%AD%D8%A7%D8%AF&sp=CAI%253D']]],
];
const PAGE = 40;
const REFRESH_MS = 5 * 60 * 1000;

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem('sn:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sn:' + k, JSON.stringify(v)); } catch { /* private mode / quota */ } },
};

const SECTIONS = { ittihad: { label: 'الاتحاد', bar: '#000000' }, gaming: { label: 'الألعاب', bar: '#0d0b1a' } };
const prefs = { section: 'ittihad', theme: 'auto', font: 1, perWidget: 4, images: true, order: [], off: [], known: [], keywords: [], ...store.get('prefs', {}) };
const saved = store.get('saved', {});
const read = new Set(store.get('read', []));
const lastVisit = store.get('lastVisit', 0);
const state = { data: null, byId: {}, tab: 'home', cat: 'all', vsrc: 'all', vById: {}, club: 'news', clubItems: [], clubVideos: [], game: 'all', gameItems: [], gameVideos: [], query: '', filter: null, limit: PAGE, error: '' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => n.toLocaleString('ar-SA');
const norm = (s) => s.toLowerCase().replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\s+/g, ' ').trim();
const httpUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

function ago(t) {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'الآن';
  if (m < 60) return `منذ ${num(m)} د`;
  const h = Math.round(m / 60);
  if (h < 24) return `منذ ${num(h)} س`;
  return `منذ ${num(Math.round(h / 24))} ي`;
}

function savePrefs() { store.set('prefs', prefs); }
function applyLook() {
  const r = document.documentElement;
  if (prefs.theme === 'auto') r.removeAttribute('data-theme'); else r.dataset.theme = prefs.theme;
  r.style.setProperty('--scale', prefs.font);
}

/* ---------- data ---------- */
async function nativeHttp(url) {
  const res = await fetch(`/proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('x-upstream-type') || '', url: res.headers.get('x-final-url') || url };
}

// Android app: show the last collected news at once, then re-collect on the phone.
async function loadNative(manual) {
  const cached = store.get('data', null);
  if (cached && !state.data) { setData(structuredClone(cached)); render(); renderStatus(); }
  if (!manual && cached && Date.now() - cached.generatedAt < REFRESH_MS) return;
  state.busy = true;
  if (!state.data) render();
  renderStatus();
  try {
    const [{ collect }, sources, channels, topics, gaming] = await Promise.all([import('./lib/collect.js'), ...['sources.json', 'videos.json', 'topics.json', 'gaming.json'].map((f) => fetch(f).then((r) => r.json()))]);
    const data = await collect({ sources, channels, topics, gaming, http: nativeHttp, prev: cached });
    if (!data.items.length) throw new Error('offline');
    store.set('data', data);
    setData(data); render();
  } finally { state.busy = false; }
}

async function load(manual) {
  if (state.loading) return;
  state.loading = true;
  $('#btn-refresh').classList.add('spin');
  try {
    if (NATIVE) { await loadNative(manual); state.error = ''; return; }
    const res = await fetch(`data/news.json?t=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status === 404 ? 'nodata' : 'http');
    const data = await res.json();
    const changed = !state.data || data.generatedAt !== state.data.generatedAt;
    state.error = '';
    if (changed) { setData(data); render(); }
  } catch (e) {
    state.error = e.message === 'nodata' ? 'nodata' : 'offline';
    if (!state.data || manual) render();
  } finally {
    state.loading = false;
    $('#btn-refresh').classList.remove('spin');
    renderStatus();
  }
}

function setData(data) {
  state.data = data;
  state.byId = Object.fromEntries([...data.sources, ...(data.gaming?.sources || [])].map((s) => [s.id, s]));
  state.vById = Object.fromEntries((data.videoSources || []).map((s) => [s.id, s]));
  data.videos = (data.videos || []).filter((v) => /^[\w-]{11}$/.test(v.id) && state.vById[v.s]);
  // First time we see a source: append it to the widget order; English ones start switched off.
  for (const s of data.sources) {
    if (prefs.known.includes(s.id)) continue;
    prefs.known.push(s.id); prefs.order.push(s.id);
    if (s.lang !== 'ar') prefs.off.push(s.id);
  }
  savePrefs();
  for (const it of data.items) it.n = norm(`${it.t} ${it.x || ''}`);
  // Club section: topic search results plus matching stories from the regular sources.
  const topic = data.topics?.ittihad || [];
  for (const it of topic) it.n = norm(it.t);
  const isClub = (it) => !CLUB_NOT.test(it.n) && (CLUB_STRICT.test(it.n) || (it.c === 'sports' && CLUB_LOOSE.test(it.n)));
  const seen = new Set();
  state.clubItems = [...data.items.filter(isClub), ...topic.filter((it) => !CLUB_NOT.test(it.n) && CLUB_LOOSE.test(it.n))]
    .filter((it) => !seen.has(it.n) && seen.add(it.n)).sort((a, b) => b.d - a.d);
  state.gameItems = data.gaming?.items || [];
  for (const it of state.gameItems) it.n = norm(`${it.t} ${it.x || ''}`);
  state.gameVideos = data.videos.filter((v) => state.vById[v.s].section === 'gaming');
  data.videos = data.videos.filter((v) => !state.vById[v.s].section); // section channels stay out of the general video tab
  data.videoSources = data.videoSources.filter((s) => !s.section);
  state.clubVideos = data.videos.filter((v) => state.vById[v.s].club || (!CLUB_NOT.test(norm(v.t)) && CLUB_LOOSE.test(norm(v.t))));
}

const orderedSources = () => prefs.order.map((id) => state.byId[id]).filter(Boolean);
const enabled = (id) => !prefs.off.includes(id);

function visible({ ignoreCat } = {}) {
  if (!state.data) return [];
  const q = norm(state.query);
  return state.data.items.filter((it) => enabled(it.s) && state.byId[it.s]
    && (ignoreCat || state.cat === 'all' || it.c === state.cat)
    && (!q || it.n.includes(q)));
}
const matchesInterest = (it) => prefs.keywords.some((k) => it.n.includes(norm(k)));

/* ---------- pieces ---------- */
function itemRow(it, { showSource = true } = {}) {
  const src = state.byId[it.s] || { name: it.sn || '', color: '', lang: 'ar' };
  const img = prefs.images && httpUrl(it.i);
  return `<button class="item${read.has(it.id) ? ' read' : ''}" data-open="${esc(it.id)}"${src.lang === 'ar' ? '' : ' dir="ltr"'}>
    <span class="item-body">
      <span class="item-title">${esc(it.t)}</span>
      <span class="meta">
        ${showSource ? `<span class="src" style="--src:${esc(src.color)}"><i class="dot"></i>${esc(src.name)}</span>` : ''}
        <span>${ago(it.d)}</span>
        ${it.d > lastVisit && lastVisit && !read.has(it.id) ? '<span class="new">● جديد</span>' : ''}
        ${saved[it.id] ? '<span>🔖</span>' : ''}
      </span>
    </span>
    ${img ? `<img class="thumb" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
  </button>`;
}

function widget({ title, color, items, filter, total }) {
  const fresh = lastVisit ? items.filter((i) => i.d > lastVisit && !read.has(i.id)).length : 0;
  return `<section class="widget" style="--src:${esc(color)}">
    <button class="widget-head" data-filter='${esc(JSON.stringify(filter))}'>
      <h2><i class="dot"></i>${esc(title)}${fresh ? `<span class="badge">${num(fresh)} جديد</span>` : ''}</h2>
      <span class="more">عرض الكل (${num(total)}) ‹</span>
    </button>
    ${items.slice(0, prefs.perWidget).map((it) => itemRow(it, { showSource: !filter.source })).join('')}
  </section>`;
}

function hero(items) {
  const picked = []; const used = new Set();
  for (const it of items) {
    if (!httpUrl(it.i) || used.has(it.s)) continue;
    used.add(it.s); picked.push(it);
    if (picked.length === 8) break;
  }
  if (picked.length < 3 || !prefs.images) return '';
  return `<div class="section-title">أبرز الأخبار</div><div class="hero">${picked.map((it) => {
    const src = state.byId[it.s];
    return `<button class="hero-card" data-open="${esc(it.id)}">
      <img src="${esc(it.i)}" alt="" loading="lazy" referrerpolicy="no-referrer">
      <span class="hero-text"><small><i class="dot" style="--src:${esc(src.color)}"></i>${esc(src.name)} · ${ago(it.d)}</small><b>${esc(it.t)}</b></span>
    </button>`;
  }).join('')}</div>`;
}

function listView(items, emptyMsg) {
  if (!items.length) return `<div class="empty"><b>${esc(emptyMsg)}</b></div>`;
  return `<div class="list">${items.slice(0, state.limit).map((it) => itemRow(it)).join('')}</div>
    ${items.length > state.limit ? `<button class="btn ghost wide" data-more>عرض المزيد (${num(items.length - state.limit)})</button>` : ''}`;
}

function videoCard(v) {
  const ch = state.vById[v.s];
  return `<button class="vcard" data-video="${esc(v.id)}">
    <span class="vthumb"><img src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer"><i class="play"></i></span>
    <span class="item-title">${esc(v.t)}</span>
    <span class="meta"><span class="src" style="--src:${esc(ch.color)}"><i class="dot"></i>${esc(ch.name)}</span><span>${ago(v.d)}</span></span>
  </button>`;
}

function videosFiltered() {
  const q = norm(state.query);
  return (state.data?.videos || []).filter((v) => (state.vsrc === 'all' || v.s === state.vsrc) && (!q || norm(v.t).includes(q)));
}

function viewVideos() {
  const vids = videosFiltered();
  if (!vids.length) return '<div class="empty"><b>لا توجد فيديوهات حالياً</b>تُجلب أحدث المقاطع من قنوات المصادر على يوتيوب مع كل تحديث.</div>';
  return `<div class="section-title">أحدث الفيديوهات (${num(vids.length)})</div><div class="vgrid">${vids.slice(0, state.limit).map(videoCard).join('')}</div>
    ${vids.length > state.limit ? `<button class="btn ghost wide" data-more>عرض المزيد (${num(vids.length - state.limit)})</button>` : ''}`;
}

function viewGaming() {
  const q = norm(state.query);
  const seg = `<div class="club-hero game"><b>الألعاب · Gaming</b><span>آخر أخبار الألعاب من أكبر المواقع وصنّاع المحتوى</span></div>
    <div class="seg plat">${[['all', 'الكل'], ['ar', 'عربي'], ['en', 'English'], ['video', 'فيديو']].map(([k, l]) => `<button data-game="${k}" class="${state.game === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (state.game === 'video') {
    const vids = state.gameVideos.filter((v) => !q || norm(v.t).includes(q));
    return seg + (vids.length ? `<div class="vgrid">${vids.slice(0, state.limit).map(videoCard).join('')}</div>${vids.length > state.limit ? `<button class="btn ghost wide" data-more>عرض المزيد (${num(vids.length - state.limit)})</button>` : ''}` : '<div class="empty"><b>لا توجد مقاطع حالياً</b></div>');
  }
  const items = state.gameItems.filter((it) => (!q || it.n.includes(q)) && (state.game === 'all' || state.byId[it.s]?.lang === state.game));
  return seg + listView(items, 'لا توجد أخبار ألعاب حالياً');
}

function viewSection() {
  const pick = `<nav class="chips sec-pick">${Object.entries(SECTIONS).map(([k, v]) => `<button class="chip${prefs.section === k ? ' on' : ''}" data-sec="${k}">${v.label}</button>`).join('')}</nav>`;
  return pick + (prefs.section === 'gaming' ? viewGaming() : viewClub());
}

function viewClub() {
  const q = norm(state.query);
  const items = state.clubItems.filter((it) => (!q || it.n.includes(q)) && (state.club !== 'rumors' || RUMOR.test(it.n)));
  const seg = `<div class="club-hero"><b>نادي الاتحاد</b><span>العميد · كل ما يخص النمور في مكان واحد</span></div>
    <div class="seg plat">${[['news', 'الأخبار'], ['rumors', 'الصفقات'], ['video', 'فيديو'], ['social', 'التطبيقات']].map(([k, l]) => `<button data-club="${k}" class="${state.club === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (state.club === 'video') {
    const vids = state.clubVideos.filter((v) => !q || norm(v.t).includes(q));
    return seg + (vids.length ? `<div class="vgrid">${vids.slice(0, state.limit).map(videoCard).join('')}</div>` : '<div class="empty"><b>لا توجد مقاطع حالياً</b>جرّب قسم «التطبيقات» لفتح يوتيوب مباشرة.</div>');
  }
  if (state.club === 'social') {
    return `${seg}<p class="hint">تُفتح هذه الروابط مباشرة في تطبيقات إكس وتيك توك ويوتيوب على هاتفك.</p>${CLUB_LINKS.map(([name, links]) => `<div class="panel"><h2>${esc(name)}</h2>
      ${links.map(([label, url]) => `<a class="src-row link" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><b>${esc(label)}</b><span class="more">فتح ↗</span></a>`).join('')}</div>`).join('')}`;
  }
  return seg + listView(items, state.club === 'rumors' ? 'لا توجد أخبار صفقات حالياً' : 'لا توجد أخبار عن الاتحاد حالياً');
}

/* ---------- views ---------- */
function viewHome() {
  const items = visible();
  if (state.query) return `<div class="section-title">نتائج البحث (${num(items.length)})</div>${listView(items, 'لا توجد نتائج مطابقة')}`;
  let html = hero(items);
  const vids = state.cat === 'all' ? (state.data.videos || []).slice(0, 8) : [];
  if (vids.length) html += `<div class="section-title">أحدث الفيديوهات<button class="more" data-tab="video">عرض الكل ‹</button></div><div class="vstrip">${vids.map(videoCard).join('')}</div>`;
  const widgets = [];
  if (prefs.keywords.length) {
    const mine = items.filter(matchesInterest);
    if (mine.length) widgets.push(widget({ title: '⭐ اهتماماتي', color: 'var(--gold)', items: mine, total: mine.length, filter: { interest: true, label: 'اهتماماتي' } }));
  }
  widgets.push(widget({ title: 'آخر الأخبار', color: 'var(--accent)', items, total: items.length, filter: { all: true } }));
  for (const src of orderedSources()) {
    if (!enabled(src.id)) continue;
    const mine = items.filter((i) => i.s === src.id);
    if (mine.length) widgets.push(widget({ title: src.name, color: src.color, items: mine, total: mine.length, filter: { source: src.id, label: src.name } }));
  }
  if (!items.length) return '<div class="empty"><b>لا توجد أخبار في هذا التصنيف حالياً</b>جرّب تصنيفاً آخر أو فعّل مصادر أكثر من «تخصيص».</div>';
  return `${html}<div class="section-title">ودجات المصادر</div><div class="grid">${widgets.join('')}</div>`;
}

function viewLatest() {
  let items = visible();
  const f = state.filter;
  if (f?.source) items = items.filter((i) => i.s === f.source);
  if (f?.interest) items = items.filter(matchesInterest);
  const head = f?.label ? `<div class="section-title"><span class="pill">${esc(f.label)}</span><button class="pill" data-clear-filter>✕ إزالة التصفية</button></div>` : `<div class="section-title">${state.query ? `نتائج البحث (${num(items.length)})` : 'كل الأخبار بالترتيب الزمني'}</div>`;
  return head + listView(items, 'لا توجد أخبار مطابقة');
}

function viewSaved() {
  const items = Object.values(saved).sort((a, b) => b.at - a.at);
  return `<div class="section-title">المحفوظات (${num(items.length)})</div>${items.length ? `<div class="list">${items.map((it) => itemRow(it)).join('')}</div>` : '<div class="empty"><b>لا توجد أخبار محفوظة</b>افتح أي خبر واضغط «حفظ» ليظهر هنا حتى بدون إنترنت.</div>'}`;
}

const seg = (key, options, cur) => `<div class="seg" data-pref="${key}">${options.map(([v, l]) => `<button data-val="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const VIA = { direct: 'مباشر', gnews: 'عبر أخبار Google', bing: 'عبر Bing', stale: 'نسخة سابقة', failed: 'غير متاح حالياً' };

function viewSettings() {
  const list = orderedSources();
  const unused = SUGGESTED.filter((k) => !prefs.keywords.includes(k));
  return `
  <div class="panel"><h2>المظهر</h2>
    <div class="row"><span>الوضع</span>${seg('theme', [['auto', 'تلقائي'], ['light', 'فاتح'], ['dark', 'داكن']], prefs.theme)}</div>
    <div class="row"><span>حجم الخط</span>${seg('font', [[0.92, 'صغير'], [1, 'متوسط'], [1.12, 'كبير'], [1.25, 'أكبر']], prefs.font)}</div>
    <div class="row"><span>أخبار كل ودجت</span>${seg('perWidget', [[3, '٣'], [4, '٤'], [6, '٦'], [8, '٨']], prefs.perWidget)}</div>
    <div class="row"><span>الصور</span>${seg('images', [[true, 'إظهار'], [false, 'إخفاء']], prefs.images)}</div>
  </div>
  <div class="panel"><h2>⭐ اهتماماتي</h2><p>أضف كلمات تهمّك لتظهر أخبارها في ودجت خاص أعلى الصفحة.</p>
    <form class="kw-form" id="kw-form"><input id="kw" placeholder="مثال: الهلال، أرامكو…" maxlength="40" aria-label="كلمة مفتاحية"><button class="btn">إضافة</button></form>
    <div class="kws">${prefs.keywords.map((k) => `<button class="chip on" data-kw-del="${esc(k)}">${esc(k)} ✕</button>`).join('')}${unused.map((k) => `<button class="chip sug" data-kw-add="${esc(k)}">+ ${esc(k)}</button>`).join('')}</div>
  </div>
  <div class="panel"><h2>المصادر وترتيب الودجات</h2><p>فعّل المصادر التي تريدها ورتّبها بالأسهم.</p>
    ${list.map((s, k) => `<div class="src-row">
      <label><input type="checkbox" data-src="${esc(s.id)}" ${enabled(s.id) ? 'checked' : ''}><i class="dot" style="--src:${esc(s.color)}"></i><span><b>${esc(s.name)}</b><small>${esc(s.full)} · ${num(s.count)} خبر · ${VIA[s.via] || ''}</small></span></label>
      <button class="move" data-move="${esc(s.id)}" data-dir="-1" aria-label="تحريك ${esc(s.name)} للأعلى" ${k === 0 ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg></button>
      <button class="move" data-move="${esc(s.id)}" data-dir="1" aria-label="تحريك ${esc(s.name)} للأسفل" ${k === list.length - 1 ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button>
    </div>`).join('') || '<p>ستظهر المصادر بعد تحميل الأخبار.</p>'}
  </div>
  ${NATIVE ? '' : `<div class="panel"><h2>تثبيت التطبيق على الهاتف</h2>
    ${installEvt ? '<button class="btn wide" data-install>تثبيت الآن</button>' : ''}
    <ol class="steps"><li><b>آيفون (Safari):</b> زر المشاركة ← «إضافة إلى الشاشة الرئيسية».</li><li><b>أندرويد (Chrome):</b> القائمة ⋮ ← «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».</li></ol>
  </div>`}`;
}

function render() {
  const view = $('#view');
  $('#cats').hidden = state.tab === 'saved' || state.tab === 'settings' || state.tab === 'sec';
  // Each personal section carries its own colours.
  const sec = state.tab === 'sec' ? prefs.section : '';
  if (sec !== (document.documentElement.dataset.section || '')) {
    if (sec) document.documentElement.dataset.section = sec; else delete document.documentElement.dataset.section;
    const bar = sec ? SECTIONS[sec].bar : '#0a7a45';
    document.querySelector('meta[name="theme-color"]').content = bar;
    window.Native?.theme?.(bar);
  }
  $('#cats').innerHTML = state.tab === 'video'
    ? [['all', 'كل القنوات'], ...(state.data?.videoSources || []).filter((s) => s.count).map((s) => [s.id, s.name])].map(([k, l]) => `<button class="chip${state.vsrc === k ? ' on' : ''}" data-vsrc="${esc(k)}">${esc(l)}</button>`).join('')
    : Object.entries(CATS).map(([k, l]) => `<button class="chip${state.cat === k ? ' on' : ''}" data-cat="${k}">${l}</button>`).join('');
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  if (state.tab === 'settings') view.innerHTML = viewSettings();
  else if (state.tab === 'saved') view.innerHTML = viewSaved();
  else if (!state.data) {
    view.innerHTML = state.busy ? '<div class="empty"><b>جارٍ جلب الأخبار من المصادر…</b>قد يستغرق ذلك بضع ثوانٍ في أول مرة.</div>'
      : state.error === 'nodata' ? '<div class="empty"><b>لم تُجهَّز الأخبار بعد</b>سيجلبها التحديث التلقائي خلال دقائق. اضغط زر التحديث لاحقاً.</div>'
      : state.error ? '<div class="empty"><b>تعذّر تحميل الأخبار</b>تحقق من اتصالك بالإنترنت ثم اضغط زر التحديث.</div>'
      : '<div class="empty">جارٍ تحميل الأخبار…</div>';
  } else view.innerHTML = state.tab === 'latest' ? viewLatest() : state.tab === 'video' ? viewVideos() : state.tab === 'sec' ? viewSection() : viewHome();
}

function renderStatus() {
  const el = $('#status');
  el.hidden = ['saved', 'settings', 'video', 'sec'].includes(state.tab);
  el.classList.toggle('err', !!state.error && !!state.data);
  if (!state.data) { el.textContent = ''; return; }
  const live = state.data.sources.filter((s) => s.count && enabled(s.id)).length;
  el.textContent = `${state.busy ? 'جارٍ جلب الأخبار من المصادر… · ' : state.error ? 'بدون اتصال · ' : ''}آخر تحديث ${ago(state.data.generatedAt)} · ${num(visible({ ignoreCat: true }).length)} خبر من ${num(live)} مصدر`;
}

/* ---------- reader view (Android app) ---------- */
const articles = new Map();
const TEXT_TAGS = { P: 'p', H2: 'h3', H3: 'h3', H4: 'h4', H5: 'h4', BLOCKQUOTE: 'blockquote', UL: 'ul', OL: 'ol', LI: 'li', FIGCAPTION: 'figcaption', STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', BR: 'br' };

function absUrl(u, base) {
  try { const url = new URL(u, base); return /^https?:$/.test(url.protocol) ? url.href.replace(/^http:/, 'https:') : ''; } catch { return ''; }
}

// Rebuild extracted article HTML from an allow-list of tags, so no publisher
// markup, scripts, styles or ad containers ever reach the page.
function cleanArticle(html, base, skipImage) {
  const src = new DOMParser().parseFromString(html, 'text/html').body;
  const seen = new Set(skipImage ? [skipImage] : []);
  const walk = (node, out) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (n.nodeValue.trim() || out.lastChild) out.append(n.nodeValue); continue; }
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'IMG') {
        const u = absUrl(n.getAttribute('data-src') || n.getAttribute('data-lazy-src') || n.getAttribute('data-original') || n.getAttribute('src') || '', base);
        if (!u || seen.has(u) || Number(n.getAttribute('width') || 999) < 120) continue;
        seen.add(u);
        const img = document.createElement('img');
        img.src = u; img.alt = n.getAttribute('alt') || ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
        out.append(img);
        continue;
      }
      const tag = TEXT_TAGS[n.tagName];
      if (!tag) { walk(n, out); continue; }
      const el = document.createElement(tag);
      walk(n, el);
      if (tag === 'br' || el.textContent.trim() || el.querySelector('img')) out.append(el);
    }
  };
  const frag = document.createDocumentFragment();
  walk(src, frag);
  // A heading before any text is the headline again, which the sheet already shows.
  if (/^H[34]$/.test(frag.firstElementChild?.tagName)) frag.firstElementChild.remove();
  return frag;
}

async function loadArticle(it) {
  if (articles.has(it.id)) return articles.get(it.id);
  let url = it.u;
  if (new URL(url).hostname.endsWith('news.google.com')) {
    const r = await fetch(`/resolve?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('resolve');
    url = (await r.json()).url;
  }
  const res = await nativeHttp(url);
  const doc = new DOMParser().parseFromString(decodeBody(res.bytes, res.type), 'text/html');
  const image = absUrl(doc.querySelector('meta[property="og:image"], meta[name="twitter:image"]')?.content || '', res.url);
  if (!window.Readability) await new Promise((ok, no) => { const el = document.createElement('script'); el.src = 'lib/readability.js'; el.onload = ok; el.onerror = no; document.head.append(el); });
  const parsed = new window.Readability(doc).parse();
  if (!parsed || parsed.textContent.trim().length < 200) throw new Error('short');
  const art = { url: res.url, image, html: parsed.content };
  articles.set(it.id, art);
  return art;
}

async function showArticle(it) {
  const box = $('#reader');
  try {
    const art = await loadArticle(it);
    if (sheetItem !== it || !box.isConnected) return;
    const cover = $('#sheet img.cover');
    const img = prefs.images && (cover?.src || art.image);
    if (!cover && img) $('#sheet .grab').insertAdjacentHTML('afterend', `<img class="cover" src="${esc(img)}" alt="" referrerpolicy="no-referrer">`);
    const body = cleanArticle(art.html, art.url, img);
    if (!prefs.images) body.querySelectorAll('img').forEach((n) => n.remove());
    box.replaceChildren(body);
    $('#sheet .summary')?.remove();
    $('#sheet a.btn').href = art.url;
  } catch {
    if (sheetItem === it && box.isConnected) box.innerHTML = '<p class="hint">تعذّر عرض نص الخبر داخل التطبيق. استخدم زر «فتح الصفحة الأصلية».</p>';
  }
}

/* ---------- article sheet ---------- */
let sheetItem = null;
function openSheet(id) {
  const it = state.data?.items.find((i) => i.id === id) || state.clubItems.find((i) => i.id === id) || state.gameItems.find((i) => i.id === id) || saved[id];
  if (!it) return;
  sheetItem = it;
  read.add(id); store.set('read', [...read].slice(-600));
  const src = state.byId[it.s] || { name: it.sn || '', color: '', lang: 'ar' };
  const img = prefs.images && httpUrl(it.i);
  const sheet = $('#sheet');
  sheet.dir = src.lang === 'ar' ? 'rtl' : 'ltr';
  sheet.innerHTML = `<div class="grab"></div>
    ${img ? `<img class="cover" src="${esc(img)}" alt="" referrerpolicy="no-referrer">` : ''}
    <div class="meta"><span class="src" style="--src:${esc(src.color)}"><i class="dot"></i>${esc(src.name)}</span><span>${ago(it.d)}</span><span>${esc(CATS[it.c] || '')}</span></div>
    <h2 id="sheet-title">${esc(it.t)}</h2>
    ${it.x ? `<p class="summary">${esc(it.x)}</p>` : ''}
    ${NATIVE ? '<div class="reader" id="reader"><p class="hint">جارٍ تحميل نص الخبر…</p></div>' : ''}
    <div class="actions" dir="rtl">
      <a class="btn${NATIVE ? ' ghost' : ''}" href="${esc(httpUrl(it.u))}" target="_blank" rel="noopener noreferrer">${NATIVE ? 'فتح الصفحة الأصلية ↗' : 'قراءة الخبر كاملاً من المصدر ↗'}</a>
      <button class="btn ghost" data-save>${saved[id] ? '🔖 محفوظ' : 'حفظ'}</button>
      <button class="btn ghost" data-share>مشاركة</button>
      <button class="btn ghost" data-close>إغلاق</button>
    </div>`;
  sheet.classList.toggle('full', NATIVE);
  sheet.hidden = false; $('#backdrop').hidden = false;
  document.body.style.overflow = 'hidden';
  sheet.scrollTop = 0;
  if (NATIVE) showArticle(it); else sheet.querySelector('a').focus({ preventScroll: true });
  document.querySelectorAll(`[data-open="${CSS.escape(id)}"]`).forEach((b) => b.classList.add('read'));
}
function openVideo(id) {
  const v = [...(state.data?.videos || []), ...state.gameVideos].find((x) => x.id === id);
  if (!v) return;
  const ch = state.vById[v.s];
  const url = `https://www.youtube.com/watch?v=${v.id}`;
  sheetItem = { t: v.t, u: url };
  const sheet = $('#sheet');
  sheet.dir = 'rtl';
  sheet.classList.remove('full');
  sheet.innerHTML = `<div class="grab"></div>
    <div class="player"><iframe src="https://www.youtube-nocookie.com/embed/${esc(v.id)}?autoplay=1&playsinline=1&rel=0&hl=ar" title="${esc(v.t)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
    <div class="meta"><span class="src" style="--src:${esc(ch.color)}"><i class="dot"></i>${esc(ch.name)}</span><span>${ago(v.d)}</span></div>
    <h2 id="sheet-title">${esc(v.t)}</h2>
    <div class="actions">
      <a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">فتح في يوتيوب ↗</a>
      <button class="btn ghost" data-share>مشاركة</button>
      <button class="btn ghost" data-close>إغلاق</button>
    </div>`;
  sheet.hidden = false; $('#backdrop').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  if ($('#sheet').hidden) return;
  $('#sheet').innerHTML = ''; // also stops any playing video
  $('#sheet').hidden = true; $('#backdrop').hidden = true; document.body.style.overflow = '';
  sheetItem = null;
  if (state.tab === 'saved') render();
}

/* ---------- events ---------- */
let installEvt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (state.tab === 'settings') render(); });

function go(tab, filter = null) {
  state.tab = tab; state.filter = filter; state.limit = PAGE;
  render(); renderStatus(); scrollTo(0, 0);
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a, [data-cat]');
  if (e.target.id === 'backdrop') return closeSheet();
  if (!t) return;
  const d = t.dataset;
  if (d.tab) return go(d.tab);
  if (d.cat) { state.cat = d.cat; state.limit = PAGE; render(); renderStatus(); return; }
  if (d.open) return openSheet(d.open);
  if (d.video) return openVideo(d.video);
  if (d.sec) { prefs.section = d.sec; savePrefs(); state.limit = PAGE; render(); return scrollTo(0, 0); }
  if (d.game) { state.game = d.game; state.limit = PAGE; return render(); }
  if (d.club) { state.club = d.club; state.limit = PAGE; return render(); }
  if (d.vsrc) { state.vsrc = d.vsrc; state.limit = PAGE; return render(); }
  if (d.filter) { const f = JSON.parse(d.filter); return go('latest', f.all ? null : f); }
  if ('clearFilter' in d) return go('latest');
  if ('more' in d) { state.limit += PAGE; return render(); }
  if ('close' in d) return closeSheet();
  if ('save' in d && sheetItem) {
    const it = sheetItem;
    if (saved[it.id]) delete saved[it.id];
    else saved[it.id] = { id: it.id, s: it.s, sn: state.byId[it.s]?.name || it.sn, t: it.t, u: it.u, d: it.d, x: it.x, i: it.i, c: it.c, at: Date.now() };
    store.set('saved', saved);
    t.textContent = saved[it.id] ? '🔖 محفوظ' : 'حفظ';
    return;
  }
  if ('share' in d && sheetItem) {
    const payload = { title: sheetItem.t, text: sheetItem.t, url: sheetItem.u };
    try {
      if (window.Native?.share) window.Native.share(payload.title, payload.url);
      else if (navigator.share) await navigator.share(payload);
      else { await navigator.clipboard.writeText(`${sheetItem.t}\n${sheetItem.u}`); t.textContent = 'تم نسخ الرابط ✓'; }
    } catch { /* user cancelled */ }
    return;
  }
  if ('install' in d && installEvt) { installEvt.prompt(); installEvt = null; return; }
  if (d.val !== undefined && t.parentElement.dataset.pref) {
    const key = t.parentElement.dataset.pref;
    prefs[key] = key === 'theme' ? d.val : key === 'images' ? d.val === 'true' : Number(d.val);
    savePrefs(); applyLook(); return render();
  }
  if (d.move) {
    const i = prefs.order.indexOf(d.move); const j = i + Number(d.dir);
    if (i < 0 || j < 0 || j >= prefs.order.length) return;
    [prefs.order[i], prefs.order[j]] = [prefs.order[j], prefs.order[i]];
    savePrefs(); return render();
  }
  if (d.kwAdd) { prefs.keywords.push(d.kwAdd); savePrefs(); return render(); }
  if (d.kwDel) { prefs.keywords = prefs.keywords.filter((k) => k !== d.kwDel); savePrefs(); return render(); }
  if (t.id === 'btn-refresh') return load(true);
  if (t.id === 'btn-search') { $('#searchbar').hidden = false; $('#q').focus(); return; }
  if (t.id === 'q-close') {
    $('#searchbar').hidden = true; $('#q').value = ''; state.query = '';
    render(); renderStatus();
  }
});

document.addEventListener('change', (e) => {
  const id = e.target.dataset?.src;
  if (!id) return;
  prefs.off = e.target.checked ? prefs.off.filter((x) => x !== id) : [...new Set([...prefs.off, id])];
  savePrefs();
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'kw-form') return;
  e.preventDefault();
  const v = $('#kw').value.trim();
  if (v && !prefs.keywords.includes(v)) { prefs.keywords.push(v); savePrefs(); }
  render();
});

let qTimer;
$('#q').addEventListener('input', (e) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    state.query = e.target.value; state.limit = PAGE;
    if (state.tab === 'saved' || state.tab === 'settings') state.tab = 'latest';
    render(); renderStatus();
  }, 180);
});

// Broken or hot-link-blocked images: drop them instead of showing a broken icon.
document.addEventListener('error', (e) => {
  const el = e.target;
  if (el.tagName !== 'IMG' || el.closest('.brand')) return;
  const card = el.closest('.hero-card');
  (card || el).remove();
}, true);

addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) store.set('lastVisit', Date.now());
  else if (!state.data || Date.now() - state.data.generatedAt > REFRESH_MS) load();
});
addEventListener('pagehide', () => store.set('lastVisit', Date.now()));
setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
setInterval(renderStatus, 60000);

/* ---------- boot ---------- */
applyLook();
try {
  $('#today').textContent = `${new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())} · ${new Intl.DateTimeFormat('ar-EG-u-nu-arab', { day: 'numeric', month: 'long' }).format(new Date())}`;
} catch { /* Intl calendar unsupported */ }
render();
load();
// Android back button: close the open story first, then return to the first tab, then exit.
window.__back = () => {
  if (!$('#sheet').hidden) { closeSheet(); return true; }
  if (state.tab !== 'home' || state.query) { $('#searchbar').hidden = true; $('#q').value = ''; state.query = ''; go('home'); return true; }
  return false;
};
if (!NATIVE && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
