/* UNICA — чеки: список, документ продажи, оплата долга, печать, WhatsApp */
'use strict';

const SL = { period: 'today', q: '', debt: false };

route('sales', async (params, query) => {
  if (params[0]) return saleView(Number(params[0]), query.new === '1');
  const [from, to] = periodRange(SL.period);
  const qs = `?from=${from}&to=${to}${SL.q ? '&q=' + encodeURIComponent(SL.q) : ''}${SL.debt ? '&debt=1' : ''}`;
  const rows = await Api.get('/sales' + (SL.debt ? `?debt=1${SL.q ? '&q=' + encodeURIComponent(SL.q) : ''}` : qs));
  const done = rows.filter(r => r.status === 'done');
  const total = done.reduce((s, r) => s + r.total, 0);
  const debt = done.reduce((s, r) => s + r.debt, 0);
  let html = pageHead(isAdmin() ? 'Чеки' : 'Мои чеки', `<a class="btn primary" href="#/sell">${icons.plus}Новая продажа</a>`);
  html += `<div class="toolbar">
    ${segHtml('sp', [['today', 'Сегодня'], ['yesterday', 'Вчера'], ['7', '7 дней'], ['month', 'Месяц']], SL.debt ? '' : SL.period, 'setSalesPeriod')}
    <button class="chip ${SL.debt ? 'on' : ''}" onclick="SL.debt=!SL.debt;router()">${icons.clock}С долгом</button>
    <label class="search grow">${icons.search}<input type="search" placeholder="Номер, имя или телефон" value="${esc(SL.q)}" oninput="salesSearch(this.value)"></label>
  </div>`;
  html += `<div class="sum-strip">
    <div><span>${SL.debt ? 'Чеков с долгом' : 'Продано'}</span><b class="money">${SL.debt ? done.length : money(total) + ' сом'}</b></div>
    <div><span>Чеков</span><b>${done.length}</b></div>
    <div><span>Средний чек</span><b>${done.length ? money(total / done.length) : 0}</b></div>
    <div class="${debt ? 'warn' : ''}"><span>Не оплачено</span><b>${money(debt)}</b></div>
  </div>`;
  if (!rows.length) html += emptyState(icons.receipt, SL.debt ? 'Долгов нет' : 'Чеков за этот период нет', SL.debt ? 'Все покупатели рассчитались.' : 'Продажи появятся здесь сразу после оформления.', `<a class="btn primary" href="#/sell">Перейти к продаже</a>`);
  else {
    let last = '';
    html += `<div class="list">`;
    for (const r of rows) {
      const day = r.local_at.slice(0, 10);
      if (day !== last) { last = day; html += `<h3 class="list-day">${dayLabel(day)}</h3>`; }
      html += `<a class="row ${r.status === 'cancelled' ? 'muted' : ''}" href="#/sales/${r.id}">
        <span class="row-time">${timeOf(r.local_at)}</span>
        <span class="row-main"><b>№${r.id}${r.buyer ? ' · ' + esc(r.buyer) : ''}</b><small>${r.lines} ${plural(r.lines, 'позиция', 'позиции', 'позиций')}${isAdmin() && r.seller_name ? ', ' + esc(r.seller_name) : ''}${r.status === 'cancelled' ? ', отменён' : ''}</small></span>
        ${r.debt > 0 ? `<span class="tag warn">долг ${money(r.debt)}</span>` : ''}
        <b class="row-sum">${money(r.total)}</b></a>`;
    }
    html += `</div>`;
  }
  $('#app').innerHTML = html;
});
function setSalesPeriod(p) { SL.period = p; SL.debt = false; router(); }
const salesSearch = debounce((v) => { SL.q = v.trim(); router().then(() => { const i = document.querySelector('.toolbar input[type=search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 350);

/* ---------- документ продажи ---------- */
let SALE = null;
async function saleView(id, isNew) {
  const s = await Api.get('/sales/' + id);
  SALE = s;
  const S = State.settings;
  const buyer = s.contact_name || s.customer_name || 'Розничный покупатель';
  const phone = s.contact_phone || s.customer_phone || '';
  let html = isNew
    ? `<div class="done-banner"><span class="done-check">${icons.check}</span><div><b>Продажа №${s.id} оформлена</b><span>${money(s.total)} сом${s.debt ? `, в долг ${money(s.debt)} сом` : ', оплачено полностью'}</span></div><a class="btn light" href="#/sell">${icons.plus}Новая продажа</a></div>`
    : `<a class="back" href="#/sales">${icons.back}Чеки</a>`;

  html += `<div class="doc-layout"><div>
    <div class="share">
      <button class="share-b wa" onclick="shareSale()">${icons.wa}<span>WhatsApp</span></button>
      <button class="share-b" onclick="printSaleA4()">${icons.print}<span>Накладная A4</span></button>
      <button class="share-b" onclick="printReceipt(58)">${icons.receipt}<span>Чек 58 мм</span></button>
      <button class="share-b" onclick="printReceipt(80)">${icons.receipt}<span>Чек 80 мм</span></button>
    </div>
    <article class="paper ${s.status === 'cancelled' ? 'void' : ''}">
      <div class="paper-top"><div><b class="paper-co">${esc(S.company_name)}</b><small>${esc(S.company_sub || '')}</small></div>
        <div class="paper-no">Накладная №${s.id}<small>${dt(s.local_at)}</small></div></div>
      <dl class="paper-meta"><div><dt>Покупатель</dt><dd>${s.contact_id ? `<a href="#/contact/${s.contact_id}">${esc(buyer)}</a>` : esc(buyer)}${phone ? `<small>${esc(phone)}</small>` : ''}</dd></div>
        <div><dt>Продавец</dt><dd>${esc(s.seller_name || '—')}</dd></div></dl>
      ${docTable(s)}
      <p class="paper-words">${esc(cap(rubWords(s.total)))} сом 00 тыйын</p>
      ${s.status === 'cancelled' ? `<div class="void-mark">Отменён</div>` : ''}
    </article></div>
    <aside class="doc-side">
      <section class="card"><h2>Оплата</h2>
        <div class="pay-total"><span>Сумма</span><b class="money">${money(s.total)}</b></div>
        ${s.payments.map(p => `<div class="pay-row ${p.type === 'out' ? 'neg' : ''}"><span>${esc(p.category)}<small>${esc(p.account_name)}, ${dt(p.local_at)}</small></span><b>${p.type === 'out' ? '−' : ''}${money(p.amount)}</b></div>`).join('') || `<p class="hint">Оплат пока не было.</p>`}
        ${s.status === 'done' ? `<div class="pay-total ${s.debt ? 'warn' : 'good'}"><span>${s.debt ? 'Долг' : 'Оплачено полностью'}</span><b>${s.debt ? money(s.debt) : icons.check}</b></div>` : ''}
        ${s.debt > 0 ? `<button class="btn primary block" onclick="payDebt(${s.id}, ${s.debt})">${icons.in}Принять оплату</button>` : ''}
      </section>
      ${isAdmin() && s.cost_total !== undefined ? `<section class="card owner"><h2>Для владельца</h2>
        <div class="kv"><span>Себестоимость</span><b>${money(s.cost_total)}</b></div>
        <div class="kv"><span>Валовая прибыль</span><b>${money(s.total - s.cost_total)}</b></div>
        <div class="kv"><span>Маржа</span><b>${s.total ? pct((s.total - s.cost_total) / s.total * 100) : '—'}</b></div>
        ${s.discount ? `<div class="kv"><span>Скидка</span><b>${money(s.discount)}</b></div>` : ''}</section>` : ''}
      ${isAdmin() && s.status === 'done' ? `<button class="btn ghost-danger block" onclick="cancelSale(${s.id})">Отменить продажу</button>` : ''}
    </aside></div>`;
  $('#app').innerHTML = html;
}
function docTable(s) {
  const rows = s.items.map((it, i) => `<tr><td class="c">${i + 1}</td><td>${esc(it.name)}${it.variant ? `<small>${esc(it.variant)}</small>` : ''}<small class="m">${qtyFmt(it.qty)} ${esc(it.unit)} × ${money(it.price)}</small></td>
    <td class="c x">${esc(it.unit)}</td><td class="r x">${qtyFmt(it.qty)}</td><td class="r x">${money(it.price)}</td><td class="r b">${money(it.price * it.qty)}</td></tr>`).join('');
  const f = (l, v, cls = '') => `<tr class="${cls}"><td></td><td class="r">${l}</td><td class="x"></td><td class="x"></td><td class="x"></td><td class="r b">${v}</td></tr>`;
  return `<table class="doc-t"><thead><tr><th class="c">№</th><th>Наименование</th><th class="c x">Ед.</th><th class="r x">Кол-во</th><th class="r x">Цена</th><th class="r">Сумма</th></tr></thead>
    <tbody>${rows}</tbody><tfoot>${s.discount ? f('Сумма', money(s.subtotal), 'sub') + f('Скидка', '−' + money(s.discount), 'sub') : ''}${f('Итого, сом', money(s.total), 'tot')}</tfoot></table>`;
}
function payDebt(id, debt) {
  openSheet({
    title: 'Оплата долга по чеку №' + id,
    body: `${field('Сумма', numInput('pdAmt', debt, 'autofocus'), `Долг: ${money(debt)} сом`)}${field('Куда', `<select id="pdAcc">${accountOptions(State.accounts[0]?.id)}</select>`)}`,
    footer: `<button class="btn" onclick="closeSheet()">Отмена</button><button class="btn primary" id="pdOk">Принять</button>`,
  });
  $('#pdOk').onclick = async () => {
    const amount = readNum('pdAmt');
    if (!(amount > 0)) { toast('Укажите сумму', 'err'); return; }
    try { await Api.post(`/sales/${id}/pay`, { amount, account_id: Number($('#pdAcc').value) }); await refreshAccounts(); toast('Оплата принята'); closeSheet(); router(); }
    catch (e) { toast(errText(e, 'Не удалось принять оплату'), 'err'); }
  };
}
function cancelSale(id) {
  confirmSheet(`Отменить продажу №${id}?`, 'Товар вернётся на склад, полученные деньги будут записаны в кассу как возврат покупателю. Чек останется в истории с пометкой «отменён».', 'Отменить продажу', async () => {
    try { await Api.post(`/sales/${id}/cancel`); await refreshAccounts(); closeSheet(); toast('Продажа отменена'); router(); }
    catch (e) { toast(errText(e, 'Не удалось отменить'), 'err'); }
  });
}

/* ---------- сумма прописью ---------- */
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
function rubWords(n) {
  n = Math.floor(Math.abs(n || 0)); if (!n) return 'ноль';
  const o = [['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'], ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']];
  const t10 = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  const t = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const h = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
  const g = [[null, 0], [['тысяча', 'тысячи', 'тысяч'], 1], [['миллион', 'миллиона', 'миллионов'], 0], [['миллиард', 'миллиарда', 'миллиардов'], 0]];
  const out = [];
  for (let i = 0; n > 0 && i < g.length; i++, n = Math.floor(n / 1000)) {
    const x = n % 1000; if (!x) continue;
    const w = [h[Math.floor(x / 100)]]; const y = x % 100;
    if (y >= 10 && y < 20) w.push(t10[y - 10]); else { w.push(t[Math.floor(y / 10)]); w.push(o[g[i][1]][y % 10]); }
    if (g[i][0]) w.push(plural(x, ...g[i][0]));
    out.unshift(w.filter(Boolean).join(' '));
  }
  return out.join(' ');
}

/* ---------- печать ---------- */
function printDoc(html, page) {
  const root = $('#print');
  root.innerHTML = html;
  let st = $('#pageStyle');
  if (!st) { st = document.createElement('style'); st.id = 'pageStyle'; document.head.appendChild(st); }
  if (page === 'A4') st.textContent = '@page{size:A4;margin:14mm 12mm}';
  else {
    root.style.cssText = 'display:block;position:fixed;left:-10000px;top:0';
    const h = Math.ceil(root.firstElementChild.getBoundingClientRect().height * 25.4 / 96) + 8;
    root.style.cssText = '';
    st.textContent = `@page{size:${page}mm ${Math.max(60, h)}mm;margin:2mm}`;
  }
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 60);
}
function printSaleA4() {
  const s = SALE, S = State.settings;
  const sup = [S.company_name, S.company_inn && 'ИНН ' + S.company_inn, S.company_address, S.company_phone].filter(Boolean).map(esc).join(', ');
  const buyer = [s.contact_name || s.customer_name || 'Розничный покупатель', s.contact_phone || s.customer_phone].filter(Boolean).map(esc).join(', ');
  const units = s.items.reduce((a, i) => a + i.qty, 0);
  printDoc(`<div class="pr-a4"><div class="pr-head"><div><b>${esc(S.company_name)}</b><small>${esc(S.company_sub || '')}</small></div><div class="pr-title">НАКЛАДНАЯ № ${s.id}<small>от ${dt(s.local_at, false)}</small></div></div>
    <table class="pr-parties"><tr><td>Поставщик:</td><td><b>${sup}</b></td></tr><tr><td>Покупатель:</td><td><b>${buyer}</b></td></tr>
    <tr><td>Оплата:</td><td>${s.debt ? `оплачено ${money(s.paid)} сом, долг ${money(s.debt)} сом` : 'оплачено полностью'}</td></tr></table>
    ${docTable(s)}
    <p class="pr-words">Всего наименований ${s.items.length}, единиц ${qtyFmt(units)}, на сумму ${money(s.total)} сом.<br><b>${esc(cap(rubWords(s.total)))} сом 00 тыйын</b></p>
    <div class="pr-signs"><span>Отпустил ____________________</span><span>Получил ____________________</span></div></div>`, 'A4');
}
function printReceipt(mm) {
  const s = SALE, S = State.settings;
  const lines = s.items.map(it => `<div class="rc-i"><div>${esc(it.name)}${it.variant ? ' (' + esc(it.variant) + ')' : ''}</div><div class="rc-r"><span>${qtyFmt(it.qty)} ${esc(it.unit)} × ${money(it.price)}</span><b>${money(it.price * it.qty)}</b></div></div>`).join('');
  printDoc(`<div class="rc w${mm}"><div class="rc-co">${esc(S.company_name)}</div>${S.company_address ? `<div class="rc-c">${esc(S.company_address)}</div>` : ''}${S.company_phone ? `<div class="rc-c">${esc(S.company_phone)}</div>` : ''}
    <div class="rc-hr"></div><div class="rc-r"><span>Чек №${s.id}</span><span>${dt(s.local_at)}</span></div>${s.contact_name || s.customer_name ? `<div class="rc-r"><span>Покупатель</span><span>${esc(s.contact_name || s.customer_name)}</span></div>` : ''}
    <div class="rc-hr"></div>${lines}<div class="rc-hr"></div>
    ${s.discount ? `<div class="rc-r"><span>Сумма</span><span>${money(s.subtotal)}</span></div><div class="rc-r"><span>Скидка</span><span>−${money(s.discount)}</span></div>` : ''}
    <div class="rc-r rc-tot"><span>ИТОГО</span><span>${money(s.total)} сом</span></div>
    ${s.payments.filter(p => p.type === 'in').map(p => `<div class="rc-r"><span>${esc(p.account_name)}</span><span>${money(p.amount)}</span></div>`).join('')}
    ${s.debt ? `<div class="rc-r"><span>Долг</span><span>${money(s.debt)}</span></div>` : ''}
    <div class="rc-hr"></div><div class="rc-c">${esc(S.receipt_footer || 'Спасибо за покупку!')}</div></div>`, mm);
}

/* ---------- WhatsApp: накладная картинкой ---------- */
async function shareSale() {
  const s = SALE, S = State.settings;
  const text = [`*${S.company_name}* — накладная №${s.id}, ${dt(s.local_at)}`, '',
    ...s.items.map((it, i) => `${i + 1}. ${it.name}${it.variant ? ' (' + it.variant + ')' : ''} — ${qtyFmt(it.qty)} ${it.unit} × ${money(it.price)} = ${money(it.price * it.qty)}`),
    '', s.discount ? `Скидка: ${money(s.discount)} сом` : '', `*Итого: ${money(s.total)} сом*`, s.debt ? `Долг: ${money(s.debt)} сом` : '', S.company_phone || ''].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
  try {
    const blob = await saleImage(s);
    const file = new File([blob], `nakladnaya-${s.id}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: `Накладная №${s.id}` }); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) { if (e && e.name === 'AbortError') return; }
  let d = String(s.contact_phone || s.customer_phone || '').replace(/\D/g, '');
  if (d.length === 10 && d[0] === '0') d = '996' + d.slice(1); else if (d.length === 9) d = '996' + d;
  window.open(`https://wa.me/${d}?text=${encodeURIComponent(text)}`, '_blank');
}
function saleImage(s) {
  const S = State.settings, W = 720, P = 44, k = 2;
  const c = document.createElement('canvas'), x = c.getContext('2d');
  const F = (w, z, fam = 'Onest') => `${w} ${z}px ${fam}, "Segoe UI", Arial, sans-serif`;
  const wrap = (t, mw, f) => { x.font = f; const out = []; let line = ''; for (const w of String(t).split(' ')) { const tt = line ? line + ' ' + w : w; if (x.measureText(tt).width > mw && line) { out.push(line); line = w; } else line = tt; } if (line) out.push(line); return out; };
  const items = s.items.map(it => ({ it, l: wrap(it.name + (it.variant ? ` (${it.variant})` : ''), W - P * 2 - 150, F(600, 22)) }));
  const H = 260 + items.reduce((a, r) => a + r.l.length * 29 + 36, 0) + (s.discount ? 70 : 0) + (s.debt ? 40 : 0) + 170;
  c.width = W * k; c.height = H * k; x.scale(k, k);
  x.fillStyle = '#fbfcfa'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#10221e'; x.fillRect(0, 0, W, 132);
  x.fillStyle = '#b98a2e'; x.fillRect(0, 132, W, 5);
  x.fillStyle = '#fff'; x.font = F(700, 30, 'Unbounded'); x.fillText(S.company_name || 'UNICA', P, 62);
  x.font = F(500, 17); x.fillStyle = '#b9c7c1';
  let sub = S.company_phone || S.company_sub || ''; while (sub && x.measureText(sub).width > W - P * 2 - 230) sub = sub.slice(0, -2) + '…';
  x.fillText(sub, P, 96);
  x.textAlign = 'right'; x.fillStyle = '#fff'; x.font = F(700, 24); x.fillText('Накладная №' + s.id, W - P, 62);
  x.font = F(500, 17); x.fillStyle = '#b9c7c1'; x.fillText(dt(s.local_at), W - P, 96); x.textAlign = 'left';
  let y = 182;
  x.fillStyle = '#5e6b67'; x.font = F(600, 17); x.fillText('Покупатель: ' + (s.contact_name || s.customer_name || 'розничный'), P, y); y += 42;
  x.strokeStyle = '#dfe5e1'; x.lineWidth = 2;
  for (const { it, l } of items) {
    x.beginPath(); x.moveTo(P, y - 24); x.lineTo(W - P, y - 24); x.stroke();
    x.fillStyle = '#14201d'; x.font = F(600, 22); l.forEach((ln, j) => x.fillText(ln, P, y + 4 + j * 29));
    x.fillStyle = '#5e6b67'; x.font = F(500, 17); x.fillText(`${qtyFmt(it.qty)} ${it.unit} × ${money(it.price)}`, P, y + 4 + l.length * 29);
    x.textAlign = 'right'; x.fillStyle = '#14201d'; x.font = F(700, 22); x.fillText(money(it.price * it.qty), W - P, y + 4); x.textAlign = 'left';
    y += l.length * 29 + 36;
  }
  x.beginPath(); x.moveTo(P, y - 24); x.lineTo(W - P, y - 24); x.stroke();
  const kv = (a, b, col = '#5e6b67') => { x.fillStyle = col; x.font = F(600, 18); x.fillText(a, P, y); x.textAlign = 'right'; x.fillText(b, W - P, y); x.textAlign = 'left'; y += 32; };
  y += 6;
  if (s.discount) { kv('Сумма', money(s.subtotal)); kv('Скидка', '−' + money(s.discount)); }
  y += 4;
  x.fillStyle = '#10221e'; rr(x, P - 14, y - 6, W - P * 2 + 28, 74, 16); x.fill();
  x.fillStyle = '#fff'; x.font = F(600, 22); x.fillText('Итого', P + 6, y + 40);
  x.textAlign = 'right'; x.fillStyle = '#e6c372'; x.font = F(700, 28, 'Unbounded'); x.fillText(money(s.total) + ' сом', W - P - 6, y + 42); x.textAlign = 'left';
  y += 112;
  if (s.debt) kv('Долг', money(s.debt) + ' сом', '#b4581f');
  x.fillStyle = '#5e6b67'; x.font = F(500, 17); x.fillText(S.receipt_footer || 'Спасибо за покупку!', P, y);
  return new Promise(r => c.toBlob(r, 'image/png'));
}
function rr(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
