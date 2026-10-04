/* UNICA — ядро: помощники, API, вход, маршруты, меню, окна, иконки */
'use strict';

/* ---------- форматирование ---------- */
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsq = (s) => esc(String(s)).replace(/'/g, "\\'");
const money = (v) => (v == null || v === '' ? '—' : Math.round(Number(v)).toLocaleString('ru-RU').replace(/,/g, ' '));
const qtyFmt = (v) => (Math.round(Number(v) * 1000) / 1000).toLocaleString('ru-RU');
const pct = (v, d = 1) => (Number.isFinite(v) ? (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('ru-RU') + '%' : '—');
function plural(n, one, few, many) { const a = Math.abs(n) % 10, b = Math.abs(n) % 100; return b > 10 && b < 20 ? many : a === 1 ? one : a >= 2 && a <= 4 ? few : many; }
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function dt(local, withTime = true) {
  if (!local) return '';
  const [d, t] = local.split(' '); const [y, m, dd] = d.split('-');
  return `${dd}.${m}.${y}` + (withTime && t ? ' ' + t.slice(0, 5) : '');
}
const timeOf = (local) => (local || '').slice(11, 16);
function dayLabel(day) {
  const today = ymd(new Date()), yest = ymd(addDays(new Date(), -1));
  if (day === today) return 'Сегодня';
  if (day === yest) return 'Вчера';
  const d = new Date(day + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- API ---------- */
const Api = {
  token: (() => { try { return localStorage.getItem('unica_token'); } catch (e) { return null; } })(),
  async req(method, path, body, isForm) {
    const headers = {};
    if (!isForm) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    let res;
    try { res = await fetch('/api' + path, { method, headers, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) }); }
    catch (e) { throw Object.assign(new Error('offline'), { offline: true }); }
    if (res.status === 401 && path !== '/auth/login') { Auth.logout(); throw new Error('unauthorized'); }
    let data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw Object.assign(new Error((data && data.error) || 'error'), { status: res.status, data });
    return data;
  },
  get(p) { return this.req('GET', p); }, post(p, b, f) { return this.req('POST', p, b ?? {}, f); },
  patch(p, b, f) { return this.req('PATCH', p, b, f); }, put(p, b) { return this.req('PUT', p, b); }, del(p) { return this.req('DELETE', p); },
};

/* ---------- состояние ---------- */
const State = { user: null, settings: null, accounts: [], categories: [] };
const isAdmin = () => State.user && State.user.role === 'admin';
async function loadBasics() {
  const [s, a, c] = await Promise.all([Api.get('/settings'), Api.get('/cash/accounts'), Api.get('/categories')]);
  State.settings = s; State.accounts = a; State.categories = c;
}
async function refreshAccounts() { State.accounts = await Api.get('/cash/accounts'); return State.accounts; }

/* ---------- вход ---------- */
const Auth = {
  async init() {
    if (!Api.token) return false;
    try { State.user = await Api.get('/auth/me'); return true; } catch (e) { return false; }
  },
  async login(login, password) {
    const d = await Api.post('/auth/login', { login, password });
    Api.token = d.token; State.user = d.user;
    try { localStorage.setItem('unica_token', d.token); } catch (e) {}
  },
  logout() {
    Api.token = null; State.user = null;
    try { localStorage.removeItem('unica_token'); } catch (e) {}
    closeSheet(); showLogin();
  },
};
function showLogin() {
  document.body.dataset.screen = 'login';
  $('#app').innerHTML = '';
  $('#login').hidden = false;
  setTimeout(() => $('#loginName')?.focus(), 50);
}
async function doLogin(e) {
  e.preventDefault();
  const err = $('#loginErr'); err.hidden = true;
  const btn = $('#loginBtn'); btn.disabled = true;
  try {
    await Auth.login($('#loginName').value.trim(), $('#loginPass').value);
    $('#login').hidden = true;
    await startApp();
  } catch (ex) {
    err.textContent = ex.offline ? 'Нет связи с сервером. Проверьте интернет.' : 'Неверный логин или пароль.';
    err.hidden = false;
  } finally { btn.disabled = false; }
}

/* ---------- маршруты ---------- */
const Routes = {};          // name -> async (params, query) => void
let Route = { name: '', parts: [], query: {} };
function route(name, fn) { Routes[name] = fn; }
function go(hash) { if (location.hash === hash) router(); else location.hash = hash; }
async function router() {
  if (!State.user) return;
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  let name = parts[0] || 'sell';
  if (!Routes[name]) name = 'sell';
  Route = { name, parts, query };
  closeSheet();
  renderNav();
  const app = $('#app');
  app.innerHTML = `<div class="loading"><span></span></div>`;
  try { await Routes[name](parts.slice(1), query); }
  catch (e) {
    if (e.message === 'unauthorized') return;
    console.error(e);
    app.innerHTML = emptyState(icons.alert, e.status === 403 ? 'Этот раздел доступен только владельцу' : e.offline ? 'Нет связи с сервером' : 'Не удалось открыть страницу', e.offline ? 'Проверьте интернет и обновите страницу.' : '', `<button class="btn" onclick="router()">Обновить</button>`);
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', router);

/* ---------- меню ---------- */
function navItems() {
  const a = isAdmin();
  return [
    { id: 'sell', label: 'Продажа', icon: icons.bag, hash: '#/sell', match: ['sell'] },
    { id: 'sales', label: 'Чеки', icon: icons.receipt, hash: '#/sales', match: ['sales'] },
    { id: 'cash', label: 'Касса', icon: icons.wallet, hash: '#/cash', match: ['cash'] },
    { id: 'stock', label: 'Склад', icon: icons.box, hash: '#/stock', match: ['stock', 'product', 'purchases', 'purchase'], admin: true },
    { id: 'clients', label: 'Клиенты', icon: icons.users, hash: '#/clients', match: ['clients', 'contact', 'suppliers'] },
    { id: 'reports', label: 'Отчёты', icon: icons.chart, hash: '#/reports', match: ['reports'], admin: true },
    { id: 'more', label: 'Ещё', icon: icons.more, hash: '#/more', match: ['more', 'settings', 'users'] },
  ].filter(i => !i.admin || a);
}
function renderNav() {
  const items = navItems();
  const cur = (i) => i.match.includes(Route.name);
  $('#side').innerHTML = `
    <a class="side-brand" href="#/sell"><span class="mark">U</span><span>UNICA<small>${esc(State.settings?.company_sub || 'двери и комплектующие')}</small></span></a>
    <nav class="side-nav">${items.filter(i => i.id !== 'more').map(i => `<a href="${i.hash}" class="${cur(i) ? 'on' : ''}">${i.icon}<span>${i.label}</span>${i.id === 'sell' ? `<b class="nav-count" data-cart-count hidden></b>` : ''}</a>`).join('')}</nav>
    <div class="side-foot">
      <a href="#/more" class="side-user ${cur(items.find(i => i.id === 'more')) ? 'on' : ''}"><span class="ava">${esc((State.user.name || '?')[0])}</span><span>${esc(State.user.name)}<small>${isAdmin() ? 'владелец' : 'продавец'}</small></span>${icons.more}</a>
    </div>`;
  // на телефоне 5 вкладок: продажа, касса, склад/чеки, отчёты/клиенты, ещё
  const mob = isAdmin() ? ['sell', 'cash', 'stock', 'reports', 'more'] : ['sell', 'sales', 'cash', 'clients', 'more'];
  const mobItems = mob.map(id => items.find(i => i.id === id)).filter(Boolean);
  const anyOn = mobItems.some(i => i.id !== 'more' && cur(i));
  $('#tabs').innerHTML = mobItems.map(i =>
    `<a href="${i.hash}" class="${(i.id === 'more' ? !anyOn : cur(i)) ? 'on' : ''}">
      <span class="tab-ico">${i.icon}${i.id === 'sell' ? `<b class="nav-count" data-cart-count hidden></b>` : ''}</span><span>${i.label}</span></a>`).join('');
  updateCartCount();
}
function updateCartCount() {
  const n = typeof Cart !== 'undefined' ? Cart.lines.length : 0;
  document.querySelectorAll('[data-cart-count]').forEach(el => { el.textContent = n; el.hidden = !n; });
}

/* ---------- шапка страницы ---------- */
function pageHead(title, actions = '', sub = '') {
  return `<header class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="page-actions">${actions}</div></header>`;
}
function emptyState(icon, title, text = '', action = '') {
  return `<div class="empty">${icon}<b>${title}</b>${text ? `<p>${text}</p>` : ''}${action}</div>`;
}

/* ---------- окно-шторка ---------- */
function openSheet({ title, body, footer = '', wide = false, onClose }) {
  const root = $('#sheet');
  root.innerHTML = `<div class="sheet-bg" onclick="closeSheet()"></div>
    <section class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header><h2>${title}</h2><button class="icon-btn" onclick="closeSheet()" aria-label="Закрыть">${icons.x}</button></header>
      <div class="sheet-body">${body}</div>
      ${footer ? `<footer>${footer}</footer>` : ''}
    </section>`;
  root.hidden = false;
  document.body.classList.add('sheet-open');
  root._onClose = onClose;
  setTimeout(() => root.querySelector('[autofocus]')?.focus(), 60);
}
function closeSheet() {
  const root = $('#sheet');
  if (!root || root.hidden) return;
  root.hidden = true; root.innerHTML = '';
  document.body.classList.remove('sheet-open');
  if (root._onClose) { const f = root._onClose; root._onClose = null; f(); }
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
function confirmSheet(title, text, okLabel, onOk, danger = true) {
  openSheet({
    title, body: `<p class="lead">${text}</p>`,
    footer: `<button class="btn" onclick="closeSheet()">Отмена</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cfOk">${okLabel}</button>`,
  });
  $('#cfOk').onclick = async () => { $('#cfOk').disabled = true; try { await onOk(); } finally { const b = $('#cfOk'); if (b) b.disabled = false; } };
}

/* ---------- уведомление ---------- */
function toast(msg, type = 'ok', ms = 2800) {
  const t = $('#toast');
  t.innerHTML = `<div class="toast ${type}">${type === 'err' ? icons.alert : icons.check}<span>${esc(msg)}</span></div>`;
  clearTimeout(t._t); t._t = setTimeout(() => { t.innerHTML = ''; }, ms);
}
function errText(e, fallback) {
  if (e && e.offline) return 'Нет связи с сервером. Проверьте интернет.';
  const map = { debt_needs_client: 'Для продажи в долг укажите имя или телефон покупателя.', overpaid: 'Оплата больше суммы чека.', linked_op: 'Эта операция привязана к чеку или приходу — отмените сам документ.', has_history: 'У контакта есть история — его нельзя удалить.', login_taken: 'Такой логин уже занят.', already: 'Демо-данные уже добавлены.' };
  return (e && e.message && map[e.message]) || fallback;
}

/* ---------- поля ввода ---------- */
const field = (label, input, hint = '') => `<label class="field"><span>${label}</span>${input}${hint ? `<em>${hint}</em>` : ''}</label>`;
const numInput = (id, val = '', attrs = '') => `<input id="${id}" type="text" inputmode="numeric" pattern="[0-9 ]*" autocomplete="off" value="${val === '' || val == null ? '' : esc(val)}" ${attrs}>`;
const readNum = (id) => { const el = typeof id === 'string' ? document.getElementById(id) : id; return el ? Math.round(Number(String(el.value).replace(/[^\d.,-]/g, '').replace(',', '.')) || 0) : 0; };
function accountOptions(selected) { return State.accounts.map(a => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join(''); }
function segHtml(name, options, value, onchange) {
  return `<div class="seg" role="radiogroup">${options.map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === value}" class="${v === value ? 'on' : ''}" onclick="${onchange}('${v}')">${l}</button>`).join('')}</div>`;
}

/* ---------- периоды ---------- */
function periodRange(p) {
  const now = new Date(), t = ymd(now);
  switch (p) {
    case 'today': return [t, t];
    case 'yesterday': { const y = ymd(addDays(now, -1)); return [y, y]; }
    case '7': return [ymd(addDays(now, -6)), t];
    case '30': return [ymd(addDays(now, -29)), t];
    case 'month': return [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), t];
    case 'prevmonth': return [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))];
    default: return [t, t];
  }
}

/* ---------- иконки (24×24, обводка) ---------- */
const I = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;
const icons = {
  bag: I('<path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>'),
  receipt: I('<path d="M6 3h12v18l-2.5-1.6L13 21l-2.5-1.6L8 21l-2-1.3z"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
  wallet: I('<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><rect x="4" y="8" width="16" height="11" rx="2"/><path d="M16 13.5h.01"/>'),
  box: I('<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>'),
  users: I('<circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3.4 2.7-5.5 6-5.5s6 2.1 6 5.5"/><path d="M16 5.5a3 3 0 0 1 0 5.6M18 14c2 .7 3 2.4 3 5"/>'),
  chart: I('<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>'),
  more: I('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  minus: I('<path d="M5 12h14"/>'),
  x: I('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: I('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  alert: I('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>'),
  search: I('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>'),
  back: I('<path d="M15 5l-7 7 7 7"/>'),
  chev: I('<path d="M9 5l7 7-7 7"/>'),
  print: I('<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>'),
  wa: '<svg viewBox="0 0 24 24" aria-hidden="true" class="fill"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3z"/></svg>',
  cash: I('<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v.01M17.5 14.5v.01"/>'),
  card: I('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18h2"/>'),
  clock: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  in: I('<path d="M12 4v13M6.5 11.5L12 17l5.5-5.5"/><path d="M5 20h14"/>'),
  out: I('<path d="M12 20V7M6.5 12.5L12 7l5.5 5.5"/><path d="M5 4h14"/>'),
  swap: I('<path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5"/>'),
  truck: I('<path d="M3 6h11v10H3zM14 9h4l3 3.5V16h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>'),
  edit: I('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  trash: I('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>'),
  phone: I('<path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16.5 16.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>'),
  door: I('<path d="M6 21V3.5h12V21"/><path d="M3.5 21h17"/><path d="M14.5 12h.01"/>'),
  doorglass: I('<path d="M6 21V3.5h12V21"/><path d="M3.5 21h17"/><rect x="9" y="6.5" width="6" height="7"/><path d="M15.5 16h.01"/>'),
  shield: I('<path d="M6 21V3.5h12V21"/><path d="M3.5 21h17"/><rect x="8.5" y="6" width="7" height="12" rx="1"/><path d="M14 11v2"/>'),
  frame: I('<path d="M5 21V3.5h14V21"/><path d="M8 21V6.5h8V21"/>'),
  casing: I('<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M3.5 12v4h16a1 1 0 0 0 1-1v-3"/>'),
  ext: I('<rect x="3.5" y="5" width="17" height="3" rx=".5"/><rect x="3.5" y="10.5" width="17" height="3" rx=".5"/><rect x="3.5" y="16" width="17" height="3" rx=".5"/>'),
  handle: I('<rect x="4" y="7" width="5" height="10" rx="2.5"/><path d="M6.5 12H20"/>'),
  threshold: I('<path d="M2.5 16l4-4h11l4 4z"/>'),
  key: I('<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M21 12v2"/>'),
  logout: I('<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>'),
  install: I('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 7v7M9 11.5l3 3 3-3"/>'),
  gear: I('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
  doc: I('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>'),
  sparkle: I('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>'),
};
const CAT_ICONS = { door_interior: 'door', door_enamel: 'doorglass', door_metal: 'shield', frame: 'frame', casing: 'casing', extension: 'ext', handle: 'handle', threshold: 'threshold', box: 'box' };
const catIcon = (key) => icons[CAT_ICONS[key] || 'box'] || icons.box;

/* ---------- запуск ---------- */
async function startApp() {
  document.body.dataset.screen = 'app';
  await loadBasics();
  if (typeof Cart !== 'undefined') Cart.load();
  if (!location.hash) location.hash = '#/sell';
  await router();
}
async function boot() {
  try {
    if (await Auth.init()) { $('#login').hidden = true; await startApp(); }
    else showLogin();
  } catch (e) { console.error(e); showLogin(); }
  finally { $('#boot')?.remove(); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
