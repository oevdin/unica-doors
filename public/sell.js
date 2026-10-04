/* ============================================================
   UNICA Doors — продажа на месте (рынок), накладная/чек, история.
   Работает поверх Cart / каталога из app.js.
   ============================================================ */

const PAY_LABELS = { cash: 'Наличные', transfer: 'Перевод', debt: 'В долг' };
let SETTINGS = null;
async function loadSettings() {
  try { SETTINGS = await Api.get('/settings'); } catch (e) { SETTINGS = SETTINGS || { company_name: 'UNICA Doors' }; }
  return SETTINGS;
}

/* local date helpers (YYYY-MM-DD in the shop's own day) */
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function fmtLocal(local, withDate = true) {
  if (!local) return '';
  const [d, t] = local.split(' ');
  const [y, m, dd] = d.split('-');
  return (withDate ? `${dd}.${m}.${y} ` : '') + (t || '').slice(0, 5);
}
function fmtDayShort(day) { const [, m, d] = day.split('-'); return `${d}.${m}`; }

/* ============================================================
   ЭКРАН ПРОДАЖИ (#/sell)
   ============================================================ */
let SELL = { cat: 'all', q: '' };

async function viewSell() {
  await ensureCategories();
  const app = document.getElementById('app');
  app.innerHTML = `<div class="pos">
    <div class="pos-main">
      <div class="pos-top">
        <div class="pos-search">
          ${searchIcon()}
          <input id="posSearch" type="search" placeholder="Найти товар…" value="${esc(SELL.q)}" enterkeyhint="search" autocomplete="off"
            oninput="onPosSearch(this.value)">
        </div>
        <nav class="cat-strip pos-cats" id="posCats"></nav>
      </div>
      <div id="posList" class="pos-list"><div class="empty-state">Загрузка…</div></div>
    </div>
    <aside class="pos-ticket" id="posTicket"></aside>
  </div>`;
  renderPosCats();
  renderTicketPanel();
  await renderPosList();
}

function renderPosCats() {
  const el = document.getElementById('posCats');
  if (!el) return;
  el.innerHTML = `<button class="cat-chip ${SELL.cat === 'all' ? 'active' : ''}" onclick="setPosCat('all')">Все</button>` +
    CATEGORIES.map(c => `<button class="cat-chip ${SELL.cat === c.id ? 'active' : ''}" onclick="setPosCat(${c.id})">${iconSvg(c.icon)}${esc(c.name)}</button>`).join('');
}
function setPosCat(id) { SELL.cat = id; renderPosCats(); renderPosList(); }
const onPosSearch = debounce((v) => { SELL.q = v.trim(); renderPosList(); }, 200);

async function renderPosList() {
  const root = document.getElementById('posList');
  if (!root) return;
  let products;
  if (SELL.q) products = indexProducts(await Api.get('/products?q=' + encodeURIComponent(SELL.q)));
  else if (SELL.cat === 'all') products = (await Promise.all(CATEGORIES.map(c => loadProducts(c.id)))).flat();
  else products = await loadProducts(SELL.cat);

  if (!products.length) { root.innerHTML = `<div class="empty-state">${boxIcon()}<div>Ничего не найдено</div></div>`; return; }
  const byCat = {};
  for (const p of products) (byCat[p.category_id] = byCat[p.category_id] || []).push(p);
  let html = '';
  for (const cat of CATEGORIES) {
    const list = byCat[cat.id];
    if (!list) continue;
    if (SELL.cat === 'all' || SELL.q) html += `<div class="pos-group">${esc(cat.name)}</div>`;
    for (const p of list) html += posRowHtml(p);
  }
  root.innerHTML = html;
}

function posRowHtml(p) {
  const n = Cart.qtyOfProduct(p.id);
  const hasOpts = !!parseOptions(p);
  return `<div class="pos-row ${n ? 'in' : ''}" data-pos-row="${p.id}">
    <button class="pos-row-main" onclick="${hasOpts ? `openProductDetail(${p.id})` : `posAdd(${p.id})`}">
      <span class="pos-thumb">${p.photo ? `<img src="${p.photo}" alt="" loading="lazy">` : photoPlaceholder()}</span>
      <span class="pos-info">
        <span class="pos-name">${esc(p.name)}</span>
        <span class="pos-meta">${fmtPrice(p.price)} сом${unitSuffix(p)}${hasOpts ? ' · выбрать вариант' : ''}</span>
      </span>
    </button>
    <span class="pos-act">${n ? `<span class="pos-badge">${n}</span>` : ''}<button class="pos-plus" onclick="${hasOpts ? `openProductDetail(${p.id})` : `posAdd(${p.id})`}" aria-label="Добавить">${plusIcon()}</button></span>
  </div>`;
}
function refreshPosRow(productId) {
  const p = PRODUCT_INDEX[productId];
  document.querySelectorAll(`[data-pos-row="${productId}"]`).forEach(el => { el.outerHTML = posRowHtml(p); });
}
function posAdd(productId) {
  const p = PRODUCT_INDEX[productId];
  if (!p) return;
  Cart.add(p, {}, 1);
  refreshPosRow(productId);
  updateCartBadge();
  if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) {}
}

/* ---- ticket (current sale) panel: right column on desktop, bottom bar on phone ---- */
function renderTicketPanel() {
  const el = document.getElementById('posTicket');
  if (!el) return;
  if (!Cart.items.length) {
    el.innerHTML = `<div class="ticket-empty">${cartIcon()}<div><b>Чек пуст</b><span>Нажимайте на товары слева — они появятся здесь</span></div></div>`;
    el.classList.remove('has');
    return;
  }
  el.classList.add('has');
  let rows = '';
  Cart.items.forEach(it => {
    const ol = optsLabel(it.opts);
    rows += `<div class="t-line"><div class="t-name">${esc(it.name)}${ol ? `<small>${esc(ol)}</small>` : ''}</div>
      <div class="t-q">${it.qty} × ${fmtPrice(it.price)}</div><div class="t-sum">${fmtPrice(it.price * it.qty)}</div></div>`;
  });
  el.innerHTML = `<div class="ticket-head"><b>Текущий чек</b><button class="link-btn" onclick="confirmClearCart()">Очистить</button></div>
    <div class="ticket-lines">${rows}</div>
    <button class="ticket-go" onclick="openCheckout()">
      <span class="tg-count">${Cart.items.length}</span>
      <span class="tg-label">Оформить продажу<small>${Cart.count()} ед.</small></span>
      <span class="tg-sum">${fmtPrice(Cart.total())} сом</span>
    </button>`;
}

/* ============================================================
   ОФОРМЛЕНИЕ ПРОДАЖИ (sheet)
   ============================================================ */
let CHECKOUT = { discount: 0, discMode: 'som', payment: 'cash', name: '', phone: '', note: '' };

function checkoutTotals() {
  const subtotal = Cart.total();
  const raw = Number(CHECKOUT.discount) || 0;
  let discount = CHECKOUT.discMode === 'pct' ? Math.round(subtotal * Math.min(100, raw) / 100) : Math.round(raw);
  discount = Math.max(0, Math.min(subtotal, discount));
  return { subtotal, discount, total: subtotal - discount };
}

function openCheckout() {
  if (!Cart.items.length) { showToast('Добавьте товары в чек', true); return; }
  renderCheckout();
}

function renderCheckout() {
  const t = checkoutTotals();
  let lines = '';
  Cart.items.forEach((it, i) => {
    const k = esc(it.key).replace(/'/g, "\\'");
    const ol = optsLabel(it.opts);
    lines += `<div class="co-line">
      <div class="co-name"><span>${esc(it.name)}${ol ? `<small>${esc(ol)}</small>` : ''}</span>
        <button class="inv-del" onclick="changeCartQty('${k}', 0)" aria-label="Убрать">${closeIcon()}</button></div>
      <div class="co-ctrl">
        ${qtyStepperHtml(it.key, it.qty)}
        <label class="co-price"><input type="number" inputmode="numeric" pattern="[0-9]*" value="${it.price}" onclick="this.select()"
          onchange="setLinePrice('${k}', this.value)"><span>сом/${esc(it.unit || 'шт')}</span></label>
        <b class="co-sum">${fmtPrice(it.price * it.qty)}</b>
      </div>
    </div>`;
  });
  const payBtns = Object.entries(PAY_LABELS).map(([k, v]) =>
    `<button type="button" class="chip pay-${k} ${CHECKOUT.payment === k ? 'active' : ''}" onclick="CHECKOUT.payment='${k}'; renderCheckout()">${payIcon(k)}${v}</button>`).join('');

  renderModal(`
    <button class="modal-close" onclick="closeModal()">${closeIcon()}</button>
    <h3>Оформление продажи</h3>
    <div class="co-lines">${lines}</div>
    <div class="co-grid">
      <div class="field">
        <label>Скидка</label>
        <div class="seg-input">
          <input type="number" inputmode="decimal" id="coDisc" value="${CHECKOUT.discount || ''}" placeholder="0" onclick="this.select()"
            oninput="CHECKOUT.discount=this.value; updateCheckoutTotals()">
          <div class="seg">
            <button type="button" class="${CHECKOUT.discMode === 'som' ? 'active' : ''}" onclick="CHECKOUT.discMode='som'; renderCheckout()">сом</button>
            <button type="button" class="${CHECKOUT.discMode === 'pct' ? 'active' : ''}" onclick="CHECKOUT.discMode='pct'; renderCheckout()">%</button>
          </div>
        </div>
      </div>
      <div class="field"><label>Оплата</label><div class="chips">${payBtns}</div></div>
      <div class="field"><label>Покупатель (необязательно)</label><input type="text" id="coName" value="${esc(CHECKOUT.name)}" placeholder="Имя" oninput="CHECKOUT.name=this.value"></div>
      <div class="field"><label>WhatsApp покупателя</label><input type="tel" inputmode="tel" id="coPhone" value="${esc(CHECKOUT.phone)}" placeholder="+996 700 123 456" oninput="CHECKOUT.phone=this.value"></div>
    </div>
    ${CHECKOUT.payment === 'debt' ? `<p class="co-warn">${warnIcon()} Продажа в долг — укажите имя и телефон покупателя, чтобы не потерять долг.</p>` : ''}
    <div class="pd-footer co-footer">
      <div id="coTotals">${checkoutTotalsHtml(t)}</div>
      <button class="btn primary big" id="coSubmit" onclick="submitSale()">Продать</button>
    </div>
    <button class="link-btn co-alt" onclick="closeModal(); openSubmitOrderModal()">или оформить как заявку контрагенту →</button>
  `, 'modal-wide sheet');
}
function checkoutTotalsHtml(t) {
  return `${t.discount ? `<div class="pd-total-label">${fmtPrice(t.subtotal)} − скидка ${fmtPrice(t.discount)}</div>` : `<div class="pd-total-label">К оплате</div>`}
    <div class="pd-total">${fmtPrice(t.total)} сом</div>`;
}
function updateCheckoutTotals() { const el = document.getElementById('coTotals'); if (el) el.innerHTML = checkoutTotalsHtml(checkoutTotals()); }
function setLinePrice(key, v) {
  const it = Cart.find(key);
  if (!it) return;
  it.price = Math.max(0, Math.round(Number(v) || 0));
  Cart.save();
  renderCheckout();
  renderTicketPanel();
}

async function submitSale() {
  const t = checkoutTotals();
  if (CHECKOUT.payment === 'debt' && !CHECKOUT.name.trim() && !CHECKOUT.phone.trim()) {
    showToast('Для продажи в долг укажите имя или телефон', true); return;
  }
  const btn = document.getElementById('coSubmit');
  if (btn) { btn.disabled = true; btn.textContent = 'Сохраняю…'; }
  const items = Cart.items.map(it => {
    const ol = optsLabel(it.opts);
    return { product_id: it.product_id, product_name: it.name + (ol ? ' (' + ol + ')' : ''), unit: it.unit || 'шт', qty: it.qty, price: it.price };
  });
  try {
    const sale = await Api.post('/sales', {
      items, discount: t.discount, payment: CHECKOUT.payment,
      customer_name: CHECKOUT.name, customer_phone: CHECKOUT.phone,
    });
    Cart.clear(true);
    CHECKOUT = { discount: 0, discMode: 'som', payment: 'cash', name: '', phone: '', note: '' };
    closeModal();
    updateCartBadge();
    navigate('#/sales/' + sale.id + '?new=1');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Продать'; }
    showToast('Не удалось сохранить продажу. Проверьте интернет.', true, 5000);
  }
}

/* ============================================================
   ПРОДАЖА / НАКЛАДНАЯ (#/sales/:id)
   ============================================================ */
let CURRENT_SALE = null;

async function viewSaleDetail(id, isNew) {
  if (!SETTINGS) await loadSettings();
  const s = await Api.get('/sales/' + id);
  CURRENT_SALE = s;
  const app = document.getElementById('app');
  const buyer = s.customer_name || s.contractor_name || 'Розничный покупатель';
  const debtOpen = s.payment === 'debt' && !s.paid_at;
  const profit = s.cost_total !== undefined ? s.total - s.cost_total : null;

  let html = isNew
    ? `<div class="sale-done"><div class="sd-check">${checkIcon()}</div><div><b>Продажа №${s.id} сохранена</b><span>${PAY_LABELS[s.payment]} · ${fmtPrice(s.total)} сом</span></div></div>`
    : `<button class="btn small" onclick="navigate('#/sales')" style="margin-bottom:14px;">${backIcon()} История</button>`;

  html += `<div class="doc-share">
      <button class="share-btn wa" onclick="shareSaleWhatsApp()">${waIcon()}<span>WhatsApp</span></button>
      <button class="share-btn" onclick="printSaleA4()">${printIcon()}<span>Накладная A4</span></button>
      <button class="share-btn" onclick="printSaleReceipt(58)">${receiptIcon()}<span>Чек 58 мм</span></button>
      <button class="share-btn" onclick="printSaleReceipt(80)">${receiptIcon()}<span>Чек 80 мм</span></button>
    </div>`;

  html += `<article class="paper">
      <div class="paper-head">
        <div><div class="paper-co">${esc(SETTINGS.company_name)}</div><div class="paper-sub">${esc(SETTINGS.company_sub || '')}</div></div>
        <div class="paper-no">Накладная №${s.id}<span>${fmtLocal(s.local_at)}</span></div>
      </div>
      <div class="paper-meta">
        <div><span>Покупатель</span><b>${esc(buyer)}</b>${s.customer_phone ? `<em>${esc(s.customer_phone)}</em>` : ''}</div>
        <div><span>Продавец</span><b>${esc(s.seller_name || '—')}</b></div>
        <div><span>Оплата</span><b class="pay-tag pay-${s.payment}">${PAY_LABELS[s.payment]}${s.payment === 'debt' ? (debtOpen ? ' · не оплачено' : ' · погашен') : ''}</b></div>
      </div>
      ${saleTableHtml(s)}
      <div class="paper-words">${esc(capitalize(numberToWordsRu(s.total)))} сом 00 тыйын</div>
    </article>`;

  if (s.status === 'cancelled') html += `<p class="co-warn">${warnIcon()} Продажа отменена и не учитывается в аналитике.</p>`;

  html += `<div class="sale-actions">`;
  if (isNew) html += `<button class="btn primary big" onclick="navigate('#/sell')">${plusIcon()} Новая продажа</button>`;
  if (debtOpen) html += `<button class="btn" onclick="markSalePaid(${s.id})">${checkIcon()} Долг погашен</button>`;
  if (Auth.isAdmin() && s.status === 'done') html += `<button class="btn danger" onclick="confirmCancelSale(${s.id})">Отменить продажу</button>`;
  html += `</div>`;

  if (profit !== null) {
    html += `<div class="admin-note">${lockIcon()}<span>Видно только администратору: себестоимость ${fmtPrice(s.cost_total)} сом · прибыль <b>${fmtPrice(profit)} сом</b>${s.total ? ` (${Math.round(profit / s.total * 100)}%)` : ''}</span></div>`;
  }
  app.innerHTML = html;
}

function saleTableHtml(s) {
  let rows = '';
  s.items.forEach((it, i) => {
    rows += `<tr><td class="c">${i + 1}</td><td>${esc(it.product_name)}<div class="m-only inv-m">${it.qty} ${esc(it.unit)} × ${fmtPrice(it.price)}</div></td>
      <td class="c col-x">${esc(it.unit)}</td><td class="r col-x">${it.qty}</td><td class="r col-x">${fmtPrice(it.price)}</td><td class="r b">${fmtPrice(it.price * it.qty)}</td></tr>`;
  });
  const foot = (label, val, cls = '') => `<tr class="${cls}"><td></td><td class="r">${label}</td><td class="col-x"></td><td class="col-x"></td><td class="col-x"></td><td class="r b">${val}</td></tr>`;
  return `<div class="inv-table-wrap"><table class="inv-table">
    <thead><tr><th class="c">№</th><th>Наименование</th><th class="c col-x">Ед.</th><th class="r col-x">Кол-во</th><th class="r col-x">Цена</th><th class="r">Сумма</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>${s.discount ? foot('Сумма:', fmtPrice(s.subtotal), 'sub') + foot('Скидка:', '−' + fmtPrice(s.discount), 'sub') : ''}${foot('Итого, сом:', fmtPrice(s.total))}</tfoot>
  </table></div>`;
}

async function markSalePaid(id) {
  try { await Api.patch('/sales/' + id, { paid: true }); showToast('Долг отмечен как погашенный'); router(); }
  catch (e) { showToast('Не удалось обновить', true); }
}
function confirmCancelSale(id) {
  renderModal(`<h3>Отменить продажу №${id}?</h3>
    <p style="color:var(--text-mute);font-size:14px;line-height:1.5;">Продажа останется в истории с пометкой «отменена», но не будет учитываться в выручке и прибыли.</p>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Назад</button>
    <button class="btn danger" onclick="cancelSale(${id})">Отменить продажу</button></div>`);
}
async function cancelSale(id) {
  await Api.patch('/sales/' + id, { status: 'cancelled' });
  closeModal(); showToast('Продажа отменена'); router();
}

/* ---- печать: накладная A4 ---- */
function printSaleA4() {
  const s = CURRENT_SALE; if (!s) return;
  const S = SETTINGS || {};
  const buyer = [s.customer_name || s.contractor_name || 'Розничный покупатель', s.customer_phone, s.contractor_address].filter(Boolean).map(esc).join(', ');
  const supplier = [S.company_name, S.company_inn ? 'ИНН ' + S.company_inn : '', S.company_address, S.company_phone].filter(Boolean).map(esc).join(', ');
  const qtyTotal = s.items.reduce((a, it) => a + it.qty, 0);
  printHtml(`<div class="print-doc">
    <div class="pd-head">
      <div><div class="pd-company">${esc(S.company_name)}</div><div class="pd-company-sub">${esc(S.company_sub || '')}</div></div>
      <div class="pd-title">НАКЛАДНАЯ № ${s.id}<span>от ${fmtLocal(s.local_at).slice(0, 10)}</span></div>
    </div>
    <table class="pd-parties">
      <tr><td>Поставщик:</td><td><b>${supplier}</b></td></tr>
      <tr><td>Покупатель:</td><td><b>${buyer}</b></td></tr>
      <tr><td>Оплата:</td><td>${PAY_LABELS[s.payment]}${s.payment === 'debt' && !s.paid_at ? ' (не оплачено)' : ''}</td></tr>
    </table>
    ${saleTableHtml(s)}
    <p class="pd-words">Всего наименований ${s.items.length}, единиц ${qtyTotal}, на сумму ${fmtPrice(s.total)} сом.<br><b>${esc(capitalize(numberToWordsRu(s.total)))} сом 00 тыйын</b></p>
    <div class="pd-signs"><div>Отпустил ____________________</div><div>Получил ____________________</div></div>
  </div>`, 'A4');
}

/* ---- печать: чек 58/80 мм для карманного принтера ---- */
function printSaleReceipt(mm) {
  const s = CURRENT_SALE; if (!s) return;
  const S = SETTINGS || {};
  let lines = '';
  s.items.forEach(it => {
    lines += `<div class="rc-item"><div>${esc(it.product_name)}</div><div class="rc-row"><span>${it.qty} ${esc(it.unit)} × ${fmtPrice(it.price)}</span><b>${fmtPrice(it.price * it.qty)}</b></div></div>`;
  });
  printHtml(`<div class="receipt w${mm}">
    <div class="rc-co">${esc(S.company_name)}</div>
    ${S.company_address ? `<div class="rc-c">${esc(S.company_address)}</div>` : ''}${S.company_phone ? `<div class="rc-c">${esc(S.company_phone)}</div>` : ''}
    <div class="rc-hr"></div>
    <div class="rc-row"><span>Накладная №${s.id}</span><span>${fmtLocal(s.local_at)}</span></div>
    ${s.customer_name ? `<div class="rc-row"><span>Покупатель</span><span>${esc(s.customer_name)}</span></div>` : ''}
    <div class="rc-hr"></div>
    ${lines}
    <div class="rc-hr"></div>
    ${s.discount ? `<div class="rc-row"><span>Сумма</span><span>${fmtPrice(s.subtotal)}</span></div><div class="rc-row"><span>Скидка</span><span>−${fmtPrice(s.discount)}</span></div>` : ''}
    <div class="rc-row rc-total"><span>ИТОГО</span><span>${fmtPrice(s.total)} сом</span></div>
    <div class="rc-row"><span>Оплата</span><span>${PAY_LABELS[s.payment]}</span></div>
    <div class="rc-hr"></div>
    <div class="rc-c">${esc(S.receipt_footer || 'Спасибо за покупку!')}</div>
  </div>`, mm + 'mm');
}

function printHtml(inner, page) {
  const root = document.getElementById('printRoot');
  root.innerHTML = inner;
  let st = document.getElementById('pageStyle');
  if (!st) { st = document.createElement('style'); st.id = 'pageStyle'; document.head.appendChild(st); }
  document.body.classList.add('printing');
  if (page === 'A4') st.textContent = '@page{size:A4;margin:14mm 12mm;}';
  else {
    // чек: ширина ленты, длина — по фактической высоте содержимого
    const w = parseInt(page, 10);
    root.style.cssText = 'display:block;position:fixed;left:-10000px;top:0;';
    const el = root.firstElementChild;
    const hmm = Math.ceil((el ? el.getBoundingClientRect().height : 400) * 25.4 / 96) + 8;
    root.style.cssText = '';
    st.textContent = `@page{size:${w}mm ${Math.max(60, hmm)}mm;margin:2mm;}`;
  }
  const done = () => { document.body.classList.remove('printing'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 60);
}

/* ---- WhatsApp: накладная картинкой (Android/iPhone), иначе текстом ---- */
function saleText(s) {
  const S = SETTINGS || {};
  const out = [`*${S.company_name}* — накладная №${s.id}`, fmtLocal(s.local_at), ''];
  s.items.forEach((it, i) => out.push(`${i + 1}. ${it.product_name} — ${it.qty} ${it.unit} × ${fmtPrice(it.price)} = ${fmtPrice(it.price * it.qty)}`));
  out.push('');
  if (s.discount) out.push(`Скидка: −${fmtPrice(s.discount)} сом`);
  out.push(`*Итого: ${fmtPrice(s.total)} сом* (${PAY_LABELS[s.payment].toLowerCase()})`);
  if (S.company_phone) out.push('', S.company_phone);
  return out.join('\n');
}
function waPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('0') && d.length === 10) d = '996' + d.slice(1);
  if (d.length === 9) d = '996' + d;
  return d;
}
async function shareSaleWhatsApp() {
  const s = CURRENT_SALE; if (!s) return;
  const text = saleText(s);
  try {
    const blob = await renderSaleImage(s);
    const file = new File([blob], `nakladnaya-${s.id}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: `Накладная №${s.id}`, text: `Накладная №${s.id} — ${fmtPrice(s.total)} сом` });
      return;
    }
    // компьютер: скачиваем картинку и открываем WhatsApp с текстом
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const phone = waPhone(s.customer_phone);
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
}

function renderSaleImage(s) {
  const S = SETTINGS || {};
  const W = 720, P = 40, scale = 2;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const F = (w, sz) => `${w} ${sz}px Manrope, "Segoe UI", Arial, sans-serif`;
  const wrap = (text, maxW, font) => {
    ctx.font = font; const words = String(text).split(' '); const out = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }
    if (line) out.push(line); return out;
  };
  // measure height first
  const nameW = W - P * 2 - 150;
  const itemLines = s.items.map(it => wrap(it.product_name, nameW, F(600, 22)));
  let H = 250 + itemLines.reduce((a, l) => a + l.length * 28 + 34, 0) + (s.discount ? 80 : 30) + 170;
  c.width = W * scale; c.height = H * scale; ctx.scale(scale, scale);
  ctx.fillStyle = '#fbf8f3'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1f2328'; ctx.fillRect(0, 0, W, 120);
  ctx.fillStyle = '#c8935f'; ctx.fillRect(0, 120, W, 6);
  ctx.fillStyle = '#fff'; ctx.font = F(800, 30); ctx.fillText(S.company_name || 'UNICA Doors', P, 58);
  ctx.font = F(500, 17); ctx.fillStyle = '#d6d0c7';
  let sub = S.company_phone || S.company_sub || '';
  while (sub && ctx.measureText(sub).width > W - P * 2 - 200) sub = sub.slice(0, -2).trimEnd() + '…';
  ctx.fillText(sub, P, 90);
  ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = F(800, 24); ctx.fillText(`Накладная №${s.id}`, W - P, 58);
  ctx.font = F(500, 17); ctx.fillStyle = '#d6d0c7'; ctx.fillText(fmtLocal(s.local_at), W - P, 90); ctx.textAlign = 'left';
  let y = 170;
  ctx.fillStyle = '#6f6a63'; ctx.font = F(600, 16);
  ctx.fillText('Покупатель: ' + (s.customer_name || s.contractor_name || 'Розничный покупатель'), P, y); y += 40;
  ctx.strokeStyle = '#e7e1d8'; ctx.lineWidth = 2;
  s.items.forEach((it, i) => {
    ctx.beginPath(); ctx.moveTo(P, y - 22); ctx.lineTo(W - P, y - 22); ctx.stroke();
    ctx.fillStyle = '#1f2328'; ctx.font = F(600, 22);
    itemLines[i].forEach((ln, j) => ctx.fillText(ln, P, y + 6 + j * 28));
    const yy = y + 6 + (itemLines[i].length - 1) * 28;
    ctx.fillStyle = '#6f6a63'; ctx.font = F(500, 17); ctx.fillText(`${it.qty} ${it.unit} × ${fmtPrice(it.price)}`, P, yy + 28);
    ctx.textAlign = 'right'; ctx.fillStyle = '#1f2328'; ctx.font = F(800, 22); ctx.fillText(fmtPrice(it.price * it.qty), W - P, y + 6); ctx.textAlign = 'left';
    y += itemLines[i].length * 28 + 34;
  });
  ctx.beginPath(); ctx.moveTo(P, y - 22); ctx.lineTo(W - P, y - 22); ctx.stroke();
  y += 14;
  if (s.discount) {
    ctx.fillStyle = '#6f6a63'; ctx.font = F(600, 18);
    ctx.fillText('Сумма', P, y); ctx.textAlign = 'right'; ctx.fillText(fmtPrice(s.subtotal), W - P, y); ctx.textAlign = 'left'; y += 30;
    ctx.fillText('Скидка', P, y); ctx.textAlign = 'right'; ctx.fillText('−' + fmtPrice(s.discount), W - P, y); ctx.textAlign = 'left'; y += 20;
  }
  ctx.fillStyle = '#f3e9dd'; roundRect(ctx, P - 12, y, W - P * 2 + 24, 70, 14); ctx.fill();
  ctx.fillStyle = '#1f2328'; ctx.font = F(800, 26); ctx.fillText('Итого', P + 8, y + 45);
  ctx.textAlign = 'right'; ctx.fillText(fmtPrice(s.total) + ' сом', W - P - 8, y + 45); ctx.textAlign = 'left';
  y += 104;
  ctx.fillStyle = '#6f6a63'; ctx.font = F(500, 17);
  ctx.fillText(`Оплата: ${PAY_LABELS[s.payment]}${s.payment === 'debt' && !s.paid_at ? ' (не оплачено)' : ''}`, P, y);
  ctx.textAlign = 'right'; ctx.fillText(S.receipt_footer || 'Спасибо за покупку!', W - P, y); ctx.textAlign = 'left';
  return new Promise(r => c.toBlob(r, 'image/png'));
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/* ============================================================
   ИСТОРИЯ ПРОДАЖ (#/sales)
   ============================================================ */
let HIST = { period: 'today', q: '' };
function periodRange(p) {
  const now = new Date(), t = ymd(now);
  if (p === 'today') return [t, t];
  if (p === 'yesterday') { const y = ymd(addDays(now, -1)); return [y, y]; }
  if (p === '7') return [ymd(addDays(now, -6)), t];
  if (p === '30') return [ymd(addDays(now, -29)), t];
  if (p === 'month') return [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), t];
  return [t, t];
}
async function viewSales() {
  const app = document.getElementById('app');
  const periods = [['today', 'Сегодня'], ['yesterday', 'Вчера'], ['7', '7 дней'], ['month', 'Месяц']];
  app.innerHTML = `<div class="page-head"><h1 class="page-title">${Auth.isAdmin() ? 'Продажи' : 'Мои продажи'}</h1>
      <button class="btn primary" onclick="navigate('#/sell')">${plusIcon()} Новая</button></div>
    <div class="seg wide">${periods.map(([k, v]) => `<button class="${HIST.period === k ? 'active' : ''}" onclick="HIST.period='${k}'; viewSales()">${v}</button>`).join('')}</div>
    <div class="pos-search" style="margin:12px 0 16px;">${searchIcon()}<input type="search" placeholder="Номер, имя или телефон покупателя" value="${esc(HIST.q)}" oninput="onHistSearch(this.value)"></div>
    <div id="histRoot"><div class="empty-state">Загрузка…</div></div>`;
  await loadHist();
}
const onHistSearch = debounce((v) => { HIST.q = v.trim(); loadHist(); }, 250);
async function loadHist() {
  const [from, to] = periodRange(HIST.period);
  const rows = await Api.get(`/sales?from=${from}&to=${to}${HIST.q ? '&q=' + encodeURIComponent(HIST.q) : ''}`);
  const root = document.getElementById('histRoot');
  if (!root) return;
  const done = rows.filter(r => r.status === 'done');
  const sum = (arr) => arr.reduce((a, r) => a + r.total, 0);
  const by = (k) => done.filter(r => r.payment === k);
  let html = `<div class="hist-sum">
    <div class="hs-main"><span>Выручка</span><b>${fmtPrice(sum(done))} сом</b><em>${done.length} ${pluralSales(done.length)}</em></div>
    <div class="hs-pay"><span>${payIcon('cash')}Наличные</span><b>${fmtPrice(sum(by('cash')))}</b></div>
    <div class="hs-pay"><span>${payIcon('transfer')}Перевод</span><b>${fmtPrice(sum(by('transfer')))}</b></div>
    <div class="hs-pay"><span>${payIcon('debt')}В долг</span><b>${fmtPrice(sum(by('debt')))}</b></div>
  </div>`;
  if (!rows.length) { root.innerHTML = html + `<div class="empty-state">${receiptIcon()}<div>Продаж за этот период нет</div></div>`; return; }
  let lastDay = '';
  html += `<div class="hist-list">`;
  for (const r of rows) {
    const day = r.local_at.slice(0, 10);
    if (day !== lastDay && HIST.period !== 'today' && HIST.period !== 'yesterday') { html += `<div class="hist-day">${fmtLocal(day + ' ', true).trim()}</div>`; lastDay = day; }
    const buyer = r.customer_name || r.contractor_name || 'Розничный покупатель';
    html += `<a class="hist-row ${r.status === 'cancelled' ? 'cancelled' : ''}" href="#/sales/${r.id}">
      <span class="hr-time">${fmtLocal(r.local_at, false)}</span>
      <span class="hr-main"><b>№${r.id} · ${esc(buyer)}</b><small>${r.lines} поз.${Auth.isAdmin() && r.seller_name ? ' · ' + esc(r.seller_name) : ''}${r.status === 'cancelled' ? ' · отменена' : ''}</small></span>
      <span class="pay-tag pay-${r.payment}">${PAY_LABELS[r.payment]}${r.payment === 'debt' && r.paid_at ? ' ✓' : ''}</span>
      <span class="hr-sum">${fmtPrice(r.total)}</span>
    </a>`;
  }
  root.innerHTML = html + `</div>`;
}
function pluralSales(n) { const a = n % 10, b = n % 100; return (b > 10 && b < 20) ? 'продаж' : a === 1 ? 'продажа' : (a >= 2 && a <= 4) ? 'продажи' : 'продаж'; }

/* ---- icons used here ---- */
function searchIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`; }
function receiptIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/></svg>`; }
function lockIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`; }
function chartIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`; }
function moreIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>`; }
function sellIcon() { return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16l-1.5 12.5a2 2 0 0 1-2 1.5h-9a2 2 0 0 1-2-1.5z"/><path d="M8.5 7a3.5 3.5 0 0 1 7 0"/><path d="M12 11v6M9 14h6"/></svg>`; }
function waIcon() { return `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3z"/></svg>`; }
function payIcon(k) {
  if (k === 'cash') return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/></svg>`;
  if (k === 'transfer') return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18h2"/></svg>`;
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
}
