/* UNICA — клиенты и поставщики: карточка, история покупок, долги */
'use strict';

const CT = { q: '', debt: false };
const contactTabs = (on) => isAdmin() ? `<nav class="tabs-inline"><a href="#/clients" class="${on === 'client' ? 'on' : ''}">Клиенты</a><a href="#/suppliers" class="${on === 'supplier' ? 'on' : ''}">Поставщики</a></nav>` : '';
function waLink(phone) { let d = String(phone || '').replace(/\D/g, ''); if (d.length === 10 && d[0] === '0') d = '996' + d.slice(1); else if (d.length === 9) d = '996' + d; return d ? 'https://wa.me/' + d : ''; }

async function contactList(type) {
  const qs = new URLSearchParams({ type }); if (CT.q) qs.set('q', CT.q); if (CT.debt) qs.set('debt', 1);
  const rows = await Api.get('/contacts?' + qs);
  const debt = rows.reduce((s, r) => s + Math.max(0, r.debt), 0);
  const isC = type === 'client';
  let html = pageHead(isC ? 'Клиенты' : 'Поставщики', `<button class="btn primary" onclick="contactSheet(null,'${type}')">${icons.plus}${isC ? 'Клиент' : 'Поставщик'}</button>`) + contactTabs(type);
  html += `<div class="toolbar"><label class="search grow">${icons.search}<input type="search" placeholder="Имя или телефон" value="${esc(CT.q)}" oninput="ctSearch(this.value)"></label>
    <button class="chip ${CT.debt ? 'on' : ''}" onclick="CT.debt=!CT.debt;router()">${icons.clock}${isC ? 'Должники' : 'Мы должны'}</button></div>`;
  html += `<div class="sum-strip"><div><span>${isC ? 'Клиентов' : 'Поставщиков'}</span><b>${rows.length}</b></div>
    <div class="${debt ? 'warn' : ''}"><span>${isC ? 'Должны нам' : 'Мы должны'}</span><b>${money(debt)}</b></div></div>`;
  if (!rows.length) html += emptyState(icons.users, CT.debt ? 'Долгов нет' : isC ? 'Клиентов пока нет' : 'Поставщиков пока нет', isC ? 'Клиент появляется сам, когда в продаже указано имя или телефон.' : 'Поставщик добавится при первом приходе товара.');
  else html += `<div class="list">${rows.map(c => `<a class="row" href="#/contact/${c.id}"><span class="ava">${esc((c.name || '?')[0])}</span>
      <span class="row-main"><b>${esc(c.name)}</b><small>${esc(c.phone || 'без телефона')}${c.orders ? `, ${c.orders} ${isC ? plural(c.orders, 'покупка', 'покупки', 'покупок') : plural(c.orders, 'приход', 'прихода', 'приходов')}` : ''}${c.last_at ? ', последний раз ' + dt(c.last_at, false) : ''}</small></span>
      ${c.debt > 0 ? `<span class="tag warn">${isC ? 'долг' : 'мы должны'} ${money(c.debt)}</span>` : ''}${isAdmin() && c.spent ? `<b class="row-sum">${money(c.spent)}</b>` : ''}</a>`).join('')}</div>`;
  $('#app').innerHTML = html;
}
route('clients', () => contactList('client'));
route('suppliers', () => contactList('supplier'));
const ctSearch = debounce((v) => { CT.q = v.trim(); router().then(() => { const i = document.querySelector('.toolbar input[type=search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 350);

route('contact', async ([id]) => {
  const c = await Api.get('/contacts/' + id);
  const isC = c.type === 'client';
  const docs = isC ? await Api.get('/sales?contact_id=' + id) : await Api.get('/purchases?contact_id=' + id);
  const wa = waLink(c.phone);
  let html = `<a class="back" href="#/${isC ? 'clients' : 'suppliers'}">${icons.back}${isC ? 'Клиенты' : 'Поставщики'}</a>`;
  html += `<div class="person"><span class="ava xl">${esc((c.name || '?')[0])}</span><div><h1>${esc(c.name)}</h1><p>${isC ? 'Клиент' : 'Поставщик'}${c.phone ? ', ' + esc(c.phone) : ''}</p>
    <div class="page-actions">${c.phone ? `<a class="btn" href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${icons.phone}Позвонить</a>` : ''}${wa ? `<a class="btn wa" href="${wa}" target="_blank" rel="noopener">${icons.wa}WhatsApp</a>` : ''}
    <button class="btn" onclick="contactSheet(${c.id})">${icons.edit}Изменить</button></div></div></div>`;
  html += `<div class="sum-strip"><div><span>${isC ? 'Покупок' : 'Приходов'}</span><b>${c.orders}</b></div>
    ${isAdmin() ? `<div><span>${isC ? 'Купил на' : 'Поставил на'}</span><b>${money(c.spent)}</b></div>` : ''}
    <div class="${c.debt > 0 ? 'warn' : ''}"><span>${isC ? 'Долг клиента' : 'Наш долг'}</span><b>${money(Math.max(0, c.debt))}</b></div>
    <div><span>Последний раз</span><b>${c.last_at ? dt(c.last_at, false) : '—'}</b></div></div>`;
  if (c.note) html += `<p class="note">${esc(c.note)}</p>`;
  html += `<section class="card"><h2>${isC ? 'Покупки' : 'Приходы товара'}</h2>${docs.length ? `<div class="list">${docs.map(d => `<a class="row ${d.status === 'cancelled' ? 'muted' : ''}" href="#/${isC ? 'sales' : 'purchase'}/${d.id}">
      <span class="row-time">${dt(d.local_at, false).slice(0, 5)}</span><span class="row-main"><b>№${d.id}</b><small>${d.lines} ${plural(d.lines, 'позиция', 'позиции', 'позиций')}${d.status === 'cancelled' ? ', отменён' : ''}</small></span>
      ${d.debt > 0 ? `<span class="tag warn">долг ${money(d.debt)}</span>` : ''}<b class="row-sum">${money(d.total)}</b></a>`).join('')}</div>` : '<p class="hint">Пока ничего нет.</p>'}</section>`;
  $('#app').innerHTML = html;
});

function contactSheet(id, type = 'client') {
  (async () => {
    const c = id ? await Api.get('/contacts/' + id) : { type, name: '', phone: '', note: '' };
    openSheet({ title: id ? 'Изменить контакт' : c.type === 'client' ? 'Новый клиент' : 'Новый поставщик',
      body: `${field('Имя или название', `<input id="cN" type="text" value="${esc(c.name)}" autofocus>`)}${field('Телефон', `<input id="cP" type="tel" inputmode="tel" value="${esc(c.phone || '')}" placeholder="0700 123 456">`)}
        ${field('Заметка', `<textarea id="cX" rows="3" placeholder="Адрес, что покупает, договорённости">${esc(c.note || '')}</textarea>`)}`,
      footer: `${id && isAdmin() ? `<button class="btn ghost-danger" onclick="delContact(${id})">${icons.trash}Удалить</button>` : ''}<button class="btn" onclick="closeSheet()">Отмена</button><button class="btn primary" id="cOk">Сохранить</button>` });
    $('#cOk').onclick = async () => {
      const b = { name: $('#cN').value.trim(), phone: $('#cP').value.trim(), note: $('#cX').value.trim(), type: c.type };
      if (!b.name) { toast('Укажите имя', 'err'); return; }
      const r = id ? await Api.patch('/contacts/' + id, b) : await Api.post('/contacts', b);
      closeSheet(); toast('Сохранено'); id ? router() : go('#/contact/' + r.id);
    };
  })();
}
function delContact(id) {
  confirmSheet('Удалить контакт?', 'Удалить можно только контакт без покупок и приходов.', 'Удалить', async () => {
    try { await Api.del('/contacts/' + id); closeSheet(); toast('Контакт удалён'); go('#/clients'); } catch (e) { toast(errText(e, 'Не удалось удалить'), 'err'); }
  });
}
