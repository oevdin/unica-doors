/* UNICA — «Ещё»: настройки, реквизиты, статьи, счета, сотрудники, демо-данные */
'use strict';

route('more', async () => {
  const a = isAdmin();
  const item = (href, ico, t, s) => `<a class="menu-i" href="${href}">${ico}<span><b>${t}</b><small>${s}</small></span>${icons.chev}</a>`;
  const btn = (fn, ico, t, s, cls = '') => `<button class="menu-i ${cls}" onclick="${fn}">${ico}<span><b>${t}</b><small>${s}</small></span>${cls ? '' : icons.chev}</button>`;
  let html = `<div class="me"><span class="ava xl">${esc(State.user.name[0])}</span><div><h1>${esc(State.user.name)}</h1><p>${a ? 'Владелец' : 'Продавец'}, вход: ${esc(State.user.login)}</p></div></div>`;
  html += `<div class="menu">${item('#/sales', icons.receipt, 'Чеки', 'Все продажи, долги, повторная отправка накладной')}
    ${item('#/clients', icons.users, 'Клиенты', 'История покупок и долги')}
    ${a ? item('#/suppliers', icons.truck, 'Поставщики', 'Приходы товара и наши долги') + item('#/purchases', icons.box, 'Приходы товара', 'Поступления на склад') : ''}</div>`;
  if (a) html += `<h3 class="menu-h">Настройки</h3><div class="menu">${item('#/settings', icons.doc, 'Реквизиты и статьи', 'Шапка накладной, статьи прихода и расхода, счета')}
    ${item('#/users', icons.users, 'Сотрудники', 'Продавцы и доступ')}
    ${btn('demoSheet()', icons.sparkle, 'Демо-данные', 'Посмотреть отчёты на примерах и удалить их')}
    ${btn('resetSheet()', icons.trash, 'Начать с нуля', 'Удалить все продажи, кассу и клиентов, каталог оставить', 'danger')}</div>`;
  html += `<div class="menu">${btn('installSheet()', icons.install, 'Установить на телефон', 'Иконка на главном экране')}
    ${btn('passSheet()', icons.key, 'Сменить пароль', 'Пароль для входа')}
    ${btn('Auth.logout()', icons.logout, 'Выйти', 'Из аккаунта ' + esc(State.user.login), 'danger')}</div>`;
  $('#app').innerHTML = html;
});

route('settings', async () => {
  if (!isAdmin()) return go('#/more');
  const s = State.settings = await Api.get('/settings');
  const accs = await refreshAccounts();
  const f = (id, l, v, ph) => field(l, `<input id="${id}" type="text" value="${esc(v || '')}" placeholder="${ph}">`);
  $('#app').innerHTML = `<a class="back" href="#/more">${icons.back}Ещё</a>` + pageHead('Реквизиты и статьи') + `<div class="two">
    <section class="card"><h2>Шапка накладной и чека</h2>
      ${f('sN', 'Название', s.company_name, 'UNICA Doors')}${f('sS', 'Подпись', s.company_sub, 'Двери и комплектующие')}
      <div class="co-grid">${f('sI', 'ИНН', s.company_inn, '01234567890123')}${f('sP', 'Телефон', s.company_phone, '+996 700 000 000')}</div>
      ${f('sA', 'Адрес', s.company_address, 'Рынок, ряд, место')}${f('sF', 'Текст внизу чека', s.receipt_footer, 'Спасибо за покупку!')}
      <button class="btn primary" onclick="saveCompany()">Сохранить реквизиты</button></section>
    <div>
      <section class="card"><h2>Статьи расхода</h2>${field('', `<textarea id="sE" rows="8">${esc(s.expense_categories.join('\n'))}</textarea>`, 'Одна статья в строке. «Изъятие владельцем» не считается расходом в отчётах.')}
        <h2 class="mt">Статьи прихода</h2>${field('', `<textarea id="sIn" rows="3">${esc(s.income_categories.join('\n'))}</textarea>`)}
        <button class="btn primary" onclick="saveCats()">Сохранить статьи</button></section>
      <section class="card"><h2>Счета</h2>${accs.map(a => `<div class="row"><span class="op-ico">${a.kind === 'cash' ? icons.cash : icons.card}</span><input class="inline-in" value="${esc(a.name)}" onchange="Api.patch('/cash/accounts/${a.id}',{name:this.value}).then(()=>{toast('Сохранено');refreshAccounts()})" aria-label="Название счёта"><b>${money(a.balance)}</b></div>`).join('')}
        <div class="row-in mt"><input id="nAcc" type="text" placeholder="Например: Карта Мбанк"><select id="nAccK"><option value="bank">Безнал</option><option value="cash">Наличные</option></select><button class="btn" onclick="addAcc()">Добавить</button></div></section>
    </div></div>`;
});
async function saveCompany() {
  const v = (id) => $('#' + id).value;
  State.settings = await Api.put('/settings', { company_name: v('sN') || 'UNICA', company_sub: v('sS'), company_inn: v('sI'), company_phone: v('sP'), company_address: v('sA'), receipt_footer: v('sF') });
  toast('Реквизиты сохранены'); renderNav();
}
async function saveCats() { State.settings = await Api.put('/settings', { expense_categories: $('#sE').value, income_categories: $('#sIn').value }); toast('Статьи сохранены'); router(); }
async function addAcc() { const n = $('#nAcc').value.trim(); if (!n) return; await Api.post('/cash/accounts', { name: n, kind: $('#nAccK').value }); toast('Счёт добавлен'); router(); }

route('users', async () => {
  if (!isAdmin()) return go('#/more');
  const users = await Api.get('/auth/users');
  $('#app').innerHTML = `<a class="back" href="#/more">${icons.back}Ещё</a>` + pageHead('Сотрудники', `<button class="btn primary" onclick="userSheet()">${icons.plus}Сотрудник</button>`) +
    `<div class="list">${users.map(u => `<div class="row ${u.active ? '' : 'muted'}"><span class="ava">${esc(u.name[0])}</span><span class="row-main"><b>${esc(u.name)}</b><small>${u.role === 'admin' ? 'Владелец' : 'Продавец'}, вход: ${esc(u.login)}${u.active ? '' : ', отключён'}</small></span>
      <button class="btn sm" onclick='userSheet(${JSON.stringify(u).replace(/'/g, '&#39;')})'>${icons.edit}Изменить</button></div>`).join('')}</div>
    <p class="hint">Продавец видит продажу, свои чеки, кассу (только свои операции) и клиентов. Себестоимость, склад, отчёты и прибыль видит только владелец.</p>`;
});
function userSheet(u) {
  openSheet({ title: u ? 'Изменить сотрудника' : 'Новый сотрудник',
    body: `${field('Имя', `<input id="uN" type="text" value="${esc(u?.name || '')}" autofocus>`)}${u ? '' : field('Логин', `<input id="uL" type="text" autocapitalize="off" placeholder="aibek">`)}
      ${field(u ? 'Новый пароль' : 'Пароль', `<input id="uP" type="text" autocomplete="new-password" placeholder="${u ? 'Оставьте пустым, чтобы не менять' : 'Не короче 4 символов'}">`)}
      ${field('Роль', `<select id="uR"><option value="seller" ${u?.role === 'seller' ? 'selected' : ''}>Продавец</option><option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Владелец</option></select>`)}
      ${u ? `<label class="check"><input id="uA" type="checkbox" ${u.active ? 'checked' : ''}><span>Может входить в приложение</span></label>` : ''}`,
    footer: `<button class="btn" onclick="closeSheet()">Отмена</button><button class="btn primary" id="uOk">Сохранить</button>` });
  $('#uOk').onclick = async () => {
    const b = { name: $('#uN').value.trim(), role: $('#uR').value, password: $('#uP').value };
    try {
      if (u) { b.active = $('#uA').checked; if (!b.password) delete b.password; await Api.patch('/auth/users/' + u.id, b); }
      else { b.login = $('#uL').value.trim(); if (!b.name || !b.login || (b.password || '').length < 4) { toast('Заполните имя, логин и пароль', 'err'); return; } await Api.post('/auth/users', b); }
      closeSheet(); toast('Сохранено'); router();
    } catch (e) { toast(errText(e, 'Не удалось сохранить'), 'err'); }
  };
}
function passSheet() {
  openSheet({ title: 'Сменить пароль', body: `${field('Текущий пароль', `<input id="pc" type="password" autocomplete="current-password" autofocus>`)}${field('Новый пароль', `<input id="pn" type="password" autocomplete="new-password">`)}`,
    footer: `<button class="btn" onclick="closeSheet()">Отмена</button><button class="btn primary" id="pOk2">Сменить</button>` });
  $('#pOk2').onclick = async () => {
    try { await Api.post('/auth/change-password', { currentPassword: $('#pc').value, newPassword: $('#pn').value }); closeSheet(); toast('Пароль изменён'); }
    catch (e) { toast(e.message === 'password_too_short' ? 'Пароль не короче 4 символов' : 'Текущий пароль указан неверно', 'err'); }
  };
}
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });
function installSheet() {
  if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; return; }
  openSheet({ title: 'Установить на телефон', body: `<ol class="steps"><li><b>Android, Chrome:</b> меню ⋮ справа вверху, затем «Добавить на главный экран».</li><li><b>iPhone, Safari:</b> кнопка «Поделиться» внизу, затем «На экран „Домой“».</li></ol>`,
    footer: `<button class="btn primary" onclick="closeSheet()">Понятно</button>` });
}
function demoSheet() {
  openSheet({ title: 'Демо-данные', body: `<p class="lead">Демо-данные — это пример работы магазина за месяц: поставщики и приходы товара, около 150 продаж, расходы, долги клиентов. На них удобно посмотреть отчёты.</p><p class="lead">Перед началом настоящей работы удалите их: остатки и касса вернутся к прежним значениям, ваши собственные записи не пострадают.</p>`,
    footer: `<button class="btn ghost-danger" onclick="demoClear()">Удалить демо-данные</button><button class="btn primary" onclick="demoFill()">${icons.sparkle}Добавить</button>` });
}
function resetSheet() {
  openSheet({ title: 'Начать с нуля', body: `<p class="lead">Будут удалены <b>все</b> продажи, приходы товара, операции кассы, клиенты и поставщики. Остатки товаров станут нулевыми. Каталог, цены, сотрудники и реквизиты останутся.</p>
    <p class="note warn">${icons.alert}<span>Это нельзя отменить. Используйте перед началом настоящей работы, чтобы убрать пробные записи.</span></p>
    ${field('Чтобы подтвердить, напишите УДАЛИТЬ', `<input id="rsC" type="text" autocomplete="off" autocapitalize="characters">`)}`,
    footer: `<button class="btn" onclick="closeSheet()">Отмена</button><button class="btn danger" id="rsOk">Удалить всё</button>` });
  $('#rsOk').onclick = async () => {
    try { await Api.post('/demo/reset', { confirm: $('#rsC').value }); await loadBasics(); PRODUCTS = []; Cart.clear(); closeSheet(); toast('Все операции удалены. Можно начинать работу.'); go('#/sell'); }
    catch (e) { toast(e.message === 'confirm_required' ? 'Напишите слово УДАЛИТЬ для подтверждения' : 'Не удалось удалить', 'err'); }
  };
}
async function demoFill() {
  try { const r = await Api.post('/demo/fill'); await loadBasics(); PRODUCTS = []; closeSheet(); toast(`Добавлено: ${r.sales} продаж и ${r.purchases} прихода`); go('#/reports'); }
  catch (e) { toast(errText(e, 'Не удалось добавить демо-данные'), 'err'); }
}
async function demoClear() {
  const r = await Api.post('/demo/clear'); await loadBasics(); PRODUCTS = []; closeSheet(); toast(`Удалено: ${r.sales} демо-продаж`); router();
}
