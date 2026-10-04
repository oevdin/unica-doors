/* UNICA — касса: остатки по счетам, приход, расход, перевод, журнал операций */
'use strict';

const CS = { period: 'today', type: '', account: 0 };

route('cash', async () => {
  const [from, to] = periodRange(CS.period);
  const qs = new URLSearchParams({ from, to });
  if (CS.type) qs.set('type', CS.type);
  if (CS.account) qs.set('account_id', CS.account);
  const d = await Api.get('/cash/ops?' + qs);
  State.accounts = d.accounts;
  const total = d.accounts.reduce((s, a) => s + a.balance, 0);

  let html = pageHead('Касса', `<button class="btn in" onclick="opSheet('in')">${icons.in}Приход</button><button class="btn out" onclick="opSheet('out')">${icons.out}Расход</button><button class="btn" onclick="opSheet('transfer')">${icons.swap}<span class="hide-s">Перевод</span></button>`);
  html += `<section class="till">
      <div class="till-main"><span>Деньги в кассе и на счетах</span><b class="big-money">${money(total)}<small>сом</small></b></div>
      <div class="till-accs">${d.accounts.map(a => `<button class="acc ${CS.account === a.id ? 'on' : ''}" onclick="CS.account=CS.account===${a.id}?0:${a.id};router()">
        ${a.kind === 'cash' ? icons.cash : icons.card}<span>${esc(a.name)}</span><b class="${a.balance < 0 ? 'neg' : ''}">${money(a.balance)}</b></button>`).join('')}</div>
    </section>`;
  html += `<div class="toolbar">
    ${segHtml('cp', [['today', 'Сегодня'], ['yesterday', 'Вчера'], ['7', '7 дней'], ['month', 'Месяц']], CS.period, 'setCashPeriod')}
    ${segHtml('ct', [['', 'Все'], ['in', 'Приход'], ['out', 'Расход'], ['transfer', 'Переводы']], CS.type, 'setCashType')}
  </div>`;
  html += `<div class="flow"><div class="f-in"><span>${icons.in}Приход за период</span><b>+${money(d.total_in)}</b></div>
    <div class="f-out"><span>${icons.out}Расход за период</span><b>−${money(d.total_out)}</b></div>
    <div><span>Итог</span><b class="${d.total_in - d.total_out < 0 ? 'neg' : ''}">${d.total_in - d.total_out >= 0 ? '+' : '−'}${money(Math.abs(d.total_in - d.total_out))}</b></div></div>`;

  if (!d.ops.length) html += emptyState(icons.wallet, 'Операций нет', 'Продажи, оплаты и расходы за этот период появятся здесь.');
  else {
    let last = '';
    html += `<div class="list">`;
    for (const o of d.ops) {
      const day = o.local_at.slice(0, 10);
      if (day !== last) { last = day; html += `<h3 class="list-day">${dayLabel(day)}</h3>`; }
      const ref = o.sale_id ? `#/sales/${o.sale_id}` : o.purchase_id ? `#/purchase/${o.purchase_id}` : '';
      const sign = o.type === 'in' ? '+' : o.type === 'out' ? '−' : '';
      const sub = [o.type === 'transfer' ? `${esc(o.account_name)} → ${esc(o.to_account_name)}` : esc(o.account_name),
        o.sale_id ? 'чек №' + o.sale_id : '', o.purchase_id ? 'приход №' + o.purchase_id : '', o.contact_name ? esc(o.contact_name) : '', o.note ? esc(o.note) : '', isAdmin() && o.user_name ? esc(o.user_name) : ''].filter(Boolean).join(', ');
      html += `<${ref ? `a href="${ref}"` : 'div'} class="row op ${o.type}">
        <span class="op-ico">${o.type === 'in' ? icons.in : o.type === 'out' ? icons.out : icons.swap}</span>
        <span class="row-main"><b>${esc(o.category)}</b><small>${timeOf(o.local_at)} · ${sub}</small></span>
        <b class="row-sum">${sign}${money(o.amount)}</b>
        ${isAdmin() && !o.sale_id && !o.purchase_id ? `<button class="icon-btn sm" onclick="event.preventDefault();delOp(${o.id})" aria-label="Удалить операцию">${icons.trash}</button>` : ''}
      </${ref ? 'a' : 'div'}>`;
    }
    html += `</div>`;
  }
  $('#app').innerHTML = html;
});
function setCashPeriod(p) { CS.period = p; router(); }
function setCashType(t) { CS.type = t; router(); }

function opSheet(type) {
  const cats = type === 'in' ? State.settings.income_categories : State.settings.expense_categories;
  const titles = { in: 'Приход денег', out: 'Расход', transfer: 'Перевод между счетами' };
  const accs = State.accounts;
  let body = field('Сумма', numInput('opAmt', '', 'autofocus placeholder="0" class="amount"'));
  if (type === 'transfer') {
    body += `<div class="co-grid">${field('Откуда', `<select id="opAcc">${accountOptions(accs[0]?.id)}</select>`)}${field('Куда', `<select id="opTo">${accountOptions(accs[1]?.id || accs[0]?.id)}</select>`)}</div>`;
  } else {
    body += field(type === 'in' ? 'Куда' : 'Откуда', `<select id="opAcc">${accountOptions(accs[0]?.id)}</select>`);
    body += `<div class="field"><span>Статья</span><div class="chips wrap" id="opCats">${cats.map((c, i) => `<button type="button" class="chip ${i === 0 ? 'on' : ''}" data-v="${esc(c)}" onclick="document.querySelectorAll('#opCats .chip').forEach(b=>b.classList.toggle('on',b===this))">${esc(c)}</button>`).join('')}</div></div>`;
  }
  body += field('Комментарий', `<input id="opNote" type="text" placeholder="${type === 'out' ? 'Например: аренда за октябрь' : 'Необязательно'}">`);
  openSheet({ title: titles[type], body, footer: `<button class="btn" onclick="closeSheet()">Отмена</button><button class="btn ${type === 'in' ? 'in' : type === 'out' ? 'out' : 'primary'}" id="opOk">Записать</button>` });
  $('#opOk').onclick = async () => {
    const amount = readNum('opAmt');
    if (!(amount > 0)) { toast('Укажите сумму', 'err'); $('#opAmt').focus(); return; }
    const payload = { type, amount, account_id: Number($('#opAcc').value), note: $('#opNote').value };
    if (type === 'transfer') { payload.to_account_id = Number($('#opTo').value); if (payload.to_account_id === payload.account_id) { toast('Выберите разные счета', 'err'); return; } }
    else payload.category = document.querySelector('#opCats .chip.on')?.dataset.v;
    $('#opOk').disabled = true;
    try { await Api.post('/cash/ops', payload); toast(type === 'in' ? 'Приход записан' : type === 'out' ? 'Расход записан' : 'Перевод записан'); closeSheet(); router(); }
    catch (e) { $('#opOk').disabled = false; toast(errText(e, 'Не удалось записать'), 'err'); }
  };
}
function delOp(id) {
  confirmSheet('Удалить операцию?', 'Сумма перестанет учитываться в остатке кассы и отчётах.', 'Удалить', async () => {
    try { await Api.del('/cash/ops/' + id); closeSheet(); toast('Операция удалена'); router(); } catch (e) { toast(errText(e, 'Не удалось удалить'), 'err'); }
  });
}
