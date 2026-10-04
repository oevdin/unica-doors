/* ============================================================
   UNICA — заявки и контрагенты. SPA, vanilla JS, hash-роутинг.
   ============================================================ */

/* ---------- constants & helpers ---------- */
const STATUS_LABELS = {
  new: 'Новая', confirmed: 'Подтверждена', shipped: 'Отгружена',
  done: 'Завершена', cancelled: 'Отменена',
};
const STATUS_ORDER = ['new', 'confirmed', 'shipped', 'done', 'cancelled'];

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtPrice(p) {
  if (p === null || p === undefined || p === '') return '—';
  return Number(p).toLocaleString('ru-RU').replace(/,/g, ' ');
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function pluralItems(n) {
  const n10 = n % 10, n100 = n % 100;
  if (n100 >= 11 && n100 <= 14) return 'товаров';
  if (n10 === 1) return 'товар';
  if (n10 >= 2 && n10 <= 4) return 'товара';
  return 'товаров';
}
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ---------- API layer ---------- */
const Api = {
  token: localStorage.getItem('unica_token') || null,

  headers(json = true) {
    const h = {};
    if (json) h['Content-Type'] = 'application/json';
    if (this.token) h['Authorization'] = 'Bearer ' + this.token;
    return h;
  },

  async req(method, path, body, isForm = false) {
    const opts = { method, headers: this.headers(!isForm) };
    if (body !== undefined) opts.body = isForm ? body : JSON.stringify(body);
    const res = await fetch('/api' + path, opts);
    if (res.status === 401) {
      Auth.logout();
      throw new Error('unauthorized');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'request_failed');
      err.data = data;
      err.status = res.status;
      throw err;
    }
    return data;
  },

  get(path) { return this.req('GET', path); },
  post(path, body, isForm) { return this.req('POST', path, body, isForm); },
  patch(path, body, isForm) { return this.req('PATCH', path, body, isForm); },
  del(path) { return this.req('DELETE', path); },
};

/* ---------- auth ---------- */
const Auth = {
  user: null,

  async init() {
    if (!Api.token) return false;
    try {
      this.user = await Api.get('/auth/me');
      return true;
    } catch (e) {
      this.logout();
      return false;
    }
  },

  async login(login, password) {
    const data = await Api.post('/auth/login', { login, password });
    Api.token = data.token;
    localStorage.setItem('unica_token', data.token);
    this.user = data.user;
  },

  logout() {
    Api.token = null;
    this.user = null;
    localStorage.removeItem('unica_token');
    Cart.clear(true);
    showAuthScreen();
  },

  isAdmin() { return this.user && this.user.role === 'admin'; },
};

/* ---------- cart (draft order, per browser session) ----------
   A cart line is a product + chosen options (цвет, размер, ...).
   The same door in two colors = two separate lines, keyed by `key`. */
function cartKey(productId, opts) {
  const o = opts || {};
  const norm = Object.keys(o).sort().map(k => k + '=' + o[k]).join(';');
  return productId + '|' + norm;
}
function optsLabel(opts) {
  return Object.entries(opts || {}).map(([k, v]) => v).join(' · ');
}
const Cart = {
  items: [],

  load() {
    try {
      const raw = localStorage.getItem('unica_doors_cart');
      this.items = raw ? JSON.parse(raw) : [];
    } catch (e) { this.items = []; }
  },
  save() {
    try { localStorage.setItem('unica_doors_cart', JSON.stringify(this.items)); } catch (e) {}
  },
  clear(silent) {
    this.items = [];
    this.save();
    if (!silent) render();
  },
  find(key) { return this.items.find(i => i.key === key); },
  qtyOfProduct(productId) { return this.items.filter(i => i.product_id === productId).reduce((s, i) => s + i.qty, 0); },
  add(product, opts, qty) {
    const key = cartKey(product.id, opts);
    const existing = this.find(key);
    const n = qty || 1;
    if (existing) existing.qty += n;
    else this.items.push({
      key, product_id: product.id, name: product.name, opts: opts || {},
      price: product.price, photo: product.photo, unit: product.unit || 'шт', qty: n,
    });
    this.save();
  },
  setQty(key, qty) {
    const it = this.find(key);
    if (!it) return;
    if (qty <= 0) { this.items = this.items.filter(i => i.key !== key); }
    else { it.qty = qty; }
    this.save();
  },
  count() { return this.items.reduce((s, i) => s + i.qty, 0); },
  total() { return this.items.reduce((s, i) => s + (i.price || 0) * i.qty, 0); },
};

/* ---------- global catalog cache ---------- */
let CATEGORIES = [];
let PRODUCTS_CACHE = {}; // categoryId -> products[]
const PRODUCT_INDEX = {}; // productId -> product (any product we've seen)

function parseOptions(p) {
  if (p._opts !== undefined) return p._opts;
  let o = null;
  try { o = p.options ? JSON.parse(p.options) : null; } catch (e) { o = null; }
  p._opts = o && Object.keys(o).length ? o : null;
  return p._opts;
}
function indexProducts(rows) { rows.forEach(p => { parseOptions(p); PRODUCT_INDEX[p.id] = p; }); return rows; }

async function loadCategories() {
  CATEGORIES = await Api.get('/categories');
}
async function loadProducts(categoryId) {
  if (PRODUCTS_CACHE[categoryId]) return PRODUCTS_CACHE[categoryId];
  const rows = indexProducts(await Api.get('/products?category_id=' + categoryId));
  PRODUCTS_CACHE[categoryId] = rows;
  return rows;
}
function invalidateProductCache() { PRODUCTS_CACHE = {}; }
function categoryBySlug(slug) { return CATEGORIES.find(c => c.slug === slug); }

/* Комплектующие, которые предлагаются к двери из этих разделов.
   cat — slug раздела, pick — какой товар выбрать по умолчанию (часть названия). */
const KIT_RULES = {
  'interior-ecoshpon': [
    { cat: 'frames', label: 'Коробка', qty: 1, on: true },
    { cat: 'casings', label: 'Наличник (2 стороны)', qty: 2, on: true },
    { cat: 'extensions', label: 'Добор', qty: 1, on: false },
    { cat: 'hardware', label: 'Петли', qty: 1, on: true, pick: 'Петли' },
    { cat: 'hardware', label: 'Ручка', qty: 1, on: true, pick: 'Ручка' },
    { cat: 'hardware', label: 'Защёлка', qty: 1, on: true, pick: 'Защёлка' },
  ],
};
KIT_RULES['interior-enamel'] = KIT_RULES['interior-ecoshpon'];
KIT_RULES['metal'] = [
  { cat: 'thresholds', label: 'Уплотнитель', qty: 1, on: false, pick: 'Уплотнитель' },
];

/* ---------- router ---------- */
let currentRoute = { name: 'home' };

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = hash.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { parts, query };
}

async function router() {
  if (!Auth.user) { showAuthScreen(); return; }
  showAppScreen();

  const { parts, query } = parseHash();
  const app = document.getElementById('app');
  app.innerHTML = '<div class="empty-state">Загрузка…</div>';

  try {
    if (parts.length === 0) {
      currentRoute = { name: 'home' };
      await viewHome();
    } else if (parts[0] === 'category' && parts[1]) {
      currentRoute = { name: 'category', id: Number(parts[1]) };
      await viewCategory(Number(parts[1]));
    } else if (parts[0] === 'search') {
      currentRoute = { name: 'search', q: query.q || '' };
      await viewSearch(query.q || '');
    } else if (parts[0] === 'cart') {
      currentRoute = { name: 'cart' };
      await viewCart();
    } else if (parts[0] === 'contractors') {
      currentRoute = { name: 'contractors' };
      await viewContractors();
    } else if (parts[0] === 'orders' && parts[1]) {
      currentRoute = { name: 'order-detail', id: Number(parts[1]) };
      await viewOrderDetail(Number(parts[1]));
    } else if (parts[0] === 'orders') {
      currentRoute = { name: 'orders' };
      await viewOrders(query);
    } else if (parts[0] === 'admin') {
      if (!Auth.isAdmin()) { navigate('#/'); return; }
      currentRoute = { name: 'admin', tab: parts[1] || 'catalog' };
      await viewAdmin(parts[1] || 'catalog');
    } else {
      currentRoute = { name: 'home' };
      await viewHome();
    }
  } catch (e) {
    if (e.message !== 'unauthorized') {
      app.innerHTML = `<div class="empty-state">${notFoundIcon()}<div>Не удалось загрузить страницу</div></div>`;
      console.error(e);
    }
  }

  renderNav();
  window.scrollTo({ top: 0 });
}

function navigate(hash) { location.hash = hash; }
window.addEventListener('hashchange', router);

/* ============================================================
   VIEWS
   ============================================================ */

/* ---- home: hero + category grid ---- */
async function viewHome() {
  if (CATEGORIES.length === 0) await loadCategories();
  const app = document.getElementById('app');

  let html = `<section class="hero">
    <div class="hero-text">
      <div class="hero-kicker">UNICA DOORS</div>
      <h1>Двери и всё для их установки</h1>
      <p>Межкомнатные и металлические двери, коробки, наличники, доборы и фурнитура — соберите комплект и отправьте заявку за пару минут.</p>
      <form class="hero-search" onsubmit="event.preventDefault(); const v=this.q.value.trim(); if(v) navigate('#/search?q='+encodeURIComponent(v));">
        <input name="q" type="search" placeholder="Поиск по названию модели…" enterkeyhint="search">
        <button class="btn primary" type="submit">Найти</button>
      </form>
    </div>
    <div class="hero-doors" aria-hidden="true"><span></span><span></span><span></span></div>
  </section>`;

  const doorCats = CATEGORIES.filter(c => /^door_/.test(c.icon));
  const partCats = CATEGORIES.filter(c => !/^door_/.test(c.icon));
  const block = (title, list, big) => {
    if (!list.length) return '';
    let h = `<h2 class="section-title">${title}</h2><div class="cat-grid ${big ? 'cat-grid-big' : ''}">`;
    for (const cat of list) {
      h += `<a class="cat-card" href="#/category/${cat.id}">
        ${iconSvg(cat.icon, 'cat-icon')}
        <h3>${esc(cat.name)}</h3>
        <p data-count-for="${cat.id}"></p>
      </a>`;
    }
    return h + `</div>`;
  };
  html += block('Двери', doorCats, true);
  html += block('Комплектующие и фурнитура', partCats, false);
  app.innerHTML = html;

  Promise.all(CATEGORIES.map(c => loadProducts(c.id))).then(() => {
    document.querySelectorAll('[data-count-for]').forEach(el => {
      const n = (PRODUCTS_CACHE[el.getAttribute('data-count-for')] || []).length;
      el.textContent = `${n} ${pluralItems(n)}`;
    });
  });
}

/* ---- category: product grid ---- */
async function viewCategory(catId) {
  const cat = CATEGORIES.find(c => c.id === catId) || (await ensureCategories(), CATEGORIES.find(c => c.id === catId));
  const products = await loadProducts(catId);
  const app = document.getElementById('app');

  let html = `<button class="btn small" onclick="navigate('#/')" style="margin-bottom:16px;">${backIcon()} Все разделы</button>`;
  html += `<h1 class="page-title">${cat ? esc(cat.name) : 'Раздел'}</h1><p class="page-sub">${products.length} ${pluralItems(products.length)}</p>`;
  html += renderProductGrid(products);
  app.innerHTML = html;
}

async function ensureCategories() { if (CATEGORIES.length === 0) await loadCategories(); }

/* ---- search ---- */
async function viewSearch(q) {
  const app = document.getElementById('app');
  if (!q.trim()) { await viewHome(); return; }
  const products = indexProducts(await Api.get('/products?q=' + encodeURIComponent(q)));
  let html = `<h1 class="page-title">Поиск: «${esc(q)}»</h1><p class="page-sub">${products.length} ${pluralItems(products.length)}</p>`;
  html += renderProductGrid(products);
  app.innerHTML = html;
}

function unitSuffix(p) { return p.unit && p.unit !== 'шт' ? ` / ${esc(p.unit)}` : ''; }
function optionsSummary(p) {
  const o = parseOptions(p);
  if (!o) return '';
  return Object.entries(o).map(([k, v]) => `${esc(k)}: ${v.length}`).join(' · ');
}

function renderProductGrid(products) {
  if (products.length === 0) return `<div class="empty-state">${boxIcon()}<div>Товары не найдены</div></div>`;
  let html = `<div class="prod-grid">`;
  for (const p of products) {
    html += `<div class="prod-card">
      <div class="prod-clickable" onclick="openProductDetail(${p.id})">
        <div class="prod-photo">${p.photo ? `<img src="${p.photo}" alt="" loading="lazy">` : photoPlaceholder()}</div>
        <div class="prod-body">
          <h4 class="prod-name">${esc(p.name)}</h4>
          ${parseOptions(p) ? `<div class="prod-opts">${optionsSummary(p)}</div>` : ''}
          <div class="prod-price">${p.price ? 'от ' : ''}${fmtPrice(p.price)}<small>сом${unitSuffix(p)}</small></div>
        </div>
      </div>
      <div class="prod-add" data-add-for="${p.id}">${productAddHtml(p)}</div>
    </div>`;
  }
  html += `</div>`;
  return html;
}

/* Button area on a product card. Products with options always go through the
   detail sheet (нужно выбрать цвет/размер); simple ones get a stepper. */
function productAddHtml(p) {
  if (parseOptions(p)) {
    const n = Cart.qtyOfProduct(p.id);
    return `<button class="add-cart-btn ${n ? 'in-cart' : ''}" onclick="openProductDetail(${p.id})">${n ? `В заявке: ${n}` : `${cartIcon()} Выбрать`}</button>`;
  }
  const key = cartKey(p.id, {});
  const it = Cart.find(key);
  if (it) return qtyStepperHtml(key, it.qty) + `<div class="add-cart-btn in-cart" style="flex:1;text-align:center;">В заявке</div>`;
  return `<button class="add-cart-btn" onclick="quickAdd(${p.id})">${cartIcon()} В заявку</button>`;
}
function quickAdd(productId) {
  const p = PRODUCT_INDEX[productId];
  if (!p) return;
  Cart.add(p, {}, 1);
  refreshProductCardAdd(productId);
  updateCartBadge();
  showToast(`«${p.name}» добавлен в заявку`);
}

/* ---- product detail sheet: options, qty, kit ---- */
let DETAIL = null; // { product, opts, qty, kit: [{rule, productId, opts, qty, on}] }

function defaultOpts(p, preset) {
  const o = parseOptions(p) || {};
  const res = {};
  for (const [k, vals] of Object.entries(o)) {
    res[k] = preset && vals.includes(preset[k]) ? preset[k] : vals[0];
  }
  return res;
}

async function openProductDetail(productId) {
  const p = PRODUCT_INDEX[productId];
  if (!p) return;
  await ensureCategories();
  const cat = CATEGORIES.find(c => c.id === p.category_id);
  DETAIL = { product: p, opts: defaultOpts(p), qty: 1, kit: [] };

  const rules = cat ? (KIT_RULES[cat.slug] || []) : [];
  for (const rule of rules) {
    const kc = categoryBySlug(rule.cat);
    if (!kc) continue;
    const list = await loadProducts(kc.id);
    if (!list.length) continue;
    const pick = (rule.pick && list.find(x => x.name.includes(rule.pick))) || list[0];
    DETAIL.kit.push({ rule, catId: kc.id, productId: pick.id, opts: defaultOpts(pick, DETAIL.opts), qty: rule.qty, on: rule.on });
  }
  renderProductDetail();
}

function renderProductDetail() {
  const { product: p, opts, qty, kit } = DETAIL;
  const o = parseOptions(p);
  let optHtml = '';
  if (o) {
    for (const [k, vals] of Object.entries(o)) {
      optHtml += `<div class="opt-group"><div class="opt-label">${esc(k)}</div><div class="chips">`;
      vals.forEach((v, i) => {
        optHtml += `<button type="button" class="chip ${opts[k] === v ? 'active' : ''}" onclick="setDetailOpt(${JSON.stringify(k).replace(/"/g, '&quot;')}, ${i})">${esc(v)}</button>`;
      });
      optHtml += `</div></div>`;
    }
  }

  let kitHtml = '';
  if (kit.length) {
    kitHtml = `<div class="kit"><div class="kit-head">Собрать комплект<span>цвет комплектующих подставится как у двери</span></div>`;
    kit.forEach((line, i) => {
      const list = PRODUCTS_CACHE[line.catId] || [];
      const lp = PRODUCT_INDEX[line.productId];
      const sel = list.map(x => `<option value="${x.id}" ${x.id === line.productId ? 'selected' : ''}>${esc(x.name)} — ${fmtPrice(x.price)} сом</option>`).join('');
      const lo = parseOptions(lp);
      const optSel = lo ? Object.entries(lo).map(([k, vals]) =>
        `<select class="kit-opt" onchange="setKitOpt(${i}, ${JSON.stringify(k).replace(/"/g, '&quot;')}, this.value)">${vals.map(v => `<option ${line.opts[k] === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`).join('') : '';
      kitHtml += `<div class="kit-line ${line.on ? '' : 'off'}">
        <label class="kit-check"><input type="checkbox" ${line.on ? 'checked' : ''} onchange="toggleKit(${i}, this.checked)"> ${esc(line.rule.label)}</label>
        <div class="kit-controls">
          <select onchange="setKitProduct(${i}, Number(this.value))">${sel}</select>
          ${optSel}
          <div class="qty-stepper sm">
            <button onclick="setKitQty(${i}, ${line.qty - 1})">−</button>
            <input type="number" inputmode="numeric" pattern="[0-9]*" class="qty-input" value="${line.qty}" onchange="setKitQty(${i}, parseInt(this.value)||0)" onclick="this.select()">
            <button onclick="setKitQty(${i}, ${line.qty + 1})">+</button>
          </div>
        </div>
      </div>`;
    });
    kitHtml += `</div>`;
  }

  const total = detailTotal();
  renderModal(`
    <button class="modal-close" onclick="closeModal()">${closeIcon()}</button>
    <div class="product-detail">
      <div class="pd-photo">${p.photo ? `<img src="${p.photo}" alt="">` : photoPlaceholder()}</div>
      <div class="pd-info">
        <h3>${esc(p.name)}</h3>
        <div class="pd-price">${fmtPrice(p.price)}<small>сом${unitSuffix(p)}</small></div>
        <p class="pd-desc">${p.description ? esc(p.description) : 'Описание уточняется.'}</p>
        ${optHtml}
        <div class="opt-group"><div class="opt-label">Количество</div>
          <div class="qty-stepper">
            <button onclick="setDetailQty(${qty - 1})">−</button>
            <input type="number" inputmode="numeric" pattern="[0-9]*" class="qty-input" value="${qty}" onchange="setDetailQty(parseInt(this.value)||1)" onclick="this.select()">
            <button onclick="setDetailQty(${qty + 1})">+</button>
          </div>
        </div>
      </div>
    </div>
    ${kitHtml}
    <div class="pd-footer">
      <div><div class="pd-total-label">${kit.some(l => l.on) ? 'Итого с комплектующими' : 'Итого'}</div><div class="pd-total">${fmtPrice(total)} сом</div></div>
      <button class="btn primary" onclick="addDetailToCart()">${cartIcon()} Добавить в заявку</button>
    </div>
  `, 'modal-wide');
}
function detailTotal() {
  const { product: p, qty, kit } = DETAIL;
  let t = (p.price || 0) * qty;
  for (const l of kit) if (l.on) t += (PRODUCT_INDEX[l.productId].price || 0) * l.qty * qty;
  return t;
}
function setDetailOpt(key, idx) {
  const val = parseOptions(DETAIL.product)[key][idx];
  DETAIL.opts[key] = val;
  // подтягиваем тот же цвет в комплектующие, если он у них есть
  for (const l of DETAIL.kit) {
    const lo = parseOptions(PRODUCT_INDEX[l.productId]);
    if (lo && lo[key] && lo[key].includes(val)) l.opts[key] = val;
  }
  renderProductDetail();
}
function setDetailQty(n) { DETAIL.qty = Math.max(1, n); renderProductDetail(); }
function toggleKit(i, on) { DETAIL.kit[i].on = on; renderProductDetail(); }
function setKitProduct(i, productId) {
  const l = DETAIL.kit[i];
  l.productId = productId;
  l.opts = defaultOpts(PRODUCT_INDEX[productId], DETAIL.opts);
  renderProductDetail();
}
function setKitOpt(i, key, val) { DETAIL.kit[i].opts[key] = val; renderProductDetail(); }
function setKitQty(i, n) { const l = DETAIL.kit[i]; l.qty = Math.max(0, n); if (l.qty === 0) l.on = false; else if (!l.on) l.on = true; renderProductDetail(); }

function addDetailToCart() {
  const { product: p, opts, qty, kit } = DETAIL;
  Cart.add(p, parseOptions(p) ? { ...opts } : {}, qty);
  let extra = 0;
  for (const l of kit) {
    if (!l.on || l.qty <= 0) continue;
    const lp = PRODUCT_INDEX[l.productId];
    Cart.add(lp, parseOptions(lp) ? { ...l.opts } : {}, l.qty * qty);
    extra++;
  }
  closeModal();
  refreshProductCardAdd(p.id);
  updateCartBadge();
  showToast(extra ? `Дверь и ${extra} поз. комплектующих добавлены в заявку` : `«${p.name}» добавлен в заявку`);
}

function qtyStepperHtml(key, qty) {
  const k = esc(key).replace(/'/g, "\\'");
  return `<div class="qty-stepper">
      <button onclick="changeCartQty('${k}', ${qty - 1})">−</button>
      <input type="number" inputmode="numeric" pattern="[0-9]*" class="qty-input" value="${qty}"
        onchange="changeCartQty('${k}', parseInt(this.value)||0)" onclick="this.select()">
      <button onclick="changeCartQty('${k}', ${qty + 1})">+</button>
    </div>`;
}
function changeCartQty(key, qty) {
  const it = Cart.find(key);
  const pid = it ? it.product_id : null;
  Cart.setQty(key, qty);
  if (pid) refreshProductCardAdd(pid);
  updateCartBadge();
  if (currentRoute.name === 'cart') renderCartView();
}
function refreshProductCardAdd(productId) {
  const p = PRODUCT_INDEX[productId];
  if (!p) return;
  document.querySelectorAll('[data-add-for="' + productId + '"]').forEach(el => { el.innerHTML = productAddHtml(p); });
}

/* ---- cart / draft order ---- */
async function viewCart() {
  const app = document.getElementById('app');
  app.innerHTML = `<div id="cartViewRoot"></div>`;
  renderCartView();
}
function renderCartView() {
  const root = document.getElementById('cartViewRoot');
  if (!root) return;
  let html = `<h1 class="page-title">Текущая заявка</h1>`;
  if (Cart.items.length === 0) {
    html += `<div class="empty-state">${cartIcon()}<div>В заявке пока нет товаров.<br>Перейдите в каталог, чтобы добавить их.</div></div>`;
    html += `<button class="btn primary" onclick="navigate('#/')" style="margin-top:14px;">В каталог</button>`;
    root.innerHTML = html;
    return;
  }
  html += `<div class="cart-list">`;
  for (const it of Cart.items) {
    const k = esc(it.key).replace(/'/g, "\\'");
    const ol = optsLabel(it.opts);
    html += `<div class="cart-item">
      <div class="cart-item-photo">${it.photo ? `<img src="${it.photo}">` : photoPlaceholder()}</div>
      <div class="cart-item-body">
        <p class="cart-item-name">${esc(it.name)}</p>
        ${ol ? `<p class="cart-item-opts">${esc(ol)}</p>` : ''}
        <div class="cart-item-price">${fmtPrice(it.price)} × ${it.qty} ${esc(it.unit || 'шт')} = <b>${fmtPrice((it.price || 0) * it.qty)} сом</b></div>
      </div>
      ${qtyStepperHtml(it.key, it.qty)}
      <button class="icon-btn danger" onclick="changeCartQty('${k}', 0)">${trashIcon()}</button>
    </div>`;
  }
  html += `</div>`;
  html += `<div class="cart-summary"><span>Итого, ${Cart.count()} ${pluralItems(Cart.count())}</span><span class="total">${fmtPrice(Cart.total())} сом</span></div>`;
  html += `<button class="btn primary block" onclick="openSubmitOrderModal()">Оформить заявку</button>`;
  root.innerHTML = html;
}
function updateCartBadge() {
  const badge = document.querySelector('.bottom-nav .badge[data-nav="cart"], .main-nav .badge[data-nav="cart"]');
  const count = Cart.count();
  document.querySelectorAll('[data-cart-badge]').forEach(el => {
    el.setAttribute('data-count', count);
    el.style.display = count > 0 ? '' : 'none';
  });
}

/* ---- submit order modal: pick / create contractor ---- */
async function openSubmitOrderModal() {
  if (Cart.items.length === 0) return;
  const contractors = await Api.get('/contractors');
  const options = contractors.map(c => `<option value="${c.id}">${esc(c.name)}${c.phone ? ' — ' + esc(c.phone) : ''}</option>`).join('');
  renderModal(`
    <h3>Оформление заявки</h3>
    <div class="field">
      <label>Контрагент</label>
      <select id="orderContractorSelect">
        <option value="">— Выберите контрагента —</option>
        ${options}
      </select>
    </div>
    <button class="btn small" onclick="openContractorFormModal(null, true)" style="margin-bottom:15px;">${plusIcon()} Новый контрагент</button>
    <div class="field">
      <label>Комментарий (необязательно)</label>
      <textarea id="orderNote" placeholder="Например: доставка до склада, срочно и т.д."></textarea>
    </div>
    <div class="field" style="background:var(--gray-bg);border-radius:8px;padding:12px 14px;">
      <div style="font-size:13px;color:var(--text-mute);margin-bottom:4px;">${Cart.count()} ${pluralItems(Cart.count())}</div>
      <div style="font-size:18px;font-weight:800;color:var(--navy);">${fmtPrice(Cart.total())} сом</div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Отмена</button>
      <button class="btn primary" onclick="submitOrder()">Отправить заявку</button>
    </div>
  `);
}
async function submitOrder() {
  const contractorId = document.getElementById('orderContractorSelect').value;
  const note = document.getElementById('orderNote').value.trim();
  if (!contractorId) { showToast('Выберите контрагента', true); return; }

  const items = Cart.items.map(it => {
    const ol = optsLabel(it.opts);
    return { product_id: it.product_id, product_name: it.name + (ol ? ' (' + ol + ')' : ''), price: it.price, qty: it.qty };
  });
  try {
    const order = await Api.post('/orders', { contractor_id: Number(contractorId), note: note || null, items });
    Cart.clear(true);
    closeModal();
    updateCartBadge();
    showToast('Заявка №' + order.id + ' оформлена');
    navigate('#/orders/' + order.id);
  } catch (e) {
    showToast('Не удалось оформить заявку', true);
  }
}

/* ---- contractors ---- */
async function viewContractors(searchQuery) {
  const app = document.getElementById('app');
  const q = searchQuery !== undefined ? searchQuery : '';
  app.innerHTML = `
    <h1 class="page-title">Контрагенты</h1>
    <p class="page-sub">Клиенты и партнёры, на которых оформляются заявки</p>
    <div class="page-toolbar">
      <input type="text" class="search-input" id="contractorSearch" placeholder="Поиск по названию, телефону, e-mail..." value="${esc(q)}" oninput="onContractorSearch(this.value)">
      <button class="btn primary" onclick="openContractorFormModal(null)">${plusIcon()} Добавить</button>
    </div>
    <div id="contractorListRoot"></div>
  `;
  document.getElementById('contractorSearch').focus();
  await loadContractorList(q);
}
const onContractorSearch = debounce((val) => loadContractorList(val), 300);

async function loadContractorList(q) {
  const rows = await Api.get('/contractors' + (q ? '?q=' + encodeURIComponent(q) : ''));
  const root = document.getElementById('contractorListRoot');
  if (!root) return;
  if (rows.length === 0) {
    root.innerHTML = `<div class="empty-state">${usersIcon()}<div>Контрагенты не найдены</div></div>`;
    return;
  }
  let html = '';
  for (const c of rows) {
    html += `<div class="list-row">
      <div class="lr-main">
        <p class="lr-title">${esc(c.name)}</p>
        <p class="lr-sub">${[c.contact_person, c.phone, c.email].filter(Boolean).map(esc).join(' · ') || 'нет контактных данных'}</p>
      </div>
      <div class="lr-actions">
        <button class="icon-btn" onclick='openContractorFormModal(${c.id})' title="Изменить">${editIcon()}</button>
        <button class="icon-btn danger" onclick="confirmDeleteContractor(${c.id}, '${esc(c.name).replace(/'/g, "\\'")}')" title="Удалить">${trashIcon()}</button>
      </div>
    </div>`;
  }
  root.innerHTML = html;
}

function openContractorFormModal(id, thenSelectInOrderModal) {
  (async () => {
    const editing = id ? await Api.get('/contractors/' + id) : null;
    renderModal(`
      <h3>${editing ? 'Изменить контрагента' : 'Новый контрагент'}</h3>
      <div class="field"><label>Название организации *</label><input type="text" id="cName" value="${editing ? esc(editing.name) : ''}" placeholder="ООО «Компания»"></div>
      <div class="field"><label>Контактное лицо</label><input type="text" id="cContact" value="${editing ? esc(editing.contact_person || '') : ''}" placeholder="Имя Фамилия"></div>
      <div class="field"><label>Телефон</label><input type="tel" id="cPhone" value="${editing ? esc(editing.phone || '') : ''}" placeholder="+996 700 000 000"></div>
      <div class="field"><label>E-mail</label><input type="email" id="cEmail" value="${editing ? esc(editing.email || '') : ''}" placeholder="mail@example.com"></div>
      <div class="field"><label>Адрес</label><input type="text" id="cAddress" value="${editing ? esc(editing.address || '') : ''}" placeholder="Город, улица, дом"></div>
      <div class="field"><label>Заметка</label><textarea id="cNote" placeholder="Дополнительная информация">${editing ? esc(editing.note || '') : ''}</textarea></div>
      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">Отмена</button>
        <button class="btn primary" onclick="saveContractor(${id || 'null'}, ${!!thenSelectInOrderModal})">Сохранить</button>
      </div>
    `);
  })();
}

async function saveContractor(id, thenSelectInOrderModal) {
  const payload = {
    name: document.getElementById('cName').value.trim(),
    contact_person: document.getElementById('cContact').value.trim() || null,
    phone: document.getElementById('cPhone').value.trim() || null,
    email: document.getElementById('cEmail').value.trim() || null,
    address: document.getElementById('cAddress').value.trim() || null,
    note: document.getElementById('cNote').value.trim() || null,
  };
  if (!payload.name) { showToast('Укажите название организации', true); return; }

  try {
    let saved;
    if (id) saved = await Api.patch('/contractors/' + id, payload);
    else saved = await Api.post('/contractors', payload);

    if (thenSelectInOrderModal) {
      await openSubmitOrderModal();
      setTimeout(() => {
        const sel = document.getElementById('orderContractorSelect');
        if (sel) {
          const opt = document.createElement('option');
          opt.value = saved.id; opt.textContent = saved.name;
          sel.appendChild(opt);
          sel.value = saved.id;
        }
      }, 30);
    } else {
      closeModal();
      if (currentRoute.name === 'contractors') loadContractorList(document.getElementById('contractorSearch')?.value || '');
      showToast('Контрагент сохранён');
    }
  } catch (e) {
    showToast('Не удалось сохранить контрагента', true);
  }
}

function confirmDeleteContractor(id, name) {
  renderModal(`
    <h3>Удалить контрагента?</h3>
    <p style="color:var(--text-mute);font-size:14px;line-height:1.5;">«${esc(name)}» будет удалён безвозвратно.</p>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Отмена</button>
      <button class="btn danger" onclick="deleteContractor(${id})">Удалить</button>
    </div>
  `);
}
async function deleteContractor(id) {
  try {
    await Api.del('/contractors/' + id);
    closeModal();
    loadContractorList(document.getElementById('contractorSearch')?.value || '');
    showToast('Контрагент удалён');
  } catch (e) {
    if (e.data && e.data.error === 'has_orders') {
      showToast(e.data.message, true, 5000);
    } else {
      showToast('Не удалось удалить контрагента', true);
    }
    closeModal();
  }
}

/* ---- orders ---- */
async function viewOrders(query) {
  const app = document.getElementById('app');
  const status = query.status || '';
  app.innerHTML = `
    <h1 class="page-title">Заявки</h1>
    <p class="page-sub">Все оформленные заявки от контрагентов</p>
    <div class="page-toolbar">
      <select class="search-input" id="orderStatusFilter" style="flex:0 0 200px;" onchange="navigate('#/orders' + (this.value ? '?status='+this.value : ''))">
        <option value="">Все статусы</option>
        ${STATUS_ORDER.map(s => `<option value="${s}" ${s === status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
      </select>
    </div>
    <div id="orderListRoot"></div>
  `;
  const rows = await Api.get('/orders' + (status ? '?status=' + status : ''));
  const root = document.getElementById('orderListRoot');
  if (rows.length === 0) {
    root.innerHTML = `<div class="empty-state">${boxIcon()}<div>Заявок пока нет</div></div>`;
    return;
  }
  let html = '';
  for (const o of rows) {
    html += `<a class="list-row" href="#/orders/${o.id}" style="text-decoration:none;">
      <div class="lr-main">
        <p class="lr-title">Заявка №${o.id} — ${esc(o.contractor_name)}</p>
        <p class="lr-sub">${fmtDate(o.created_at)} · ${o.items.length} ${pluralItems(o.items.length)} · ${fmtPrice(o.total)} сом</p>
      </div>
      <span class="status-badge status-${o.status}">${STATUS_LABELS[o.status]}</span>
    </a>`;
  }
  root.innerHTML = html;
}

async function viewOrderDetail(id) {
  const app = document.getElementById('app');
  const o = await Api.get('/orders/' + id);
  let html = `<button class="btn small" onclick="navigate('#/orders')" style="margin-bottom:16px;">${backIcon()} Все заявки</button>`;
  html += `<h1 class="page-title">Заявка №${o.id}</h1>`;
  html += `<p class="page-sub">${fmtDate(o.created_at)} · оформил(а): ${esc(o.created_by_name || '—')}</p>`;

  html += `<div class="field"><label>Статус</label>
    <select id="orderStatusSelect" onchange="updateOrderStatus(${o.id}, this.value)">
      ${STATUS_ORDER.map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
    </select>
  </div>`;

  html += `<div class="field"><label>Контрагент</label>
    <div class="list-row" style="margin:0;">
      <div class="lr-main">
        <p class="lr-title">${esc(o.contractor_name)}</p>
        <p class="lr-sub">${esc(o.contractor_phone || 'телефон не указан')}</p>
      </div>
    </div>
  </div>`;

  if (o.note) html += `<div class="field"><label>Комментарий</label><p style="font-size:14px;color:var(--text);">${esc(o.note)}</p></div>`;

  html += `<div class="field"><label>Состав заявки</label><div class="cart-list">`;
  for (const it of o.items) {
    html += `<div class="cart-item">
      <div class="cart-item-body">
        <p class="cart-item-name">${esc(it.product_name)}</p>
        <div class="cart-item-price">${fmtPrice(it.price)} сом × ${it.qty} = <b>${fmtPrice((it.price || 0) * it.qty)} сом</b></div>
      </div>
    </div>`;
  }
  html += `</div></div>`;
  html += `<div class="cart-summary"><span>Итого</span><span class="total">${fmtPrice(o.total)} сом</span></div>`;

  if (Auth.isAdmin()) {
    html += `<button class="btn danger" onclick="confirmDeleteOrder(${o.id})" style="margin-top:20px;">${trashIcon()} Удалить заявку</button>`;
  }

  app.innerHTML = html;
}
async function updateOrderStatus(id, status) {
  try {
    await Api.patch('/orders/' + id, { status });
    showToast('Статус обновлён');
  } catch (e) {
    showToast('Не удалось обновить статус', true);
  }
}
function confirmDeleteOrder(id) {
  renderModal(`
    <h3>Удалить заявку №${id}?</h3>
    <p style="color:var(--text-mute);font-size:14px;">Это действие необратимо.</p>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Отмена</button>
      <button class="btn danger" onclick="deleteOrder(${id})">Удалить</button>
    </div>
  `);
}
async function deleteOrder(id) {
  await Api.del('/orders/' + id);
  closeModal();
  navigate('#/orders');
  showToast('Заявка удалена');
}

/* ---- admin ---- */
async function viewAdmin(tab) {
  const app = document.getElementById('app');
  let html = `<h1 class="page-title">Администрирование</h1>`;
  html += `<div class="page-toolbar">
    <button class="btn ${tab === 'catalog' ? 'primary' : ''}" onclick="navigate('#/admin/catalog')">Каталог</button>
    <button class="btn ${tab === 'users' ? 'primary' : ''}" onclick="navigate('#/admin/users')">Пользователи</button>
  </div>
  <div id="adminTabRoot"></div>`;
  app.innerHTML = html;

  if (tab === 'users') await renderAdminUsers();
  else await renderAdminCatalog();
}

/* -- admin: catalog -- */
async function renderAdminCatalog() {
  await ensureCategories();
  const root = document.getElementById('adminTabRoot');
  let html = `<div class="admin-toolbar">
    <button class="btn primary" onclick="openCategoryFormModal(null)">${plusIcon()} Новый раздел</button>
  </div>`;
  for (const cat of CATEGORIES) {
    const products = await loadProducts(cat.id);
    html += `<div style="margin-bottom:28px;">
      <div class="list-row" style="background:var(--gray-bg);border:none;">
        <div class="lr-main">
          <p class="lr-title">${iconSvg(cat.icon, 'cat-icon').replace('cat-icon','cat-icon-sm')} ${esc(cat.name)}</p>
          <p class="lr-sub">${products.length} ${pluralItems(products.length)}</p>
        </div>
        <div class="lr-actions">
          <button class="btn small" onclick="openProductFormModal(null, ${cat.id})">${plusIcon()} Товар</button>
          <button class="icon-btn" onclick="openCategoryFormModal(${cat.id})">${editIcon()}</button>
          <button class="icon-btn danger" onclick="confirmDeleteCategory(${cat.id}, '${esc(cat.name).replace(/'/g, "\\'")}')">${trashIcon()}</button>
        </div>
      </div>`;
    for (const p of products) {
      html += `<div class="list-row" style="margin-left:16px;">
        <div class="cart-item-photo" style="margin-right:12px;">${p.photo ? `<img src="${p.photo}">` : photoPlaceholder()}</div>
        <div class="lr-main">
          <p class="lr-title" style="font-size:13.5px;">${esc(p.name)}</p>
          <p class="lr-sub">${fmtPrice(p.price)} сом${unitSuffix(p)}${parseOptions(p) ? ' · ' + optionsSummary(p) : ''}</p>
        </div>
        <div class="lr-actions">
          <button class="icon-btn" onclick="openProductFormModal(${p.id}, ${cat.id})">${editIcon()}</button>
          <button class="icon-btn danger" onclick="confirmDeleteProduct(${p.id}, ${cat.id})">${trashIcon()}</button>
        </div>
      </div>`;
    }
    html += `</div>`;
  }
  root.innerHTML = html;
}

function openCategoryFormModal(id) {
  const editing = id ? CATEGORIES.find(c => c.id === id) : null;
  const iconGrid = ICON_CHOICES.map(key =>
    `<button type="button" class="icon-choice ${editing && editing.icon === key ? 'selected' : ''}" data-icon="${key}" onclick="selectIconChoice('${key}')">${iconSvg(key)}</button>`
  ).join('');
  renderModal(`
    <h3>${editing ? 'Изменить раздел' : 'Новый раздел'}</h3>
    <div class="field"><label>Название</label><input type="text" id="catName" value="${editing ? esc(editing.name) : ''}" placeholder="Например: Клеи для плитки"></div>
    <div class="field"><label>Иконка</label><div class="icon-grid" id="iconGrid">${iconGrid}</div></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Отмена</button>
      <button class="btn primary" onclick="saveCategory(${id || 'null'})">Сохранить</button>
    </div>
  `);
  window.__pendingIcon = editing ? editing.icon : ICON_CHOICES[0];
}
function selectIconChoice(key) {
  window.__pendingIcon = key;
  document.querySelectorAll('#iconGrid .icon-choice').forEach(el => {
    el.classList.toggle('selected', el.getAttribute('data-icon') === key);
  });
}
async function saveCategory(id) {
  const name = document.getElementById('catName').value.trim();
  if (!name) { showToast('Укажите название раздела', true); return; }
  const icon = window.__pendingIcon || ICON_CHOICES[0];
  try {
    if (id) await Api.patch('/categories/' + id, { name, icon });
    else await Api.post('/categories', { name, icon });
    closeModal();
    await loadCategories();
    await renderAdminCatalog();
    showToast('Раздел сохранён');
  } catch (e) {
    showToast('Не удалось сохранить раздел', true);
  }
}
function confirmDeleteCategory(id, name) {
  renderModal(`
    <h3>Удалить раздел?</h3>
    <p style="color:var(--text-mute);font-size:14px;line-height:1.5;">«${esc(name)}» и все товары в нём будут удалены безвозвратно.</p>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Отмена</button>
      <button class="btn danger" onclick="deleteCategory(${id})">Удалить</button>
    </div>
  `);
}
async function deleteCategory(id) {
  await Api.del('/categories/' + id);
  closeModal();
  invalidateProductCache();
  await loadCategories();
  await renderAdminCatalog();
  showToast('Раздел удалён');
}

function openProductFormModal(id, categoryId) {
  (async () => {
    let editing = null;
    if (id) {
      const products = await loadProducts(categoryId);
      editing = products.find(p => p.id === id);
    }
    const catOptions = CATEGORIES.map(c => `<option value="${c.id}" ${(editing ? editing.category_id : categoryId) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    renderModal(`
      <h3>${editing ? 'Изменить товар' : 'Новый товар'}</h3>
      <div class="field"><label>Фото</label>
        <div class="photo-upload">
          <div class="photo-preview" id="photoPreview">${editing && editing.photo ? `<img src="${editing.photo}">` : photoPlaceholder()}</div>
          <input type="file" accept="image/*" id="photoInput">
        </div>
      </div>
      <div class="field"><label>Раздел</label><select id="fCategory">${catOptions}</select></div>
      <div class="field"><label>Наименование</label><input type="text" id="fName" value="${editing ? esc(editing.name) : ''}" placeholder="Название товара"></div>
      <div class="field-row">
        <div class="field"><label>Цена, сом</label><input type="number" inputmode="numeric" id="fPrice" value="${editing ? (editing.price ?? '') : ''}" placeholder="0"></div>
        <div class="field"><label>Ед. изм.</label><input type="text" id="fUnit" list="unitList" value="${editing ? esc(editing.unit || 'шт') : 'шт'}"><datalist id="unitList"><option>шт</option><option>компл.</option><option>пог. м</option><option>упак.</option></datalist></div>
      </div>
      <div class="field"><label>Варианты (каждая строка: Название: значение, значение…)</label>
        <textarea id="fOptions" rows="3" placeholder="Цвет: Белый, Капучино, Дуб нордик&#10;Размер: 600×2000, 700×2000, 800×2000">${editing ? esc(optionsToText(editing)) : ''}</textarea>
      </div>
      <div class="field"><label>Описание</label><textarea id="fDescription" placeholder="Короткое описание для карточки товара">${editing && editing.description ? esc(editing.description) : ''}</textarea></div>
      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">Отмена</button>
        <button class="btn primary" onclick="saveProduct(${editing ? editing.id : 'null'}, ${editing ? editing.category_id : categoryId})">Сохранить</button>
      </div>
    `);
    document.getElementById('photoInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => { document.getElementById('photoPreview').innerHTML = `<img src="${ev.target.result}">`; };
      reader.readAsDataURL(file);
    });
  })();
}
async function saveProduct(id, oldCategoryId) {
  const name = document.getElementById('fName').value.trim();
  const price = document.getElementById('fPrice').value;
  const categoryId = document.getElementById('fCategory').value;
  const description = document.getElementById('fDescription').value.trim();
  const photoFile = document.getElementById('photoInput').files[0];
  if (!name) { showToast('Укажите наименование товара', true); return; }

  const form = new FormData();
  form.append('name', name);
  form.append('price', price);
  form.append('category_id', categoryId);
  form.append('description', description);
  form.append('unit', document.getElementById('fUnit').value.trim() || 'шт');
  form.append('options', JSON.stringify(textToOptions(document.getElementById('fOptions').value)));
  if (photoFile) form.append('photo', photoFile);

  try {
    if (id) await Api.patch('/products/' + id, form, true);
    else await Api.post('/products', form, true);
    closeModal();
    invalidateProductCache();
    await renderAdminCatalog();
    showToast('Товар сохранён');
  } catch (e) {
    showToast('Не удалось сохранить товар', true);
  }
}
function optionsToText(p) {
  const o = parseOptions(p);
  return o ? Object.entries(o).map(([k, v]) => `${k}: ${v.join(', ')}`).join('\n') : '';
}
function textToOptions(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const vals = line.slice(i + 1).split(',').map(x => x.trim()).filter(Boolean);
    if (vals.length) out[line.slice(0, i).trim()] = vals;
  }
  return out;
}
function confirmDeleteProduct(id, categoryId) {
  renderModal(`
    <h3>Удалить товар?</h3>
    <p style="color:var(--text-mute);font-size:14px;">Товар будет удалён безвозвратно.</p>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Отмена</button>
      <button class="btn danger" onclick="deleteProduct(${id})">Удалить</button>
    </div>
  `);
}
async function deleteProduct(id) {
  await Api.del('/products/' + id);
  closeModal();
  invalidateProductCache();
  await renderAdminCatalog();
  showToast('Товар удалён');
}

/* -- admin: users -- */
async function renderAdminUsers() {
  const root = document.getElementById('adminTabRoot');
  const users = await Api.get('/auth/users');
  let html = `<div class="admin-toolbar"><button class="btn primary" onclick="openUserFormModal(null)">${plusIcon()} Новый пользователь</button></div>`;
  for (const u of users) {
    html += `<div class="list-row">
      <div class="lr-main">
        <p class="lr-title">${esc(u.name)} ${!u.active ? '<span style="color:var(--red);font-weight:600;">(отключён)</span>' : ''}</p>
        <p class="lr-sub">${esc(u.login)} · ${u.role === 'admin' ? 'Администратор' : 'Менеджер'}</p>
      </div>
      <div class="lr-actions">
        <button class="icon-btn" onclick="openUserFormModal(${u.id})">${editIcon()}</button>
        ${u.id !== Auth.user.id ? `<button class="icon-btn danger" onclick="confirmDeleteUser(${u.id}, '${esc(u.name).replace(/'/g, "\\'")}')">${trashIcon()}</button>` : ''}
      </div>
    </div>`;
  }
  root.innerHTML = html;
}
function openUserFormModal(id) {
  (async () => {
    const editing = id ? (await Api.get('/auth/users')).find(u => u.id === id) : null;
    renderModal(`
      <h3>${editing ? 'Изменить пользователя' : 'Новый пользователь'}</h3>
      <div class="field"><label>Имя</label><input type="text" id="uName" value="${editing ? esc(editing.name) : ''}" placeholder="Имя Фамилия"></div>
      <div class="field"><label>Логин</label><input type="text" id="uLogin" value="${editing ? esc(editing.login) : ''}" ${editing ? 'disabled' : ''} placeholder="login"></div>
      <div class="field"><label>${editing ? 'Новый пароль (необязательно)' : 'Пароль'}</label><input type="text" id="uPassword" placeholder="${editing ? 'Оставьте пустым, чтобы не менять' : 'Пароль'}"></div>
      <div class="field"><label>Роль</label>
        <select id="uRole">
          <option value="manager" ${editing && editing.role === 'manager' ? 'selected' : ''}>Менеджер</option>
          <option value="admin" ${editing && editing.role === 'admin' ? 'selected' : ''}>Администратор</option>
        </select>
      </div>
      ${editing ? `<div class="field"><label><input type="checkbox" id="uActive" ${editing.active ? 'checked' : ''} style="width:auto;margin-right:8px;">Активен</label></div>` : ''}
      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">Отмена</button>
        <button class="btn primary" onclick="saveUser(${id || 'null'})">Сохранить</button>
      </div>
    `);
  })();
}
async function saveUser(id) {
  const name = document.getElementById('uName').value.trim();
  const login = document.getElementById('uLogin').value.trim();
  const password = document.getElementById('uPassword').value;
  const role = document.getElementById('uRole').value;
  if (!name || !login) { showToast('Заполните имя и логин', true); return; }

  try {
    if (id) {
      const payload = { name, role };
      const activeEl = document.getElementById('uActive');
      if (activeEl) payload.active = activeEl.checked ? 1 : 0;
      if (password) payload.password = password;
      await Api.patch('/auth/users/' + id, payload);
    } else {
      if (!password) { showToast('Укажите пароль', true); return; }
      await Api.post('/auth/users', { name, login, password, role });
    }
    closeModal();
    await renderAdminUsers();
    showToast('Пользователь сохранён');
  } catch (e) {
    if (e.data && e.data.error === 'login_taken') showToast('Такой логин уже занят', true);
    else showToast('Не удалось сохранить пользователя', true);
  }
}
function confirmDeleteUser(id, name) {
  renderModal(`
    <h3>Удалить пользователя?</h3>
    <p style="color:var(--text-mute);font-size:14px;">«${esc(name)}» больше не сможет войти в систему.</p>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Отмена</button>
      <button class="btn danger" onclick="deleteUser(${id})">Удалить</button>
    </div>
  `);
}
async function deleteUser(id) {
  await Api.del('/auth/users/' + id);
  closeModal();
  await renderAdminUsers();
  showToast('Пользователь удалён');
}

/* ============================================================
   NAV / SHELL / MODAL / TOAST
   ============================================================ */

function renderNav() {
  const cartCount = Cart.count();
  const items = [
    { key: 'home', label: 'Каталог', hash: '#/', icon: homeIcon, match: r => r.name === 'home' || r.name === 'category' || r.name === 'search' },
    { key: 'cart', label: 'Заявка', hash: '#/cart', icon: cartIcon, match: r => r.name === 'cart', badge: cartCount },
    { key: 'contractors', label: 'Контрагенты', hash: '#/contractors', icon: usersIcon, match: r => r.name === 'contractors' },
    { key: 'orders', label: 'Заявки', hash: '#/orders', icon: listIcon, match: r => r.name === 'orders' || r.name === 'order-detail' },
  ];
  if (Auth.isAdmin()) items.push({ key: 'admin', label: 'Админ', hash: '#/admin', icon: adminIcon, match: r => r.name === 'admin' });

  const navHtml = items.map(it => {
    const active = it.match(currentRoute);
    const badge = it.badge > 0 ? ` <span class="badge" data-cart-badge data-count="${it.badge}"></span>` : '';
    return `<button class="${active ? 'active' : ''}" onclick="navigate('${it.hash}')">${it.icon()}${badge}<span>${it.label}</span></button>`;
  }).join('');

  document.getElementById('mainNav').innerHTML = items.map(it => {
    const active = it.match(currentRoute);
    return `<button class="${active ? 'active' : ''}" onclick="navigate('${it.hash}')">${it.label}${it.badge > 0 ? ' · ' + it.badge : ''}</button>`;
  }).join('');

  document.getElementById('bottomNav').innerHTML = `<div class="bottom-nav-inner">${navHtml}</div>`;
  updateCartBadge();
}

function toggleUserMenu() {
  const menu = document.getElementById('userMenu');
  if (!menu.hidden) { menu.hidden = true; return; }
  menu.innerHTML = `
    <div class="um-header">
      <div class="um-name">${esc(Auth.user.name)}</div>
      <div class="um-role">${Auth.user.role === 'admin' ? 'Администратор' : 'Менеджер'}</div>
    </div>
    <button onclick="openChangePasswordModal()">Сменить пароль</button>
    <button class="danger" onclick="Auth.logout()">Выйти</button>
  `;
  menu.hidden = false;
}
document.addEventListener('click', (e) => {
  const menu = document.getElementById('userMenu');
  if (!menu || menu.hidden) return;
  if (!menu.contains(e.target) && !e.target.closest('.icon-btn-lg')) menu.hidden = true;
});

function openChangePasswordModal() {
  document.getElementById('userMenu').hidden = true;
  renderModal(`
    <h3>Смена пароля</h3>
    <div class="field"><label>Текущий пароль</label><input type="password" id="curPass"></div>
    <div class="field"><label>Новый пароль</label><input type="password" id="newPass"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Отмена</button>
      <button class="btn primary" onclick="doChangePassword()">Сохранить</button>
    </div>
  `);
}
async function doChangePassword() {
  const currentPassword = document.getElementById('curPass').value;
  const newPassword = document.getElementById('newPass').value;
  try {
    await Api.post('/auth/change-password', { currentPassword, newPassword });
    closeModal();
    showToast('Пароль изменён');
  } catch (e) {
    showToast('Не удалось сменить пароль — проверьте текущий пароль', true);
  }
}

function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }
function renderModal(inner, extraClass) {
  document.getElementById('modalRoot').innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
      <div class="modal ${extraClass || ''}">${inner}</div>
    </div>`;
}
function showToast(msg, isErr, duration) {
  const root = document.getElementById('toastRoot');
  root.innerHTML = `<div class="toast ${isErr ? 'err' : ''}">${isErr ? warnIcon() : checkIcon()}${esc(msg)}</div>`;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => { root.innerHTML = ''; }, duration || 3000);
}

/* ---- icons ---- */
function photoPlaceholder() { return `<svg viewBox="0 0 64 64"><rect x="6" y="14" width="52" height="38" rx="3"/><circle cx="22" cy="28" r="5"/><path d="M6 44 L22 32 L34 40 L44 30 L58 42"/></svg>`; }
function editIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`; }
function trashIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/></svg>`; }
function plusIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`; }
function backIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18 L9 12 L15 6"/></svg>`; }
function cartIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.5 3h2l2.7 12.4a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L21.5 7H6"/></svg>`; }
function homeIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>`; }
function usersIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 3-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="18" cy="9" r="2.6"/><path d="M15.5 14.3c2.6.4 4.8 2.3 5 5.7"/></svg>`; }
function listIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/></svg>`; }
function adminIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5l-8-3Z"/></svg>`; }
function boxIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>`; }
function notFoundIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>`; }
function checkIcon() { return `<svg viewBox="0 0 24 24"><path d="M20 6 L9 17 L4 12"/></svg>`; }
function closeIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round"><path d="M18 6 L6 18"/><path d="M6 6 L18 18"/></svg>`; }
function warnIcon() { return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8 L12 13"/><circle cx="12" cy="16" r="0.6" fill="#fff"/></svg>`; }

/* ============================================================
   SCREEN SWITCHING & BOOT
   ============================================================ */

function showAuthScreen() {
  document.getElementById('authScreen').hidden = false;
  document.getElementById('appRoot').hidden = true;
  setTimeout(() => document.getElementById('loginInput')?.focus(), 30);
}
function showAppScreen() {
  document.getElementById('authScreen').hidden = true;
  document.getElementById('appRoot').hidden = false;
  document.getElementById('userChip').textContent = Auth.user ? Auth.user.name : '';
}

async function doLogin() {
  const login = document.getElementById('loginInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  const errEl = document.getElementById('authError');
  errEl.hidden = true;
  if (!login || !password) { errEl.textContent = 'Введите логин и пароль'; errEl.hidden = false; return; }
  try {
    await Auth.login(login, password);
    Cart.load();
    router();
  } catch (e) {
    errEl.textContent = 'Неверный логин или пароль';
    errEl.hidden = false;
  }
}

async function boot() {
  Cart.load();
  const ok = await Auth.init();
  if (ok) {
    await loadCategories();
    router();
  } else {
    showAuthScreen();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

boot();
