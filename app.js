/* Meu Dinheiro — interface. Toda a matemática fica em logic.js; aqui só tela, eventos e armazenamento. */
(function () {
  'use strict';
  const L = FinLogic;
  const VERSION = '1.1.0';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fm = (c) => L.formatMoney(c);

  let S = null; // estado do app (carregado do IndexedDB)
  const UI = { tab: 'home', ym: L.ymOf(L.todayStr()), q: '', type: '', status: '', cat: '', method: '', acc: '', scope: 'month', shortcuts: [], planMode: 'month' };

  // ---------- ícones ----------
  const I = {
    home: '<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    left: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  };

  // ---------- persistência ----------
  let saving = Promise.resolve();
  function persist() {
    saving = saving.then(() => DB.set('state', S)).catch((e) => toast('Não consegui salvar os dados: ' + (e && e.message ? e.message : e), { err: true, ms: 9000 }));
    return saving;
  }
  function commit() { persist(); render(); }

  // ---------- datas ----------
  const shortDate = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
  const fullDate = (d) => d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
  function dayLabel(date) {
    const t = L.todayStr();
    if (date === t) return 'Hoje';
    if (date === L.addDays(t, -1)) return 'Ontem';
    if (date === L.addDays(t, 1)) return 'Amanhã';
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(/\./g, '');
  }
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const shortMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', ''); };
  const dateTimeBR = (iso) => { const d = new Date(iso); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
  const dueText = (m, today) => {
    const n = L.daysBetween(today, m.date);
    if (n === 0) return 'vence hoje'; if (n === 1) return 'vence amanhã'; if (n === -1) return 'venceu ontem';
    return n < 0 ? `atrasado há ${-n} dias` : `vence em ${n} dias`;
  };

  // ---------- avisos, folhas e diálogos ----------
  let toastTimer = null;
  function toast(msg, { action, onAction, err, ms = 5500 } = {}) {
    const root = $('#toast-root');
    clearTimeout(toastTimer);
    root.innerHTML = `<div class="toast ${err ? 'err' : ''}" role="status"><span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}</div>`;
    const btn = $('button', root);
    if (btn) btn.onclick = () => { root.innerHTML = ''; clearTimeout(toastTimer); onAction && onAction(); };
    toastTimer = setTimeout(() => { root.innerHTML = ''; }, ms);
  }

  const layers = [];
  function syncViewport() {
    const vv = window.visualViewport, root = $('#sheet-root');
    if (!vv || !root) return;
    root.style.top = vv.offsetTop + 'px';
    root.style.height = vv.height + 'px';
    root.style.bottom = 'auto';
  }
  if (window.visualViewport) { visualViewport.addEventListener('resize', syncViewport); visualViewport.addEventListener('scroll', syncViewport); }

  function openLayer(html) {
    const layer = document.createElement('div');
    layer.className = 'layer';
    layer.innerHTML = html;
    clearTimeout(toastTimer); $('#toast-root').innerHTML = '';
    $('#sheet-root').appendChild(layer);
    layers.push(layer);
    document.body.style.overflow = 'hidden';
    syncViewport();
    requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('open')));
    return layer;
  }
  function closeLayer(layer) {
    if (!layer || !layer.isConnected) return;
    layer.classList.remove('open');
    const i = layers.indexOf(layer);
    if (i > -1) layers.splice(i, 1);
    if (!layers.length) document.body.style.overflow = '';
    setTimeout(() => layer.remove(), 230);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && layers.length) { const top = layers[layers.length - 1]; if (top.dataset.locked !== '1') closeLayer(top); } });

  function sheet({ title, body, foot = '', full = false, locked = false }) {
    const layer = openLayer(`<div class="scrim"></div><div class="sheet ${full ? 'full' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="grab"></div><div class="head"><h3>${esc(title)}</h3>${locked ? '' : '<button type="button" class="icon-btn" data-close aria-label="Fechar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>'}</div>
      <div class="body">${body}</div>${foot ? `<div class="foot">${foot}</div>` : ''}</div>`);
    if (locked) layer.dataset.locked = '1';
    layer.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]') || (!locked && e.target.classList.contains('scrim'))) closeLayer(layer);
    });
    return layer;
  }

  function ask({ title, text, ok = 'Confirmar', danger = false, cancel = 'Cancelar' }) {
    return new Promise((resolve) => {
      const layer = openLayer(`<div class="scrim"></div><div class="dialog"><div class="box" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
        <h4>${esc(title)}</h4><p>${esc(text)}</p><div class="btns"><button type="button" class="btn" data-r="0">${esc(cancel)}</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div></div></div>`);
      layer.dataset.locked = '1';
      layer.addEventListener('click', (e) => {
        const b = e.target.closest('[data-r]');
        if (b) { closeLayer(layer); resolve(b.dataset.r === '1'); }
        else if (e.target.classList.contains('scrim')) { closeLayer(layer); resolve(false); }
      });
    });
  }

  async function saveFile(name, text, mimes) {
    for (const mime of mimes) {
      try {
        const file = new File([text], name, { type: mime });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: name });
          return 'shared';
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
      }
    }
    const url = URL.createObjectURL(new Blob([text], { type: mimes[0] }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'downloaded';
  }

  // ---------- peças de tela ----------
  const sign = (m) => (m.type === 'in' ? '+' : m.type === 'out' ? '−' : '');
  const amtClass = (m) => (m.type === 'in' ? 'green' : m.type === 'out' ? 'red' : 'blue');

  function movInfo(m) {
    const c = L.getCategory(S, m.categoryId), a = L.getAccount(S, m.accountId), to = m.toAccountId ? L.getAccount(S, m.toAccountId) : null;
    const icon = m.type === 'transfer' ? '↔️' : (c ? c.emoji : '📦');
    const sub = m.type === 'transfer'
      ? `${a ? a.name : '?'} → ${to ? to.name : '?'}`
      : `${c ? c.name : 'Outros'} · ${a ? a.name : '?'}${m.method && m.method !== 'Outro' ? ' · ' + m.method : ''}`;
    return { icon, sub };
  }

  function movRow(m, { showDate = false } = {}) {
    const { icon, sub } = movInfo(m);
    const today = L.todayStr();
    const planned = m.status === 'planned';
    const late = planned && m.date < today;
    return `<button type="button" class="row" data-act="edit" data-id="${esc(m.id)}">
      <span class="ic">${icon}</span>
      <span class="mid"><span class="t">${esc(m.desc)}${planned ? `<span class="pill ${late ? 'late' : ''}">${late ? 'atrasado' : 'previsto'}</span>` : ''}</span><span class="s">${esc(sub)}</span></span>
      <span class="amt num ${amtClass(m)}">${sign(m)}${esc(fm(m.amount))}${(() => { const parts = []; if (showDate) parts.push(shortDate(m.date)); if (m.plannedAmount != null && m.plannedAmount !== m.amount) parts.push('previsto ' + fm(m.plannedAmount)); return parts.length ? `<small>${esc(parts.join(' · '))}</small>` : ''; })()}</span></button>`;
  }

  function pendRow(m, today) {
    const { icon, sub } = movInfo(m);
    const late = m.date < today;
    return `<div class="row"><button type="button" class="grow" data-act="edit" data-id="${esc(m.id)}">
      <span class="ic">${icon}</span>
      <span class="mid"><span class="t">${esc(m.desc)}</span><span class="s ${late ? 'red' : ''}">${esc(dueText(m, today))} · ${shortDate(m.date)} · ${esc(sub)}</span></span>
      <span class="amt num ${amtClass(m)}">${sign(m)}${esc(fm(m.amount))}</span></button>
      <button type="button" class="ok-btn" data-act="done" data-id="${esc(m.id)}" aria-label="${m.type === 'in' ? 'Marcar como recebido' : 'Marcar como pago'}">${I.check}</button></div>`;
  }

  function monthNav() {
    const cur = L.ymOf(L.todayStr());
    return `<div class="month-nav"><button type="button" class="icon-btn" data-act="month" data-d="-1" aria-label="Mês anterior">${I.left}</button>
      <button type="button" class="lbl" data-act="month-now" aria-label="Voltar ao mês atual">${esc(cap(L.monthLabel(UI.ym)))}</button>
      <button type="button" class="icon-btn" data-act="month" data-d="1" aria-label="Próximo mês">${I.right}</button></div>`;
  }

  function lineChart(points) {
    if (points.length < 2) return '';
    const W = 320, H = 110, vals = points.map((p) => p.balance);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    const x = (i) => (i / (points.length - 1)) * W;
    const y = (v) => H - 8 - ((v - min) / (max - min)) * (H - 20);
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
    return `<svg class="line-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evolução do saldo no mês">
      <defs><linearGradient id="lg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#8b5cf6" stop-opacity=".35"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/></linearGradient>
      <linearGradient id="ls" x1="0" x2="1"><stop offset="0" stop-color="#4f8cff"/><stop offset="1" stop-color="#9b72ff"/></linearGradient></defs>
      <path d="${d} L${W},${H} L0,${H} Z" fill="url(#lg)"/><path d="${d}" fill="none" stroke="url(#ls)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      </svg>`;
  }

  function barsChart(series, curYm) {
    const max = Math.max(1, ...series.flatMap((r) => [r.in, r.out]));
    return `<div class="bars">${series.map((r) => `<div class="col ${r.ym === curYm ? 'cur' : ''}"><div class="pair">
      <div class="b in" style="height:${Math.max(r.in ? 3 : 0, (r.in / max) * 100)}%" title="Entradas ${esc(fm(r.in))}"></div>
      <div class="b out" style="height:${Math.max(r.out ? 3 : 0, (r.out / max) * 100)}%" title="Saídas ${esc(fm(r.out))}"></div></div>
      <div class="m">${esc(shortMonth(r.ym))}</div></div>`).join('')}</div>
      <div class="legend"><span><i class="dot" style="background:var(--green)"></i> Entradas</span><span><i class="dot" style="background:var(--red)"></i> Saídas</span></div>`;
  }

  // ---------- telas ----------
  const STARTERS = [
    { type: 'out', desc: 'Gasolina', categoryId: 'cat-carro', emoji: '⛽' },
    { type: 'out', desc: 'Alimentação', categoryId: 'cat-alimentacao', emoji: '🍽️' },
    { type: 'out', desc: 'Transporte', categoryId: 'cat-transporte', emoji: '🚌' },
    { type: 'in', desc: 'Serviço extra', categoryId: 'cat-extras', emoji: '🛠️' },
  ];

  function banners() {
    const out = [];
    const today = L.todayStr();
    if (DB.degraded) out.push(`<div class="banner warn"><span>⚠️</span><div><b>Armazenamento limitado.</b> O navegador não liberou o banco de dados (aba privada?). Seus dados podem ser apagados — faça backup com frequência.</div></div>`);
    const last = S.settings.lastBackupAt;
    const days = last ? L.daysBetween(L.todayStr(new Date(last)), today) : null;
    const snooze = localStorage.getItem('fin-snooze-backup');
    if (S.movements.length >= 3 && (days === null || days >= 7) && snooze !== today) {
      out.push(`<div class="banner warn"><span>💾</span><div><b>${days === null ? 'Você ainda não fez backup.' : `Seu último backup foi há ${days} dias.`}</b>
        Os dados ficam só neste celular. Salve uma cópia para não perder nada.<br><button type="button" class="btn primary sm" data-act="backup-now">Fazer backup agora</button></div><button type="button" class="x" data-act="snooze-backup" aria-label="Lembrar amanhã">×</button></div>`);
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone;
    if (ios && !localStorage.getItem('fin-hide-install') && S.movements.length >= 1) {
      out.push(`<div class="banner info"><span>📲</span><div><b>Instale na tela de início.</b> No Safari, toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>. Assim o iPhone protege melhor seus dados.</div><button type="button" class="x" data-act="hide-install" aria-label="Dispensar">×</button></div>`);
    }
    return out.join('');
  }

  function homeView() {
    const today = L.todayStr(), curYm = L.ymOf(today), ym = UI.ym;
    const isCur = ym === curYm, isPast = ym < curYm;
    const sm = L.monthSummary(S, ym, today);
    const act = L.activeAccounts(S);
    let h = banners();
    h += `<div class="top stack"><h1>Meu Dinheiro</h1>${monthNav()}</div>`;

    const subs = [];
    if (isCur) { subs.push(['Livre após contas', sm.canSpend, sm.canSpend < 0 ? 'red' : '']); subs.push(['Previsto p/ fim do mês', sm.projected, sm.projected < 0 ? 'red' : '']); }
    else if (isPast) subs.push(['Resultado do mês', sm.net, sm.net < 0 ? 'red' : 'green']);
    else subs.push([`Previsto até o fim de ${shortMonth(ym)}`, sm.projected, sm.projected < 0 ? 'red' : '']);
    h += `<div class="card hero"><div class="lbl">Saldo ${isCur ? 'disponível' : 'atual (hoje)'}</div>
      <div class="big num ${sm.balance < 0 ? 'red' : ''}">${esc(fm(sm.balance))}</div>
      <div class="sub">${subs.map(([k, v, c]) => `<span>${esc(k)}<br><b class="num ${c}">${esc(fm(v))}</b></span>`).join('')}</div></div>`;

    if (act.length > 1) {
      h += `<div class="chips scroll">${act.map((a) => `<span class="chip sm">${a.type === 'dinheiro' ? '💵' : '🏦'} ${esc(a.name)} · <b class="num">${esc(fm(L.accountBalance(S, a.id)))}</b></span>`).join('')}</div>`;
    }

    // alertas
    const al = [];
    if (sm.overdueOutCount) al.push(`<button type="button" class="alert bad" data-act="pend"><span class="ico">🚨</span><span class="t"><b>${sm.overdueOutCount} ${sm.overdueOutCount > 1 ? 'contas atrasadas' : 'conta atrasada'}</b>Total ${esc(fm(sm.overdueOut))} para pagar</span><span class="go">ver ›</span></button>`);
    const soon = L.alerts(S, today, 3).filter((a) => a.kind === 'soon' && a.movement.type === 'out');
    if (soon.length) { const tot = soon.reduce((t, a) => t + a.movement.amount, 0); al.push(`<button type="button" class="alert warn" data-act="pend"><span class="ico">⏰</span><span class="t"><b>${soon.length} ${soon.length > 1 ? 'contas vencem' : 'conta vence'} em até 3 dias</b>${esc(soon.map((a) => a.movement.desc).slice(0, 2).join(', '))}${soon.length > 2 ? '…' : ''} · ${esc(fm(tot))}</span><span class="go">ver ›</span></button>`); }
    const lateIn = L.alerts(S, today, 0).filter((a) => a.kind === 'overdue' && a.movement.type === 'in');
    if (lateIn.length) al.push(`<button type="button" class="alert info" data-act="pend"><span class="ico">📥</span><span class="t"><b>${lateIn.length} ${lateIn.length > 1 ? 'recebimentos previstos' : 'recebimento previsto'} sem confirmação</b>Só entra no saldo quando você confirmar</span><span class="go">ver ›</span></button>`);
    if (isCur && sm.canSpend < 0) al.push(`<div class="alert bad"><span class="ico">⚠️</span><span class="t"><b>As contas do mês passam do seu saldo</b>Faltam ${esc(fm(-sm.canSpend))} para cobrir o que está previsto</span></div>`);
    h += al.join('');

    // atalhos
    UI.shortcuts = L.topShortcuts(S, 6, today);
    const sc = UI.shortcuts.length ? UI.shortcuts.map((s) => ({ ...s, emoji: (L.getCategory(S, s.categoryId) || { emoji: '📦' }).emoji })) : STARTERS;
    UI.shortcuts = sc;
    h += `<div class="chips scroll" aria-label="Atalhos de lançamento rápido">${sc.map((s, i) => `<button type="button" class="chip" data-act="shortcut" data-i="${i}">${s.emoji} ${esc(s.desc)}${s.amount ? ` · ${esc(fm(s.amount))}` : ''}</button>`).join('')}</div>`;

    if (!S.movements.some((m) => !m.deletedAt)) {
      h += `<div class="card empty"><span class="e">✨</span><b>Tudo pronto para começar</b><br>Toque no botão <b>+</b> e lance seu primeiro gasto ou entrada. Leva uns 5 segundos.</div>`;
    }

    h += `<div class="grid2">
      <div class="card stat"><div class="k"><i class="dot" style="background:var(--green)"></i>Recebido</div><div class="v num green">${esc(fm(sm.received))}</div><div class="d">entradas no mês</div></div>
      <div class="card stat"><div class="k"><i class="dot" style="background:var(--red)"></i>Gasto</div><div class="v num red">${esc(fm(sm.spent))}</div><div class="d">${sm.paidOutCount} ${sm.paidOutCount === 1 ? 'saída paga' : 'saídas pagas'}</div></div>
      <div class="card stat"><div class="k"><i class="dot" style="background:var(--purple)"></i>A pagar</div><div class="v num purple">${esc(fm(sm.toPay))}</div><div class="d">${sm.pendingOutCount} ${sm.pendingOutCount === 1 ? 'conta pendente' : 'contas pendentes'}</div></div>
      <div class="card stat"><div class="k"><i class="dot" style="background:var(--blue)"></i>A receber</div><div class="v num blue">${esc(fm(sm.toReceive))}</div><div class="d">previsto, ainda não entrou</div></div></div>`;

    const evo = L.balanceEvolution(S, ym, today);
    if (evo.length > 1) h += `<div class="card"><h2>Evolução do saldo</h2>${lineChart(evo)}<div class="legend"><span>dia 1</span><span style="margin-left:auto">${isCur ? 'hoje' : 'fim do mês'}: <b class="num" style="color:var(--text)">${esc(fm(evo[evo.length - 1].balance))}</b></span></div></div>`;

    const series = L.monthlySeries(S, ym, 6);
    if (series.some((r) => r.in || r.out)) h += `<div class="card"><h2>Entradas × saídas</h2>${barsChart(series, ym)}</div>`;

    const cats = L.byCategory(S, ym, 'out');
    if (cats.length) {
      const top = cats.slice(0, 6), rest = cats.slice(6).reduce((t, c) => t + c.amount, 0);
      const rows = top.map((c) => ({ ...c })).concat(rest ? [{ emoji: '…', name: 'Outras', amount: rest, pct: rest / cats.reduce((t, c) => t + c.amount, 0) }] : []);
      h += `<div class="card"><h2>Gastos por categoria</h2>${rows.map((c) => `<div class="hbar"><div class="h"><span>${c.emoji} ${esc(c.name)}</span><span class="num">${esc(fm(c.amount))} <span class="muted">· ${Math.round(c.pct * 100)}%</span></span></div><div class="track"><div class="fill" style="width:${Math.max(3, c.pct * 100)}%"></div></div></div>`).join('')}</div>`;
    }

    const recent = L.filterMovements(S, { status: 'done' }).slice(0, 5);
    if (recent.length) h += `<div class="top" style="margin:18px 0 8px"><div class="section-t" style="margin:0 4px">Últimos lançamentos</div><button type="button" class="link" data-act="tab" data-tab="movs">Ver todos</button></div><div class="list">${recent.map((m) => movRow(m, { showDate: true })).join('')}</div>`;
    return h;
  }

  function movFilter() {
    const f = { q: UI.q, type: UI.type || null, status: UI.status || null, categoryId: UI.cat || null, method: UI.method || null, accountId: UI.acc || null };
    if (UI.scope === 'month') { f.from = UI.ym + '-01'; f.to = L.lastDayOfMonth(UI.ym); }
    return f;
  }
  function movList() {
    const list = L.filterMovements(S, movFilter());
    if (!list.length) return `<div class="empty"><span class="e">🔎</span>${UI.q || UI.type || UI.status || UI.cat || UI.method || UI.acc ? 'Nada encontrado com esses filtros.' : 'Nenhum lançamento neste período.'}</div>`;
    let inn = 0, out = 0;
    list.forEach((m) => { if (m.status === 'done') { if (m.type === 'in') inn += m.amount; else if (m.type === 'out') out += m.amount; } });
    let h = `<div class="totals"><span>${list.length} ${list.length === 1 ? 'lançamento' : 'lançamentos'}</span><span class="green">Entradas ${esc(fm(inn))}</span><span class="red">Saídas ${esc(fm(out))}</span></div>`;
    let cur = null, buf = [];
    const flush = () => { if (cur) h += `<div class="day"><span>${esc(dayLabel(cur))}</span></div><div class="list">${buf.join('')}</div>`; buf = []; };
    for (const m of list) { if (m.date !== cur) { flush(); cur = m.date; } buf.push(movRow(m)); }
    flush();
    return h;
  }
  function advCount() { return [UI.cat, UI.method, UI.acc].filter(Boolean).length; }
  function movsView() {
    const chip = (label, on, attrs) => `<button type="button" class="chip ${on ? 'on' : ''}" ${attrs}>${label}</button>`;
    const n = advCount();
    return `<div class="top ${UI.scope === 'month' ? 'stack' : ''}"><h1>Movimentos</h1>${UI.scope === 'month' ? monthNav() : ''}</div>
      <div class="search">${I.search}<input id="q" type="search" inputmode="search" enterkeyhint="search" placeholder="Buscar descrição, categoria, valor…" value="${esc(UI.q)}" autocomplete="off" aria-label="Buscar movimentações"></div>
      <div class="chips scroll">
        ${chip('Tudo', !UI.type && !UI.status, 'data-act="ftype" data-v=""')}${chip('Entradas', UI.type === 'in', 'data-act="ftype" data-v="in"')}${chip('Saídas', UI.type === 'out', 'data-act="ftype" data-v="out"')}${chip('Transf.', UI.type === 'transfer', 'data-act="ftype" data-v="transfer"')}${chip('Previstos', UI.status === 'planned', 'data-act="fstatus"')}
        ${chip(UI.scope === 'month' ? '📅 Só este mês' : '♾️ Todos os meses', UI.scope === 'all', 'data-act="scope"')}${chip(`⚙️ Filtros${n ? ' (' + n + ')' : ''}`, n > 0, 'data-act="filters"')}</div>
      <div id="mov-list">${movList()}</div>`;
  }

  function pendList() {
    const today = L.todayStr();
    const pend = L.filterMovements(S, { status: 'planned' }).reverse(); // mais antigos primeiro
    const toPay = pend.filter((m) => m.type === 'out').reduce((t, m) => t + m.amount, 0);
    const toRec = pend.filter((m) => m.type === 'in').reduce((t, m) => t + m.amount, 0);
    let h = `<div class="grid2"><div class="card stat"><div class="k"><i class="dot" style="background:var(--purple)"></i>A pagar (tudo)</div><div class="v num purple">${esc(fm(toPay))}</div></div>
      <div class="card stat"><div class="k"><i class="dot" style="background:var(--blue)"></i>A receber (tudo)</div><div class="v num blue">${esc(fm(toRec))}</div></div></div>`;
    if (!pend.length) return h + `<div class="empty"><span class="e">🎉</span><b>Nada pendente</b><br>Contas futuras aparecem aqui quando você lança algo como <b>previsto</b> ou cadastra uma <b>despesa fixa</b>.</div>`;
    const groups = [['Atrasados', (m) => m.date < today], ['Próximos 7 dias', (m) => m.date >= today && m.date <= L.addDays(today, 7)], ['Mais adiante', (m) => m.date > L.addDays(today, 7)]];
    for (const [name, fn] of groups) {
      const items = pend.filter(fn);
      if (!items.length) continue;
      const tot = items.reduce((t, m) => t + (m.type === 'in' ? m.amount : -m.amount), 0);
      h += `<div class="day"><span class="${name === 'Atrasados' ? 'red' : ''}">${name}</span><span class="num">${tot >= 0 ? '+' : '−'}${esc(fm(Math.abs(tot)))}</span></div><div class="list">${items.map((m) => pendRow(m, today)).join('')}</div>`;
    }
    return h + `<p class="note" style="padding:4px 6px">Toque no ✓ quando pagar ou receber. O valor só muda o saldo depois disso.</p>`;
  }

  function moreView() {
    const live = L.live(S).length;
    const last = S.settings.lastBackupAt;
    const item = (ic, t, s, act) => `<button type="button" class="row" data-act="${act}"><span class="ic">${ic}</span><span class="mid"><span class="t">${t}</span><span class="s">${s}</span></span><span class="arrow muted">›</span></button>`;
    return `<div class="top"><h1>Mais</h1></div>
      <div class="list menu">
        ${item('🏦', 'Contas e saldos', `${L.activeAccounts(S).length} ${L.activeAccounts(S).length === 1 ? 'conta' : 'contas'} ativas`, 'm-accounts')}
        ${item('🔁', 'Despesas fixas', S.recurring.length ? `${L.recurringTotals(S).count} ativas · ${fm(L.recurringTotals(S).out)} por mês` : 'Internet, faculdade, assinaturas…', 'm-rules')}
        ${item('🏷️', 'Categorias', `${S.categories.length} categorias`, 'm-cats')}
        ${item('💾', 'Backup e restauração', last ? 'Último backup: ' + dateTimeBR(last) : 'Nenhum backup feito ainda', 'm-backup')}
        ${item('📤', 'Exportar planilha (CSV)', 'Abre no Excel e no Planilhas', 'm-csv')}
        ${item('🕘', 'Histórico de alterações', 'Quem mudou o quê e quando', 'm-log')}
        ${item('ℹ️', 'Como funciona e instalação', 'Guardar dados, iPhone, privacidade', 'm-about')}</div>
      <p class="note" style="padding:4px 8px">${live} ${live === 1 ? 'lançamento guardado' : 'lançamentos guardados'} neste aparelho · versão ${VERSION}</p>`;
  }

  function renderTabbar() {
    const today = L.todayStr();
    const late = L.alerts(S, today, 0).filter((a) => a.kind === 'overdue' && a.movement.type === 'out').length;
    const t = (id, label, ic, badge = 0) => `<button type="button" class="tab ${UI.tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}" aria-label="${label}" ${UI.tab === id ? 'aria-current="page"' : ''}>${I[ic]}<span>${label}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</button>`;
    $('#tabbar').innerHTML = t('home', 'Início', 'home') + t('movs', 'Movimentos', 'list') +
      `<button type="button" class="fab" data-act="new" aria-label="Nova movimentação">+</button>` +
      t('plan', 'Planejar', 'cal', late) + t('more', 'Mais', 'more');
  }

  function render(resetScroll = false) {
    if (!S) return;
    autoGenerate();
    const y = window.scrollY;
    renderTabbar();
    try {
      $('#view').innerHTML = { home: homeView, movs: movsView, plan: planView, more: moreView }[UI.tab]();
    } catch (e) {
      console.error(e);
      $('#view').innerHTML = `<div class="card"><b>Algo deu errado ao montar a tela.</b><p class="note">${esc(e.message || e)}</p><p class="note">Seus dados estão salvos. Tente fechar e abrir o app.</p></div>`;
    }
    window.scrollTo(0, resetScroll ? 0 : y);
  }

  // ---------- formulário de movimentação ----------
  function lastMatching(desc, type) {
    const d = L.norm(desc);
    return L.filterMovements(S, { type }).find((m) => L.norm(m.desc) === d) || null;
  }

  function openMovementForm(opts = {}) {
    const ed = opts.id ? L.getMovement(S, opts.id) : null;
    if (opts.id && (!ed || ed.deletedAt)) return;
    const act = L.activeAccounts(S);
    const pre = opts.prefill || {};
    const validAcc = (id) => act.find((a) => a.id === id);
    const F = {
      type: ed ? ed.type : pre.type || 'out',
      categoryId: ed ? ed.categoryId : pre.categoryId || null,
      catTouched: !!(ed || pre.categoryId),
      method: ed ? ed.method : pre.method || S.settings.lastMethod || 'Pix',
      accountId: ed ? ed.accountId : (validAcc(pre.accountId) || validAcc(S.settings.lastAccountId) || act[0]).id,
      toAccountId: ed ? ed.toAccountId : null,
      status: ed ? ed.status : opts.planned ? 'planned' : 'done',
      statusTouched: !!(ed || opts.planned),
      date: ed ? ed.date : L.todayStr(),
      repeat: 1,
    };
    if (F.method === 'Transferência') F.method = 'Pix';
    if (!F.toAccountId) F.toAccountId = (act.find((a) => a.id !== F.accountId) || {}).id || null;
    const today = L.todayStr();

    const accOpts = (sel, includeId) => {
      const list = S.accounts.filter((a) => !a.archived || a.id === includeId);
      return list.map((a) => `<option value="${esc(a.id)}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)} — ${esc(fm(L.accountBalance(S, a.id)))}</option>`).join('');
    };

    const body = `<form id="mf" novalidate autocomplete="off">
      <div class="seg" role="tablist" aria-label="Tipo"><button type="button" data-t="out" class="out">Saída</button><button type="button" data-t="in" class="in">Entrada</button><button type="button" data-t="transfer" class="transfer">Transferência</button></div>
      <div class="amount-wrap" id="aw"><span>R$</span><input id="f-amount" inputmode="decimal" autocomplete="off" placeholder="0,00" aria-label="Valor" value="${ed ? esc(L.plainMoney(ed.amount)) : pre.amount ? esc(L.plainMoney(pre.amount)) : ''}"></div>
      <div class="field" id="fld-desc"><label for="f-desc">Descrição</label><input class="inp" id="f-desc" maxlength="80" autocomplete="off" autocapitalize="sentences" placeholder="Ex.: Gasolina" value="${esc(ed ? ed.desc : pre.desc || '')}"><div class="chips scroll" id="sugg" style="margin:8px -16px 0"></div></div>
      <div class="field" id="fld-cat"><div class="lab">Categoria</div><div class="chips" id="cats"></div></div>
      <div class="field"><label for="f-date">Data</label><div class="two"><input type="date" class="inp" id="f-date" value="${esc(F.date)}"><div class="chips" id="dayq" style="align-content:center"><button type="button" class="chip" data-d="0">Hoje</button><button type="button" class="chip" data-d="-1">Ontem</button></div></div></div>
      <div class="field" id="fld-acc"></div>
      <div class="field" id="fld-method"><div class="lab">Forma de pagamento</div><div class="chips" id="methods"></div></div>
      <div class="field" id="fld-status"><div class="lab">Situação</div><div class="seg two" id="status-seg"></div><div class="hint" id="status-hint"></div></div>
      <div class="field"><label for="f-note">Observações (opcional)</label><textarea class="inp" id="f-note" rows="2" maxlength="300">${esc(ed ? ed.note : '')}</textarea></div>
      ${ed ? '' : `<div class="field" id="fld-repeat"><label for="f-repeat">Repetir todo mês</label><select class="inp" id="f-repeat">${[[1, 'Não repetir'], [2, '2 meses'], [3, '3 meses'], [4, '4 meses'], [6, '6 meses'], [8, '8 meses'], [12, '12 meses'], [24, '24 meses']].map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select><div class="hint">Os meses seguintes entram como <b>previstos</b> e não mexem no saldo até você confirmar.</div></div>`}
      ${ed && ed.seriesId ? '<p class="note">Este lançamento faz parte de uma série mensal. Mudanças aqui valem só para este mês.</p>' : ''}
      ${ed && ed.ruleId && L.getRule(S, ed.ruleId) ? `<p class="note">Vem da despesa fixa “${esc(L.getRule(S, ed.ruleId).name)}”. Mudanças aqui valem só para este mês.</p><button type="button" class="btn" id="open-rule" style="width:100%;margin-bottom:12px">🔁 Editar a despesa fixa</button>` : ''}
      ${ed && ed.status === 'planned' ? `<button type="button" class="btn" id="mark-done" style="width:100%;margin-bottom:12px">✓ Marcar como ${ed.type === 'in' ? 'recebido' : 'pago'}</button>` : ''}
      <p class="err" id="err" role="alert"></p></form>`;
    const foot = ed
      ? `<button type="button" class="btn danger" id="del" style="flex:0 0 auto">Excluir</button><button type="button" class="btn primary" id="save">Salvar</button>`
      : `<button type="button" class="btn primary" id="save">Salvar</button>`;
    const layer = sheet({ title: ed ? 'Editar movimentação' : 'Nova movimentação', body, foot });
    const q = (s) => $(s, layer);
    const setErr = (t) => { q('#err').textContent = t || ''; };

    const catsFor = () => S.categories.filter((c) => c.kind === F.type || c.kind === 'both');
    function renderCats() {
      if (F.categoryId && !catsFor().some((c) => c.id === F.categoryId)) { const cur = L.getCategory(S, F.categoryId); if (!(ed && cur)) F.categoryId = null; }
      q('#cats').innerHTML = catsFor().map((c) => `<button type="button" class="chip ${F.type} ${c.id === F.categoryId ? 'on' : ''}" data-c="${esc(c.id)}">${c.emoji} ${esc(c.name)}</button>`).join('') + `<button type="button" class="chip dashed" data-newcat>＋ Nova</button>`;
    }
    function renderSugg() {
      const txt = L.norm(q('#f-desc').value);
      let list = L.descSuggestions(S, F.type, 30).filter((d) => !txt || L.norm(d).includes(txt)).filter((d) => L.norm(d) !== txt).slice(0, 8);
      q('#sugg').innerHTML = list.map((d) => `<button type="button" class="chip sm" data-s="${esc(d)}" style="margin-right:8px">${esc(d)}</button>`).join('');
      q('#sugg').style.display = list.length ? '' : 'none';
    }
    function renderAcc() {
      if (F.type === 'transfer') {
        q('#fld-acc').innerHTML = `<div class="two"><div><label for="f-acc">De</label><select class="inp" id="f-acc">${accOpts(F.accountId, ed && ed.accountId)}</select></div><div><label for="f-to">Para</label><select class="inp" id="f-to">${accOpts(F.toAccountId, ed && ed.toAccountId)}</select></div></div>`;
      } else {
        q('#fld-acc').innerHTML = `<label for="f-acc">${F.type === 'in' ? 'Entrou na conta' : 'Saiu da conta'}</label><select class="inp" id="f-acc">${accOpts(F.accountId, ed && ed.accountId)}</select>`;
      }
    }
    function renderStatus() {
      const inc = F.type === 'in';
      q('#status-seg').innerHTML = `<button type="button" data-st="done" class="${F.status === 'done' ? 'on done' : ''}">${inc ? '✓ Já recebi' : '✓ Já paguei'}</button><button type="button" data-st="planned" class="${F.status === 'planned' ? 'on planned' : ''}">⏳ Previsto</button>`;
      q('#status-hint').textContent = F.status === 'planned' ? `Fica em “Pendentes” e só entra no saldo quando você confirmar ${inc ? 'o recebimento' : 'o pagamento'}.` : '';
    }
    function renderMethods() {
      q('#methods').innerHTML = L.METHODS.map((m) => `<button type="button" class="chip ${m === F.method ? 'on' : ''}" data-m="${esc(m)}">${esc(m)}</button>`).join('');
    }
    function renderType() {
      $$('.seg:not(.two) button', layer).forEach((b) => b.classList.toggle('on', b.dataset.t === F.type));
      $$('.seg:not(.two) button', layer).forEach((b) => { if (b.dataset.t === F.type) b.classList.add(F.type); });
      q('#aw').className = 'amount-wrap ' + F.type;
      const tr = F.type === 'transfer';
      ['#fld-cat', '#fld-method', '#fld-status', '#fld-repeat'].forEach((s) => { const el = q(s); if (el) el.classList.toggle('hidden', tr); });
      q('#fld-desc').classList.toggle('hidden', false);
      q('#f-desc').placeholder = tr ? 'Ex.: Saque para o caixa (opcional)' : F.type === 'in' ? 'Ex.: Salário' : 'Ex.: Gasolina';
      renderCats(); renderSugg(); renderAcc(); renderStatus(); renderMethods();
    }
    renderType();

    layer.addEventListener('click', (e) => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.t) { F.type = t.dataset.t; if (F.type === 'transfer' && F.toAccountId === F.accountId) F.toAccountId = (act.find((a) => a.id !== F.accountId) || {}).id || null; if (!F.catTouched) F.categoryId = L.suggestCategory(S, q('#f-desc').value, F.type); renderType(); }
      else if (t.dataset.c) { F.categoryId = t.dataset.c; F.catTouched = true; renderCats(); }
      else if (t.hasAttribute('data-newcat')) openCategoryEditor({ kind: F.type, onSaved: (c) => { F.categoryId = c.id; F.catTouched = true; renderCats(); } });
      else if (t.dataset.m) { F.method = t.dataset.m; renderMethods(); }
      else if (t.dataset.st) { F.status = t.dataset.st; F.statusTouched = true; renderStatus(); }
      else if (t.dataset.d !== undefined) { F.date = L.addDays(today, Number(t.dataset.d)); q('#f-date').value = F.date; syncStatusByDate(); }
      else if (t.dataset.s !== undefined) {
        q('#f-desc').value = t.dataset.s;
        const last = lastMatching(t.dataset.s, F.type);
        if (last) {
          if (!F.catTouched && last.categoryId) F.categoryId = last.categoryId;
          if (F.type !== 'transfer') { F.method = last.method !== 'Transferência' ? last.method : F.method; if (act.some((a) => a.id === last.accountId)) F.accountId = last.accountId; }
          if (!q('#f-amount').value.trim()) q('#f-amount').value = L.plainMoney(last.amount);
          renderCats(); renderAcc(); renderMethods();
        }
        renderSugg(); q('#f-amount').focus({ preventScroll: true });
      }
    });
    function syncStatusByDate() {
      if (!ed && !F.statusTouched && F.type !== 'transfer') { F.status = F.date > today ? 'planned' : 'done'; renderStatus(); }
    }
    layer.addEventListener('input', (e) => {
      const id = e.target.id;
      if (id === 'f-amount') { const v = e.target.value.replace(/[^\d.,]/g, ''); if (v !== e.target.value) e.target.value = v; }
      else if (id === 'f-desc') {
        if (!F.catTouched) { const sc = L.suggestCategory(S, e.target.value, F.type); if (sc !== F.categoryId) { F.categoryId = sc; renderCats(); } }
        renderSugg();
      }
    });
    layer.addEventListener('change', (e) => {
      const id = e.target.id;
      if (id === 'f-date') { F.date = e.target.value; syncStatusByDate(); }
      else if (id === 'f-acc') { F.accountId = e.target.value; if (F.type === 'transfer' && F.toAccountId === F.accountId) { F.toAccountId = (act.find((a) => a.id !== F.accountId) || {}).id || null; renderAcc(); } }
      else if (id === 'f-to') F.toAccountId = e.target.value;
      else if (id === 'f-repeat') { F.repeat = Number(e.target.value); if (F.repeat > 1 && !F.statusTouched) { /* mantém o status escolhido para o 1º mês */ } }
    });

    let busy = false;
    function submit() {
      if (busy) return;
      const amount = L.parseMoney(q('#f-amount').value);
      if (amount == null || amount <= 0) { setErr('Informe um valor válido. Ex.: 25 ou 25,90'); q('#f-amount').focus(); return; }
      const desc = q('#f-desc').value;
      const input = {
        type: F.type, desc, amount, date: q('#f-date').value, method: F.method, accountId: F.accountId, toAccountId: F.toAccountId,
        categoryId: F.categoryId || L.suggestCategory(S, desc, F.type) || 'cat-outros', status: F.status, note: q('#f-note').value,
      };
      busy = true;
      try {
        const word = { in: 'Entrada', out: 'Saída', transfer: 'Transferência' }[F.type];
        if (ed) {
          const { before } = L.updateMovement(S, ed.id, input);
          commit(); closeLayer(layer);
          toast('Alterações salvas', { action: 'Desfazer', onAction: () => { L.applySnapshot(S, ed.id, before); commit(); } });
        } else {
          const list = F.repeat > 1 && F.type !== 'transfer' ? L.addRecurring(S, input, F.repeat) : [L.addMovement(S, input)];
          commit(); closeLayer(layer);
          const msg = list.length > 1 ? `${list.length} lançamentos mensais criados` : input.status === 'planned' ? `${word} prevista de ${fm(amount)} salva` : `${word} de ${fm(amount)} salva`;
          toast(msg, { action: 'Desfazer', onAction: () => { list.forEach((m) => L.deleteMovement(S, m.id)); commit(); } });
        }
      } catch (err) {
        busy = false;
        if (err instanceof L.FinError) setErr(err.message); else { console.error(err); setErr('Erro inesperado: ' + err.message); }
      }
    }
    q('#save').addEventListener('click', submit);
    q('#mf').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    if (ed) {
      q('#del').addEventListener('click', async () => {
        const ok = await ask({ title: 'Excluir este lançamento?', text: `${ed.desc} · ${fm(ed.amount)} em ${fullDate(ed.date)}. Você poderá desfazer logo depois.`, ok: 'Excluir', danger: true });
        if (!ok) return;
        L.deleteMovement(S, ed.id); commit(); closeLayer(layer);
        toast('Lançamento excluído', { action: 'Desfazer', onAction: () => { L.restoreMovement(S, ed.id); commit(); } });
      });
      const orb = q('#open-rule');
      if (orb) orb.addEventListener('click', () => { closeLayer(layer); openRuleEditor(ed.ruleId); });
      const md = q('#mark-done');
      if (md) md.addEventListener('click', () => { closeLayer(layer); openMarkDone(ed.id); });
    } else if (!pre.amount || !pre.desc) {
      q('#f-amount').focus({ preventScroll: true });
    }
    if (!ed && pre.desc && !pre.amount) q('#f-amount').focus({ preventScroll: true });
  }

  function openMarkDone(id) {
    const m = L.getMovement(S, id);
    if (!m || m.deletedAt || m.status !== 'planned') return;
    const inc = m.type === 'in';
    const act = L.activeAccounts(S);
    const body = `<div class="card" style="margin-bottom:14px"><div class="muted" style="font-size:13px">${inc ? 'Recebimento previsto' : 'Pagamento previsto'} para ${fullDate(m.date)}</div><div style="font-size:20px;font-weight:700;margin:4px 0">${esc(m.desc)}</div><div class="num ${amtClass(m)}" style="font-size:26px;font-weight:760">${esc(fm(m.amount))}</div></div>
      <div class="field"><label for="d-date">${inc ? 'Data em que recebeu' : 'Data em que pagou'}</label><input type="date" class="inp" id="d-date" value="${esc(L.todayStr())}"></div>
      <div class="field"><label for="d-amount">${inc ? 'Valor recebido' : 'Valor pago'} (R$)</label><input class="inp" id="d-amount" inputmode="decimal" autocomplete="off" value="${esc(L.plainMoney(m.amount))}"><div class="hint">Veio diferente do previsto? Ajuste aqui. O valor previsto fica guardado.</div></div>
      <div class="field"><label for="d-acc">${inc ? 'Entrou na conta' : 'Saiu da conta'}</label><select class="inp" id="d-acc">${act.map((a) => `<option value="${esc(a.id)}" ${a.id === m.accountId ? 'selected' : ''}>${esc(a.name)} — ${esc(fm(L.accountBalance(S, a.id)))}</option>`).join('')}</select></div>
      <p class="err" id="err" role="alert"></p>`;
    const layer = sheet({ title: inc ? 'Confirmar recebimento' : 'Confirmar pagamento', body, foot: `<button type="button" class="btn primary" id="ok">${inc ? 'Confirmar recebimento' : 'Confirmar pagamento'}</button>` });
    $('#d-amount', layer).addEventListener('input', (e) => { const v = e.target.value.replace(/[^\d.,]/g, ''); if (v !== e.target.value) e.target.value = v; });
    $('#ok', layer).addEventListener('click', () => {
      try {
        const amt = L.parseMoney($('#d-amount', layer).value);
        if (amt == null || amt <= 0) throw new L.FinError('Informe um valor válido. Ex.: 120 ou 120,50');
        const { before } = L.markDone(S, id, { date: $('#d-date', layer).value, accountId: $('#d-acc', layer).value, amount: amt });
        commit(); closeLayer(layer);
        toast(inc ? 'Recebimento confirmado' : 'Pagamento confirmado', { action: 'Desfazer', onAction: () => { L.applySnapshot(S, id, before, undefined, 'Desfez confirmação'); commit(); } });
      } catch (e) { if (e instanceof L.FinError) $('#err', layer).textContent = e.message; else throw e; }
    });
  }

  function openFilters() {
    const opt = (v, label, sel) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(label)}</option>`;
    const body = `<div class="field"><label for="x-cat">Categoria</label><select class="inp" id="x-cat">${opt('', 'Todas', UI.cat)}${S.categories.map((c) => opt(c.id, `${c.emoji} ${c.name}`, UI.cat)).join('')}</select></div>
      <div class="field"><label for="x-method">Forma de pagamento</label><select class="inp" id="x-method">${opt('', 'Todas', UI.method)}${L.ALL_METHODS.map((m) => opt(m, m, UI.method)).join('')}</select></div>
      <div class="field"><label for="x-acc">Conta</label><select class="inp" id="x-acc">${opt('', 'Todas', UI.acc)}${S.accounts.map((a) => opt(a.id, a.name + (a.archived ? ' (arquivada)' : ''), UI.acc)).join('')}</select></div>`;
    const layer = sheet({ title: 'Filtros', body, foot: `<button type="button" class="btn" id="clear">Limpar</button><button type="button" class="btn primary" id="apply">Aplicar</button>` });
    $('#apply', layer).onclick = () => { UI.cat = $('#x-cat', layer).value; UI.method = $('#x-method', layer).value; UI.acc = $('#x-acc', layer).value; closeLayer(layer); render(); };
    $('#clear', layer).onclick = () => { UI.cat = UI.method = UI.acc = ''; closeLayer(layer); render(); };
  }

  // ---------- contas ----------
  function openAccounts() {
    const layer = sheet({ title: 'Contas e saldos', body: '', full: true });
    const draw = () => {
      const act = S.accounts.filter((a) => !a.archived), arch = S.accounts.filter((a) => a.archived);
      const row = (a) => `<button type="button" class="row" data-acc="${esc(a.id)}"><span class="ic">${a.type === 'dinheiro' ? '💵' : '🏦'}</span><span class="mid"><span class="t">${esc(a.name)}</span><span class="s">Saldo inicial ${esc(fm(a.initial))}</span></span><span class="amt num ${L.accountBalance(S, a.id) < 0 ? 'red' : ''}">${esc(fm(L.accountBalance(S, a.id)))}</span></button>`;
      $('.body', layer).innerHTML = `<div class="list">${act.map(row).join('')}</div>
        <button type="button" class="btn" data-newacc style="width:100%">＋ Nova conta</button>
        <p class="note" style="margin-top:14px">O saldo de cada conta é o <b>saldo inicial</b> + entradas − saídas já pagas ± transferências. Se o saldo não bater com o do seu banco, corrija o saldo inicial tocando na conta.</p>
        ${arch.length ? `<div class="section-t">Arquivadas</div><div class="list">${arch.map(row).join('')}</div>` : ''}`;
    };
    draw();
    layer.addEventListener('click', (e) => {
      const r = e.target.closest('[data-acc]');
      if (r) openAccountEditor(r.dataset.acc, draw);
      else if (e.target.closest('[data-newacc]')) openAccountEditor(null, draw);
    });
  }

  function openAccountEditor(id, done) {
    const a = id ? L.getAccount(S, id) : null;
    const body = `<div class="field"><label for="a-name">Nome</label><input class="inp" id="a-name" maxlength="30" placeholder="Ex.: Nubank" value="${esc(a ? a.name : '')}"></div>
      ${a ? '' : `<div class="field"><div class="lab">Tipo</div><div class="chips"><button type="button" class="chip on" data-ty="conta">🏦 Conta bancária</button><button type="button" class="chip" data-ty="dinheiro">💵 Dinheiro</button></div></div>`}
      <div class="field"><label for="a-ini">Saldo inicial (ponto de partida)</label><input class="inp" id="a-ini" inputmode="decimal" placeholder="0,00" value="${a ? esc((a.initial < 0 ? '-' : '') + L.plainMoney(a.initial)) : ''}"><div class="hint">Quanto havia nessa conta quando você começou a usar o app. Use negativo (ex.: -50,00) se estava no vermelho.</div></div>
      ${a ? `<div class="kv"><span class="muted">Saldo atual</span><b class="num">${esc(fm(L.accountBalance(S, a.id)))}</b></div>` : ''}
      <p class="err" id="err" role="alert"></p>`;
    const foot = (a ? `<button type="button" class="btn ${a.archived ? '' : 'danger'}" id="arch" style="flex:0 0 auto">${a.archived ? 'Reativar' : 'Arquivar'}</button>` : '') + `<button type="button" class="btn primary" id="save">Salvar</button>`;
    const layer = sheet({ title: a ? 'Editar conta' : 'Nova conta', body, foot });
    let type = 'conta';
    layer.addEventListener('click', (e) => { const t = e.target.closest('[data-ty]'); if (t) { type = t.dataset.ty; $$('[data-ty]', layer).forEach((b) => b.classList.toggle('on', b === t)); } });
    $('#a-ini', layer).addEventListener('input', (e) => { const v = e.target.value.replace(/[^\d.,-]/g, ''); if (v !== e.target.value) e.target.value = v; });
    $('#save', layer).onclick = () => {
      const raw = $('#a-ini', layer).value.trim();
      const neg = raw.startsWith('-');
      const cents = raw === '' ? 0 : L.parseMoney(raw.replace('-', ''));
      if (cents == null) { $('#err', layer).textContent = 'Saldo inicial inválido. Ex.: 1500 ou 1.500,00'; return; }
      try {
        if (a) L.updateAccount(S, a.id, { name: $('#a-name', layer).value, initial: neg ? -cents : cents });
        else L.addAccount(S, { name: $('#a-name', layer).value, type, initial: neg ? -cents : cents });
        commit(); closeLayer(layer); done && done();
      } catch (er) { if (er instanceof L.FinError) $('#err', layer).textContent = er.message; else throw er; }
    };
    if (a) $('#arch', layer).onclick = () => {
      try { L.setAccountArchived(S, a.id, !a.archived); commit(); closeLayer(layer); done && done(); }
      catch (er) { if (er instanceof L.FinError) $('#err', layer).textContent = er.message; else throw er; }
    };
  }

  // ---------- categorias ----------
  const EMOJIS = ['🏠', '🍽️', '🚌', '🚗', '🎓', '💊', '🎮', '🔁', '🧾', '⛪', '💼', '🛠️', '🛒', '👕', '🐶', '📱', '💡', '🎁', '✈️', '🎬', '☕', '🏋️', '💰', '📦'];
  function openCategories() {
    const layer = sheet({ title: 'Categorias', body: '', full: true });
    const draw = () => {
      const group = (title, kinds) => {
        const list = S.categories.filter((c) => kinds.includes(c.kind));
        return list.length ? `<div class="section-t">${title}</div><div class="list">${list.map((c) => `<button type="button" class="row" data-cat="${esc(c.id)}"><span class="ic">${c.emoji}</span><span class="mid"><span class="t">${esc(c.name)}</span></span><span class="muted" style="font-size:13px">${L.categoryUsage(S, c.id)} lanç.</span></button>`).join('')}</div>` : '';
      };
      $('.body', layer).innerHTML = `<button type="button" class="btn" data-newcat style="width:100%">＋ Nova categoria</button>${group('Saídas', ['out'])}${group('Entradas', ['in'])}${group('Servem para os dois', ['both'])}`;
    };
    draw();
    layer.addEventListener('click', (e) => {
      const r = e.target.closest('[data-cat]');
      if (r) openCategoryEditor({ id: r.dataset.cat, onSaved: draw });
      else if (e.target.closest('[data-newcat]')) openCategoryEditor({ onSaved: draw });
    });
  }

  function openCategoryEditor({ id, kind = 'out', onSaved }) {
    const c = id ? L.getCategory(S, id) : null;
    let emoji = c ? c.emoji : '🏷️', k = c ? c.kind : kind === 'transfer' ? 'out' : kind;
    const body = `<div class="field"><label for="c-name">Nome</label><input class="inp" id="c-name" maxlength="30" placeholder="Ex.: Pets" value="${esc(c ? c.name : '')}"></div>
      <div class="field"><div class="lab">Ícone</div><div class="picker" id="picker">${EMOJIS.map((e) => `<button type="button" data-e="${e}" class="${e === emoji ? 'on' : ''}">${e}</button>`).join('')}</div></div>
      ${id === 'cat-outros' ? '' : `<div class="field"><div class="lab">Usar em</div><div class="chips" id="kinds">${[['out', 'Saídas'], ['in', 'Entradas'], ['both', 'Os dois']].map(([v, t]) => `<button type="button" class="chip ${v === k ? 'on' : ''}" data-k="${v}">${t}</button>`).join('')}</div></div>`}
      ${c ? `<div class="hint">${L.categoryUsage(S, c.id)} lançamentos usam esta categoria.</div>` : ''}<p class="err" id="err" role="alert"></p>`;
    const foot = (c && c.id !== 'cat-outros' ? `<button type="button" class="btn danger" id="del" style="flex:0 0 auto">Excluir</button>` : '') + `<button type="button" class="btn primary" id="save">Salvar</button>`;
    const layer = sheet({ title: c ? 'Editar categoria' : 'Nova categoria', body, foot });
    layer.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.e) { emoji = b.dataset.e; $$('#picker button', layer).forEach((x) => x.classList.toggle('on', x === b)); }
      else if (b.dataset.k) { k = b.dataset.k; $$('#kinds .chip', layer).forEach((x) => x.classList.toggle('on', x === b)); }
    });
    $('#save', layer).onclick = () => {
      try {
        const saved = c ? L.updateCategory(S, c.id, { name: $('#c-name', layer).value, emoji, kind: k }) : L.addCategory(S, { name: $('#c-name', layer).value, emoji, kind: k });
        commit(); closeLayer(layer); onSaved && onSaved(saved);
      } catch (er) { if (er instanceof L.FinError) $('#err', layer).textContent = er.message; else throw er; }
    };
    if (c && c.id !== 'cat-outros') $('#del', layer).onclick = async () => {
      const n = L.categoryUsage(S, c.id);
      const ok = await ask({ title: `Excluir “${c.name}”?`, text: n ? `${n} lançamentos vão para a categoria “Outros”. Nenhum lançamento é apagado.` : 'Nenhum lançamento usa esta categoria.', ok: 'Excluir', danger: true });
      if (!ok) return;
      L.deleteCategory(S, c.id); commit(); closeLayer(layer); onSaved && onSaved(null);
    };
  }


  // ---------- planejamento ----------
  function autoGenerate() {
    const upto = UI.tab === 'plan' || UI.tab === 'home' ? UI.ym : null;
    try { if (L.generateRecurring(S, L.todayStr(), upto)) persist(); } catch (e) { console.error(e); }
  }

  function planView() {
    const seg = `<div class="seg two" style="margin-bottom:14px" role="tablist"><button type="button" role="tab" data-act="planmode" data-v="month" class="${UI.planMode === 'month' ? 'on transfer' : ''}">Mês a mês</button><button type="button" role="tab" data-act="planmode" data-v="pend" class="${UI.planMode === 'pend' ? 'on transfer' : ''}">A pagar e receber</button></div>`;
    if (UI.planMode === 'pend') return `<div class="top"><h1>Planejar</h1></div>${seg}${pendList()}`;
    return `<div class="top stack"><h1>Planejar</h1>${monthNav()}</div>${seg}${planMonthView()}`;
  }

  function planMonthView() {
    const today = L.todayStr(), curYm = L.ymOf(today), ym = UI.ym;
    const isPast = ym < curYm;
    const p = L.planMonth(S, ym, today);
    const tot = L.recurringTotals(S);
    const endDay = L.lastDayOfMonth(ym).slice(8, 10) + '/' + ym.slice(5, 7);
    let h = '';

    if (isPast) {
      const res = p.inReceived - p.outPaid;
      h += `<div class="card hero"><div class="lbl">Resultado do mês</div><div class="big num ${res < 0 ? 'red' : 'green'}">${esc(fm(res))}</div>
        <div class="sub"><span>Recebido<br><b class="num green">${esc(fm(p.inReceived))}</b></span><span>Pago<br><b class="num red">${esc(fm(p.outPaid))}</b></span></div></div>`;
    } else {
      h += `<div class="card hero"><div class="lbl">Saldo projetado em ${esc(endDay)}</div><div class="big num ${p.projected < 0 ? 'red' : ''}">${esc(fm(p.projected))}</div>
        <div class="sub"><span>Entradas previstas<br><b class="num green">${esc(fm(p.inExpected))}</b></span><span>Saídas previstas<br><b class="num red">${esc(fm(p.outTotal))}</b></span></div></div>`;
      if (p.carriedOut > 0) h += `<div class="banner info"><span>ℹ️</span><div>A projeção já desconta <b>${esc(fm(p.carriedOut))}</b> de contas de meses anteriores que ainda não foram pagas.</div></div>`;
      if (p.projected < 0) h += `<div class="alert bad"><span class="ico">⚠️</span><span class="t"><b>Mês no vermelho</b>Faltam ${esc(fm(-p.projected))} para cobrir o que está previsto até ${esc(endDay)}</span></div>`;
    }

    h += `<div class="chips" style="margin-bottom:12px"><button type="button" class="chip" data-act="m-rules">🔁 Despesas fixas${tot.count ? ` · ${esc(fm(tot.out))}/mês` : ''}</button></div>`;

    const hasAny = p.planned.length || p.done.length;
    if (!hasAny) {
      h += `<div class="card empty"><span class="e">🗓️</span><b>Nada previsto para este mês</b><br>Cadastre suas contas que se repetem (internet, faculdade, assinaturas…) e elas aparecem aqui sozinhas todo mês.<br><br><button type="button" class="btn primary sm" data-act="m-rules">＋ Cadastrar despesa fixa</button></div>`;
      return h;
    }

    h += `<div class="card"><h2>Entradas</h2>
      <div class="kv"><span>Previstas no mês</span><b class="num">${esc(fm(p.inExpected))}</b></div>
      <div class="kv"><span>Já recebidas</span><b class="num green">${esc(fm(p.inReceived))}</b></div>
      <div class="kv"><span>A receber</span><b class="num blue">${esc(fm(p.inPending))}</b></div></div>`;

    const grp = (label, emoji, g) => {
      const total = g.paid + g.pending;
      if (!total) return '';
      return `<div class="hbar"><div class="h"><span>${emoji} ${label}</span><span class="num">${esc(fm(total))}</span></div><div class="track"><div class="fill" style="width:${Math.round((g.paid / total) * 100)}%"></div></div>
        <div class="note" style="margin-top:4px">${esc(fm(g.paid))} pago · ${esc(fm(g.pending))} a pagar</div></div>`;
    };
    const groups = grp('Despesas fixas', '🔁', p.fixed) + grp('Parcelas e séries', '🧾', p.series) + grp('Variáveis e avulsas', '🛒', p.other);
    h += `<div class="card"><h2>Despesas</h2>${groups || '<div class="note">Nenhuma despesa neste mês.</div>'}
      <div class="kv"><span>Total de despesas</span><b class="num">${esc(fm(p.outTotal))}</b></div>
      <div class="kv"><span>Sobra prevista do mês</span><b class="num ${p.net < 0 ? 'red' : 'green'}">${esc(fm(p.net))}</b></div></div>`;

    if (p.planned.length) {
      const toPay = p.planned.filter((m) => m.type === 'out').reduce((t, m) => t + m.amount, 0);
      h += `<div class="day"><span>Falta pagar ou receber (${p.planned.length})</span><span class="num">${toPay ? '−' + esc(fm(toPay)) : ''}</span></div><div class="list">${p.planned.map((m) => pendRow(m, today)).join('')}</div>`;
    }
    if (p.done.length) h += `<div class="day"><span>Já realizado (${p.done.length})</span></div><div class="list">${p.done.map((m) => movRow(m, { showDate: true })).join('')}</div>`;
    h += `<p class="note" style="padding:4px 6px">Toque num item para editar só aquele mês. Para mudar de vez, edite a despesa fixa. O que já foi pago nunca é alterado.</p>`;
    return h;
  }

  // ---------- despesas fixas ----------
  function openRules() {
    const layer = sheet({ title: 'Despesas fixas', body: '', full: true });
    const draw = () => {
      const tot = L.recurringTotals(S);
      const rows = S.recurring.slice().sort((a, b) => a.day - b.day || a.name.localeCompare(b.name)).map((r) => {
        const c = L.getCategory(S, r.categoryId);
        return `<button type="button" class="row" data-rule="${esc(r.id)}"><span class="ic">${c ? c.emoji : '🔁'}</span>
          <span class="mid"><span class="t">${esc(r.name)}${r.active ? '' : '<span class="pill">pausada</span>'}</span><span class="s">Todo dia ${r.day} · ${esc(c ? c.name : 'Outros')}${r.endYm ? ' · até ' + esc(ymShort(r.endYm)) : ''}</span></span>
          <span class="amt num ${r.type === 'in' ? 'green' : 'red'}">${r.type === 'in' ? '+' : '−'}${esc(fm(r.amount))}</span></button>`;
      }).join('');
      $('.body', layer).innerHTML = `${S.recurring.length ? `<div class="card"><div class="kv"><span class="muted">Saídas fixas por mês</span><b class="num red">${esc(fm(tot.out))}</b></div><div class="kv"><span class="muted">Entradas fixas por mês</span><b class="num green">${esc(fm(tot.in))}</b></div></div>` : ''}
        <button type="button" class="btn primary" data-newrule style="width:100%;margin-bottom:14px">＋ Nova despesa fixa</button>
        ${rows ? `<div class="list">${rows}</div>` : '<div class="empty"><span class="e">🔁</span>Cadastre aqui o que se repete todo mês: internet, faculdade, dízimo, assinaturas, academia, salário…</div>'}
        <p class="note">Cada fixa gera, sozinha, uma conta <b>prevista</b> por mês nos próximos meses (aba Planejar). Nada muda no saldo até você confirmar o pagamento.</p>`;
    };
    draw();
    layer.addEventListener('click', (e) => {
      const r = e.target.closest('[data-rule]');
      if (r) openRuleEditor(r.dataset.rule, draw);
      else if (e.target.closest('[data-newrule]')) openRuleEditor(null, draw);
    });
  }

  const ymShort = (ym) => `${cap(shortMonth(ym))}/${ym.slice(0, 4)}`;

  function openRuleEditor(id, done) {
    const r = id ? L.getRule(S, id) : null;
    if (id && !r) return;
    const today = L.todayStr(), cur = L.ymOf(today), dayNow = Number(today.slice(8, 10));
    const act = L.activeAccounts(S);
    const F = {
      type: r ? r.type : 'out', categoryId: r ? r.categoryId : null, catTouched: !!r,
      accountId: r ? r.accountId : (act.find((a) => a.id === S.settings.lastAccountId) || act[0]).id,
      method: r ? r.method : 'Pix', startYm: r ? r.startYm : 'auto', endYm: r && r.endYm ? r.endYm : '',
    };
    const range = (from, to) => { const out = []; for (let ym = from; ym <= to; ym = L.addMonthsYM(ym, 1)) out.push(ym); return out; };
    const startOpts = range(r && r.startYm < cur ? r.startYm : cur, L.addMonthsYM(cur, 11));
    const endOpts = range(r && r.endYm && r.endYm < cur ? r.endYm : cur, L.addMonthsYM(cur, 36));
    const accOpts = S.accounts.filter((a) => !a.archived || (r && a.id === r.accountId)).map((a) => `<option value="${esc(a.id)}" ${a.id === F.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
    const body = `<form id="rf" novalidate autocomplete="off">
      ${r ? '' : `<div class="seg two" id="rt" style="margin-bottom:14px"><button type="button" data-t="out">Despesa</button><button type="button" data-t="in">Entrada</button></div>`}
      <div class="field"><label for="r-name">Nome</label><input class="inp" id="r-name" maxlength="40" autocapitalize="sentences" placeholder="Ex.: Internet" value="${esc(r ? r.name : '')}"></div>
      <div class="two"><div class="field"><label for="r-amount">Valor (R$)</label><input class="inp" id="r-amount" inputmode="decimal" placeholder="0,00" value="${r ? esc(L.plainMoney(r.amount)) : ''}"></div>
      <div class="field"><label for="r-day">Vence no dia</label><input class="inp" id="r-day" inputmode="numeric" maxlength="2" placeholder="1 a 31" value="${r ? r.day : ''}"></div></div>
      <div class="hint" style="margin:-6px 0 14px">Em meses mais curtos, vale o último dia do mês.</div>
      <div class="field"><div class="lab">Categoria</div><div class="chips" id="rcats"></div></div>
      <div class="field"><label for="r-acc">Conta</label><select class="inp" id="r-acc">${accOpts}</select></div>
      <div class="field"><div class="lab">Forma de pagamento</div><div class="chips" id="rmethods"></div></div>
      <div class="two"><div class="field"><label for="r-start">Começa em</label><select class="inp" id="r-start">${r ? '' : '<option value="auto">Próximo vencimento</option>'}${startOpts.map((ym) => `<option value="${ym}" ${ym === F.startYm ? 'selected' : ''}>${esc(ymShort(ym))}</option>`).join('')}</select></div>
      <div class="field"><label for="r-end">Termina em</label><select class="inp" id="r-end"><option value="">Sem data final</option>${endOpts.map((ym) => `<option value="${ym}" ${ym === F.endYm ? 'selected' : ''}>${esc(ymShort(ym))}</option>`).join('')}</select></div></div>
      ${r ? `<p class="note">Mudanças valem do mês atual em diante. O que já foi pago e os lançamentos que você editou à mão não mudam.${r.active ? '' : ' <b>Esta despesa está pausada.</b>'}</p>` : ''}
      <p class="err" id="err" role="alert"></p></form>`;
    const foot = (r ? `<button type="button" class="btn danger" id="del" style="flex:0 0 auto">Excluir</button><button type="button" class="btn" id="pause" style="flex:0 0 auto">${r.active ? 'Pausar' : 'Reativar'}</button>` : '') + `<button type="button" class="btn primary" id="save">Salvar</button>`;
    const layer = sheet({ title: r ? 'Editar despesa fixa' : 'Nova despesa fixa', body, foot });
    const q = (x) => $(x, layer);
    const setErr = (t) => { q('#err').textContent = t || ''; };
    const catsFor = () => S.categories.filter((c) => c.kind === F.type || c.kind === 'both');
    const drawCats = () => { q('#rcats').innerHTML = catsFor().map((c) => `<button type="button" class="chip ${F.type} ${c.id === F.categoryId ? 'on' : ''}" data-c="${esc(c.id)}">${c.emoji} ${esc(c.name)}</button>`).join(''); };
    const drawMethods = () => { q('#rmethods').innerHTML = L.METHODS.map((m) => `<button type="button" class="chip ${m === F.method ? 'on' : ''}" data-m="${esc(m)}">${esc(m)}</button>`).join(''); };
    const drawType = () => { $$('#rt button', layer).forEach((b) => { b.className = b.dataset.t === F.type ? 'on ' + F.type : ''; }); if (!F.catTouched) F.categoryId = L.suggestCategory(S, q('#r-name').value, F.type); drawCats(); };
    drawType(); drawMethods();
    layer.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.t) { F.type = b.dataset.t; F.catTouched = false; drawType(); }
      else if (b.dataset.c) { F.categoryId = b.dataset.c; F.catTouched = true; drawCats(); }
      else if (b.dataset.m) { F.method = b.dataset.m; drawMethods(); }
    });
    layer.addEventListener('input', (e) => {
      const id = e.target.id;
      if (id === 'r-amount') { const v = e.target.value.replace(/[^\d.,]/g, ''); if (v !== e.target.value) e.target.value = v; }
      else if (id === 'r-day') { const v = e.target.value.replace(/\D/g, '').slice(0, 2); if (v !== e.target.value) e.target.value = v; }
      else if (id === 'r-name' && !F.catTouched) { const sc = L.suggestCategory(S, e.target.value, F.type); if (sc !== F.categoryId) { F.categoryId = sc; drawCats(); } }
    });
    layer.addEventListener('change', (e) => {
      if (e.target.id === 'r-acc') F.accountId = e.target.value;
      else if (e.target.id === 'r-start') F.startYm = e.target.value;
      else if (e.target.id === 'r-end') F.endYm = e.target.value;
    });
    q('#save').addEventListener('click', () => {
      const amount = L.parseMoney(q('#r-amount').value);
      if (amount == null || amount <= 0) { setErr('Informe um valor válido. Ex.: 120 ou 120,90'); q('#r-amount').focus(); return; }
      const day = parseInt(q('#r-day').value, 10);
      let startYm = F.startYm;
      if (startYm === 'auto') startYm = day >= dayNow ? cur : L.addMonthsYM(cur, 1);
      const name = q('#r-name').value;
      try {
        const input = { type: F.type, name, amount, day, categoryId: F.categoryId || L.suggestCategory(S, name, F.type) || 'cat-outros', accountId: F.accountId, method: F.method, startYm, endYm: F.endYm || null };
        if (r) L.updateRule(S, r.id, input); else L.addRule(S, input);
        commit(); closeLayer(layer); done && done();
        toast(r ? 'Despesa fixa atualizada' : 'Despesa fixa criada. Os próximos meses já aparecem em Planejar.');
      } catch (er) { if (er instanceof L.FinError) setErr(er.message); else { console.error(er); setErr('Erro inesperado: ' + er.message); } }
    });
    if (r) {
      q('#del').addEventListener('click', async () => {
        const ok = await ask({ title: `Excluir “${r.name}”?`, text: 'Os próximos lançamentos previstos desta despesa serão removidos. O que você já pagou continua no histórico.', ok: 'Excluir', danger: true });
        if (!ok) return;
        L.deleteRule(S, r.id); commit(); closeLayer(layer); done && done(); toast('Despesa fixa excluída');
      });
      q('#pause').addEventListener('click', () => {
        const wasActive = r.active;
        L.setRuleActive(S, r.id, !wasActive); commit(); closeLayer(layer); done && done();
        toast(wasActive ? 'Pausada: os próximos meses saíram do planejamento' : 'Reativada: os próximos meses voltaram');
      });
    }
  }

  // ---------- backup, exportação, histórico ----------
  async function doBackup() {
    const name = `meu-dinheiro-backup-${L.todayStr()}.json`;
    const res = await saveFile(name, L.exportBackup(S), ['application/json', 'text/plain']);
    if (res === 'cancelled') { toast('Backup cancelado — nada foi salvo.'); return false; }
    S.settings.lastBackupAt = new Date().toISOString();
    localStorage.removeItem('fin-snooze-backup');
    commit();
    toast(res === 'shared' ? 'Backup pronto. Escolha “Salvar em Arquivos” ou envie para você mesmo.' : 'Backup baixado. Guarde o arquivo em um lugar seguro.', { ms: 8000 });
    return true;
  }

  async function openBackup() {
    const hasPrev = !!(await DB.get('pre-import'));
    const last = S.settings.lastBackupAt;
    const body = `<div class="card"><div class="kv"><span class="muted">Último backup</span><b>${last ? esc(dateTimeBR(last)) : 'nunca'}</b></div>
      <div class="kv"><span class="muted">Lançamentos guardados</span><b>${L.live(S).length}</b></div></div>
      <p class="note">Seus dados ficam <b>somente neste celular</b>. O backup é um arquivo que você guarda no iCloud Drive, no Google Drive ou envia para você mesmo no WhatsApp/e-mail. Se trocar de celular ou limpar os dados do Safari, é com ele que você recupera tudo.</p>
      <button type="button" class="btn primary" id="bk-now" style="width:100%;margin:6px 0 10px">💾 Salvar backup agora</button>
      <button type="button" class="btn" id="bk-restore" style="width:100%">📥 Restaurar de um arquivo…</button>
      <input type="file" id="bk-file" accept=".json,application/json,text/plain" class="hidden">
      ${hasPrev ? `<button type="button" class="btn ghost" id="bk-undo" style="width:100%;margin-top:8px">↩︎ Voltar ao estado de antes da última restauração</button>` : ''}
      <p class="err" id="err" role="alert"></p>`;
    const layer = sheet({ title: 'Backup e restauração', body });
    $('#bk-now', layer).onclick = async () => { if (await doBackup()) closeLayer(layer); };
    $('#bk-restore', layer).onclick = () => $('#bk-file', layer).click();
    $('#bk-file', layer).onchange = async (e) => {
      const file = e.target.files && e.target.files[0]; if (!file) return;
      const err = $('#err', layer); err.textContent = '';
      try {
        const next = L.validateBackup(await file.text());
        const ok = await ask({ title: 'Substituir todos os dados?', text: `O backup tem ${next.movements.filter((m) => !m.deletedAt).length} lançamentos e ${next.accounts.length} contas. Isso substitui TUDO que está no app agora (uma cópia do estado atual fica guardada para você voltar atrás).`, ok: 'Restaurar', danger: true });
        if (!ok) return;
        await DB.set('pre-import', S);
        S = next; await persist(); render(true); closeLayer(layer);
        toast('Backup restaurado com sucesso.', { ms: 7000 });
      } catch (er) { err.textContent = er instanceof L.FinError ? er.message : 'Não consegui ler o arquivo: ' + er.message; }
      e.target.value = '';
    };
    const undo = $('#bk-undo', layer);
    if (undo) undo.onclick = async () => {
      const prev = await DB.get('pre-import'); if (!prev) return;
      const ok = await ask({ title: 'Voltar ao estado anterior?', text: 'Os dados atuais serão substituídos pela cópia de antes da última restauração.', ok: 'Voltar', danger: true });
      if (!ok) return;
      try { S = loadState(prev); await DB.set('pre-import', undefined); await persist(); render(true); closeLayer(layer); toast('Estado anterior recuperado.'); }
      catch (er) { $('#err', layer).textContent = 'Não foi possível recuperar: ' + er.message; }
    };
  }

  function openCSV() {
    const body = `<p class="note">O arquivo abre direto no Excel, no Numbers e no Planilhas (separador “;”, valores com vírgula).</p>
      <button type="button" class="btn primary" data-sc="month" style="width:100%;margin:6px 0 10px">Só ${esc(L.monthLabel(UI.ym))}</button>
      <button type="button" class="btn" data-sc="all" style="width:100%">Todos os lançamentos</button><p class="err" id="err" role="alert"></p>`;
    const layer = sheet({ title: 'Exportar planilha (CSV)', body });
    layer.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-sc]'); if (!b) return;
      const f = b.dataset.sc === 'month' ? { from: UI.ym + '-01', to: L.lastDayOfMonth(UI.ym) } : {};
      const list = L.filterMovements(S, f).reverse();
      if (!list.length) { $('#err', layer).textContent = 'Não há lançamentos nesse período.'; return; }
      const name = b.dataset.sc === 'month' ? `meu-dinheiro-${UI.ym}.csv` : `meu-dinheiro-tudo-${L.todayStr()}.csv`;
      const res = await saveFile(name, '﻿' + L.toCSV(S, list), ['text/csv', 'text/plain']);
      if (res !== 'cancelled') { closeLayer(layer); toast('Planilha exportada.'); }
    });
  }

  function openLog() {
    const items = S.log.slice().reverse().slice(0, 150);
    const body = items.length ? items.map((l) => `<div class="log-item">${esc(l.summary)}${l.extra && l.extra.before ? `<div class="was">Antes: ${esc(l.extra.before)}</div>` : ''}<small>${esc(dateTimeBR(l.at))}</small></div>`).join('') : '<div class="empty">Nada registrado ainda.</div>';
    sheet({ title: 'Histórico de alterações', body: body + (S.log.length > 150 ? '<p class="note">Mostrando as 150 mais recentes.</p>' : ''), full: true });
  }

  function openAbout() {
    const body = `<div class="card"><h2>Seus dados</h2><p class="note" style="margin:0">Tudo o que você lança fica guardado <b>dentro deste celular</b>, no próprio navegador. Nada é enviado para a internet e ninguém mais enxerga seus valores — nem quem tiver o link do site.</p></div>
      <div class="card"><h2>Instalar no iPhone</h2><ol class="note" style="margin:0;padding-left:20px"><li>Abra o site no <b>Safari</b>.</li><li>Toque no botão <b>Compartilhar</b> (quadrado com seta).</li><li>Escolha <b>Adicionar à Tela de Início</b>.</li><li>Abra pelo ícone novo. Funciona até sem internet.</li></ol></div>
      <div class="card"><h2>Como as contas fecham</h2><ul class="note" style="margin:0;padding-left:20px"><li><b>Previsto</b> não mexe no saldo. Só vira dinheiro de verdade quando você confirma.</li><li><b>Transferência</b> entre suas contas não conta como renda nem gasto.</li><li><b>Despesas fixas</b> geram previsões dos próximos meses sozinhas. Mudar o valor da fixa só vale daqui para frente; o que já foi pago não muda.</li><li>Marcar como pago <b>não cria outro lançamento</b>: o mesmo registro muda de previsto para pago.</li><li>“Livre após contas” = saldo de hoje − tudo que está previsto para pagar até o fim do mês (inclusive atrasadas).</li></ul></div>
      <div class="kv"><span class="muted">Versão</span><b>${VERSION}</b></div>
      <div class="kv"><span class="muted">Armazenamento protegido</span><b>${DB.persisted === true ? 'sim' : DB.persisted === false ? 'não garantido' : 'indisponível'}</b></div>`;
    sheet({ title: 'Como funciona', body, full: true });
  }

  function openOnboarding() {
    const body = `<p class="note" style="margin-top:0">Para começar, diga quanto você tem agora. Dá para mudar depois em <b>Mais › Contas</b>.</p>
      <div class="field"><label for="o-main">Na conta do banco (R$)</label><input class="inp" id="o-main" inputmode="decimal" placeholder="0,00" autocomplete="off"></div>
      <div class="field"><label for="o-cash">Em dinheiro / carteira (R$)</label><input class="inp" id="o-cash" inputmode="decimal" placeholder="0,00" autocomplete="off"></div>
      <p class="note">Seus dados ficam só neste celular. Faça um backup de vez em quando em <b>Mais › Backup</b>.</p><p class="err" id="err" role="alert"></p>`;
    const layer = sheet({ title: 'Bem-vindo 👋', body, foot: `<button type="button" class="btn primary" id="go">Começar</button>`, locked: true });
    $$('input', layer).forEach((i) => i.addEventListener('input', () => { i.value = i.value.replace(/[^\d.,-]/g, ''); }));
    $('#go', layer).onclick = () => {
      const val = (id) => { const r = $(id, layer).value.trim(); if (!r) return 0; const c = L.parseMoney(r.replace('-', '')); return c == null ? null : (r.startsWith('-') ? -c : c); };
      const a = val('#o-main'), b = val('#o-cash');
      if (a == null || b == null) { $('#err', layer).textContent = 'Valor inválido. Ex.: 1500 ou 1.500,00'; return; }
      L.updateAccount(S, 'acc-principal', { name: 'Conta principal', initial: a });
      L.updateAccount(S, 'acc-dinheiro', { name: 'Dinheiro', initial: b });
      S.settings.onboarded = true;
      commit(); closeLayer(layer);
    };
  }

  // ---------- eventos globais ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !S) return;
    const a = b.dataset.act;
    if (a === 'tab') { UI.tab = b.dataset.tab; render(true); }
    else if (a === 'new') openMovementForm({});
    else if (a === 'month') { UI.ym = L.addMonthsYM(UI.ym, Number(b.dataset.d)); render(); }
    else if (a === 'month-now') { UI.ym = L.ymOf(L.todayStr()); render(); }
    else if (a === 'edit') openMovementForm({ id: b.dataset.id });
    else if (a === 'done') openMarkDone(b.dataset.id);
    else if (a === 'shortcut') { const s = UI.shortcuts[Number(b.dataset.i)]; if (s) openMovementForm({ prefill: s }); }
    else if (a === 'ftype') { UI.type = b.dataset.v; UI.status = ''; render(); }
    else if (a === 'fstatus') { UI.status = UI.status ? '' : 'planned'; UI.type = ''; render(); }
    else if (a === 'scope') { UI.scope = UI.scope === 'month' ? 'all' : 'month'; render(); }
    else if (a === 'filters') openFilters();
    else if (a === 'backup-now') doBackup();
    else if (a === 'snooze-backup') { localStorage.setItem('fin-snooze-backup', L.todayStr()); render(); }
    else if (a === 'hide-install') { localStorage.setItem('fin-hide-install', '1'); render(); }
    else if (a === 'pend') { UI.tab = 'plan'; UI.planMode = 'pend'; render(true); }
    else if (a === 'planmode') { UI.planMode = b.dataset.v; render(); }
    else if (a === 'm-rules') openRules();
    else if (a === 'm-accounts') openAccounts();
    else if (a === 'm-cats') openCategories();
    else if (a === 'm-backup') openBackup();
    else if (a === 'm-csv') openCSV();
    else if (a === 'm-log') openLog();
    else if (a === 'm-about') openAbout();
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'q' && S) {
      UI.q = e.target.value;
      const el = $('#mov-list'); if (el) el.innerHTML = movList();
    }
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden && S && !layers.length) render(); });

  // ---------- início ----------
  function loadState(saved) {
    const st = L.validateBackup({ app: L.APP_ID, schema: saved.schema || 1, data: saved });
    st.settings.onboarded = !!(saved.settings && saved.settings.onboarded);
    return st;
  }

  function fatal(msg, saved) {
    $('#view').innerHTML = `<div class="card"><h2>Não consegui abrir seus dados</h2><p class="note">${esc(msg)}</p>
      <p class="note"><b>Nada foi apagado.</b> Uma cópia dos dados atuais foi preservada. Você pode tentar de novo ou restaurar de um backup.</p>
      <button type="button" class="btn" id="retry" style="width:100%;margin-bottom:8px">Tentar de novo</button>
      <button type="button" class="btn primary" id="restore" style="width:100%">Restaurar de um backup…</button><input type="file" id="rf" accept=".json,application/json,text/plain" class="hidden"><p class="err" id="err"></p></div>`;
    $('#retry').onclick = () => location.reload();
    $('#restore').onclick = () => $('#rf').click();
    $('#rf').onchange = async (e) => {
      try {
        const next = L.validateBackup(await e.target.files[0].text());
        await DB.set('corrupt-state', saved);
        S = next; await persist(); location.reload();
      } catch (er) { $('#err').textContent = er.message; }
    };
  }

  async function init() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
    let saved;
    try { saved = await DB.get('state'); } catch (e) { saved = undefined; }
    if (saved === undefined || saved === null) {
      S = L.newState();
      try { await DB.set('state', S); } catch (e) { /* aviso aparece via DB.degraded */ }
    } else {
      try { S = loadState(saved); }
      catch (e) { console.error(e); try { await DB.set('corrupt-state', saved); } catch (_) {} fatal(e.message || String(e), saved); return; }
    }
    DB.requestPersistence().then(() => { if (UI.tab === 'more') render(); });
    render(true);
    if (!S.settings.onboarded) openOnboarding();
  }

  window.__fin = { get state() { return S; }, UI, render, commit }; // útil para diagnóstico e testes
  init();
})();
