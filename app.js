const $ = id => document.getElementById(id);
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = cents => money.format(cents / 100);
const dateLabel = iso => iso.split('-').reverse().join('/');
const total = entries => entries.reduce((sum, item) => sum + item.amount, 0);
const currentMonth = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(new Date());
$('month').value = currentMonth();
const month = () => $('month').value;
const inMonth = entry => entry.date.startsWith(month() + '-');
const opening = () => month() + '-01';
const state = { bills: [], income: [], reserve: [], sources: [], targets: [], goals: {} };
let editing;
const collections = {bill:'bills',income:'income',source:'sources',target:'targets',reserve:'reserve'};
const emptyState = () => ({bills:[],income:[],reserve:[],sources:[],targets:[],goals:{}});
async function request(path, payload) {
  const response = await fetch('/api/'+path, payload === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
async function persist(type, item, record) {
  const id = type === 'goal' ? (state.goals[record.date.slice(0,7)] == null ? null : record.date) : item?.id;
  return request('entry',{type,id,record:{...item,...record}});
}
async function updateItem(type,item,record) {
  try {
    const saved = await persist(type,item,record);
    updateState(type,item,saved);
    render();
    announce('Alteração salva.');
  } catch (error) { announce(error.message); }
}
let returnFocus;

function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value != null) node.textContent = value;
  if (className) node.className = className;
  return node;
}
function button(label, run) {
  const node = element('button', label);
  node.type = 'button';
  node.addEventListener('click', run);
  return node;
}
function renderList(id, entries, empty, describe) {
  $(id).replaceChildren(...entries.map(item => {
    const { title, detail, amount, actions = [] } = describe(item);
    const row = element('div', null, 'item');
    const description = element('div', null, 'item-description');
    description.append(element('strong', title), element('p', detail));
    row.append(description);
    if (amount != null) {
      row.append(element('strong', brl(amount), amount < 0 ? 'item-value negative' : 'item-value'));
    }
    if (actions.length) {
      const controls = element('div', null, 'item-actions');
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', 'Ações de ' + title);
      for (const [text, action] of actions) {
        const control = button(text, action);
        if (text === 'Marcar paga' || text === 'Reativar') control.classList.add('record-action');
        controls.append(control);
      }
      row.append(controls);
    }
    return row;
  }));
  if (!entries.length) $(id).append(element('p', empty, 'empty'));
}
function billsForMonth(selected) {
  const entries = state.bills.filter(inMonth);
  const saved = new Set(state.bills.filter(item => item.recurringMonth === selected+'-01').map(item => item.originId));
  const [year, number] = selected.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
  for (const item of state.bills) {
    if (!item.recurring || item.date.slice(0,7) >= selected || saved.has(item.id)) continue;
    const dueDay = String(Math.min(Number(item.date.slice(-2)), lastDay)).padStart(2,'0');
    entries.push({ name:item.name, amount:item.amount, date:selected+'-'+dueDay,
      paid:false, originId:item.id, recurringMonth:selected+'-01' });
  }
  return entries.sort((a,b) => a.date.localeCompare(b.date));
}
function updateState(type,item,saved) {
  if (item && state[collections[type]].includes(item)) Object.assign(item,saved);
  else state[collections[type]].push({id:saved.id ?? crypto.randomUUID(),...saved});
}
function effectiveGoal(selected) {
  const latest = Object.keys(state.goals).filter(key => key <= selected).sort().at(-1);
  const goal = state.goals[latest];
  return latest === selected || goal?.recurring ? goal : null;
}
function effectiveTargets(selected) {
  const start = selected + '-01';
  const latestBySource = new Map();
  for (const target of state.targets) {
    if (target.period !== 'month' || target.date > start) continue;
    const previous = latestBySource.get(target.source);
    if (!previous || previous.date < target.date) latestBySource.set(target.source,target);
  }
  const inherited = [...latestBySource.values()]
    .filter(target => target.recurring && target.date < start)
    .map(target => ({ ...target, id:undefined, date:start }));
  return [...state.targets,...inherited];
}
function render() {
  const bills = billsForMonth(month());
  const income = state.income.filter(inMonth);
  const reserve = state.reserve.filter(inMonth);
  const received = total(income);
  const obligations = total(bills);
  const goal = effectiveGoal(month())?.amount;
  const metrics = [
    ['Meta do mês', goal, button(goal == null ? 'Definir meta' : 'Editar meta', event => openEditor('goal', null, event.currentTarget))],
    ['Ganhos recebidos', received],
    ['Falta para a meta', goal == null ? null : Math.max(0, goal - received)],
    ['Contas pendentes', total(bills.filter(item => !item.paid))],
    ['Disponível planejado', received - obligations - total(reserve.filter(item => item.kind !== 'initial'))],
  ];
  $('metrics').replaceChildren(...metrics.map(([name, value, action]) => {
    const node = element('section', null, 'metric');
    node.append(element('p', name), element('strong', value == null ? '—' : brl(value), value < 0 ? 'negative' : ''));
    if (action) node.append(action);
    return node;
  }));
  const update = (type, item) => ['Editar', event => openEditor(type, item, event.currentTarget)];
  renderList('bills', bills, 'Nenhuma conta neste mês.', item => ({
    title: item.name, detail: dateLabel(item.date) + (item.paid ? ' · Paga' : ' · Pendente') + (item.recurring || item.originId ? ' · Mensal' : ''), amount: item.amount,
    actions: [update('bill', item), [item.paid ? 'Reabrir' : 'Marcar paga', () => {
      void updateItem('bill',item,{paid:!item.paid,paidDate:null});
    }]],
  }));
  renderList('income', income, 'Nenhum ganho neste mês.', item => ({
    title: item.source ? sourceName(item.source) : item.legacyOrigin, detail: [dateLabel(item.date), item.name].filter(Boolean).join(' · '),
    amount: item.amount, actions: [update('income', item)],
  }));
  const balance = total(state.reserve.filter(item => item.date.slice(0, 7) <= month()));
  $('reserve-summary').textContent = 'Acumulado até este mês: ' + brl(balance);
  renderList('reserve-list', reserve, 'Nenhuma movimentação neste mês.', item => ({
    title: reserveNames[item.kind], detail: dateLabel(item.date), amount: item.amount, actions: [update('reserve', item)],
  }));
  renderList('sources', state.sources, 'Cadastre sua primeira fonte de renda.', item => ({
    title: item.name, detail: item.archived ? 'Arquivada' : 'Ativa',
    actions: [update('source', item), [item.archived ? 'Reativar' : 'Arquivar', () => {
      if (item.archived && duplicateSource(item.name, item)) {
        announce('Já existe uma fonte ativa com esse nome.');
        return;
      }
      void updateItem('source',item,{archived:!item.archived,archivedAt:null});
    }]],
  }));
  renderList('targets', effectiveTargets(month()), 'Nenhuma meta por fonte cadastrada.', item => {
    const next = endDate(item.date, item.period);
    const actual = total(state.income.filter(gain => gain.source === item.source && gain.date >= item.date && gain.date < next));
    return {
      title: sourceName(item.source), detail: (item.recurring ? 'Recorrente · ' : '') + (item.period === 'week' ? 'Semana de ' : 'Mês de ') + dateLabel(item.date) + ' · Realizado: ' + brl(actual) + ' · ' + (actual >= item.amount ? 'Excedente: ' + brl(actual - item.amount) : 'Falta: ' + brl(item.amount - actual)),
      amount: item.amount, actions: [update('target', item)],
    };
  });
}
const reserveNames = { initial: 'Saldo inicial', deposit: 'Depósito', withdrawal: 'Retirada' };
const sourceName = id => state.sources.find(source => source.id === id)?.name ?? 'Fonte não disponível';
const duplicateSource = (name, item) => state.sources.some(source => source !== item && !source.archived && source.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));
const titles = { bill: 'Conta a pagar', income: 'Ganho', reserve: 'Movimentação da reserva', source: 'Fonte de renda', target: 'Meta por fonte', goal: 'Meta do mês' };
function endDate(start, period) {
  const date = new Date(start + 'T00:00:00Z');
  if (period === 'week') date.setUTCDate(date.getUTCDate() + 7);
  else date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}
function field(name, title, value, config = {}) {
  const wrapper = element('label', title);
  const input = element(config.options ? 'select' : 'input');
  input.name = name;
  if (config.options) {
    for (const [key, label] of config.options) {
      const option = element('option', label);
      option.value = key;
      input.append(option);
    }
  } else {
    input.type = config.type ?? 'text';
    input.maxLength = config.money ? 13 : 200;
    if (config.money) input.inputMode = 'decimal';
  }
  input.required = !config.optional && input.type !== 'checkbox';
  if (input.type === 'checkbox') { input.checked = Boolean(value); wrapper.className = 'checkbox-field'; }
  if (value != null && input.type !== 'checkbox') input.value = value;
  wrapper.append(input);
  $('fields').append(wrapper);
}
function openEditor(type, item, focus, { nextIncome, preferredSource } = {}) {
  if (['income', 'target'].includes(type) && !state.sources.some(source => !source.archived || source.id === item?.source)) {
    if (type === 'income') return openEditor('source', null, focus, { nextIncome: { item } });
    announce('Cadastre uma fonte de renda em Fontes e metas para continuar.');
    return;
  }
  editing = { type, item, month: month(), nextIncome };
  returnFocus = focus;
  $('dialog-title').textContent = nextIncome ? 'Cadastre uma fonte para o ganho' : titles[type];
  $('fields').replaceChildren();
  $('form-error').textContent = '';
  if (['bill', 'source', 'income'].includes(type)) field('name', type === 'source' ? 'Nome da fonte' : 'Descrição', item?.name, { optional: type === 'income' });
  if (['income', 'target'].includes(type)) field('source', 'Fonte de renda', preferredSource ?? item?.source, { options: state.sources.filter(source => !source.archived || source.id === item?.source).map(source => [source.id, source.name]) });
  if (type === 'target') field('period', 'Período', item?.period ?? 'month', { options: [['month', 'Mensal'], ['week', 'Semanal']] });
  if (type === 'reserve') field('kind', 'Tipo', item?.kind ?? 'deposit', { options: Object.entries(reserveNames) });
  if (['bill', 'income', 'reserve', 'target'].includes(type)) field('date', { bill: 'Vencimento', income: 'Data do recebimento', reserve: 'Data', target: 'Início do período' }[type], item?.date ?? opening(), { type: 'date' });
  if (type === 'bill' && !item?.originId) field('recurring', 'Repetir todos os meses', item?.recurring, { type:'checkbox' });
  if (type === 'goal') field('recurring', 'Repetir todos os meses', effectiveGoal(month())?.recurring, { type:'checkbox' });
  if (type === 'target') {
    field('recurring', 'Repetir todos os meses', item?.recurring, { type:'checkbox' });
    const period = $('fields').querySelector('[name=period]');
    const checkbox = $('fields').querySelector('[name=recurring]');
    const sync = () => { checkbox.disabled = period.value !== 'month'; checkbox.parentElement.hidden = checkbox.disabled; };
    period.addEventListener('change',sync);
    sync();
  }
  if (type !== 'source') {
    const amount = type === 'goal' ? effectiveGoal(month())?.amount : Math.abs(item?.amount ?? 0) || undefined;
    field('amount', 'Valor (R$)', amount == null ? '' : (amount / 100).toFixed(2).replace('.', ','), { money: true });
  }
  if (!$('editor').open) $('editor').showModal();
  $('fields').querySelector('input, select')?.focus();
}
function announce(text) { $('notice').textContent = text; }
function readAmount(value, allowZero) {
  const text = value.trim();
  if (!/^\d{1,10}(?:[,.]\d{1,2})?$/.test(text)) throw new Error('Informe um valor em reais, como 150,00.');
  const [whole, fraction = ''] = text.replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!allowZero && cents === 0) throw new Error('Informe um valor maior que zero.');
  return cents;
}
$('entry').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('button.primary');
  if (submit.disabled) return;
  submit.disabled = true;
  const { type, item, month: selected, nextIncome } = editing;
  const fields = new FormData(event.currentTarget);
  const record = Object.fromEntries(fields);
  if (['bill','goal','target'].includes(type)) record.recurring = fields.has('recurring');
  try {
    if (record.name != null) record.name = record.name.trim();
    if (['source', 'bill'].includes(type) && !record.name) throw new Error('Preencha o nome ou a descrição.');
    if (type === 'source' && !item?.archived && duplicateSource(record.name, item)) throw new Error('Já existe uma fonte ativa com esse nome.');
    if (type !== 'source') record.amount = readAmount(record.amount, type === 'goal');
    if (type === 'target') {
      const day = new Date(record.date + 'T00:00:00Z').getUTCDay();
      if (record.period === 'week' ? day !== 1 : !record.date.endsWith('-01')) throw new Error('Selecione uma segunda-feira para a meta semanal ou o dia 1 para a mensal.');
      if (state.targets.some(meta => meta !== item && meta.source === record.source && meta.period === record.period && meta.date === record.date)) throw new Error('Já existe uma meta para essa fonte e período.');
    }
    if (type === 'reserve') {
      if (record.kind === 'initial' && state.reserve.some(entry => entry !== item && entry.kind === 'initial')) throw new Error('Já existe um saldo inicial na reserva.');
      if (record.kind === 'withdrawal') record.amount *= -1;
    }
    if (type === 'goal') record.date = selected + '-01';
    const saved = await persist(type,item,record);
    if (type === 'goal') state.goals[selected] = { amount:saved.amount, recurring:saved.recurring };
    else {
      updateState(type,item,saved);
      const created = item ?? state[collections[type]].at(-1);
      if (nextIncome) {
        render();
        openEditor('income', nextIncome.item, returnFocus, { preferredSource: created.id });
        return;
      }
    }
    $('editor').close();
    announce('Alteração salva.');
    render();
  } catch (error) {
    $('form-error').textContent = error.message;
  } finally { submit.disabled = false; }
});
for (const id of ['cancel', 'close-editor']) $(id).addEventListener('click', () => $('editor').close());
$('editor').addEventListener('close', () => returnFocus?.focus());
for (const trigger of document.querySelectorAll('[data-form]')) {
  trigger.addEventListener('click', () => openEditor(trigger.dataset.form, null, trigger));
}
for (const trigger of document.querySelectorAll('[data-view]')) {
  trigger.addEventListener('click', () => {
    const monthly = trigger.dataset.view === 'month';
    $('month-view').hidden = !monthly;
    $('source-view').hidden = monthly;
    $('page-title').textContent = trigger.textContent;
    for (const node of document.querySelectorAll('[data-view]')) node.removeAttribute('aria-current');
    trigger.setAttribute('aria-current', 'page');
    announce('');
  });
}
$('month').addEventListener('change', () => {
  if (!$('month').value) $('month').value = currentMonth();
  render();
});
function showWorkspace() {
  $('access').hidden = true;
  $('workspace').hidden = false;
  render();
  $('workspace').querySelector('[aria-current]').focus();
}
$('login').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  $('login-error').textContent = '';
  try {
    await request('login',Object.fromEntries(new FormData(form)));
    form.reset();
    Object.assign(state,await request('state'));
    showWorkspace();
  } catch (error) { $('login-error').textContent = error.message; }
  finally { button.disabled = false; }
});
$('logout').addEventListener('click', async () => {
  try { await request('logout',{}); }
  catch (error) { announce(error.message); return; }
  Object.assign(state,emptyState());
  $('workspace').hidden = true;
  $('access').hidden = false;
  $('login').querySelector('[name=email]').focus();
});
