/* Lógica financeira pura (sem acesso a tela ou banco). Funciona no navegador e no Node (testes).
 * Dinheiro SEMPRE em centavos inteiros. Datas SEMPRE como texto "AAAA-MM-DD" (horário local).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FinLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA = 1;
  const APP_ID = 'financas-pessoais';
  const METHODS = ['Pix', 'Dinheiro', 'Débito', 'Boleto', 'Outro'];
  const ALL_METHODS = METHODS.concat(['Transferência']);
  const MAX_AMOUNT = 99999999999; // R$ 999.999.999,99
  const LOG_LIMIT = 500;

  class FinError extends Error {}

  // ---------- utilidades ----------
  const pad = (n) => String(n).padStart(2, '0');
  const nowISO = () => new Date().toISOString();
  const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().trim().replace(/\s+/g, ' ');
  }

  // "25" "25,5" "1.234,56" "R$ 80" "80.50" -> centavos (ou null se inválido)
  function parseMoney(input) {
    if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
    let s = String(input == null ? '' : input).replace(/R\$/gi, '').replace(/\s/g, '');
    if (!s || !/^[\d.,]+$/.test(s)) return null;
    if ((s.match(/,/g) || []).length > 1) return null; // mais de uma vírgula é ambíguo
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    let int = s, dec = '';
    if (lastComma > -1 && lastComma > lastDot) {
      int = s.slice(0, lastComma); dec = s.slice(lastComma + 1);
    } else if (lastComma === -1 && lastDot > -1) {
      const dots = (s.match(/\./g) || []).length;
      const after = s.length - lastDot - 1;
      if (dots === 1 && after <= 2) { int = s.slice(0, lastDot); dec = s.slice(lastDot + 1); }
    }
    int = int.replace(/[.,]/g, '');
    if (/[.,]/.test(dec) || dec.length > 2) return null;
    const cents = parseInt(int || '0', 10) * 100 + parseInt((dec + '00').slice(0, 2), 10);
    return Number.isFinite(cents) ? cents : null;
  }

  const brl = typeof Intl !== 'undefined'
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }) : null;
  function formatMoney(cents) {
    const v = (cents || 0) / 100;
    return brl ? brl.format(v) : 'R$ ' + v.toFixed(2).replace('.', ',');
  }
  const plainMoney = (cents) => (Math.abs(cents) / 100).toFixed(2).replace('.', ',');

  // ---------- datas ----------
  function todayStr(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function isValidDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    if (y < 1990 || y > 2100) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  const ymOf = (s) => s.slice(0, 7);
  function lastDayOfMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
  }
  function addMonthsYM(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const t = y * 12 + (m - 1) + n;
    return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
  }
  // soma meses preservando o dia (31/jan + 1 mês = 28/fev)
  function addMonthsToDate(dateStr, n) {
    const ym = addMonthsYM(ymOf(dateStr), n);
    const day = Math.min(Number(dateStr.slice(8, 10)), Number(lastDayOfMonth(ym).slice(8, 10)));
    return `${ym}-${pad(day)}`;
  }
  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }
  function daysBetween(a, b) { // b - a, em dias
    const [y1, m1, d1] = a.split('-').map(Number);
    const [y2, m2, d2] = b.split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
  }
  function monthLabel(ym) {
    const [y, m] = ym.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  // ---------- estado inicial ----------
  const DEFAULT_CATEGORIES = [
    { id: 'cat-moradia', name: 'Moradia', emoji: '🏠', kind: 'out' },
    { id: 'cat-alimentacao', name: 'Alimentação', emoji: '🍽️', kind: 'out' },
    { id: 'cat-transporte', name: 'Transporte', emoji: '🚌', kind: 'out' },
    { id: 'cat-carro', name: 'Carro', emoji: '🚗', kind: 'out' },
    { id: 'cat-faculdade', name: 'Faculdade', emoji: '🎓', kind: 'out' },
    { id: 'cat-saude', name: 'Saúde', emoji: '💊', kind: 'out' },
    { id: 'cat-lazer', name: 'Lazer', emoji: '🎮', kind: 'out' },
    { id: 'cat-assinaturas', name: 'Assinaturas', emoji: '🔁', kind: 'out' },
    { id: 'cat-dividas', name: 'Dívidas', emoji: '🧾', kind: 'out' },
    { id: 'cat-igreja', name: 'Igreja', emoji: '⛪', kind: 'out' },
    { id: 'cat-salario', name: 'Salário', emoji: '💼', kind: 'in' },
    { id: 'cat-extras', name: 'Serviços extras', emoji: '🛠️', kind: 'in' },
    { id: 'cat-outros', name: 'Outros', emoji: '📦', kind: 'both' },
  ];

  function newState(now = nowISO()) {
    return {
      app: APP_ID,
      schema: SCHEMA,
      createdAt: now,
      accounts: [
        { id: 'acc-principal', name: 'Conta principal', type: 'conta', initial: 0, archived: false },
        { id: 'acc-dinheiro', name: 'Dinheiro', type: 'dinheiro', initial: 0, archived: false },
      ],
      categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
      movements: [],
      log: [],
      settings: { onboarded: false, lastBackupAt: null, lastAccountId: null, lastMethod: null },
    };
  }

  const live = (s) => s.movements.filter((m) => !m.deletedAt);
  const getAccount = (s, id) => s.accounts.find((a) => a.id === id);
  const getCategory = (s, id) => s.categories.find((c) => c.id === id);
  const activeAccounts = (s) => s.accounts.filter((a) => !a.archived);
  const getMovement = (s, id) => s.movements.find((m) => m.id === id);

  function pushLog(state, now, action, ref, summary, extra) {
    state.log.push({ id: uid('l_'), at: now, action, ref: ref || null, summary, ...(extra ? { extra } : {}) });
    if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
  }

  const TYPE_LABEL = { in: 'Entrada', out: 'Saída', transfer: 'Transferência' };
  const describe = (m) => `${TYPE_LABEL[m.type]} · ${m.desc} · ${formatMoney(m.amount)} (${m.date.split('-').reverse().join('/')})`;

  // ---------- movimentações ----------
  function cleanMovementInput(state, input, ctx = {}) {
    const ex = ctx.existing || null;
    const type = input.type;
    if (!['in', 'out', 'transfer'].includes(type)) throw new FinError('Escolha entrada, saída ou transferência.');
    const amount = input.amount;
    if (!Number.isInteger(amount) || amount <= 0) throw new FinError('Informe um valor maior que zero.');
    if (amount > MAX_AMOUNT) throw new FinError('Esse valor é alto demais. Confira se digitou certo.');
    if (!isValidDate(input.date)) throw new FinError('Data inválida.');
    const acc = getAccount(state, input.accountId);
    if (!acc || (acc.archived && !(ex && ex.accountId === acc.id))) throw new FinError('Escolha uma conta válida.');

    let toAccountId = null, categoryId = null, method = ALL_METHODS.includes(input.method) ? input.method : 'Outro';
    if (type === 'transfer') {
      const to = getAccount(state, input.toAccountId);
      if (!to || (to.archived && !(ex && ex.toAccountId === to.id))) throw new FinError('Escolha a conta de destino.');
      if (to.id === acc.id) throw new FinError('A conta de origem e a de destino precisam ser diferentes.');
      toAccountId = to.id;
      method = 'Transferência';
    } else {
      categoryId = getCategory(state, input.categoryId) ? input.categoryId : 'cat-outros';
      if (method === 'Transferência') method = 'Outro';
    }
    const status = type === 'transfer' ? 'done' : input.status === 'planned' ? 'planned' : 'done';
    const fallback = type === 'transfer' ? 'Transferência' : getCategory(state, categoryId).name;
    return {
      type, amount, date: input.date, accountId: acc.id, toAccountId, categoryId, method, status,
      desc: String(input.desc || '').trim().slice(0, 80) || fallback,
      note: String(input.note || '').trim().slice(0, 300),
    };
  }

  function addMovement(state, input, now = nowISO(), extra = {}) {
    const f = cleanMovementInput(state, input);
    const m = { id: uid('m_'), ...f, dueDate: null, seriesId: null, ...extra, createdAt: now, updatedAt: now, deletedAt: null };
    state.movements.push(m);
    if (m.type !== 'transfer') { state.settings.lastAccountId = m.accountId; state.settings.lastMethod = m.method; }
    pushLog(state, now, 'create', m.id, 'Criou: ' + describe(m));
    return m;
  }

  // Cria a primeira (com o status escolhido) e as seguintes como "previstas", uma por mês.
  function addRecurring(state, input, months, now = nowISO()) {
    const n = Math.max(1, Math.min(60, Math.floor(months) || 1));
    if (n === 1) return [addMovement(state, input, now)];
    if (input.type === 'transfer') throw new FinError('Transferências não podem ser repetidas.');
    cleanMovementInput(state, input); // valida antes de criar qualquer coisa
    const seriesId = uid('s_');
    const out = [];
    for (let i = 0; i < n; i++) {
      const item = { ...input, date: addMonthsToDate(input.date, i), status: i === 0 ? input.status : 'planned' };
      const f = cleanMovementInput(state, item);
      const m = { id: uid('m_'), ...f, dueDate: null, seriesId, createdAt: now, updatedAt: now, deletedAt: null };
      state.movements.push(m);
      out.push(m);
    }
    state.settings.lastAccountId = out[0].accountId; state.settings.lastMethod = out[0].method;
    pushLog(state, now, 'create', out[0].id, `Criou ${n} lançamentos mensais: ${out[0].desc} · ${formatMoney(out[0].amount)}`);
    return out;
  }

  const SNAP_FIELDS = ['type', 'desc', 'amount', 'categoryId', 'date', 'method', 'accountId', 'toAccountId', 'status', 'note', 'dueDate'];
  const snapshot = (m) => Object.fromEntries(SNAP_FIELDS.map((k) => [k, m[k] == null ? null : m[k]]));

  function updateMovement(state, id, input, now = nowISO()) {
    const m = getMovement(state, id);
    if (!m || m.deletedAt) throw new FinError('Lançamento não encontrado.');
    const before = snapshot(m);
    const f = cleanMovementInput(state, input, { existing: m });
    Object.assign(m, f, { updatedAt: now });
    pushLog(state, now, 'update', m.id, 'Editou: ' + describe(m), { before: describe({ ...before, id }) });
    return { movement: m, before };
  }

  function applySnapshot(state, id, snap, now = nowISO(), label = 'Desfez alteração') {
    const m = getMovement(state, id);
    if (!m) throw new FinError('Lançamento não encontrado.');
    Object.assign(m, snap, { updatedAt: now });
    pushLog(state, now, 'update', m.id, `${label}: ${describe(m)}`);
    return m;
  }

  function deleteMovement(state, id, now = nowISO()) {
    const m = getMovement(state, id);
    if (!m || m.deletedAt) throw new FinError('Lançamento não encontrado.');
    m.deletedAt = now;
    pushLog(state, now, 'delete', m.id, 'Excluiu: ' + describe(m));
    return m;
  }
  function restoreMovement(state, id, now = nowISO()) {
    const m = getMovement(state, id);
    if (!m || !m.deletedAt) throw new FinError('Lançamento não encontrado.');
    m.deletedAt = null; m.updatedAt = now;
    pushLog(state, now, 'restore', m.id, 'Restaurou: ' + describe(m));
    return m;
  }

  // Confirma um lançamento previsto como pago/recebido. NÃO cria registro novo (evita duplicar).
  function markDone(state, id, { date, accountId } = {}, now = nowISO()) {
    const m = getMovement(state, id);
    if (!m || m.deletedAt) throw new FinError('Lançamento não encontrado.');
    if (m.status !== 'planned') throw new FinError('Esse lançamento já foi confirmado.');
    const before = snapshot(m);
    const d = date || todayStr();
    if (!isValidDate(d)) throw new FinError('Data inválida.');
    const accId = accountId || m.accountId;
    const acc = getAccount(state, accId);
    if (!acc || acc.archived) throw new FinError('Escolha uma conta válida.');
    if (d !== m.date) m.dueDate = m.dueDate || m.date;
    m.date = d; m.accountId = accId; m.status = 'done'; m.updatedAt = now;
    pushLog(state, now, 'done', m.id, (m.type === 'in' ? 'Recebeu: ' : 'Pagou: ') + describe(m));
    return { movement: m, before };
  }

  // ---------- saldos e resumos ----------
  function accountBalance(state, accountId, uptoDate = null) {
    const acc = getAccount(state, accountId);
    if (!acc) return 0;
    let b = acc.initial;
    for (const m of state.movements) {
      if (m.deletedAt || m.status !== 'done') continue;
      if (uptoDate && m.date > uptoDate) continue;
      if (m.type === 'in' && m.accountId === accountId) b += m.amount;
      else if (m.type === 'out' && m.accountId === accountId) b -= m.amount;
      else if (m.type === 'transfer') {
        if (m.accountId === accountId) b -= m.amount;
        if (m.toAccountId === accountId) b += m.amount;
      }
    }
    return b;
  }
  const totalBalance = (state, uptoDate = null) =>
    activeAccounts(state).reduce((t, a) => t + accountBalance(state, a.id, uptoDate), 0);

  function monthSummary(state, ym, today = todayStr()) {
    const end = lastDayOfMonth(ym);
    let received = 0, spent = 0, toReceive = 0, toPay = 0, pendingOutCount = 0, paidOutCount = 0;
    let obligations = 0, expectedIn = 0, overdueOut = 0, overdueOutCount = 0;
    for (const m of live(state)) {
      if (m.type === 'transfer') continue;
      const inMonth = ymOf(m.date) === ym;
      if (m.status === 'done') {
        if (!inMonth) continue;
        if (m.type === 'in') received += m.amount; else { spent += m.amount; paidOutCount++; }
      } else {
        if (inMonth) { if (m.type === 'in') toReceive += m.amount; else { toPay += m.amount; pendingOutCount++; } }
        if (m.date <= end) { if (m.type === 'in') expectedIn += m.amount; else obligations += m.amount; }
        if (m.type === 'out' && m.date < today) { overdueOut += m.amount; overdueOutCount++; }
      }
    }
    const balance = totalBalance(state);
    return {
      ym, received, spent, net: received - spent, toReceive, toPay, pendingOutCount, paidOutCount,
      balance, obligations, canSpend: balance - obligations, projected: balance + expectedIn - obligations,
      overdueOut, overdueOutCount,
    };
  }

  function byCategory(state, ym, type = 'out') {
    const map = new Map();
    let total = 0;
    for (const m of live(state)) {
      if (m.type !== type || m.status !== 'done' || ymOf(m.date) !== ym) continue;
      map.set(m.categoryId, (map.get(m.categoryId) || 0) + m.amount);
      total += m.amount;
    }
    return [...map.entries()].map(([id, amount]) => {
      const c = getCategory(state, id) || getCategory(state, 'cat-outros');
      return { categoryId: id, name: c.name, emoji: c.emoji, amount, pct: total ? amount / total : 0 };
    }).sort((a, b) => b.amount - a.amount);
  }

  function monthlySeries(state, endYm, n = 6) {
    const rows = [];
    for (let i = n - 1; i >= 0; i--) rows.push({ ym: addMonthsYM(endYm, -i), in: 0, out: 0 });
    const idx = new Map(rows.map((r) => [r.ym, r]));
    for (const m of live(state)) {
      if (m.type === 'transfer' || m.status !== 'done') continue;
      const r = idx.get(ymOf(m.date));
      if (r) r[m.type] += m.amount;
    }
    return rows;
  }

  // saldo no fim de cada dia do mês (apenas até hoje; meses futuros ficam vazios)
  function balanceEvolution(state, ym, today = todayStr()) {
    if (ym > ymOf(today)) return [];
    const last = ym === ymOf(today) ? Number(today.slice(8, 10)) : Number(lastDayOfMonth(ym).slice(8, 10));
    const pts = [];
    for (let d = 1; d <= last; d++) {
      const date = `${ym}-${pad(d)}`;
      pts.push({ date, balance: totalBalance(state, date) });
    }
    return pts;
  }

  function alerts(state, today = todayStr(), soonDays = 3) {
    const out = [];
    for (const m of live(state)) {
      if (m.status !== 'planned') continue;
      if (m.date < today) out.push({ kind: 'overdue', days: daysBetween(m.date, today), movement: m });
      else if (daysBetween(today, m.date) <= soonDays) out.push({ kind: 'soon', days: daysBetween(today, m.date), movement: m });
    }
    return out.sort((a, b) => a.movement.date.localeCompare(b.movement.date));
  }

  // ---------- busca, filtros e sugestões ----------
  function sortMovements(list) {
    return list.sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function filterMovements(state, f = {}) {
    const q = norm(f.q || '');
    const cats = new Map(state.categories.map((c) => [c.id, c.name]));
    const accs = new Map(state.accounts.map((a) => [a.id, a.name]));
    return sortMovements(live(state).filter((m) => {
      if (f.type && m.type !== f.type) return false;
      if (f.categoryId && m.categoryId !== f.categoryId) return false;
      if (f.method && m.method !== f.method) return false;
      if (f.accountId && m.accountId !== f.accountId && m.toAccountId !== f.accountId) return false;
      if (f.status && m.status !== f.status) return false;
      if (f.from && m.date < f.from) return false;
      if (f.to && m.date > f.to) return false;
      if (q) {
        const hay = norm([m.desc, m.note, cats.get(m.categoryId), accs.get(m.accountId), m.method, plainMoney(m.amount)].join(' '));
        if (!q.split(' ').every((w) => hay.includes(w))) return false;
      }
      return true;
    }));
  }

  const KEYWORDS = [
    [['gasolina', 'combustivel', 'etanol', 'posto', 'estacionamento', 'oleo', 'pneu', 'mecanico', 'embreagem', 'lavagem'], 'cat-carro'],
    [['uber', 'onibus', '99', 'passagem', 'metro', 'taxi'], 'cat-transporte'],
    [['mercado', 'supermercado', 'padaria', 'lanche', 'pizza', 'ifood', 'restaurante', 'almoco', 'janta', 'jantar', 'cafe', 'acougue', 'hamburguer', 'comida', 'alimentacao'], 'cat-alimentacao'],
    [['aluguel', 'condominio', 'luz', 'energia', 'agua', 'internet', 'gas'], 'cat-moradia'],
    [['faculdade', 'mensalidade', 'curso', 'livro'], 'cat-faculdade'],
    [['farmacia', 'remedio', 'consulta', 'dentista', 'exame', 'academia'], 'cat-saude'],
    [['netflix', 'spotify', 'assinatura', 'youtube', 'prime', 'icloud'], 'cat-assinaturas'],
    [['cinema', 'jogo', 'game', 'bar', 'viagem', 'passeio', 'steam', 'playstation'], 'cat-lazer'],
    [['dizimo', 'oferta', 'igreja'], 'cat-igreja'],
    [['salario', 'pagamento', 'holerite', 'adiantamento'], 'cat-salario'],
    [['freela', 'freelance', 'extra', 'servico', 'bico'], 'cat-extras'],
  ];

  function suggestCategory(state, desc, type = 'out') {
    const d = norm(desc);
    if (d.length < 2) return null;
    const pool = sortMovements(live(state).filter((m) => m.type === type));
    const exact = pool.find((m) => norm(m.desc) === d);
    if (exact && getCategory(state, exact.categoryId)) return exact.categoryId;
    const words = d.split(' ');
    const byWord = pool.find((m) => words.includes(norm(m.desc)) || norm(m.desc).split(' ').some((w) => w.length > 3 && words.includes(w)));
    if (byWord && getCategory(state, byWord.categoryId)) return byWord.categoryId;
    for (const [keys, cat] of KEYWORDS) {
      const c = getCategory(state, cat);
      if (!c || (c.kind !== 'both' && c.kind !== type)) continue;
      if (words.some((w) => keys.includes(w))) return cat;
    }
    return null;
  }

  function descSuggestions(state, type, limit = 40) {
    const seen = new Set(), out = [];
    for (const m of sortMovements(live(state).filter((x) => x.type === type))) {
      const k = norm(m.desc);
      if (seen.has(k)) continue;
      seen.add(k); out.push(m.desc);
      if (out.length >= limit) break;
    }
    return out;
  }

  // atalhos aprendidos: o que você mais lança (2+ vezes nos últimos 120 dias)
  function topShortcuts(state, n = 6, today = todayStr()) {
    const since = addDays(today, -120);
    const groups = new Map();
    for (const m of sortMovements(live(state).filter((x) => x.type !== 'transfer' && x.date >= since))) {
      const k = m.type + '|' + norm(m.desc);
      const g = groups.get(k);
      if (g) g.count++; else groups.set(k, { count: 1, last: m });
    }
    return [...groups.values()].filter((g) => g.count >= 2)
      .sort((a, b) => b.count - a.count || b.last.date.localeCompare(a.last.date)).slice(0, n)
      .map(({ last }) => ({ type: last.type, desc: last.desc, categoryId: last.categoryId, accountId: last.accountId, method: last.method, amount: last.amount }));
  }

  // ---------- categorias e contas ----------
  function cleanName(name, what) {
    const n = String(name || '').trim().slice(0, 30);
    if (!n) throw new FinError(`Dê um nome para ${what}.`);
    return n;
  }
  function addCategory(state, { name, emoji, kind }, now = nowISO()) {
    const n = cleanName(name, 'a categoria');
    if (state.categories.some((c) => norm(c.name) === norm(n))) throw new FinError('Já existe uma categoria com esse nome.');
    const c = { id: uid('cat_'), name: n, emoji: (emoji || '🏷️').slice(0, 4), kind: ['in', 'out', 'both'].includes(kind) ? kind : 'out' };
    state.categories.push(c);
    pushLog(state, now, 'category', c.id, `Criou categoria: ${c.name}`);
    return c;
  }
  function updateCategory(state, id, { name, emoji, kind }, now = nowISO()) {
    const c = getCategory(state, id);
    if (!c) throw new FinError('Categoria não encontrada.');
    const n = cleanName(name, 'a categoria');
    if (state.categories.some((x) => x.id !== id && norm(x.name) === norm(n))) throw new FinError('Já existe uma categoria com esse nome.');
    const old = c.name;
    c.name = n; if (emoji) c.emoji = emoji.slice(0, 4);
    if (id !== 'cat-outros' && ['in', 'out', 'both'].includes(kind)) c.kind = kind;
    pushLog(state, now, 'category', c.id, old === n ? `Editou categoria: ${n}` : `Renomeou categoria: ${old} → ${n}`);
    return c;
  }
  function deleteCategory(state, id, now = nowISO()) {
    if (id === 'cat-outros') throw new FinError('A categoria "Outros" não pode ser excluída.');
    const c = getCategory(state, id);
    if (!c) throw new FinError('Categoria não encontrada.');
    let moved = 0;
    for (const m of state.movements) if (m.categoryId === id) { m.categoryId = 'cat-outros'; moved++; }
    state.categories = state.categories.filter((x) => x.id !== id);
    pushLog(state, now, 'category', id, `Excluiu categoria: ${c.name}` + (moved ? ` (${moved} lançamentos foram para "Outros")` : ''));
    return moved;
  }
  const categoryUsage = (state, id) => state.movements.filter((m) => !m.deletedAt && m.categoryId === id).length;

  function addAccount(state, { name, type, initial }, now = nowISO()) {
    const n = cleanName(name, 'a conta');
    if (state.accounts.some((a) => !a.archived && norm(a.name) === norm(n))) throw new FinError('Já existe uma conta com esse nome.');
    const ini = Number.isInteger(initial) ? initial : 0;
    const a = { id: uid('acc_'), name: n, type: type === 'dinheiro' ? 'dinheiro' : 'conta', initial: ini, archived: false };
    state.accounts.push(a);
    pushLog(state, now, 'account', a.id, `Criou conta: ${a.name} (saldo inicial ${formatMoney(ini)})`);
    return a;
  }
  function updateAccount(state, id, { name, initial }, now = nowISO()) {
    const a = getAccount(state, id);
    if (!a) throw new FinError('Conta não encontrada.');
    const n = cleanName(name, 'a conta');
    if (state.accounts.some((x) => x.id !== id && !x.archived && norm(x.name) === norm(n))) throw new FinError('Já existe uma conta com esse nome.');
    const oldIni = a.initial;
    a.name = n;
    if (Number.isInteger(initial)) a.initial = initial;
    pushLog(state, now, 'account', a.id, `Editou conta: ${n}` + (oldIni !== a.initial ? ` (saldo inicial ${formatMoney(oldIni)} → ${formatMoney(a.initial)})` : ''));
    return a;
  }
  function setAccountArchived(state, id, archived, now = nowISO()) {
    const a = getAccount(state, id);
    if (!a) throw new FinError('Conta não encontrada.');
    if (archived) {
      if (accountBalance(state, id) !== 0) throw new FinError('Só dá para arquivar uma conta com saldo zerado. Transfira o saldo antes.');
      if (activeAccounts(state).length <= 1) throw new FinError('Você precisa manter ao menos uma conta ativa.');
      if (live(state).some((m) => m.status === 'planned' && (m.accountId === id || m.toAccountId === id))) throw new FinError('Essa conta tem lançamentos previstos. Mude a conta deles antes de arquivar.');
    }
    a.archived = !!archived;
    pushLog(state, now, 'account', a.id, `${archived ? 'Arquivou' : 'Reativou'} conta: ${a.name}`);
    return a;
  }

  // ---------- exportação e backup ----------
  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita fórmulas ao abrir no Excel
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(state, movements) {
    const cats = new Map(state.categories.map((c) => [c.id, c.name]));
    const accs = new Map(state.accounts.map((a) => [a.id, a.name]));
    const head = ['Data', 'Tipo', 'Descrição', 'Categoria', 'Valor', 'Conta', 'Conta destino', 'Forma de pagamento', 'Situação', 'Observações'];
    const rows = movements.map((m) => [
      m.date.split('-').reverse().join('/'), TYPE_LABEL[m.type], m.desc, m.type === 'transfer' ? '' : cats.get(m.categoryId) || 'Outros',
      plainMoney(m.amount), accs.get(m.accountId) || '', m.toAccountId ? accs.get(m.toAccountId) || '' : '', m.method,
      m.status === 'planned' ? 'Previsto' : m.type === 'in' ? 'Recebido' : m.type === 'out' ? 'Pago' : 'Concluída', m.note,
    ]);
    return [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
  }

  function exportBackup(state, now = nowISO()) {
    return JSON.stringify({ app: APP_ID, schema: SCHEMA, exportedAt: now, data: state }, null, 1);
  }

  function ensureBase(state) {
    if (!getCategory(state, 'cat-outros')) state.categories.push({ id: 'cat-outros', name: 'Outros', emoji: '📦', kind: 'both' });
    return state;
  }

  // Valida um arquivo de backup e devolve o estado pronto. Lança FinError se algo estiver errado.
  function validateBackup(input) {
    let obj = input;
    if (typeof input === 'string') {
      try { obj = JSON.parse(input); } catch (e) { throw new FinError('Esse arquivo não é um backup válido (não foi possível ler).'); }
    }
    if (!obj || obj.app !== APP_ID || !obj.data) throw new FinError('Esse arquivo não parece ser um backup deste app.');
    if (obj.schema > SCHEMA) throw new FinError('Esse backup é de uma versão mais nova do app. Atualize o app antes de restaurar.');
    const d = obj.data;
    if (!Array.isArray(d.accounts) || !Array.isArray(d.categories) || !Array.isArray(d.movements)) throw new FinError('Backup incompleto: faltam contas, categorias ou lançamentos.');
    const accIds = new Set();
    d.accounts.forEach((a, i) => {
      if (!a || typeof a.id !== 'string' || !a.name || !Number.isInteger(a.initial)) throw new FinError(`Conta ${i + 1} do backup está inválida.`);
      if (accIds.has(a.id)) throw new FinError('Backup com contas repetidas.');
      accIds.add(a.id); a.archived = !!a.archived; a.type = a.type === 'dinheiro' ? 'dinheiro' : 'conta';
    });
    if (!accIds.size) throw new FinError('Backup sem nenhuma conta.');
    const catIds = new Set();
    d.categories.forEach((c, i) => {
      if (!c || typeof c.id !== 'string' || !c.name) throw new FinError(`Categoria ${i + 1} do backup está inválida.`);
      catIds.add(c.id);
    });
    const ids = new Set();
    d.movements.forEach((m, i) => {
      const bad = (why) => new FinError(`Lançamento ${i + 1} do backup está inválido (${why}).`);
      if (!m || typeof m.id !== 'string' || ids.has(m.id)) throw bad('id');
      ids.add(m.id);
      if (!['in', 'out', 'transfer'].includes(m.type)) throw bad('tipo');
      if (!Number.isInteger(m.amount) || m.amount <= 0) throw bad('valor');
      if (!isValidDate(m.date)) throw bad('data');
      if (!accIds.has(m.accountId)) throw bad('conta');
      if (m.type === 'transfer' && !accIds.has(m.toAccountId)) throw bad('conta de destino');
      if (!['done', 'planned'].includes(m.status)) throw bad('situação');
      if (m.type !== 'transfer' && !catIds.has(m.categoryId)) m.categoryId = 'cat-outros';
      m.desc = String(m.desc || ''); m.note = String(m.note || ''); m.method = ALL_METHODS.includes(m.method) ? m.method : 'Outro';
      m.deletedAt = m.deletedAt || null; m.dueDate = m.dueDate || null; m.seriesId = m.seriesId || null;
    });
    const st = {
      app: APP_ID, schema: SCHEMA, createdAt: d.createdAt || nowISO(),
      accounts: d.accounts, categories: d.categories, movements: d.movements,
      log: Array.isArray(d.log) ? d.log.slice(-LOG_LIMIT) : [],
      settings: { onboarded: true, lastBackupAt: null, lastAccountId: null, lastMethod: null, ...(d.settings || {}) },
    };
    st.settings.onboarded = true;
    return ensureBase(st);
  }

  return {
    SCHEMA, APP_ID, METHODS, ALL_METHODS, DEFAULT_CATEGORIES, FinError,
    uid, norm, parseMoney, formatMoney, plainMoney,
    todayStr, isValidDate, ymOf, lastDayOfMonth, addMonthsYM, addMonthsToDate, addDays, daysBetween, monthLabel,
    newState, live, getAccount, getCategory, getMovement, activeAccounts,
    addMovement, addRecurring, updateMovement, applySnapshot, snapshot, deleteMovement, restoreMovement, markDone,
    accountBalance, totalBalance, monthSummary, byCategory, monthlySeries, balanceEvolution, alerts,
    filterMovements, suggestCategory, descSuggestions, topShortcuts,
    addCategory, updateCategory, deleteCategory, categoryUsage, addAccount, updateAccount, setAccountArchived,
    toCSV, exportBackup, validateBackup, describe,
  };
});
