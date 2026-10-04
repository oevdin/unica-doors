/* UNICA — склад: товары, остатки, инвентаризация, приход товара от поставщика */
'use strict';

const ST = { cat: 0, q: '', low: false };
const stockTabs = (on) => `<nav class="tabs-inline"><a href="#/stock" class="${on === 'stock' ? 'on' : ''}">Товары</a><a href="#/purchases" class="${on === 'pur' ? 'on' : ''}">Приходы товара</a></nav>`;

route('stock', async () => {
  const all = await Api.get('/products');
  PRODUCTS = all; all.forEach(p => { p._opts = parseOpts(p.options); PIDX[p.id] = p; });
  State.categories = await Api.get('/categories');
  const atCost = all.reduce((s, p) => s + Math.max(0, p.stock) * (p.cost || 0), 0);
  const atPrice = all.reduce((s, p) => s + Math.max(0, p.stock) * p.price, 0);
  const low = all.filter(p => p.stock <= p.min_stock);
  const q = ST.q.toLowerCase();
  const list = all.filter(p => (!ST.cat || p.category_id === ST.cat) && (!ST.low || p.stock <= p.min_stock) && (!q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)));

  let html = pageHead('Склад', `<a class="btn primary" href="#/purchase/new">${icons.truck}Приход товара</a><button class="btn" onclick="productSheet()">${icons.plus}<span class="hide-s">Товар</span></button>`);
  html += stockTabs('stock');
  html += `<div class="sum-strip">
    <div><span>Товаров</span><b>${all.length}</b></div>
    <div><span>Склад по себестоимости</span><b>${money(atCost)}</b></div>
    <div><span>Склад в розничных ценах</span><b>${money(atPrice)}</b></div>
    <button class="${low.length ? 'warn' : ''} ${ST.low ? 'on' : ''}" onclick="ST.low=!ST.low;router()"><span>Заканчиваются</span><b>${low.length}</b></button>
  </div>`;
  html += `<div class="toolbar"><label class="search grow">${icons.search}<input type="search" placeholder="Название или артикул" value="${esc(ST.q)}" oninput="stockSearch(this.value)"></label></div>
    <div class="chips scroll mb">${[`<button class="chip ${!ST.cat ? 'on' : ''}" onclick="ST.cat=0;router()">Все разделы</button>`, ...State.categories.map(c => `<button class="chip ${ST.cat === c.id ? 'on' : ''}" onclick="ST.cat=${c.id};router()">${catIcon(c.icon)}${esc(c.name)}</button>`)].join('')}
      <button class="chip ghost" onclick="categoriesSheet()">${icons.edit}Разделы</button></div>`;
  if (!list.length) html += emptyState(icons.box, ST.low ? 'Все товары в достатке' : 'Товаров нет', ST.low ? 'Ни один товар не опустился ниже минимального остатка.' : 'Добавьте первый товар или измените фильтр.', `<button class="btn primary" onclick="productSheet()">${icons.plus}Добавить товар</button>`);
  else html += `<div class="table-wrap"><table class="grid-t">
    <thead><tr><th>Товар</th><th class="r">Остаток</th><th class="r hide-s">Себест.</th><th class="r">Цена</th><th class="r hide-s">Наценка</th></tr></thead><tbody>
    ${list.map(p => { const mk = p.cost ? (p.price - p.cost) / p.cost * 100 : null; return `<tr onclick="go('#/product/${p.id}')" tabindex="0" onkeydown="if(event.key==='Enter')go('#/product/${p.id}')">
      <td><div class="cell-p"><span class="thumb sm">${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy">` : catIcon(catOf(p)?.icon)}</span><span><b>${esc(p.name)}</b><small>${esc(p.category_name || 'Без раздела')}${p.sku ? ', арт. ' + esc(p.sku) : ''}</small></span></div></td>
      <td class="r">${stockBadge(p)}</td><td class="r hide-s">${p.cost ? money(p.cost) : '<span class="bad">нет</span>'}</td><td class="r b">${money(p.price)}</td>
      <td class="r hide-s ${mk != null && mk < 20 ? 'bad' : ''}">${mk == null ? '—' : pct(mk, 0)}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  $('#app').innerHTML = html;
});
const stockSearch = debounce((v) => { ST.q = v.trim(); router().then(() => { const i = document.querySelector('.toolbar input[type=search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 350);

/* ---------- карточка товара ---------- */
route('product', async ([id]) => {
  const p = await Api.get('/products/' + id);
  p._opts = parseOpts(p.options); PIDX[p.id] = p;
  const mk = p.cost ? (p.price - p.cost) / p.cost * 100 : null;
  const mg = p.price && p.cost ? (p.price - p.cost) / p.price * 100 : null;
  const reasons = { sale: 'Продажа', purchase: 'Приход', adjust: 'Инвентаризация', cancel: 'Отмена' };
  let html = `<a class="back" href="#/stock">${icons.back}Склад</a>`;
  html += `<div class="prod-head"><span class="thumb xl">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : catIcon(catOf(p)?.icon)}</span>
    <div><h1>${esc(p.name)}</h1><p>${esc(p.category_name || 'Без раздела')}${p.sku ? ', арт. ' + esc(p.sku) : ''}${p.active ? '' : ', скрыт из продажи'}</p>
    <div class="page-actions"><button class="btn" onclick="productSheet(${p.id})">${icons.edit}Изменить</button><button class="btn" onclick="adjustSheet(${p.id})">${icons.box}Инвентаризация</button><a class="btn" href="#/purchase/new?product=${p.id}">${icons.truck}Приход</a></div></div></div>`;
  html += `<div class="sum-strip">
    <div><span>Остаток</span><b>${qtyFmt(p.stock)} ${esc(p.unit)}</b></div>
    <div><span>Себестоимость</span><b>${money(p.cost)}</b></div>
    <div><span>Цена</span><b>${money(p.price)}</b></div>
    <div><span>Наценка / маржа</span><b>${mk == null ? '—' : pct(mk, 0) + ' / ' + pct(mg, 0)}</b></div>
    <div><span>Продано за 30 дней</span><b>${qtyFmt(p.sold30)} ${esc(p.unit)}</b></div>
  </div>`;
  if (p._opts) html += `<section class="card"><h2>Варианты при продаже</h2>${Object.entries(p._opts).map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${v.map(esc).join(', ')}</b></div>`).join('')}</section>`;
  html += `<section class="card"><h2>Движение остатка</h2>${p.moves.length ? `<div class="list">${p.moves.map(m => `<div class="row"><span class="row-time">${dt(m.local_at, false).slice(0, 5)}</span>
    <span class="row-main"><b>${reasons[m.reason]}${m.ref_id ? ` №${m.ref_id}` : ''}</b><small>${timeOf(m.local_at)}${m.user_name ? ', ' + esc(m.user_name) : ''}${m.note ? ', ' + esc(m.note) : ''}</small></span>
    <b class="row-sum ${m.delta < 0 ? 'neg' : 'pos'}">${m.delta > 0 ? '+' : ''}${qtyFmt(m.delta)}</b></div>`).join('')}</div>` : '<p class="hint">Движений пока не было.</p>'}</section>`;
  $('#app').innerHTML = html;
});

function productSheet(id) {
  const p = id ? PIDX[id] : null;
  const optsText = p && p._opts ? Object.entries(p._opts).map(([k, v]) => `${k}: ${v.join(', ')}`).join('\n') : '';
  openSheet({
    title: p ? 'Изменить товар' : 'Новый товар', wide: true,
    body: `<div class="photo-pick"><span class="thumb lg" id="phPrev">${p && p.photo ? `<img src="${esc(p.photo)}" alt="">` : icons.box}</span>
        <label class="btn">Выбрать фото<input type="file" accept="image/*" id="phFile" hidden></label></div>
      ${field('Название', `<input id="pName" type="text" value="${esc(p?.name || '')}" placeholder="Дверь «Модерн» глухая" autofocus>`)}
      <div class="co-grid">${field('Раздел', `<select id="pCat"><option value="">Без раздела</option>${State.categories.map(c => `<option value="${c.id}" ${p && p.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`)}
        ${field('Артикул', `<input id="pSku" type="text" value="${esc(p?.sku || '')}" placeholder="Необязательно">`)}</div>
      <div class="co-grid three">${field('Цена продажи', numInput('pPrice', p?.price ?? ''))}${field('Себестоимость', numInput('pCost', p?.cost ?? ''), 'Обновится сама при приходе товара')}
        ${field('Единица', `<input id="pUnit" type="text" list="units" value="${esc(p?.unit || 'шт')}"><datalist id="units"><option>шт</option><option>компл.</option><option>пог. м</option><option>м²</option><option>упак.</option></datalist>`)}</div>
      <div class="co-grid">${field('Мин. остаток', numInput('pMin', p?.min_stock ?? ''), 'Ниже — товар попадёт в «Заканчиваются»')}
        ${p ? '' : field('Сейчас на складе', numInput('pStock', ''), 'Начальный остаток')}</div>
      ${field('Варианты при продаже', `<textarea id="pOpts" rows="3" placeholder="Цвет: Белый, Капучино, Венге&#10;Размер: 700×2000, 800×2000">${esc(optsText)}</textarea>`, 'Каждая строка: название, двоеточие, значения через запятую')}`,
    footer: `${p ? `<button class="btn ghost-danger" onclick="hideProduct(${p.id})">${icons.trash}Удалить</button>` : ''}<button class="btn" onclick="closeSheet()">Отмена</button><button class="btn primary" id="pOk">Сохранить</button>`,
  });
  $('#phFile').onchange = (e) => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = (ev) => { $('#phPrev').innerHTML = `<img src="${ev.target.result}" alt="">`; }; r.readAsDataURL(f); };
  $('#pOk').onclick = async () => {
    const name = $('#pName').value.trim(); if (!name) { toast('Укажите название', 'err'); return; }
    const opts = {}; for (const ln of $('#pOpts').value.split('\n')) { const i = ln.indexOf(':'); if (i > 0) { const v = ln.slice(i + 1).split(',').map(s => s.trim()).filter(Boolean); if (v.length) opts[ln.slice(0, i).trim()] = v; } }
    const fd = new FormData();
    fd.append('name', name); fd.append('category_id', $('#pCat').value); fd.append('sku', $('#pSku').value);
    fd.append('price', readNum('pPrice')); fd.append('cost', readNum('pCost')); fd.append('unit', $('#pUnit').value || 'шт');
    fd.append('min_stock', readNum('pMin')); fd.append('options', JSON.stringify(opts));
    if (!p) fd.append('stock', readNum('pStock'));
    const f = $('#phFile').files[0]; if (f) fd.append('photo', f);
    $('#pOk').disabled = true;
    try { const r = p ? await Api.patch('/products/' + p.id, fd, true) : await Api.post('/products', fd, true); toast('Товар сохранён'); closeSheet(); PRODUCTS = []; if (Route.name === 'product') router(); else go('#/product/' + r.id); }
    catch (e) { $('#pOk').disabled = false; toast(errText(e, 'Не удалось сохранить товар'), 'err'); }
  };
}
function hideProduct(id) {
  confirmSheet('Удалить товар?', 'Если по товару уже были продажи или приходы, он будет скрыт, а история и отчёты сохранятся.', 'Удалить', async () => {
    const r = await Api.del('/products/' + id); closeSheet(); toast(r.hidden ? 'Товар скрыт из продажи' : 'Товар удалён'); PRODUCTS = []; go('#/stock');
  });
}
function adjustSheet(id) {
  const p = PIDX[id];
  openSheet({ title: 'Инвентаризация', body: `<p class="lead">${esc(p.name)}. По учёту: <b>${qtyFmt(p.stock)} ${esc(p.unit)}</b>.</p>
    ${field('Фактически на складе', `<input id="adQ" type="text" inputmode="decimal" value="${qtyFmt(p.stock)}" autofocus onfocus="this.select()">`)}
    ${field('Причина', `<input id="adN" type="text" placeholder="Пересчёт, брак, пересорт…">`)}`,
    footer: `<button class="btn" onclick="closeSheet()">Отмена</button><button class="btn primary" id="adOk">Сохранить остаток</button>` });
  $('#adOk').onclick = async () => {
    const actual = Number($('#adQ').value.replace(',', '.'));
    if (!Number.isFinite(actual) || actual < 0) { toast('Укажите количество', 'err'); return; }
    await Api.post(`/products/${id}/adjust`, { actual, note: $('#adN').value }); toast('Остаток обновлён'); closeSheet(); router();
  };
}
function categoriesSheet() {
  const icoKeys = Object.keys(CAT_ICONS);
  openSheet({ title: 'Разделы', body: `<div class="list" id="catList">${State.categories.map(c => `<div class="row"><span class="op-ico">${catIcon(c.icon)}</span>
      <input class="inline-in" value="${esc(c.name)}" onchange="Api.patch('/categories/${c.id}',{name:this.value}).then(()=>toast('Сохранено'))" aria-label="Название раздела">
      <button class="icon-btn sm" onclick="delCategory(${c.id})" aria-label="Удалить раздел">${icons.trash}</button></div>`).join('')}</div>
    <div class="row-in mt"><input id="newCat" type="text" placeholder="Новый раздел"><select id="newCatIco" aria-label="Значок">${icoKeys.map(k => `<option value="${k}">${{ door_interior: 'Дверь', door_enamel: 'Дверь со стеклом', door_metal: 'Металлическая дверь', frame: 'Коробка', casing: 'Наличник', extension: 'Добор', handle: 'Фурнитура', threshold: 'Порог', box: 'Коробка товара' }[k]}</option>`).join('')}</select>
    <button class="btn primary" onclick="addCategory()">Добавить</button></div>`,
    onClose: () => { if (Route.name === 'stock') router(); } });
}
async function addCategory() { const n = $('#newCat').value.trim(); if (!n) return; await Api.post('/categories', { name: n, icon: $('#newCatIco').value }); State.categories = await Api.get('/categories'); categoriesSheet(); }
async function delCategory(id) { await Api.del('/categories/' + id); State.categories = await Api.get('/categories'); categoriesSheet(); }

/* ---------- приходы товара ---------- */
route('purchases', async () => {
  const rows = await Api.get('/purchases');
  let html = pageHead('Склад', `<a class="btn primary" href="#/purchase/new">${icons.truck}Приход товара</a>`) + stockTabs('pur');
  if (!rows.length) html += emptyState(icons.truck, 'Приходов пока нет', 'Оформите приход товара от поставщика — остатки и себестоимость обновятся сами.', `<a class="btn primary" href="#/purchase/new">Оформить приход</a>`);
  else html += `<div class="list">${rows.map(r => `<a class="row ${r.status === 'cancelled' ? 'muted' : ''}" href="#/purchase/${r.id}"><span class="row-time">${dt(r.local_at, false).slice(0, 5)}</span>
    <span class="row-main"><b>№${r.id} · ${esc(r.supplier || 'Без поставщика')}</b><small>${r.lines} ${plural(r.lines, 'позиция', 'позиции', 'позиций')}${r.status === 'cancelled' ? ', отменён' : ''}</small></span>
    ${r.debt > 0 ? `<span class="tag warn">долг ${money(r.debt)}</span>` : ''}<b class="row-sum">${money(r.total)}</b></a>`).join('')}</div>`;
  $('#app').innerHTML = html;
});

let PUR = null;
route('purchase', async ([id], query) => {
  if (id !== 'new') return purchaseView(Number(id));
  await loadProducts(true);
  const suppliers = await Api.get('/contacts?type=supplier');
  PUR = { lines: [], supplier: suppliers[0] ? String(suppliers[0].id) : '', newName: '', newPhone: '', account: State.accounts[1]?.id || State.accounts[0]?.id, paid: null, note: '' };
  if (query.product && PIDX[query.product]) PUR.lines.push({ pid: Number(query.product), qty: 1, cost: PIDX[query.product].cost || 0 });
  PUR.suppliers = suppliers;
  renderPurchaseForm();
});
function renderPurchaseForm() {
  const total = PUR.lines.reduce((s, l) => s + l.qty * l.cost, 0);
  const paid = PUR.paid == null ? total : PUR.paid;
  let html = `<a class="back" href="#/purchases">${icons.back}Приходы товара</a>` + pageHead('Приход товара', '', 'Остатки увеличатся, себестоимость пересчитается по средней цене.');
  html += `<div class="doc-layout"><div>
    <section class="card"><h2>Товары</h2>
      <label class="search">${icons.search}<input id="purQ" type="search" placeholder="Добавить товар: начните вводить название" autocomplete="off" oninput="purSearch(this.value)"></label>
      <div id="purFound" class="suggest"></div>
      ${PUR.lines.length ? `<div class="pur-lines">${PUR.lines.map((l, i) => { const p = PIDX[l.pid]; return `<div class="pur-l"><span class="pur-n"><b>${esc(p.name)}</b><small>сейчас ${qtyFmt(p.stock)} ${esc(p.unit)}, себест. ${money(p.cost)}</small></span>
        <label><span>Кол-во</span><input type="text" inputmode="decimal" value="${qtyFmt(l.qty)}" onfocus="this.select()" onchange="PUR.lines[${i}].qty=Math.max(0,Number(this.value.replace(',','.'))||0);renderPurchaseForm()"></label>
        <label><span>Цена закупки</span><input type="text" inputmode="numeric" value="${l.cost}" onfocus="this.select()" onchange="PUR.lines[${i}].cost=Math.max(0,Number(this.value.replace(/\\D/g,''))||0);renderPurchaseForm()"></label>
        <b class="pur-s">${money(l.qty * l.cost)}</b><button class="icon-btn sm" onclick="PUR.lines.splice(${i},1);renderPurchaseForm()" aria-label="Убрать">${icons.x}</button></div>`; }).join('')}</div>`
      : `<p class="hint">Найдите товар через поиск выше. Если товара ещё нет в базе — <a href="javascript:productSheet()">создайте его</a>.</p>`}
    </section></div>
    <aside class="doc-side"><section class="card"><h2>Поставщик</h2>
      ${field('Из списка', `<select id="purSup" onchange="PUR.supplier=this.value;renderPurchaseForm()"><option value="">— новый поставщик —</option>${PUR.suppliers.map(s => `<option value="${s.id}" ${String(PUR.supplier) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`)}
      ${!PUR.supplier ? field('Название', `<input type="text" value="${esc(PUR.newName)}" placeholder="ОсОО «Поставщик»" oninput="PUR.newName=this.value">`) + field('Телефон', `<input type="tel" value="${esc(PUR.newPhone)}" oninput="PUR.newPhone=this.value">`) : ''}
    </section>
    <section class="card"><h2>Оплата</h2>
      <div class="pay-total"><span>Сумма прихода</span><b class="money">${money(total)}</b></div>
      ${field('Оплачено сейчас', `<input type="text" inputmode="numeric" value="${paid}" onfocus="this.select()" onchange="PUR.paid=Math.max(0,Number(this.value.replace(/\\D/g,''))||0);renderPurchaseForm()">`, paid < total ? `Долг поставщику: ${money(total - paid)} сом` : '')}
      ${field('Со счёта', `<select onchange="PUR.account=Number(this.value)">${accountOptions(PUR.account)}</select>`)}
      ${field('Комментарий', `<input type="text" value="${esc(PUR.note)}" oninput="PUR.note=this.value" placeholder="Номер накладной поставщика">`)}
      <button class="btn primary block big" onclick="savePurchase()" ${PUR.lines.length ? '' : 'disabled'}>${icons.truck}Оприходовать</button>
    </section></aside></div>`;
  $('#app').innerHTML = html;
}
const purSearch = debounce((v) => {
  const q = v.trim().toLowerCase(), box = $('#purFound');
  if (!q) { box.innerHTML = ''; return; }
  const found = PRODUCTS.filter(p => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)).slice(0, 6);
  box.innerHTML = found.map(p => `<button type="button" onclick="purAdd(${p.id})">${catIcon(catOf(p)?.icon)}<span><b>${esc(p.name)}</b><small>остаток ${qtyFmt(p.stock)}, себест. ${money(p.cost)}</small></span></button>`).join('') || `<p class="hint">Не найдено. <a href="javascript:productSheet()">Создать товар</a></p>`;
}, 150);
function purAdd(pid) { if (!PUR.lines.some(l => l.pid === pid)) PUR.lines.push({ pid, qty: 1, cost: PIDX[pid].cost || 0 }); renderPurchaseForm(); $('#purQ')?.focus(); }
async function savePurchase() {
  const total = PUR.lines.reduce((s, l) => s + l.qty * l.cost, 0);
  if (!PUR.supplier && !PUR.newName.trim()) { toast('Укажите поставщика', 'err'); return; }
  try {
    const r = await Api.post('/purchases', { contact_id: PUR.supplier || null, supplier_name: PUR.newName, supplier_phone: PUR.newPhone,
      items: PUR.lines.map(l => ({ product_id: l.pid, qty: l.qty, cost: l.cost })), payment: { account_id: PUR.account, amount: PUR.paid == null ? total : PUR.paid }, note: PUR.note });
    PRODUCTS = []; await refreshAccounts(); toast('Товар оприходован'); go('#/purchase/' + r.id);
  } catch (e) { toast(errText(e, 'Не удалось сохранить приход'), 'err'); }
}
async function purchaseView(id) {
  const p = await Api.get('/purchases/' + id);
  let html = `<a class="back" href="#/purchases">${icons.back}Приходы товара</a>`;
  html += `<div class="doc-layout"><div><article class="paper ${p.status === 'cancelled' ? 'void' : ''}">
    <div class="paper-top"><div><b class="paper-co">Приход товара №${p.id}</b><small>${dt(p.local_at)}${p.user_name ? ', ' + esc(p.user_name) : ''}</small></div><div class="paper-no">${p.contact_id ? `<a href="#/contact/${p.contact_id}">${esc(p.supplier)}</a>` : esc(p.supplier || '')}<small>${esc(p.supplier_phone || '')}</small></div></div>
    <table class="doc-t"><thead><tr><th class="c">№</th><th>Товар</th><th class="r">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th></tr></thead>
    <tbody>${p.items.map((it, i) => `<tr><td class="c">${i + 1}</td><td>${it.product_id ? `<a href="#/product/${it.product_id}">${esc(it.name)}</a>` : esc(it.name)}</td><td class="r">${qtyFmt(it.qty)}</td><td class="r">${money(it.cost)}</td><td class="r b">${money(it.qty * it.cost)}</td></tr>`).join('')}</tbody>
    <tfoot><tr class="tot"><td></td><td class="r" colspan="3">Итого, сом</td><td class="r b">${money(p.total)}</td></tr></tfoot></table>
    ${p.note ? `<p class="paper-words">${esc(p.note)}</p>` : ''}${p.status === 'cancelled' ? `<div class="void-mark">Отменён</div>` : ''}</article></div>
    <aside class="doc-side"><section class="card"><h2>Оплата поставщику</h2>
      ${p.payments.map(o => `<div class="pay-row ${o.type === 'in' ? 'neg' : ''}"><span>${esc(o.category)}<small>${esc(o.account_name)}, ${dt(o.local_at)}</small></span><b>${money(o.amount)}</b></div>`).join('') || '<p class="hint">Не оплачено.</p>'}
      ${p.status === 'done' ? `<div class="pay-total ${p.debt ? 'warn' : 'good'}"><span>${p.debt ? 'Наш долг' : 'Оплачено полностью'}</span><b>${p.debt ? money(p.debt) : icons.check}</b></div>` : ''}
      ${p.debt > 0 ? `<button class="btn primary block" onclick="payPurchase(${p.id},${p.debt})">${icons.out}Оплатить</button>` : ''}</section>
      ${p.status === 'done' ? `<button class="btn ghost-danger block" onclick="cancelPurchase(${p.id})">Отменить приход</button>` : ''}</aside></div>`;
  $('#app').innerHTML = html;
}
function payPurchase(id, debt) {
  openSheet({ title: 'Оплата поставщику', body: `${field('Сумма', numInput('ppA', debt, 'autofocus'))}${field('Со счёта', `<select id="ppAcc">${accountOptions(State.accounts[1]?.id)}</select>`)}`,
    footer: `<button class="btn" onclick="closeSheet()">Отмена</button><button class="btn out" id="ppOk">Оплатить</button>` });
  $('#ppOk').onclick = async () => { await Api.post(`/purchases/${id}/pay`, { amount: readNum('ppA'), account_id: Number($('#ppAcc').value) }); await refreshAccounts(); closeSheet(); toast('Оплата записана'); router(); };
}
function cancelPurchase(id) {
  confirmSheet('Отменить приход?', 'Товар спишется со склада, оплаченные деньги вернутся в кассу как возврат от поставщика.', 'Отменить приход', async () => {
    await Api.post(`/purchases/${id}/cancel`); await refreshAccounts(); closeSheet(); toast('Приход отменён'); PRODUCTS = []; router();
  });
}
