/* UNICA — отчёты владельца: прибыль, маржа, деньги, ABC, склад, долги.
   Цвета графиков проверены на различимость, в т.ч. при дальтонизме:
   себестоимость #2f6fb0 / ВП #b98a2e; приход #2f8f63 / расход #d0552f (расход дополнительно штрихуется). */
'use strict';

const RC = { cost: '#2f6fb0', gp: '#b98a2e', in: '#2f8f63', out: '#d0552f', bar: '#1e4d43' };
const RP = { period: '30', from: '', to: '' };
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

route('reports', async () => {
  if (RP.period !== 'custom') [RP.from, RP.to] = periodRange(RP.period);
  const d = await Api.get(`/reports/summary?from=${RP.from}&to=${RP.to}`);
  const k = d.kpi, pv = d.prev;
  let html = pageHead('Отчёты', '', `${dt(RP.from, false)} — ${dt(RP.to, false)}`);
  html += `<div class="toolbar">${segHtml('rp', [['today', 'Сегодня'], ['7', '7 дней'], ['30', '30 дней'], ['month', 'Этот месяц'], ['prevmonth', 'Прошлый месяц'], ['custom', 'Свой период']], RP.period, 'setRp')}
    ${RP.period === 'custom' ? `<div class="dates"><input type="date" value="${RP.from}" onchange="RP.from=this.value;router()" aria-label="С"><span>—</span><input type="date" value="${RP.to}" onchange="RP.to=this.value;router()" aria-label="По"></div>` : ''}</div>`;

  if (!k.sales && !k.opex) {
    html += emptyState(icons.chart, 'За этот период продаж нет', 'Отчёты строятся по продажам, приходам и расходам. Чтобы посмотреть, как всё выглядит, добавьте демо-данные — потом они удаляются одной кнопкой.',
      `<button class="btn primary" onclick="demoFill()">${icons.sparkle}Добавить демо-данные</button>`);
    $('#app').innerHTML = html; return;
  }

  // главный блок: от выручки к чистой прибыли
  const steps = [
    { l: 'Выручка', v: k.revenue, c: 'rev' }, { l: 'Себестоимость', v: -k.cost, c: 'minus' },
    { l: 'Валовая прибыль', v: k.gp, c: 'gp' }, { l: 'Расходы', v: -k.opex, c: 'minus' }, { l: 'Чистая прибыль', v: k.net, c: 'net' }];
  const maxV = Math.max(k.revenue, 1);
  html += `<section class="pnl">
    <div class="pnl-hero"><span>Чистая прибыль</span><b class="big-money ${k.net < 0 ? 'neg' : ''}">${k.net < 0 ? '−' : ''}${money(Math.abs(k.net))}<small>сом</small></b>${delta(k.net, pv.net)}
      <p>Рентабельность продаж ${pct(k.net_margin)}. ${k.withdrawn ? `Владелец забрал ${money(k.withdrawn)} сом — это не расход и в прибыль не входит.` : ''}</p></div>
    <div class="fall">${(() => { let base = 0; return steps.map((s) => {
      const abs = Math.abs(s.v), w = abs / maxV * 100;
      let left = 0;
      if (s.c === 'rev' || s.c === 'gp' || s.c === 'net') { left = 0; base = s.v; } else { left = (base - abs) / maxV * 100; base -= abs; }
      return `<div class="fall-r ${s.c}"><span class="fall-l">${s.l}</span><span class="fall-track"><i style="left:${Math.max(0, left)}%;width:${Math.max(0.6, w)}%"></i></span><b>${s.v < 0 ? '−' : ''}${money(abs)}</b></div>`;
    }).join(''); })()}</div>
  </section>`;

  html += `<div class="kpis">
    ${kpi('Выручка', money(k.revenue), delta(k.revenue, pv.revenue), `${k.sales} ${plural(k.sales, 'чек', 'чека', 'чеков')}`)}
    ${kpi('Валовая прибыль', money(k.gp), delta(k.gp, pv.gp), 'выручка минус себестоимость')}
    ${kpi('Маржа', pct(k.margin), deltaPts(k.margin, pv.margin), 'доля ВП в выручке')}
    ${kpi('Наценка', pct(k.markup), deltaPts(k.markup, pv.markup), 'ВП к себестоимости')}
    ${kpi('Средний чек', money(k.avg), delta(k.avg, pv.avg), `${qtyFmt(k.units)} ед. товара`)}
    ${kpi('Расходы', money(k.opex), delta(k.opex, pv.opex, true), 'аренда, зарплата и прочее')}
    ${kpi('Скидки', money(k.discount), '', k.revenue ? pct(k.discount / (k.revenue + k.discount) * 100) + ' от суммы чеков' : '')}
    ${kpi('Склад', money(d.stock.at_cost), '', `в рознице ${money(d.stock.at_price)}`)}
  </div>`;
  if (d.no_cost_lines) html += `<p class="note warn">${icons.alert}<span>У ${d.no_cost_lines} проданных позиций не указана себестоимость — по ним ВП завышена. Укажите себестоимость в карточке товара или оформите приход.</span></p>`;

  html += `<section class="card"><div class="card-h"><h2>Выручка по дням</h2><div class="legend"><span><i style="background:${RC.cost}"></i>Себестоимость</span><span><i style="background:${RC.gp}"></i>Валовая прибыль</span></div></div>
    <div class="chart" id="chDays"></div><details class="tbl"><summary>Показать таблицей</summary>${daysTable(d)}</details></section>`;

  html += `<div class="two">
    <section class="card"><div class="card-h"><h2>Деньги</h2></div>
      <div class="accs-mini">${d.accounts.map(a => `<div><span>${esc(a.name)}</span><b class="${a.balance < 0 ? 'neg' : ''}">${money(a.balance)}</b></div>`).join('')}</div>
      <div class="legend mt"><span><i style="background:${RC.in}"></i>Приход</span><span><i class="hatch"></i>Расход</span></div>
      <div class="chart sm" id="chCash"></div>
      ${flowTable(d.cashflow)}</section>
    <section class="card"><div class="card-h"><h2>Расходы по статьям</h2><b>${money(k.opex)}</b></div>${bars(d.expenses.map(e => ({ name: e.category, v: e.amount, sub: `${e.n} ${plural(e.n, 'операция', 'операции', 'операций')}` })), RC.out) || '<p class="hint">Расходов за период нет.</p>'}</section>
  </div>`;

  html += `<section class="card"><div class="card-h"><h2>ABC-анализ товаров</h2><span class="muted">A — дают 80% выручки, B — следующие 15%, C — остальные 5%</span></div>
    <div class="abc">${d.abc.map(a => `<div class="abc-${a.cls}"><b>${a.cls}</b><span>${a.count} ${plural(a.count, 'товар', 'товара', 'товаров')}</span><em>${money(a.revenue)} сом, ВП ${money(a.gp)}</em></div>`).join('')}</div>
    <div class="table-wrap"><table class="grid-t"><thead><tr><th>Товар</th><th class="c">Класс</th><th class="r">Продано</th><th class="r">Выручка</th><th class="r hide-s">ВП</th><th class="r">Маржа</th></tr></thead>
    <tbody>${d.products.slice(0, 20).map(p => `<tr><td>${esc(p.name)}</td><td class="c"><span class="cls cls-${p.abc}">${p.abc}</span></td><td class="r">${qtyFmt(p.qty)} ${esc(p.unit)}</td>
      <td class="r b">${money(p.revenue)}</td><td class="r hide-s">${money(p.gp)}</td><td class="r ${p.revenue && p.gp / p.revenue < 0.2 ? 'bad' : ''}">${p.revenue ? pct(p.gp / p.revenue * 100, 0) : '—'}</td></tr>`).join('')}</tbody></table></div></section>`;

  html += `<div class="two">
    <section class="card"><div class="card-h"><h2>По разделам</h2><div class="legend"><span><i style="background:#c9d6d0"></i>Выручка</span><span><i style="background:${RC.gp}"></i>ВП</span></div></div>${catBars(d.categories)}</section>
    <section class="card"><div class="card-h"><h2>Продавцы</h2></div>${d.sellers.map(s => `<div class="seller"><span class="ava">${esc(s.name[0])}</span><span class="row-main"><b>${esc(s.name)}</b><small>${s.sales} ${plural(s.sales, 'чек', 'чека', 'чеков')}, средний ${money(s.revenue / s.sales)}</small></span>
      <span class="r"><b>${money(s.revenue)}</b><small>ВП ${money(s.gp)}</small></span></div>`).join('')}</section>
  </div>`;

  html += `<div class="two">
    <section class="card"><div class="card-h"><h2>Когда покупают</h2><span class="muted">чеков по часам</span></div><div class="chart sm" id="chHours"></div>
      <div class="wd">${[1, 2, 3, 4, 5, 6, 0].map(i => { const r = d.weekdays.find(w => w.wd === i); const mx = Math.max(1, ...d.weekdays.map(w => w.sales)); return `<div><i style="height:${r ? Math.max(6, r.sales / mx * 100) : 2}%"></i><span>${WD[i]}</span></div>`; }).join('')}</div></section>
    <section class="card"><div class="card-h"><h2>Долги</h2></div>
      <div class="debts"><div class="${d.receivables.length ? 'warn' : ''}"><span>Нам должны клиенты</span><b>${money(d.receivables.reduce((s, r) => s + r.debt, 0))}</b></div>
        <div><span>Мы должны поставщикам</span><b>${money(d.payables.reduce((s, r) => s + r.debt, 0))}</b></div></div>
      <div class="list">${d.receivables.slice(0, 6).map(r => `<a class="row" href="#/sales/${r.id}"><span class="row-main"><b>${esc(r.name)}</b><small>чек №${r.id}, ${dt(r.local_at, false)}</small></span><b class="row-sum warn-t">${money(r.debt)}</b></a>`).join('')}
        ${d.payables.slice(0, 4).map(r => `<a class="row" href="#/purchase/${r.id}"><span class="row-main"><b>${esc(r.name)}</b><small>приход №${r.id}, наш долг</small></span><b class="row-sum">${money(r.debt)}</b></a>`).join('')}</div></section>
  </div>`;

  html += `<section class="card"><div class="card-h"><h2>Отчёт о прибылях и убытках</h2><button class="btn sm" onclick="printPnl()">${icons.print}Печать</button></div>${pnlTable(d)}</section>`;
  $('#app').innerHTML = html;
  RDATA = d;
  drawDays($('#chDays'), d); drawCash($('#chCash'), d); drawHours($('#chHours'), d.hours);
});
let RDATA = null;
function setRp(p) { RP.period = p; if (p === 'custom' && !RP.from) [RP.from, RP.to] = periodRange('30'); router(); }

function kpi(label, value, dl, sub) { return `<div class="kpi"><span>${label}</span><b>${value}</b><div class="kpi-f">${dl || ''}<em>${sub || ''}</em></div></div>`; }
function delta(cur, prev, inverse) {
  if (!prev) return '';
  const ch = (cur - prev) / Math.abs(prev) * 100;
  const good = inverse ? ch < 0 : ch > 0;
  return `<span class="dl ${Math.abs(ch) < 0.5 ? '' : good ? 'up' : 'down'}" title="к прошлому периоду">${ch > 0 ? '▲' : ch < 0 ? '▼' : ''} ${pct(Math.abs(ch), 0)}</span>`;
}
function deltaPts(cur, prev) { if (!prev) return ''; const ch = cur - prev; return `<span class="dl ${Math.abs(ch) < 0.1 ? '' : ch > 0 ? 'up' : 'down'}" title="к прошлому периоду">${ch > 0 ? '▲' : ch < 0 ? '▼' : ''} ${(Math.round(Math.abs(ch) * 10) / 10).toLocaleString('ru-RU')} п.</span>`; }
function bars(rows, color) {
  if (!rows.length) return '';
  const mx = Math.max(...rows.map(r => r.v), 1);
  return `<div class="hbars">${rows.map(r => `<div class="hb"><div class="hb-t"><span>${esc(r.name)}</span><b>${money(r.v)}</b></div><div class="hb-track"><i style="width:${Math.max(1, r.v / mx * 100)}%;background:${color}"></i></div>${r.sub ? `<small>${r.sub}</small>` : ''}</div>`).join('')}</div>`;
}
function catBars(rows) {
  const mx = Math.max(...rows.map(r => r.revenue), 1);
  return `<div class="hbars">${rows.map(r => `<div class="hb"><div class="hb-t"><span>${esc(r.name)}</span><b>${money(r.revenue)}</b></div>
    <div class="hb-track"><i style="width:${r.revenue / mx * 100}%;background:#c9d6d0"></i><i style="width:${Math.max(0, r.gp / mx * 100)}%;background:${RC.gp}"></i></div><small>ВП ${money(r.gp)}, маржа ${r.revenue ? pct(r.gp / r.revenue * 100, 0) : '—'}</small></div>`).join('')}</div>`;
}
function flowTable(rows) {
  const ins = rows.filter(r => r.type === 'in'), outs = rows.filter(r => r.type === 'out');
  const li = (r, s) => `<div class="kv"><span>${esc(r.category)}</span><b class="${s === '−' ? 'neg' : 'pos'}">${s}${money(r.amount)}</b></div>`;
  return `<details class="tbl"><summary>Приход и расход по статьям</summary>${ins.map(r => li(r, '+')).join('')}${outs.map(r => li(r, '−')).join('')}</details>`;
}
function daysTable(d) {
  const days = fillDays(d);
  return `<div class="table-wrap"><table class="grid-t"><thead><tr><th>День</th><th class="r">Чеков</th><th class="r">Выручка</th><th class="r">Себест.</th><th class="r">ВП</th><th class="r">Расходы</th></tr></thead><tbody>
    ${days.filter(x => x.revenue || x.opex).map(x => `<tr><td>${dt(x.day, false)}</td><td class="r">${x.sales}</td><td class="r">${money(x.revenue)}</td><td class="r">${money(x.cost)}</td><td class="r b">${money(x.revenue - x.cost)}</td><td class="r">${money(x.opex)}</td></tr>`).join('')}</tbody></table></div>`;
}
function pnlTable(d) {
  const k = d.kpi;
  const row = (l, v, cls = '', note = '') => `<tr class="${cls}"><td>${l}${note ? `<small>${note}</small>` : ''}</td><td class="r">${v < 0 ? '−' : ''}${money(Math.abs(v))}</td><td class="r muted">${k.revenue ? pct(v / k.revenue * 100) : ''}</td></tr>`;
  return `<table class="pnl-t"><tbody>
    ${row('Выручка', k.revenue, 'strong', `${k.sales} ${plural(k.sales, 'чек', 'чека', 'чеков')}, скидки ${money(k.discount)}`)}
    ${row('Себестоимость проданного', -k.cost)}
    ${row('Валовая прибыль', k.gp, 'strong total')}
    ${d.expenses.map(e => row(e.category, -e.amount, 'sub')).join('')}
    ${row('Операционные расходы', -k.opex)}
    ${row('Чистая прибыль', k.net, 'strong total big')}
    ${k.withdrawn ? row('Изъято владельцем', -k.withdrawn, 'sub', 'не расход, справочно') : ''}
  </tbody></table>`;
}
function printPnl() {
  const d = RDATA; if (!d) return;
  printDoc(`<div class="pr-a4"><div class="pr-head"><div><b>${esc(State.settings.company_name)}</b><small>${esc(State.settings.company_sub || '')}</small></div>
    <div class="pr-title">Отчёт о прибылях и убытках<small>${dt(d.from, false)} — ${dt(d.to, false)}</small></div></div>${pnlTable(d)}</div>`, 'A4');
}

/* ---------- графики (SVG) ---------- */
function niceMax(v) { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p; return 10 * p; }
const shortN = (v) => v >= 1e6 ? (Math.round(v / 1e5) / 10).toLocaleString('ru-RU') + ' млн' : v >= 1e3 ? Math.round(v / 1e3).toLocaleString('ru-RU') + ' тыс' : String(Math.round(v));
function fillDays(d) {
  const by = (arr, key) => Object.fromEntries(arr.map(x => [x.day, x]));
  const s = by(d.days), o = by(d.opexDays), c = by(d.cashDays);
  const out = []; let cur = new Date(d.from + 'T00:00:00'); const end = new Date(d.to + 'T00:00:00');
  while (cur <= end && out.length < 400) {
    const k = ymd(cur);
    out.push({ day: k, sales: s[k]?.sales || 0, revenue: s[k]?.revenue || 0, cost: s[k]?.cost || 0, opex: o[k]?.opex || 0, cin: c[k]?.cin || 0, cout: c[k]?.cout || 0 });
    cur = addDays(cur, 1);
  }
  return out;
}
const barPath = (x, yTop, w, h, r) => { r = Math.min(r, w / 2, h); return h <= 0 ? '' : `M${x},${yTop + h} v${-(h - r)} q0,${-r} ${r},${-r} h${w - 2 * r} q${r},0 ${r},${r} v${h - r} z`; };
function frame(el, W, H, L, T, B, max, ticks = 4) {
  let g = '';
  const ih = H - T - B;
  for (let i = 0; i <= ticks; i++) { const v = max * i / ticks, y = T + ih - v / max * ih; g += `<line x1="${L}" x2="${W - 6}" y1="${y}" y2="${y}" class="g"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" class="ax">${shortN(v)}</text>`; }
  return g;
}
function drawDays(el, d) {
  if (!el) return;
  const days = fillDays(d);
  const W = el.clientWidth || 640, H = 250, L = 52, T = 10, B = 26, iw = W - L - 6, ih = H - T - B;
  const max = niceMax(Math.max(...days.map(x => x.revenue), 1));
  const slot = iw / days.length, bw = Math.max(3, Math.min(26, slot * 0.68));
  const every = Math.ceil(days.length / Math.max(1, Math.floor(iw / 52)));
  let s = frame(el, W, H, L, T, B, max);
  days.forEach((x, i) => {
    const bx = L + i * slot + (slot - bw) / 2;
    const hc = Math.min(x.cost, x.revenue) / max * ih, hg = Math.max(0, x.revenue - x.cost) / max * ih;
    if (hc > 0) s += `<rect x="${bx}" y="${T + ih - hc}" width="${bw}" height="${hc}" fill="${RC.cost}"/>`;
    if (hg > 2) s += `<path d="${barPath(bx, T + ih - hc - hg, bw, hg - 2, 4)}" fill="${RC.gp}"/>`;
    s += `<rect class="hit" data-i="${i}" x="${L + i * slot}" y="${T}" width="${slot}" height="${ih}" fill="transparent"/>`;
    if (i % every === 0) s += `<text x="${bx + bw / 2}" y="${H - 8}" text-anchor="middle" class="ax">${dt(x.day, false).slice(0, 5)}</text>`;
  });
  mount(el, W, H, T, ih, s, slot, L, (i) => { const x = days[i]; return `<b>${dayLabel(x.day)}</b><div><i style="background:${RC.gp}"></i>ВП ${money(x.revenue - x.cost)}</div><div><i style="background:${RC.cost}"></i>Себестоимость ${money(x.cost)}</div><div class="sep">Выручка ${money(x.revenue)} сом, ${x.sales} ${plural(x.sales, 'чек', 'чека', 'чеков')}</div>`; });
}
function drawCash(el, d) {
  if (!el) return;
  const days = fillDays(d);
  const W = el.clientWidth || 360, H = 170, L = 46, T = 8, B = 22, iw = W - L - 6, ih = H - T - B;
  const max = niceMax(Math.max(...days.map(x => Math.max(x.cin, x.cout)), 1));
  const slot = iw / days.length, bw = Math.max(1.5, Math.min(10, slot * 0.36));
  let s = `<defs><pattern id="hatch" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="${RC.out}"/><line x1="0" y1="0" x2="0" y2="5" stroke="#fff" stroke-width="1.6" opacity=".55"/></pattern></defs>` + frame(el, W, H, L, T, B, max, 2);
  const every = Math.ceil(days.length / Math.max(1, Math.floor(iw / 52)));
  days.forEach((x, i) => {
    const cx = L + i * slot + slot / 2;
    const hi = x.cin / max * ih, ho = x.cout / max * ih;
    if (hi > 0) s += `<path d="${barPath(cx - bw - 1, T + ih - hi, bw, hi, 3)}" fill="${RC.in}"/>`;
    if (ho > 0) s += `<path d="${barPath(cx + 1, T + ih - ho, bw, ho, 3)}" fill="url(#hatch)"/>`;
    s += `<rect class="hit" data-i="${i}" x="${L + i * slot}" y="${T}" width="${slot}" height="${ih}" fill="transparent"/>`;
    if (i % every === 0) s += `<text x="${cx}" y="${H - 6}" text-anchor="middle" class="ax">${dt(x.day, false).slice(0, 5)}</text>`;
  });
  mount(el, W, H, T, ih, s, slot, L, (i) => { const x = days[i]; return `<b>${dayLabel(x.day)}</b><div><i style="background:${RC.in}"></i>Приход ${money(x.cin)}</div><div><i style="background:${RC.out}"></i>Расход ${money(x.cout)}</div>`; });
}
function drawHours(el, rows) {
  if (!el) return;
  const by = Object.fromEntries(rows.map(r => [r.hour, r]));
  const from = Math.min(8, ...rows.map(r => r.hour)), to = Math.max(19, ...rows.map(r => r.hour));
  const hrs = []; for (let h = from; h <= to; h++) hrs.push(by[h] || { hour: h, sales: 0, revenue: 0 });
  const W = el.clientWidth || 320, H = 150, L = 30, T = 8, B = 22, iw = W - L - 6, ih = H - T - B;
  const max = niceMax(Math.max(...hrs.map(h => h.sales), 1));
  const slot = iw / hrs.length, bw = Math.max(4, Math.min(20, slot * 0.6));
  let s = frame(el, W, H, L, T, B, max, 2);
  hrs.forEach((h, i) => {
    const x = L + i * slot + (slot - bw) / 2, hh = h.sales / max * ih;
    if (hh > 0) s += `<path d="${barPath(x, T + ih - hh, bw, hh, 4)}" fill="${RC.bar}"/>`;
    s += `<rect class="hit" data-i="${i}" x="${L + i * slot}" y="${T}" width="${slot}" height="${ih}" fill="transparent"/>`;
    if (h.hour % 2 === 0) s += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" class="ax">${h.hour}</text>`;
  });
  mount(el, W, H, T, ih, s, slot, L, (i) => `<b>${hrs[i].hour}:00–${hrs[i].hour + 1}:00</b><div>${hrs[i].sales} ${plural(hrs[i].sales, 'чек', 'чека', 'чеков')}, ${money(hrs[i].revenue)} сом</div>`);
}
function mount(el, W, H, T, ih, inner, slot, L, tip) {
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${inner}<line x1="${L}" x2="${W - 6}" y1="${T + ih}" y2="${T + ih}" class="base"/><rect class="hl" x="0" y="${T}" width="0" height="${ih}"/></svg><div class="tip" hidden></div>`;
  const svg = el.querySelector('svg'), t = el.querySelector('.tip'), hl = el.querySelector('.hl');
  const show = (e) => {
    const h = e.target.closest('.hit'); if (!h) return;
    const i = Number(h.dataset.i); t.innerHTML = tip(i); t.hidden = false;
    hl.setAttribute('x', L + i * slot); hl.setAttribute('width', slot);
    const r = el.getBoundingClientRect(); let x = e.clientX - r.left + 14; if (x + t.offsetWidth > r.width) x = e.clientX - r.left - t.offsetWidth - 14;
    t.style.left = Math.max(0, x) + 'px';
  };
  svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', () => { t.hidden = true; hl.setAttribute('width', 0); });
}
