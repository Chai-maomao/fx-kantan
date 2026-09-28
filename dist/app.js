(() => {
  'use strict';
  const PAIRS = ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD'];
  const START = 10000;
  const LEVERAGE = 20;
  const KEY = 'fx-kantan-paper-v1';
  const $ = (id) => document.getElementById(id);
  const money = (n) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  const rate = (n) => Number.isFinite(n) ? n.toFixed(5) : '—';
  const pairName = (s) => `${s.slice(0, 3)}/${s.slice(3)}`;
  const localTime = (stamp) => new Date(stamp).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (!raw || !Number.isFinite(raw.balance) || !Array.isArray(raw.positions) || !Array.isArray(raw.history)) throw Error('Invalid state');
      return {
        balance: raw.balance,
        positions: raw.positions.filter(p => PAIRS.includes(p.symbol) && ['long','short'].includes(p.side) && Number.isFinite(p.entry) && p.entry > 0 && Number.isInteger(p.units) && p.units > 0 && Number.isFinite(p.margin) && p.margin > 0),
        history: raw.history.slice(0, 100).filter(h => PAIRS.includes(h.symbol))
      };
    } catch { return {balance: START, positions: [], history: []}; }
  }
  const account = load();
  let selected = PAIRS[0];
  let quotes = {};
  let feedAvailable = false;
  let requestRunning = false;
  let chartRequest = 0;

  function save() { try { localStorage.setItem(KEY, JSON.stringify(account)); } catch {} }
  function currentQuote(symbol) {
    const q = quotes[symbol];
    if (!q || !Number.isFinite(q.bid) || !Number.isFinite(q.ask) || q.bid <= 0 || q.ask <= q.bid) return null;
    return q;
  }
  function isLive(q) {
    const timestamp = Date.parse(q?.timestamp || q?.lastQuoteAt);
    return Boolean(feedAvailable && q && q.marketState === 'open' && q.stale === false && Number.isFinite(timestamp) && Date.now() - timestamp < 60000 && Date.now() >= timestamp - 10000);
  }
  function markToMarket(p) {
    const q = currentQuote(p.symbol);
    if (!q) return null;
    return (p.side === 'long' ? q.bid - p.entry : p.entry - q.ask) * p.units;
  }
  function totals() {
    const floating = account.positions.reduce((sum, p) => sum + (markToMarket(p) || 0), 0);
    const margin = account.positions.reduce((sum, p) => sum + p.margin, 0);
    const equity = account.balance + floating;
    return {floating, margin, equity, free: equity - margin};
  }
  function positiveClass(n) { return n > .00001 ? 'gain' : n < -.00001 ? 'loss' : ''; }
  function showMessage(message, kind = '') { $('trade-message').textContent = message; $('trade-message').className = `trade-message ${kind}`; }
  function orderUnits() { return Number($('units').value); }
  function renderPairList() {
    $('pair-list').innerHTML = PAIRS.map(s => {
      const q = currentQuote(s);
      return `<button type="button" class="pair-button" role="tab" aria-selected="${selected === s}" data-symbol="${s}"><b>${pairName(s)}</b><small>${q ? rate(q.mid || (q.bid + q.ask) / 2) : '等待报价'}</small></button>`;
    }).join('');
  }
  function renderAccount() {
    const t = totals();
    $('equity').textContent = money(t.equity);
    $('free-margin').textContent = money(t.free);
    $('floating').textContent = money(t.floating);
    $('floating').className = positiveClass(t.floating);
    $('realized').textContent = money(account.balance - START);
    $('realized').className = positiveClass(account.balance - START);
  }
  function renderTrade() {
    const q = currentQuote(selected);
    const live = isLive(q);
    $('trade-pair').textContent = pairName(selected);
    $('trade-state').textContent = !q ? '等待报价' : live ? '可交易' : q.marketState === 'open' ? '报价已过期' : '市场休市';
    $('bid').textContent = q ? rate(q.bid) : '—';
    $('ask').textContent = q ? rate(q.ask) : '—';
    const units = orderUnits();
    const validUnits = Number.isInteger(units) && units >= 1000 && units <= 1000000 && units % 1000 === 0;
    const margin = q && validUnits ? units * q.ask / LEVERAGE : null;
    $('estimated-margin').textContent = margin == null ? '—' : money(margin);
    $('buy-button').disabled = $('sell-button').disabled = !(live && validUnits && margin <= totals().free);
  }
  function renderChartHeading() {
    const q = currentQuote(selected);
    $('chart-title').textContent = pairName(selected);
    $('pair-price').textContent = q ? rate(q.mid || (q.bid + q.ask) / 2) : '—';
    $('pair-change').textContent = q && Number.isFinite(q.dayDiffPercent) ? `${q.dayDiffPercent >= 0 ? '+' : ''}${q.dayDiffPercent.toFixed(2)}% 今日` : '等待报价';
    $('pair-change').className = q ? positiveClass(q.dayDiffPercent) : '';
  }
  function renderRecords() {
    $('positions-body').innerHTML = account.positions.length ? account.positions.map(p => {
      const q = currentQuote(p.symbol);
      const pnl = markToMarket(p);
      const exit = q ? p.side === 'long' ? q.bid : q.ask : null;
      return `<tr><td><b>${pairName(p.symbol)}</b></td><td class="${p.side === 'long' ? 'side-long' : 'side-short'}">${p.side === 'long' ? '买入' : '卖出'}</td><td>${p.units.toLocaleString()}</td><td>${rate(p.entry)}</td><td>${exit ? rate(exit) : '—'}</td><td class="${pnl == null ? '' : positiveClass(pnl)}">${pnl == null ? '—' : money(pnl)}</td><td><button class="close-button" type="button" data-close="${p.id}" ${isLive(q) ? '' : 'disabled'}>平仓</button></td></tr>`;
    }).join('') : '<tr class="empty-row"><td colspan="7">还没有持仓。选择货币对，试着开第一单。</td></tr>';
    $('history-body').innerHTML = account.history.length ? account.history.map(h => `<tr><td>${localTime(h.time)}</td><td>${pairName(h.symbol)}</td><td>${h.action}</td><td>${Number(h.units).toLocaleString()}</td><td>${rate(h.price)}</td><td class="${h.pnl == null ? '' : positiveClass(h.pnl)}">${h.pnl == null ? '—' : money(h.pnl)}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="6">交易记录会显示在这里。</td></tr>';
  }
  function render() { renderPairList(); renderAccount(); renderTrade(); renderChartHeading(); renderRecords(); }
  function trade(side) {
    const q = currentQuote(selected);
    const units = orderUnits();
    if (!isLive(q)) return showMessage('当前报价不可交易，请等待最新行情。', 'error');
    if (!Number.isInteger(units) || units < 1000 || units > 1000000 || units % 1000) return showMessage('请输入 1,000 至 1,000,000 之间的整千数量。', 'error');
    const entry = side === 'long' ? q.ask : q.bid;
    const margin = units * q.ask / LEVERAGE;
    if (margin > totals().free) return showMessage('可用保证金不足，请减少交易数量。', 'error');
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    account.positions.unshift({id, symbol:selected, side, units, entry, margin, time:new Date().toISOString()});
    account.history.unshift({time:new Date().toISOString(), symbol:selected, action:side === 'long' ? '买入开仓' : '卖出开仓', units, price:entry, pnl:null});
    account.history = account.history.slice(0, 100);
    save(); render(); showMessage(`${pairName(selected)} 已${side === 'long' ? '买入' : '卖出'} ${units.toLocaleString()} 单位。`, 'success');
  }
  function closePosition(id) {
    const index = account.positions.findIndex(p => p.id === id);
    if (index < 0) return;
    const p = account.positions[index], q = currentQuote(p.symbol);
    if (!isLive(q)) return showMessage('报价已过期，暂时无法平仓。', 'error');
    const price = p.side === 'long' ? q.bid : q.ask;
    const pnl = markToMarket(p);
    account.balance += pnl;
    account.positions.splice(index, 1);
    account.history.unshift({time:new Date().toISOString(), symbol:p.symbol, action:'平仓', units:p.units, price, pnl});
    account.history = account.history.slice(0, 100);
    save(); render(); showMessage(`已平仓，${pnl >= 0 ? '盈利' : '亏损'} ${money(Math.abs(pnl))}。`, pnl >= 0 ? 'success' : 'error');
  }
  async function refreshQuotes() {
    if (requestRunning) return;
    requestRunning = true;
    try {
      const url = `https://biquote.io/api/latest?${PAIRS.map(s => `symbols=${s}`).join('&')}`;
      const response = await fetch(url, {cache:'no-store', signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const data = await response.json();
      PAIRS.forEach(s => { const q = data[s]; if (q && q.symbol === s) quotes[s] = q; });
      feedAvailable = true;
      const liveCount = PAIRS.filter(s => isLive(currentQuote(s))).length;
      const status = $('feed-status');
      status.textContent = liveCount ? '实时行情' : '行情暂停';
      status.className = `status ${liveCount ? 'status-live' : 'status-stale'}`;
      const q = currentQuote(selected);
      $('updated-at').textContent = q ? `报价时间 ${localTime(q.timestamp)}` : '等待最新报价';
      render();
    } catch {
      feedAvailable = false;
      $('feed-status').textContent = '行情连接中断';
      $('feed-status').className = 'status status-stale';
      render();
    } finally { requestRunning = false; }
  }
  async function refreshChart() {
    const symbol = selected;
    const request = ++chartRequest;
    $('chart-empty').style.display = 'grid';
    $('chart-empty').textContent = '正在读取行情图表…';
    try {
      const response = await fetch(`https://biquote.io/api/${symbol}/ohlc?interval=5m&limit=80`, {signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const raw = await response.json();
      if (request !== chartRequest) return;
      const items = (Array.isArray(raw) ? raw : Array.isArray(raw.bars) ? raw.bars : Array.isArray(raw.candles) ? raw.candles : Array.isArray(raw.data) ? raw.data : []).slice().reverse();
      const values = items.map(x => Number(x.close)).filter(Number.isFinite);
      if (values.length < 2) throw Error('No chart data');
      const min = Math.min(...values), max = Math.max(...values), span = Math.max(max - min, min * .0003);
      const points = values.map((v, i) => `${(i / (values.length - 1) * 800).toFixed(1)},${(245 - (v - min) / span * 205).toFixed(1)}`);
      $('chart-line').setAttribute('d', `M ${points.join(' L ')}`);
      $('chart-fill').setAttribute('d', `M 0,280 L ${points.join(' L ')} L 800,280 Z`);
      $('chart-grid').innerHTML = '<path d="M 0 70 H 800 M 0 140 H 800 M 0 210 H 800" />';
      $('chart-empty').style.display = 'none';
    } catch {
      if (request === chartRequest) $('chart-empty').textContent = '暂时无法读取图表，报价仍可单独使用。';
    }
  }
  $('pair-list').addEventListener('click', e => {
    const button = e.target.closest('[data-symbol]');
    if (!button || !PAIRS.includes(button.dataset.symbol)) return;
    selected = button.dataset.symbol;
    render(); refreshChart();
  });
  $('units').addEventListener('input', renderTrade);
  document.querySelectorAll('[data-units]').forEach(button => button.addEventListener('click', () => { $('units').value = button.dataset.units; renderTrade(); }));
  $('buy-button').addEventListener('click', () => trade('long'));
  $('sell-button').addEventListener('click', () => trade('short'));
  $('positions-body').addEventListener('click', e => { const button = e.target.closest('[data-close]'); if (button) closePosition(button.dataset.close); });
  $('reset-button').addEventListener('click', () => {
    if (!confirm('确定重置模拟账户？所有持仓和交易记录都会清空。')) return;
    account.balance = START; account.positions = []; account.history = []; save(); render(); showMessage('模拟账户已重置。', 'success');
  });
  render(); refreshQuotes(); refreshChart();
  setInterval(refreshQuotes, 5000);
  setInterval(refreshChart, 60000);
  setInterval(() => { render(); }, 10000);
})();
