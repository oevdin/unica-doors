/* UNICA — продажа: подбор товара, варианты, комплект к двери, оформление и оплата */
'use strict';

/* ---------- чек (корзина) ---------- */
const Cart = {
  lines: [],
  load() { try { this.lines = JSON.parse(localStorage.getItem('unica_cart') || '[]'); } catch (e) { this.lines = []; } },
  save() { try { localStorage.setItem('unica_cart', JSON.stringify(this.lines)); } catch (e) {} updateCartCount(); },
  key: (pid, variant) => pid + '|' + (variant || ''),
  add(p, variant, qty = 1) {
    const k = this.key(p.id, variant);
    const ex = this.lines.find(l => l.key === k);
    if (ex) ex.qty += qty;
    else this.lines.push({ key: k, product_id: p.id, name: p.name, variant: variant || '', unit: p.unit, price: p.price, qty, photo: p.photo });
    this.save();
  },
  set(key, qty) {
    const l = this.lines.find(x => x.key === key); if (!l) return;
    if (qty <= 0) this.lines = this.lines.filter(x => x.key !== key); else l.qty = qty;
    this.save();
  },
  qtyOf(pid) { return this.lines.filter(l => l.product_id === pid).reduce((s, l) => s + l.qty, 0); },
  total() { return Math.round(this.lines.reduce((s, l) => s + l.price * l.qty, 0)); },
  units() { return this.lines.reduce((s, l) => s + l.qty, 0); },
  clear() { this.lines = []; this.save(); },
};

/* ---------- каталог для продажи ---------- */
let PRODUCTS = [];            // все активные товары
const PIDX = {};
async function loadProducts(force) {
  if (PRODUCTS.length && !force) return PRODUCTS;
  PRODUCTS = await Api.get('/products');
  PRODUCTS.forEach(p => { p._opts = parseOpts(p.options); PIDX[p.id] = p; });
  return PRODUCTS;
}
function parseOpts(s) { try { const o = s ? JSON.parse(s) : null; return o && Object.keys(o).length ? o : null; } catch (e) { return null; } }
const catOf = (p) => State.categories.find(c => c.id === p.category_id);

const POS = { cat: 0, q: '' };

route('sell', async () => {
  await loadProducts(true);
  $('#app').innerHTML = `<div class="pos">
    <section class="pos-pick">
      <div class="pos-bar">
        <label class="search">${icons.search}<input id="posQ" type="search" placeholder="Найти товар" value="${esc(POS.q)}" autocomplete="off" enterkeyhint="search"></label>
        <div class="chips scroll" id="posCats"></div>
      </div>
      <div id="posList" class="pos-list"></div>
    </section>
    <aside class="ticket" id="ticket"></aside>
  </div>`;
  $('#posQ').addEventListener('input', debounce((e) => { POS.q = e.target.value.trim(); renderPosList(); }, 150));
  renderPosCats(); renderPosList(); renderTicket();
});

function renderPosCats() {
  const cats = State.categories.filter(c => PRODUCTS.some(p => p.category_id === c.id));
  $('#posCats').innerHTML = `<button class="chip ${!POS.cat ? 'on' : ''}" onclick="setPosCat(0)">Все</button>` +
    cats.map(c => `<button class="chip ${POS.cat === c.id ? 'on' : ''}" onclick="setPosCat(${c.id})">${catIcon(c.icon)}${esc(c.name)}</button>`).join('');
}
function setPosCat(id) { POS.cat = id; renderPosCats(); renderPosList(); }

function renderPosList() {
  const q = POS.q.toLowerCase();
  let list = PRODUCTS.filter(p => (!POS.cat || p.category_id === POS.cat) && (!q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)));
  const root = $('#posList');
  if (!list.length) { root.innerHTML = emptyState(icons.search, 'Ничего не найдено', q ? 'Попробуйте другое слово или выберите раздел.' : 'В этом разделе пока нет товаров.'); return; }
  let html = '', lastCat = null;
  for (const p of list) {
    if (!POS.cat && !q && p.category_id !== lastCat) { lastCat = p.category_id; html += `<h3 class="pos-group">${esc(catOf(p)?.name || 'Без раздела')}</h3>`; }
    html += posRow(p);
  }
  root.innerHTML = html;
}
function stockBadge(p) {
  if (p.stock <= 0) return `<span class="stk none">нет</span>`;
  if (p.stock <= p.min_stock) return `<span class="stk low">${qtyFmt(p.stock)} ${esc(p.unit)}</span>`;
  return `<span class="stk">${qtyFmt(p.stock)} ${esc(p.unit)}</span>`;
}
function posRow(p) {
  const n = Cart.qtyOf(p.id);
  return `<div class="pos-row ${n ? 'in' : ''}" data-pid="${p.id}">
    <button class="pos-main" onclick="pickProduct(${p.id})">
      <span class="thumb">${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy">` : catIcon(catOf(p)?.icon)}</span>
      <span class="pos-txt"><b>${esc(p.name)}</b><span class="pos-meta"><span class="price">${money(p.price)} сом</span>${p.unit !== 'шт' ? `<span>за ${esc(p.unit)}</span>` : ''}${stockBadge(p)}</span></span>
    </button>
    ${n ? `<span class="in-cart">${qtyFmt(n)}</span>` : ''}
    <button class="add" onclick="pickProduct(${p.id})" aria-label="Добавить ${esc(p.name)}">${icons.plus}</button>
  </div>`;
}
function refreshRow(pid) { const el = document.querySelector(`.pos-row[data-pid="${pid}"]`); if (el && PIDX[pid]) el.outerHTML = posRow(PIDX[pid]); }

function pickProduct(pid) {
  const p = PIDX[pid];
  if (!p) return;
  const kit = kitFor(p);
  if (!p._opts && !kit.length) { Cart.add(p, '', 1); afterAdd([pid]); return; }
  openVariantSheet(p, kit);
}
function afterAdd(pids) {
  pids.forEach(refreshRow); renderTicket();
  if (navigator.vibrate) try { navigator.vibrate(10); } catch (e) {}
}

/* ---------- варианты и комплект ---------- */
// к межкомнатной двери предлагаем всё для установки
const KIT = [
  { icon: 'frame', label: 'Коробка', qty: 1, on: true },
  { icon: 'casing', label: 'Наличник на 2 стороны', qty: 2, on: true },
  { icon: 'extension', label: 'Добор', qty: 1, on: false },
  { icon: 'handle', match: 'Петл', label: 'Петли', qty: 1, on: true },
  { icon: 'handle', match: 'Ручк', label: 'Ручка', qty: 1, on: true },
  { icon: 'handle', match: 'Защ', label: 'Защёлка', qty: 1, on: true },
];
function kitFor(p) {
  const c = catOf(p);
  if (!c || !['door_interior', 'door_enamel'].includes(c.icon)) return [];
  const out = [];
  for (const r of KIT) {
    const cats = State.categories.filter(x => x.icon === r.icon).map(x => x.id);
    const cand = PRODUCTS.filter(x => cats.includes(x.category_id) && (!r.match || x.name.includes(r.match)));
    if (cand.length) out.push({ ...r, choices: cand.map(x => x.id), pid: cand[0].id });
  }
  return out;
}
let VS = null; // состояние окна выбора
function openVariantSheet(p, kit) {
  VS = { p, opts: {}, qty: 1, kit: kit.map(k => ({ ...k })) };
  if (p._opts) for (const [k, v] of Object.entries(p._opts)) VS.opts[k] = v[0];
  renderVariantSheet();
}
function kitVariant(pid) {
  const kp = PIDX[pid]; if (!kp || !kp._opts) return '';
  const color = VS.opts['Цвет'];
  return Object.entries(kp._opts).map(([k, vals]) => (k === 'Цвет' && color && vals.includes(color) ? color : vals[0])).join(', ');
}
function renderVariantSheet() {
  const { p, opts, qty, kit } = VS;
  let body = `<div class="vs-head"><span class="thumb lg">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : catIcon(catOf(p)?.icon)}</span>
    <div><b>${esc(p.name)}</b><span class="money-sm">${money(p.price)} сом${p.unit !== 'шт' ? ' за ' + esc(p.unit) : ''}</span>${stockBadge(p)}</div></div>`;
  if (p._opts) for (const [k, vals] of Object.entries(p._opts)) {
    body += `<div class="opt"><span class="opt-l">${esc(k)}</span><div class="chips wrap">${vals.map((v, i) =>
      `<button type="button" class="chip ${opts[k] === v ? 'on' : ''}" onclick="VS.opts['${jsq(k)}']=PIDX[${p.id}]._opts['${jsq(k)}'][${i}];renderVariantSheet()">${esc(v)}</button>`).join('')}</div></div>`;
  }
  body += `<div class="opt"><span class="opt-l">Количество</span>${stepper('VS.qty', qty, 'renderVariantSheet', 1)}</div>`;
  if (kit.length) {
    body += `<div class="kit"><div class="kit-h">Всё для установки<span>цвет подставится как у двери</span></div>`;
    kit.forEach((k, i) => {
      const kp = PIDX[k.pid];
      body += `<div class="kit-row ${k.on ? '' : 'off'}">
        <label class="check"><input type="checkbox" ${k.on ? 'checked' : ''} onchange="VS.kit[${i}].on=this.checked;renderVariantSheet()"><span>${esc(k.label)}</span></label>
        <select onchange="VS.kit[${i}].pid=Number(this.value);renderVariantSheet()" aria-label="${esc(k.label)}">${k.choices.map(id => `<option value="${id}" ${id === k.pid ? 'selected' : ''}>${esc(PIDX[id].name)}</option>`).join('')}</select>
        <span class="kit-q">${k.qty * qty} ${esc(kp.unit)}</span><b>${money(kp.price * k.qty * qty)}</b>
      </div>`;
    });
    body += `</div>`;
  }
  const total = p.price * qty + kit.filter(k => k.on).reduce((s, k) => s + PIDX[k.pid].price * k.qty * qty, 0);
  openSheet({ title: 'Добавить в чек', body, wide: kit.length > 0,
    footer: `<div class="sum-line"><span>${kit.some(k => k.on) ? 'С комплектом' : 'Сумма'}</span><b class="money">${money(total)} сом</b></div>
      <button class="btn primary big" onclick="confirmVariant()">${icons.plus}Добавить</button>` });
}
function confirmVariant() {
  const { p, opts, qty, kit } = VS;
  const variant = p._opts ? Object.values(opts).join(', ') : '';
  Cart.add(p, variant, qty);
  const ids = [p.id];
  for (const k of kit) if (k.on) { Cart.add(PIDX[k.pid], kitVariant(k.pid), k.qty * qty); ids.push(k.pid); }
  closeSheet();
  afterAdd(ids);
  toast(ids.length > 1 ? `Добавлено: дверь и ${ids.length - 1} ${plural(ids.length - 1, 'позиция', 'позиции', 'позиций')} к ней` : `Добавлено: ${p.name}`);
}

function stepper(path, value, rerender, min = 0) {
  return `<div class="stepper"><button type="button" onclick="${path}=Math.max(${min},${path}-1);${rerender}()" aria-label="Меньше">${icons.minus}</button>
    <input type="text" inputmode="decimal" value="${qtyFmt(value)}" onfocus="this.select()" onchange="${path}=Math.max(${min},Number(this.value.replace(',','.'))||${min});${rerender}()" aria-label="Количество">
    <button type="button" onclick="${path}=${path}+1;${rerender}()" aria-label="Больше">${icons.plus}</button></div>`;
}

/* ---------- панель чека ---------- */
function renderTicket() {
  const el = $('#ticket'); if (!el) return;
  updateCartCount();
  if (!Cart.lines.length) {
    el.className = 'ticket empty-t';
    el.innerHTML = `<div class="t-empty">${icons.receipt}<b>Чек пуст</b><p>Нажмите на товар — он появится здесь.</p></div>`;
    return;
  }
  el.className = 'ticket';
  el.innerHTML = `<div class="t-head"><b>Чек</b><button class="link" onclick="confirmClearCart()">Очистить</button></div>
    <div class="t-lines">${Cart.lines.map(l => `<div class="t-line"><span class="t-n">${esc(l.name)}${l.variant ? `<small>${esc(l.variant)}</small>` : ''}</span>
      <span class="t-q">${qtyFmt(l.qty)} × ${money(l.price)}</span><b>${money(l.price * l.qty)}</b></div>`).join('')}</div>
    <button class="t-go" onclick="openCheckout()"><span class="t-c">${Cart.lines.length}</span><span>Оформить<small>${qtyFmt(Cart.units())} ед.</small></span><b class="money">${money(Cart.total())}</b></button>`;
}
function confirmClearCart() {
  confirmSheet('Очистить чек?', 'Все позиции будут убраны из текущего чека.', 'Очистить', () => {
    const ids = Cart.lines.map(l => l.product_id); Cart.clear(); closeSheet(); ids.forEach(refreshRow); renderTicket();
  });
}

/* ---------- оформление ---------- */
const CO = { discount: '', discMode: 'som', pay: 'cash', split: {}, contact: null, name: '', phone: '', note: '' };
function coTotals() {
  const sub = Cart.total();
  const raw = Number(String(CO.discount).replace(',', '.')) || 0;
  let d = CO.discMode === 'pct' ? Math.round(sub * Math.min(100, raw) / 100) : Math.round(raw);
  d = Math.max(0, Math.min(sub, d));
  return { sub, discount: d, total: sub - d };
}
function coPayments(total) {
  const cash = State.accounts.find(a => a.kind === 'cash') || State.accounts[0];
  const bank = State.accounts.find(a => a.kind === 'bank') || State.accounts[0];
  if (CO.pay === 'cash') return [{ account_id: cash.id, amount: total }];
  if (CO.pay === 'bank') return [{ account_id: bank.id, amount: total }];
  if (CO.pay === 'debt') return [];
  return State.accounts.map(a => ({ account_id: a.id, amount: Number(CO.split[a.id]) || 0 })).filter(x => x.amount > 0);
}
function openCheckout() {
  if (!Cart.lines.length) return;
  renderCheckout();
}
function setPay(v) { CO.pay = v; renderCheckout(); }
function setDisc(v) { CO.discMode = v; renderCheckout(); }
function renderCheckout() {
  const t = coTotals();
  const lines = Cart.lines.map(l => `<div class="co-line">
      <div class="co-top"><span>${esc(l.name)}${l.variant ? `<small>${esc(l.variant)}</small>` : ''}</span>
        <button class="icon-btn sm" onclick="coSet('${jsq(l.key)}',0)" aria-label="Убрать">${icons.x}</button></div>
      <div class="co-ctl">
        <div class="stepper sm"><button type="button" onclick="coSet('${jsq(l.key)}',${l.qty - 1})">${icons.minus}</button>
          <input type="text" inputmode="decimal" value="${qtyFmt(l.qty)}" onfocus="this.select()" onchange="coSet('${jsq(l.key)}',Number(this.value.replace(',','.'))||0)" aria-label="Количество">
          <button type="button" onclick="coSet('${jsq(l.key)}',${l.qty + 1})">${icons.plus}</button></div>
        <label class="co-price"><input type="text" inputmode="numeric" value="${l.price}" onfocus="this.select()" onchange="coPrice('${jsq(l.key)}',this.value)" aria-label="Цена"><span>сом</span></label>
        <b class="money-sm">${money(l.price * l.qty)}</b>
      </div></div>`).join('');
  const payOpts = [['cash', 'Наличные'], ['bank', 'Перевод'], ['split', 'Частями'], ['debt', 'В долг']];
  const split = CO.pay === 'split' ? `<div class="split">${State.accounts.map(a => field(esc(a.name), `<input type="text" inputmode="numeric" value="${CO.split[a.id] || ''}" placeholder="0" oninput="CO.split[${a.id}]=this.value.replace(/\\D/g,'');updCo()">`)).join('')}
      <p class="hint" id="coRest"></p></div>` : '';
  const needClient = CO.pay === 'debt' || CO.pay === 'split';
  openSheet({
    title: 'Оформление продажи', wide: true,
    body: `<div class="co-lines">${lines}</div>
      <div class="co-grid">
        ${field('Скидка', `<div class="row-in"><input id="coDisc" type="text" inputmode="decimal" placeholder="0" value="${esc(CO.discount)}" oninput="CO.discount=this.value;updCo()">${segHtml('d', [['som', 'сом'], ['pct', '%']], CO.discMode, 'setDisc')}</div>`)}
        ${field('Оплата', segHtml('p', payOpts, CO.pay, 'setPay'))}
      </div>
      ${split}
      <div class="co-grid">
        ${field('Покупатель' + (needClient ? '' : ' (необязательно)'), `<input id="coName" type="text" value="${esc(CO.name)}" placeholder="Имя" oninput="CO.name=this.value;CO.contact=null;suggestClient()" autocomplete="off">`)}
        ${field('Телефон / WhatsApp', `<input id="coPhone" type="tel" inputmode="tel" value="${esc(CO.phone)}" placeholder="0700 123 456" oninput="CO.phone=this.value;CO.contact=null;suggestClient()" autocomplete="off">`)}
      </div>
      <div id="coSuggest" class="suggest"></div>
      ${needClient ? `<p class="note warn">${icons.alert}<span>Остаток суммы запишется в долг клиенту. Укажите имя или телефон — по ним найдём его в разделе «Клиенты».</span></p>` : ''}`,
    footer: `<div class="sum-line"><span id="coSumL"></span><b class="money" id="coSum"></b></div><button class="btn primary big" id="coBtn" onclick="submitSale()">Продать</button>`,
  });
  updCo();
}
function updCo() {
  const t = coTotals();
  $('#coSumL').textContent = t.discount ? `${money(t.sub)} − ${money(t.discount)}` : 'К оплате';
  $('#coSum').textContent = money(t.total) + ' сом';
  const rest = $('#coRest');
  if (rest) {
    const paid = coPayments(t.total).reduce((s, x) => s + x.amount, 0);
    rest.textContent = paid > t.total ? `Оплата больше суммы на ${money(paid - t.total)} сом` : paid < t.total ? `В долг останется ${money(t.total - paid)} сом` : 'Оплачено полностью';
    rest.className = 'hint ' + (paid > t.total ? 'bad' : paid < t.total ? 'warn' : 'good');
  }
}
function coSet(key, qty) {
  const l = Cart.lines.find(x => x.key === key); const pid = l && l.product_id;
  Cart.set(key, qty); if (pid) refreshRow(pid); renderTicket();
  if (Cart.lines.length) renderCheckout(); else closeSheet();
}
function coPrice(key, v) { const l = Cart.lines.find(x => x.key === key); if (!l) return; l.price = Math.max(0, Math.round(Number(String(v).replace(/\D/g, '')) || 0)); Cart.save(); renderTicket(); renderCheckout(); }

const suggestClient = debounce(async () => {
  const box = $('#coSuggest'); if (!box) return;
  const q = (CO.phone.replace(/\D/g, '').length >= 3 ? CO.phone.replace(/\D/g, '').slice(-6) : '') || (CO.name.length >= 2 ? CO.name : '');
  if (!q) { box.innerHTML = ''; return; }
  try {
    const rows = (await Api.get('/contacts?type=client&q=' + encodeURIComponent(q))).slice(0, 4);
    box.innerHTML = rows.map(c => `<button type="button" onclick='useClient(${JSON.stringify({ id: c.id, name: c.name, phone: c.phone || '' }).replace(/'/g, '&#39;')})'>${icons.users}<span><b>${esc(c.name)}</b><small>${esc(c.phone || '')}${c.debt > 0 ? ` · долг ${money(c.debt)} сом` : ''}</small></span></button>`).join('');
  } catch (e) { box.innerHTML = ''; }
}, 250);
function useClient(c) { CO.contact = c.id; CO.name = c.name; CO.phone = c.phone; $('#coName').value = c.name; $('#coPhone').value = c.phone; $('#coSuggest').innerHTML = `<p class="hint good">${icons.check} Клиент из базы: ${esc(c.name)}</p>`; }

async function submitSale() {
  const t = coTotals();
  const payments = coPayments(t.total);
  const paid = payments.reduce((s, x) => s + x.amount, 0);
  if (paid > t.total) { toast('Оплата больше суммы чека', 'err'); return; }
  if (paid < t.total && !CO.contact && !CO.name.trim() && !CO.phone.trim()) { toast('Для продажи в долг укажите имя или телефон', 'err'); $('#coName')?.focus(); return; }
  const btn = $('#coBtn'); btn.disabled = true; btn.textContent = 'Сохраняю…';
  try {
    const sale = await Api.post('/sales', {
      items: Cart.lines.map(l => ({ product_id: l.product_id, name: l.name, variant: l.variant, unit: l.unit, qty: l.qty, price: l.price })),
      discount: t.discount, payments, contact_id: CO.contact, customer_name: CO.name.trim(), customer_phone: CO.phone.trim(),
    });
    Cart.clear();
    Object.assign(CO, { discount: '', discMode: 'som', pay: 'cash', split: {}, contact: null, name: '', phone: '', note: '' });
    closeSheet();
    go('#/sales/' + sale.id + '?new=1');
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Продать';
    toast(errText(e, 'Не удалось сохранить продажу'), 'err', 4500);
  }
}
