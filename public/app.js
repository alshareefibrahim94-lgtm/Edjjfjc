// أخبار السعودية — single-page app. Data comes from data/news.json, which the
// GitHub Actions workflow rebuilds from the publishers' feeds every ~20 minutes.
const CATS = { all: 'الكل', local: 'محليات', politics: 'سياسة', economy: 'اقتصاد', sports: 'رياضة', tech: 'تقنية', culture: 'ثقافة ومنوعات' };
const SUGGESTED = ['رؤية 2030', 'ولي العهد', 'أرامكو', 'الهلال', 'النصر', 'موسم الرياض', 'نيوم', 'الطقس', 'التعليم', 'الإسكان'];
const PAGE = 40;
const REFRESH_MS = 5 * 60 * 1000;

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem('sn:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sn:' + k, JSON.stringify(v)); } catch { /* private mode / quota */ } },
};

const prefs = { theme: 'auto', font: 1, perWidget: 4, images: true, order: [], off: [], known: [], keywords: [], ...store.get('prefs', {}) };
const saved = store.get('saved', {});
const read = new Set(store.get('read', []));
const lastVisit = store.get('lastVisit', 0);
const state = { data: null, byId: {}, tab: 'home', cat: 'all', query: '', filter: null, limit: PAGE, error: '' };

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
async function load(manual) {
  $('#btn-refresh').classList.add('spin');
  try {
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
    $('#btn-refresh').classList.remove('spin');
    renderStatus();
  }
}

function setData(data) {
  state.data = data;
  state.byId = Object.fromEntries(data.sources.map((s) => [s.id, s]));
  // First time we see a source: append it to the widget order; English ones start switched off.
  for (const s of data.sources) {
    if (prefs.known.includes(s.id)) continue;
    prefs.known.push(s.id); prefs.order.push(s.id);
    if (s.lang !== 'ar') prefs.off.push(s.id);
  }
  savePrefs();
  for (const it of data.items) it.n = norm(`${it.t} ${it.x || ''}`);
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

/* ---------- views ---------- */
function viewHome() {
  const items = visible();
  if (state.query) return `<div class="section-title">نتائج البحث (${num(items.length)})</div>${listView(items, 'لا توجد نتائج مطابقة')}`;
  let html = hero(items);
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
  <div class="panel"><h2>تثبيت التطبيق على الهاتف</h2>
    ${installEvt ? '<button class="btn wide" data-install>تثبيت الآن</button>' : ''}
    <ol class="steps"><li><b>آيفون (Safari):</b> زر المشاركة ← «إضافة إلى الشاشة الرئيسية».</li><li><b>أندرويد (Chrome):</b> القائمة ⋮ ← «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».</li></ol>
  </div>`;
}

function render() {
  const view = $('#view');
  $('#cats').hidden = state.tab === 'saved' || state.tab === 'settings';
  $('#cats').innerHTML = Object.entries(CATS).map(([k, l]) => `<button class="chip${state.cat === k ? ' on' : ''}" data-cat="${k}">${l}</button>`).join('');
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  if (state.tab === 'settings') view.innerHTML = viewSettings();
  else if (state.tab === 'saved') view.innerHTML = viewSaved();
  else if (!state.data) {
    view.innerHTML = state.error === 'nodata'
      ? '<div class="empty"><b>لم تُجهَّز الأخبار بعد</b>سيجلبها التحديث التلقائي خلال دقائق. اضغط زر التحديث لاحقاً.</div>'
      : state.error ? '<div class="empty"><b>تعذّر تحميل الأخبار</b>تحقق من اتصالك بالإنترنت ثم اضغط زر التحديث.</div>'
      : '<div class="empty">جارٍ تحميل الأخبار…</div>';
  } else view.innerHTML = state.tab === 'latest' ? viewLatest() : viewHome();
}

function renderStatus() {
  const el = $('#status');
  el.hidden = state.tab === 'saved' || state.tab === 'settings';
  el.classList.toggle('err', !!state.error && !!state.data);
  if (!state.data) { el.textContent = ''; return; }
  const live = state.data.sources.filter((s) => s.count && enabled(s.id)).length;
  el.textContent = `${state.error ? 'بدون اتصال · ' : ''}آخر تحديث ${ago(state.data.generatedAt)} · ${num(visible({ ignoreCat: true }).length)} خبر من ${num(live)} مصدر`;
}

/* ---------- article sheet ---------- */
let sheetItem = null;
function openSheet(id) {
  const it = state.data?.items.find((i) => i.id === id) || saved[id];
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
    ${it.x ? `<p>${esc(it.x)}</p>` : ''}
    <div class="actions" dir="rtl">
      <a class="btn" href="${esc(httpUrl(it.u))}" target="_blank" rel="noopener noreferrer">قراءة الخبر كاملاً من المصدر ↗</a>
      <button class="btn ghost" data-save>${saved[id] ? '🔖 محفوظ' : 'حفظ'}</button>
      <button class="btn ghost" data-share>مشاركة</button>
      <button class="btn ghost" data-close>إغلاق</button>
    </div>`;
  sheet.hidden = false; $('#backdrop').hidden = false;
  document.body.style.overflow = 'hidden';
  sheet.querySelector('a').focus({ preventScroll: true });
  document.querySelectorAll(`[data-open="${CSS.escape(id)}"]`).forEach((b) => b.classList.add('read'));
}
function closeSheet() {
  if ($('#sheet').hidden) return;
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
      if (navigator.share) await navigator.share(payload);
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
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
