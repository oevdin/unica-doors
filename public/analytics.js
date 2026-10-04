/* ============================================================
   UNICA Doors — аналитика продаж и прибыли (только администратор)
   Цвета графика проверены на различимость (в т.ч. при дальтонизме):
   себестоимость #3e74a8, прибыль #b5762f.
   ============================================================ */

const CH = { cost: '#3e74a8', profit: '#b5762f', bar: '#b5762f' };
let AN = { period: '30', from: '', to: '' };

async function viewAnalytics() {
  if (!Auth.isAdmin()) { navigate('#/'); return; }
  const app = document.getElementById('app');
  const periods = [['today', 'Сегодня'], ['7', '7 дней'], ['30', '30 дней'], ['month', 'Этот месяц'], ['custom', 'Период']];
  if (AN.period !== 'custom') [AN.from, AN.to] = periodRange(AN.period);
  app.innerHTML = `<div class="page-head"><h1 class="page-title">Аналитика</h1></div>
    <div class="an-filters">
      <div class="seg wide">${periods.map(([k, v]) => `<button class="${AN.period === k ? 'active' : ''}" onclick="setAnPeriod('${k}')">${v}</button>`).join('')}</div>
      ${AN.period === 'custom' ? `<div class="an-dates"><input type="date" value="${AN.from}" onchange="AN.from=this.value; loadAnalytics()"><span>—</span><input type="date" value="${AN.to}" onchange="AN.to=this.value; loadAnalytics()"></div>` : ''}
    </div>
    <div id="anRoot"><div class="empty-state">Считаю…</div></div>`;
  await loadAnalytics();
}
function setAnPeriod(p) { AN.period = p; if (p === 'custom' && !AN.from) [AN.from, AN.to] = periodRange('30'); viewAnalytics(); }

async function loadAnalytics() {
  const root = document.getElementById('anRoot');
  if (!AN.from || !AN.to) return;
  const d = await Api.get(`/sales/stats/summary?from=${AN.from}&to=${AN.to}`);
  if (!root) return;
  const k = d.kpi;
  if (!k.sales && !d.debts.length) {
    root.innerHTML = `<div class="an-empty">${chartIcon()}<b>Продаж за этот период нет</b>
      <span>Аналитика появится после первых продаж. Чтобы посмотреть, как всё выглядит, можно заполнить приложение демо-продажами (потом удаляются одной кнопкой).</span>
      <button class="btn primary" onclick="fillDemoSales()">Заполнить демо-продажами</button></div>`;
    return;
  }
  const debtSum = d.debts.reduce((a, r) => a + r.total, 0);
  let html = `<div class="kpis">
    ${kpiTile('Выручка', fmtPrice(k.revenue) + ' сом', `${k.sales} ${pluralSales(k.sales)}`, 'accent')}
    ${kpiTile('Прибыль', fmtPrice(k.profit) + ' сом', `маржа ${String(k.margin).replace('.', ',')}%`, 'profit')}
    ${kpiTile('Средний чек', fmtPrice(k.avg) + ' сом', `${k.units} ед. товара`)}
    ${kpiTile('Скидки', fmtPrice(k.discount) + ' сом', k.revenue ? `${Math.round(k.discount / (k.revenue + k.discount) * 1000) / 10}% от суммы`.replace('.', ',') : '')}
    ${kpiTile('Себестоимость', fmtPrice(k.cost) + ' сом', 'закупка проданного')}
    ${kpiTile('Долги', fmtPrice(debtSum) + ' сом', `${d.debts.length} не оплачено`, debtSum ? 'warn' : '')}
  </div>`;
  if (d.no_cost_lines) html += `<p class="co-warn">${warnIcon()} У ${d.no_cost_lines} проданных позиций не указана себестоимость — по ним прибыль завышена. Заполните «Себестоимость» в товарах.</p>`;

  html += `<section class="an-card"><div class="an-card-head"><h2>Выручка и прибыль по дням</h2>
      <div class="legend"><span><i style="background:${CH.cost}"></i>Себестоимость</span><span><i style="background:${CH.profit}"></i>Прибыль</span></div></div>
      <div class="an-chart" id="chDays"></div>
      <details class="an-table-toggle"><summary>Таблица</summary>${daysTable(d.days)}</details></section>`;

  html += `<div class="an-two">
    <section class="an-card"><div class="an-card-head"><h2>Топ товаров</h2><span class="muted">по выручке</span></div>${rankList(d.products, true)}</section>
    <section class="an-card"><div class="an-card-head"><h2>По разделам</h2><span class="muted">выручка · прибыль</span></div>${rankList(d.categories, false)}</section>
  </div>`;

  html += `<div class="an-two">
    <section class="an-card"><div class="an-card-head"><h2>Часы продаж</h2><span class="muted">кол-во продаж</span></div><div class="an-chart small" id="chHours"></div></section>
    <section class="an-card"><div class="an-card-head"><h2>Оплата и продавцы</h2></div>${paymentsBlock(d.payments, k.revenue)}${sellersBlock(d.sellers)}</section>
  </div>`;

  if (d.debts.length) {
    html += `<section class="an-card"><div class="an-card-head"><h2>Долги покупателей</h2><span class="muted">${fmtPrice(debtSum)} сом</span></div><div class="debt-list">` +
      d.debts.map(r => `<div class="debt-row"><a href="#/sales/${r.id}"><b>№${r.id} · ${esc(r.customer_name || r.contractor_name || 'Без имени')}</b><small>${fmtLocal(r.local_at)}${r.customer_phone ? ' · ' + esc(r.customer_phone) : ''}</small></a>
        <span class="hr-sum">${fmtPrice(r.total)}</span><button class="btn small" onclick="markSalePaid(${r.id})">Погашен</button></div>`).join('') + `</div></section>`;
  }
  root.innerHTML = html;
  drawDaysChart(document.getElementById('chDays'), d.days);
  drawHoursChart(document.getElementById('chHours'), d.hours);
}

function kpiTile(label, value, sub, tone) {
  return `<div class="kpi ${tone || ''}"><span>${label}</span><b>${value}</b><em>${sub || ''}</em></div>`;
}
function daysTable(days) {
  return `<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>День</th><th class="r">Продаж</th><th class="r">Выручка</th><th class="r">Себест.</th><th class="r">Прибыль</th></tr></thead><tbody>` +
    days.map(r => `<tr><td>${fmtDayShort(r.day)}</td><td class="r">${r.sales}</td><td class="r">${fmtPrice(r.revenue)}</td><td class="r">${fmtPrice(r.cost)}</td><td class="r b">${fmtPrice(r.profit)}</td></tr>`).join('') +
    `</tbody></table></div>`;
}
function rankList(rows, withQty) {
  if (!rows.length) return `<div class="muted" style="padding:10px 0;">Нет данных</div>`;
  const max = Math.max(...rows.map(r => r.revenue), 1);
  return `<div class="rank">` + rows.map((r, i) => `<div class="rank-row">
      <div class="rank-top"><span class="rank-n">${i + 1}</span><span class="rank-name">${esc(r.name)}</span><b>${fmtPrice(r.revenue)}</b></div>
      <div class="rank-bar"><i style="width:${Math.max(2, r.revenue / max * 100)}%"></i><i class="p" style="width:${Math.max(0, r.profit / max * 100)}%"></i></div>
      <div class="rank-sub">${withQty ? `${r.qty} ед. · ` : ''}прибыль ${fmtPrice(r.profit)} сом${r.revenue ? ` · ${Math.round(r.profit / r.revenue * 100)}%` : ''}</div>
    </div>`).join('') + `</div>`;
}
function paymentsBlock(rows, total) {
  const get = (k) => rows.find(r => r.payment === k) || { sales: 0, revenue: 0 };
  return `<div class="pay-split">` + ['cash', 'transfer', 'debt'].map(k => {
    const r = get(k);
    return `<div class="ps"><span>${payIcon(k)}${PAY_LABELS[k]}</span><b>${fmtPrice(r.revenue)}</b><em>${total ? Math.round(r.revenue / total * 100) : 0}% · ${r.sales}</em></div>`;
  }).join('') + `</div>`;
}
function sellersBlock(rows) {
  if (!rows.length) return '';
  return `<div class="sellers">` + rows.map(r => `<div class="seller"><span class="seller-ava">${esc((r.name || '?').trim()[0] || '?')}</span>
    <span class="seller-name">${esc(r.name)}<small>${r.sales} ${pluralSales(r.sales)}</small></span>
    <span class="seller-num"><b>${fmtPrice(r.revenue)}</b><small>прибыль ${fmtPrice(r.profit)}</small></span></div>`).join('') + `</div>`;
}

/* ---- графики: SVG, без библиотек; подсказка при наведении/касании ---- */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
function shortNum(v) {
  if (v >= 1e6) return (Math.round(v / 1e5) / 10 + 'м').replace('.', ',');
  if (v >= 1e3) return (Math.round(v / 100) / 10 + 'к').replace('.', ',');
  return String(v);
}
function fillDays(days) {
  // показываем каждый день периода, даже без продаж
  const map = Object.fromEntries(days.map(d => [d.day, d]));
  const out = [];
  let cur = new Date(AN.from + 'T00:00:00');
  const end = new Date(AN.to + 'T00:00:00');
  while (cur <= end && out.length < 400) {
    const k = ymd(cur);
    out.push(map[k] || { day: k, sales: 0, revenue: 0, cost: 0, profit: 0 });
    cur = addDays(cur, 1);
  }
  return out;
}

function drawDaysChart(el, raw) {
  if (!el) return;
  const days = fillDays(raw);
  const W = el.clientWidth || 600, H = 240, L = 44, R = 8, T = 12, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const max = niceMax(Math.max(...days.map(d => d.revenue), 1));
  const n = days.length, slot = iw / n, bw = Math.max(3, Math.min(28, slot * 0.66));
  const y = (v) => T + ih - (v / max) * ih;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = max * i / 4, yy = y(v);
    g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="grid"/><text x="${L - 6}" y="${yy + 4}" class="ax" text-anchor="end">${shortNum(v)}</text>`;
  }
  let bars = '', labels = '';
  const every = Math.ceil(n / Math.max(1, Math.floor(iw / 46)));
  days.forEach((d, i) => {
    const x = L + i * slot + (slot - bw) / 2;
    const cost = Math.max(0, Math.min(d.cost, d.revenue)), profit = Math.max(0, d.revenue - cost);
    const hc = (cost / max) * ih, hp = (profit / max) * ih;
    const r = Math.min(4, bw / 2);
    if (d.revenue > 0) {
      // нижний сегмент — себестоимость, верхний — прибыль (2px зазор между ними)
      if (hc > 0) bars += `<rect x="${x}" y="${T + ih - hc}" width="${bw}" height="${hc}" fill="${CH.cost}"/>`;
      if (hp > 2) bars += `<path d="M${x},${T + ih - hc - 2} v${-(hp - 2 - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${hp - 2 - r} z" fill="${CH.profit}"/>`;
    }
    bars += `<rect x="${L + i * slot}" y="${T}" width="${slot}" height="${ih}" fill="transparent" data-i="${i}" class="hit"/>`;
    if (i % every === 0) labels += `<text x="${x + bw / 2}" y="${H - 8}" class="ax" text-anchor="middle">${fmtDayShort(d.day)}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Выручка и прибыль по дням">${g}<line x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}" class="base"/>${bars}${labels}<rect class="hl" x="0" y="${T}" width="0" height="${ih}"/></svg><div class="tip" hidden></div>`;
  attachTip(el, (i) => {
    const d = days[i];
    return `<b>${fmtDayShort(d.day)}</b><div><i style="background:${CH.profit}"></i>Прибыль <b>${fmtPrice(d.profit)}</b></div><div><i style="background:${CH.cost}"></i>Себестоимость <b>${fmtPrice(d.cost)}</b></div><div class="tip-sep">Выручка <b>${fmtPrice(d.revenue)} сом</b> · ${d.sales} ${pluralSales(d.sales)}</div>`;
  }, slot, L);
}

function drawHoursChart(el, rows) {
  if (!el) return;
  const map = Object.fromEntries(rows.map(r => [r.hour, r]));
  const from = Math.min(8, ...rows.map(r => r.hour)), to = Math.max(19, ...rows.map(r => r.hour));
  const hrs = []; for (let h = from; h <= to; h++) hrs.push(map[h] || { hour: h, sales: 0, revenue: 0 });
  const W = el.clientWidth || 320, H = 170, L = 26, R = 6, T = 10, B = 24, iw = W - L - R, ih = H - T - B;
  const max = niceMax(Math.max(...hrs.map(h => h.sales), 1));
  const slot = iw / hrs.length, bw = Math.max(4, Math.min(22, slot * 0.6));
  let s = '';
  for (let i = 0; i <= 2; i++) { const v = max * i / 2, yy = T + ih - v / max * ih; s += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="grid"/><text x="${L - 5}" y="${yy + 4}" class="ax" text-anchor="end">${Math.round(v)}</text>`; }
  hrs.forEach((h, i) => {
    const x = L + i * slot + (slot - bw) / 2, hh = h.sales / max * ih, r = Math.min(4, bw / 2, hh);
    if (hh > 0) s += `<path d="M${x},${T + ih} v${-(hh - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${hh - r} z" fill="${CH.bar}"/>`;
    s += `<rect x="${L + i * slot}" y="${T}" width="${slot}" height="${ih}" fill="transparent" class="hit" data-i="${i}"/>`;
    if (h.hour % 2 === 0) s += `<text x="${x + bw / 2}" y="${H - 7}" class="ax" text-anchor="middle">${h.hour}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Продажи по часам">${s}<line x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}" class="base"/><rect class="hl" x="0" y="${T}" width="0" height="${ih}"/></svg><div class="tip" hidden></div>`;
  attachTip(el, (i) => `<b>${hrs[i].hour}:00–${hrs[i].hour + 1}:00</b><div>${hrs[i].sales} ${pluralSales(hrs[i].sales)} · ${fmtPrice(hrs[i].revenue)} сом</div>`, slot, L);
}

function attachTip(el, html, slot, L) {
  const tip = el.querySelector('.tip'), hl = el.querySelector('.hl'), svg = el.querySelector('svg');
  const show = (target, cx) => {
    const i = Number(target.getAttribute('data-i'));
    tip.innerHTML = html(i); tip.hidden = false;
    hl.setAttribute('x', L + i * slot); hl.setAttribute('width', slot);
    const box = el.getBoundingClientRect(), tw = tip.offsetWidth;
    let left = cx - box.left + 12; if (left + tw > box.width) left = cx - box.left - tw - 12;
    tip.style.left = Math.max(0, left) + 'px';
  };
  svg.addEventListener('pointermove', (e) => { const t = e.target.closest('.hit'); if (t) show(t, e.clientX); });
  svg.addEventListener('pointerdown', (e) => { const t = e.target.closest('.hit'); if (t) show(t, e.clientX); });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; hl.setAttribute('width', 0); });
}

/* ---- демо-продажи ---- */
async function fillDemoSales() {
  try {
    const r = await Api.post('/sales/demo/fill', {});
    showToast(`Добавлено ${r.created} демо-продаж за 30 дней`);
    if (currentRoute.name === 'analytics') viewAnalytics(); else router();
  } catch (e) { showToast('Не удалось заполнить', true); }
}
function confirmClearDemo() {
  renderModal(`<h3>Удалить демо-продажи?</h3><p style="color:var(--text-mute);font-size:14px;line-height:1.5;">Будут удалены только продажи, созданные кнопкой «Заполнить демо-продажами». Настоящие продажи не затрагиваются.</p>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Отмена</button><button class="btn danger" onclick="clearDemoSales()">Удалить</button></div>`);
}
async function clearDemoSales() {
  const r = await Api.del('/sales/demo/all');
  closeModal(); showToast(`Удалено демо-продаж: ${r.deleted}`); router();
}

/* ============================================================
   «ЕЩЁ» (#/more) и реквизиты (#/admin/company)
   ============================================================ */
function viewMore() {
  const app = document.getElementById('app');
  const item = (hash, icon, title, sub) => `<a class="more-row" href="${hash}">${icon}<span><b>${title}</b><small>${sub}</small></span><em>›</em></a>`;
  let html = `<div class="more-user"><span class="seller-ava big">${esc((Auth.user.name || '?')[0])}</span><span><b>${esc(Auth.user.name)}</b><small>${Auth.isAdmin() ? 'Администратор' : 'Продавец'} · ${esc(Auth.user.login)}</small></span></div>`;
  html += `<div class="more-list">
    ${item('#/catalog', homeIcon(), 'Каталог', 'Все разделы и товары с фото')}
    ${item('#/orders', listIcon(), 'Заявки', 'Заказы контрагентам и их статусы')}
    ${item('#/contractors', usersIcon(), 'Контрагенты', 'Оптовые покупатели и организации')}
  </div>`;
  if (Auth.isAdmin()) {
    html += `<div class="more-title">Администрирование</div><div class="more-list">
      ${item('#/admin/catalog', boxIcon(), 'Товары и цены', 'Разделы, цены, себестоимость, варианты')}
      ${item('#/admin/company', receiptIcon(), 'Реквизиты', 'Шапка накладной и чека')}
      ${item('#/admin/users', usersIcon(), 'Пользователи', 'Продавцы и их доступ')}
    </div>`;
  }
  html += `<div class="more-list">
    <button class="more-row" onclick="installHint()">${sellIcon()}<span><b>Установить на телефон</b><small>Иконка на главном экране, без адресной строки</small></span><em>›</em></button>
    <button class="more-row" onclick="openChangePasswordModal()">${lockIcon()}<span><b>Сменить пароль</b><small>Пароль для входа</small></span><em>›</em></button>
    <button class="more-row danger" onclick="Auth.logout()">${closeIcon()}<span><b>Выйти</b><small>Из аккаунта ${esc(Auth.user.login)}</small></span><em></em></button>
  </div>`;
  app.innerHTML = html;
}

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });
function installHint() {
  if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; return; }
  renderModal(`<h3>Установить на телефон</h3>
    <div class="install-steps">
      <div><b>Android (Chrome):</b> меню ⋮ справа вверху → «Добавить на главный экран» → «Установить».</div>
      <div><b>iPhone (Safari):</b> кнопка «Поделиться» внизу → «На экран „Домой“» → «Добавить».</div>
    </div>
    <div class="modal-actions"><button class="btn primary" onclick="closeModal()">Понятно</button></div>`);
}

async function renderAdminCompany() {
  const S = await loadSettings();
  const root = document.getElementById('adminTabRoot');
  const f = (id, label, ph, val) => `<div class="field"><label>${label}</label><input type="text" id="${id}" value="${esc(val || '')}" placeholder="${ph}"></div>`;
  root.innerHTML = `<div class="an-card" style="max-width:640px;">
    <div class="an-card-head"><h2>Реквизиты для накладной и чека</h2></div>
    ${f('sName', 'Название', 'UNICA Doors', S.company_name)}
    ${f('sSub', 'Подпись под названием', 'Двери и комплектующие', S.company_sub)}
    ${f('sInn', 'ИНН', '01234567890123', S.company_inn)}
    ${f('sAddr', 'Адрес / место на рынке', 'г. Бишкек, рынок «…», ряд 5, контейнер 12', S.company_address)}
    ${f('sPhone', 'Телефон / WhatsApp', '+996 700 000 000', S.company_phone)}
    ${f('sFooter', 'Текст внизу чека', 'Спасибо за покупку!', S.receipt_footer)}
    <button class="btn primary" onclick="saveCompany()">Сохранить</button>
  </div>
  <div class="an-card" style="max-width:640px;">
    <div class="an-card-head"><h2>Демо-продажи</h2></div>
    <p class="muted" style="margin:0 0 12px;line-height:1.5;">Чтобы посмотреть аналитику до начала работы, можно создать продажи-примеры за 30 дней. Перед запуском в работу удалите их.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;"><button class="btn" onclick="fillDemoSales()">Заполнить демо-продажами</button><button class="btn danger" onclick="confirmClearDemo()">Удалить демо-продажи</button></div>
  </div>`;
}
async function saveCompany() {
  const v = (id) => document.getElementById(id).value;
  try {
    SETTINGS = await Api.put('/settings', { company_name: v('sName') || 'UNICA Doors', company_sub: v('sSub'), company_inn: v('sInn'), company_address: v('sAddr'), company_phone: v('sPhone'), receipt_footer: v('sFooter') });
    showToast('Реквизиты сохранены');
  } catch (e) { showToast('Не удалось сохранить', true); }
}
