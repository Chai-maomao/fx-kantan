(() => {
  'use strict';
  const PAIRS = ['EURUSD','USDJPY','GBPUSD','AUDUSD','NZDUSD','USDCHF','USDCAD','EURJPY','GBPJPY','AUDJPY','NZDJPY','CADJPY','EURGBP','EURCHF'];
  const MAJORS = new Set(PAIRS.slice(0, 7));
  const LEVERAGES = [1,2,5,10,20,50,100,200,300,500];
  const PERIODS = {'1m':1,'5m':5,'15m':15,'1h':60,'4h':240,'1d':1440};
  const RANGES = {'1h':60,'2h':120,'8h':480,'1d':1440,'1w':10080,'1mo':43200,'3mo':129600};
  const START = 100000, KEY = 'fx-kantan-paper-v1';
  const GITHUB_MIRROR = location.hostname.toLowerCase() === 'chai-maomao.github.io';
  const LEADERBOARD_API = GITHUB_MIRROR ? 'https://fx-kantan.top/api/leaderboard' : '/api/leaderboard';
  const MIRROR_ID_KEY = 'fx-kantan-board-id-v1';
  const CURRENCY_NAMES = {USD:'美元',EUR:'欧元',GBP:'英镑',JPY:'日元',AUD:'澳元',NZD:'新西兰元',CHF:'瑞士法郎',CAD:'加元'};
  const $ = id => document.getElementById(id);
  const money = n => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const pairName = s => `${s.slice(0,3)}/${s.slice(3)}`;
  const rate = (n,s) => Number.isFinite(n) ? n.toFixed(s?.endsWith('JPY') ? 3 : 5) : '—';
  const positiveClass = n => n > .00001 ? 'gain' : n < -.00001 ? 'loss' : '';
  const localTime = stamp => new Date(stamp).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  const clockTime = stamp => new Date(stamp).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (!raw || !Number.isFinite(raw.balance) || !Array.isArray(raw.positions) || !Array.isArray(raw.history)) throw Error('Invalid state');
      return {
        balance:raw.balance,
        startingBalance:[10000,START].includes(raw.startingBalance) ? raw.startingBalance : 10000,
        leverage:LEVERAGES.includes(raw.leverage) ? raw.leverage : 20,
        positions:raw.positions.filter(p => PAIRS.includes(p.symbol) && ['long','short'].includes(p.side) && Number.isFinite(p.entry) && p.entry > 0 && Number.isInteger(p.units) && p.units > 0 && Number.isFinite(p.margin) && p.margin > 0).map(p => ({...p,leverage:LEVERAGES.includes(p.leverage) ? p.leverage : 20,takeProfit:Number.isFinite(p.takeProfit)&&p.takeProfit>0?p.takeProfit:null,stopLoss:Number.isFinite(p.stopLoss)&&p.stopLoss>0?p.stopLoss:null})),
        history:raw.history.filter(h => PAIRS.includes(h.symbol) && ['买入开仓','卖出开仓','平仓','止盈平仓','止损平仓','强制平仓'].includes(h.action) && Number.isFinite(Number(h.price)) && Number.isFinite(Number(h.units))).slice(0,100)
      };
    } catch { return {balance:START,startingBalance:START,leverage:20,positions:[],history:[]}; }
  }
  const account = load();
  let selected = 'EURUSD', filter = 'all', quotes = {}, chartBars = [], chartMode = 'candles';
  let visibleCount = null, rightOffset = 0, visibleBars = [], chartHover = -1, dragStart = null;
  let chartRequest = 0, chartLastFetch = 0, quoteRequestRunning = false, streamConnected = false;
  let renderTimer = 0, plotTimer = 0, streamRetryTimer = 0, streamStarting = false, stream;
  let leaderboardMine = null, leaderboardBusy = false, editingPositionId = null;
  let mirrorVisitorId = null;
  function leaderboardFetch(path = '', options = {}) {
    if (!GITHUB_MIRROR) return fetch(`${LEADERBOARD_API}${path}`,{...options,credentials:'same-origin'});
    if (!mirrorVisitorId) {
      try { mirrorVisitorId = localStorage.getItem(MIRROR_ID_KEY); } catch {}
      if (!mirrorVisitorId || !/^[0-9a-f-]{36}$/.test(mirrorVisitorId)) {
        mirrorVisitorId = crypto.randomUUID();
        try { localStorage.setItem(MIRROR_ID_KEY,mirrorVisitorId); } catch {}
      }
    }
    const headers = new Headers(options.headers);
    headers.set('X-FXK-Visitor-ID',mirrorVisitorId);
    return fetch(`${LEADERBOARD_API}${path}`,{...options,headers,credentials:'omit'});
  }
  function save() { try { localStorage.setItem(KEY,JSON.stringify(account)); } catch {} }
  function currentQuote(symbol) {
    const q = quotes[symbol];
    return q && Number.isFinite(q.bid) && Number.isFinite(q.ask) && q.bid > 0 && q.ask > q.bid ? q : null;
  }
  function quoteTime(q) { return Date.parse(q?.timestamp || q?.lastQuoteAt); }
  function isLive(q) {
    const age = Date.now() - quoteTime(q);
    return Boolean(q && q.marketState === 'open' && q.stale === false && Number.isFinite(age) && age >= -10000 && age < 45000);
  }
  function quoteToUsd(currency, requireLive = false) {
    if (currency === 'USD') return 1;
    const symbol = ({JPY:'USDJPY',CHF:'USDCHF',CAD:'USDCAD',EUR:'EURUSD',GBP:'GBPUSD',AUD:'AUDUSD',NZD:'NZDUSD'})[currency];
    const q = currentQuote(symbol);
    if (!q || (requireLive && !isLive(q))) return null;
    const mid = (q.bid + q.ask) / 2;
    return symbol.startsWith('USD') ? 1 / mid : mid;
  }
  function canTrade(symbol) { return isLive(currentQuote(symbol)) && quoteToUsd(symbol.slice(3),true) != null; }
  function markToMarket(p) {
    const q = currentQuote(p.symbol), factor = quoteToUsd(p.symbol.slice(3));
    if (!q || factor == null) return null;
    return (p.side === 'long' ? q.bid - p.entry : p.entry - q.ask) * p.units * factor;
  }
  function totals() {
    const values = account.positions.map(markToMarket);
    const complete = values.every(v => v != null);
    const floating = values.reduce((sum,v) => sum + (v || 0),0);
    const margin = account.positions.reduce((sum,p) => sum + p.margin,0);
    const equity = account.balance + floating;
    return {floating,margin,equity,free:equity-margin,complete};
  }
  function liquidationPrice(p) {
    const q=currentQuote(p.symbol),factor=quoteToUsd(p.symbol.slice(3),true);
    if(!q || !canTrade(p.symbol) || factor==null)return null;
    const direction=p.side==='long'?1:-1;
    let price;
    if(p.symbol.startsWith('USD')) {
      const lossPerUnit=p.margin/p.units,spread=q.ask-q.bid;
      price=(p.entry-lossPerUnit*spread/2)/(1+direction*lossPerUnit);
    } else price=p.entry-direction*p.margin/(p.units*factor);
    return Number.isFinite(price)&&price>0?price:null;
  }
  function liquidationLabel(p) {
    const price=liquidationPrice(p);
    return price==null?(canTrade(p.symbol)?'无正价格触发点':'等待有效报价'):rate(price,p.symbol);
  }
  function liquidationReached(p) {
    const pnl=markToMarket(p);
    return pnl!=null && pnl <= -p.margin;
  }
  function marginBudget() { return Number($('order-margin').value); }
  function validMargin(value) { return Number.isFinite(value) && value >= 1 && value <= 1e9 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6; }
  function orderFor(side) {
    const budget = marginBudget(), q = currentQuote(selected), factor = quoteToUsd(selected.slice(3),true);
    if (!validMargin(budget) || !canTrade(selected) || !q || factor == null) return null;
    const entry = side === 'long' ? q.ask : q.bid;
    const units = Math.floor(budget * account.leverage / (entry * factor));
    if (!Number.isSafeInteger(units) || units < 1 || units > 1e12) return null;
    return {units, entry, margin:units * entry * factor / account.leverage};
  }
  function showMessage(message,kind='') { $('trade-message').textContent = message; $('trade-message').className = `trade-message ${kind}`; }
  function acceptQuote(tick) {
    if (!tick || !PAIRS.includes(tick.symbol)) return false;
    const incoming = quoteTime(tick), previous = quotes[tick.symbol] || {};
    if (!Number.isFinite(incoming) || incoming < quoteTime(previous)) return false;
    quotes[tick.symbol] = {...previous,...tick,marketState:tick.marketState ?? previous.marketState ?? 'open',stale:tick.stale ?? false};
    return Boolean(currentQuote(tick.symbol));
  }
  function renderStatus() {
    const live = PAIRS.some(s => isLive(currentQuote(s))), status = $('feed-status');
    status.textContent = live ? (streamConnected ? '逐笔推送' : '3 秒轮询') : '行情暂停';
    status.className = `status ${live ? 'status-live' : 'status-stale'}`;
    const q = currentQuote(selected);
    $('updated-at').textContent = q ? `最新 Tick ${clockTime(q.timestamp)}` : '等待最新报价';
  }
  function renderPairList() {
    const visible = PAIRS.filter(s => filter === 'all' || (filter === 'jpy' ? s.endsWith('JPY') : MAJORS.has(s)));
    $('pair-list').innerHTML = visible.map(s => {
      const q = currentQuote(s), change = q && isLive(q) && Number.isFinite(q.dayDiffPercent) ? q.dayDiffPercent : null;
      return `<button type="button" class="pair-button" role="tab" aria-selected="${selected === s}" data-symbol="${s}"><span><b>${pairName(s)}</b><small class="${change == null ? '' : positiveClass(change)}">${change == null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}</small></span><strong>${q ? rate(q.mid || (q.bid+q.ask)/2,s) : '—'}</strong></button>`;
    }).join('');
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active',b.dataset.filter === filter));
  }
  function renderAccount() {
    const t = totals();
    $('equity').textContent = t.complete ? money(t.equity) : '—';
    $('free-margin').textContent = t.complete ? money(t.free) : '—';
    $('floating').textContent = t.complete ? money(t.floating) : '—';
    $('floating').className = positiveClass(t.floating);
    $('realized').textContent = money(account.balance-account.startingBalance);
    $('realized').className = positiveClass(account.balance-account.startingBalance);
  }
  function renderTrade() {
    const q = currentQuote(selected), live = canTrade(selected);
    const currency = selected.slice(0,3), budget = marginBudget(), buy = orderFor('long'), sell = orderFor('short');
    $('trade-pair').textContent = pairName(selected);
    $('units-explain').textContent = buy && sell ? `保证金 × ${account.leverage} 倍杠杆：买入约 ${buy.units.toLocaleString('zh-CN')} / 卖出约 ${sell.units.toLocaleString('zh-CN')} ${CURRENCY_NAMES[currency]}（${currency}）。数量按整单位向下取整，实际占用略低于输入金额。` : '输入美元保证金并选择杠杆，行情接通后显示可交易的货币数量。';
    $('trade-state').textContent = !q ? '等待报价' : live ? '可交易' : q.marketState === 'open' ? '报价或换算汇率过期' : '市场休市';
    $('bid').textContent = q ? rate(q.bid,selected) : '—';
    $('ask').textContent = q ? rate(q.ask,selected) : '—';
    const t = totals();
    $('estimated-margin').textContent = validMargin(budget) ? money(budget * account.leverage) : '—';
    $('liquidation-buy').textContent=buy?liquidationLabel({...buy,symbol:selected,side:'long'}):'—';
    $('liquidation-sell').textContent=sell?liquidationLabel({...sell,symbol:selected,side:'short'}):'—';
    $('buy-button').disabled = !(live && buy && t.complete && budget <= t.free);
    $('sell-button').disabled = !(live && sell && t.complete && budget <= t.free);
    syncRiskReference($('take-profit'),selected);
    syncRiskReference($('stop-loss'),selected);
  }
  function renderChartHeading() {
    const q = currentQuote(selected);
    $('chart-title').textContent = pairName(selected);
    $('pair-price').textContent = q ? rate(q.mid || (q.bid+q.ask)/2,selected) : '—';
    $('pair-change').textContent = q && isLive(q) && Number.isFinite(q.dayDiffPercent) ? `${q.dayDiffPercent >= 0 ? '+' : ''}${q.dayDiffPercent.toFixed(2)}% 今日` : '—';
    $('pair-change').className = q ? positiveClass(q.dayDiffPercent) : '';
  }
  function renderRecords() {
    const body=$('positions-body'),rows=Array.from(body.querySelectorAll('tr[data-position-id]'));
    if(!account.positions.length){if(!body.querySelector('.empty-row'))body.innerHTML='<tr class="empty-row"><td colspan="10">还没有持仓。选择货币对，试着开第一单。</td></tr>';}
    else {
      if(rows.length!==account.positions.length||rows.some((row,i)=>row.dataset.positionId!==account.positions[i].id)) {
        body.innerHTML=account.positions.map(p=>`<tr data-position-id="${p.id}"><td><b>${pairName(p.symbol)}</b></td><td class="${p.side==='long'?'side-long':'side-short'}">${p.side==='long'?'买入':'卖出'}</td><td class="position-margin"><b>${money(p.margin)}</b><small>${p.units.toLocaleString()} ${p.symbol.slice(0,3)}</small></td><td>${p.leverage}×</td><td>${rate(p.entry,p.symbol)}</td><td></td><td></td><td></td><td></td><td><button class="close-button" type="button" data-risk="${p.id}">设置止盈止损</button> <button class="close-button" type="button" data-close="${p.id}">平仓</button></td></tr>`).join('');
      }
      Array.from(body.rows).forEach((row,i)=>{
        const p=account.positions[i],q=currentQuote(p.symbol),pnl=markToMarket(p),exit=q?(p.side==='long'?q.bid:q.ask):null;
        row.cells[5].textContent=exit==null?'—':rate(exit,p.symbol);
        row.cells[6].textContent=`${p.takeProfit==null?'—':rate(p.takeProfit,p.symbol)} / ${p.stopLoss==null?'—':rate(p.stopLoss,p.symbol)}`;
        row.cells[7].textContent=pnl==null?'—':money(pnl);
        row.cells[7].className=pnl==null?'':positiveClass(pnl);
        row.cells[8].textContent=liquidationLabel(p);
        row.cells[8].title='亏损达到此仓保证金时强平；按最新美元换算汇率估算，实际按触发时可成交价平仓。';
        row.querySelector('[data-close]').title=canTrade(p.symbol)?'按当前报价平仓':'报价或换算汇率过期，点击查看原因';
      });
    }
    $('history-body').innerHTML = account.history.length ? account.history.map(h => `<tr><td>${localTime(h.time)}</td><td>${pairName(h.symbol)}</td><td>${h.action}</td><td>${Number(h.units).toLocaleString()}</td><td>${rate(Number(h.price),h.symbol)}</td><td class="${h.pnl == null ? '' : positiveClass(h.pnl)}">${h.pnl == null ? '—' : money(h.pnl)}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="6">交易记录会显示在这里。</td></tr>';
  }
  function render() { renderStatus(); renderPairList(); renderAccount(); renderTrade(); renderChartHeading(); renderRecords(); }
  function scheduleRender() { if (!renderTimer) renderTimer = setTimeout(() => {renderTimer=0;render();},100); }
  function schedulePlot() { if (!plotTimer) plotTimer = setTimeout(() => {plotTimer=0;drawChart();},150); }
  function riskStep(symbol) { return symbol.endsWith('JPY') ? '0.001' : '0.00001'; }
  function syncRiskReference(input,symbol) {
    input.step=riskStep(symbol);input.min=riskStep(symbol);
    if(input.dataset.reference==='true') {
      const q=currentQuote(symbol);
      input.value=q?rate(q.mid||(q.bid+q.ask)/2,symbol):'';
    }
  }
  function resetRiskReference(input,symbol) { input.dataset.reference='true';input.classList.add('reference-value');syncRiskReference(input,symbol); }
  function setRiskValue(input,value,symbol) {
    if(value==null) resetRiskReference(input,symbol);
    else {input.dataset.reference='false';input.classList.remove('reference-value');input.step=riskStep(symbol);input.min=riskStep(symbol);input.value=rate(value,symbol);}
  }
  function riskValue(id) { const input=$(id),textValue=input.value.trim();return input.dataset.reference==='true'||textValue===''?null:Number(textValue); }
  function riskError(side,entry,exit,takeProfit,stopLoss) {
    if ([takeProfit,stopLoss].some(value=>value!==null&&(!Number.isFinite(value)||value<=0))) return '止盈止损须填写大于 0 的汇率价格，或留空。';
    if (side==='long' && ((takeProfit!==null&&takeProfit<=entry)||(stopLoss!==null&&stopLoss>=exit))) return '买入做多时，止盈需高于买入价，止损需低于当前卖出价。';
    if (side==='short' && ((takeProfit!==null&&takeProfit>=entry)||(stopLoss!==null&&stopLoss<=exit))) return '卖出做空时，止盈需低于卖出价，止损需高于当前买入价。';
    return null;
  }
  function trade(side) {
    const q = currentQuote(selected), budget = marginBudget();
    if (!canTrade(selected)) return showMessage('当前报价不可交易，请等待最新行情。','error');
    if (!validMargin(budget)) return showMessage('请输入 1 至 1,000,000,000 美元的保证金，最多两位小数。','error');
    const order = orderFor(side), t = totals();
    if (!order) return showMessage('保证金不足以交易一个货币单位，或换算汇率不可用。','error');
    if (!t.complete || budget > t.free) return showMessage('可用保证金不足或换算汇率不可用。','error');
    const {units,entry,margin} = order;
    const candidate={symbol:selected,side,units,entry,margin};
    if(liquidationReached(candidate))return showMessage('当前点差已耗尽该仓保证金，请降低杠杆后再下单。','error');
    const takeProfit=riskValue('take-profit'),stopLoss=riskValue('stop-loss'),error=riskError(side,entry,side==='long'?q.bid:q.ask,takeProfit,stopLoss);
    if(error) return showMessage(error,'error');
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    account.positions.unshift({id,symbol:selected,side,units,entry,margin,leverage:account.leverage,takeProfit,stopLoss,time:new Date().toISOString()});
    account.history.unshift({time:new Date().toISOString(),symbol:selected,action:side === 'long' ? '买入开仓' : '卖出开仓',units,price:entry,pnl:null});
    account.history = account.history.slice(0,100);
    resetRiskReference($('take-profit'),selected);resetRiskReference($('stop-loss'),selected);save();render();showMessage(`${pairName(selected)} 已${side === 'long' ? '买入' : '卖出'} ${units.toLocaleString()} ${selected.slice(0,3)}，杠杆 ${account.leverage}×。`,'success');
  }
  function closePosition(id,reason='平仓') {
    const index = account.positions.findIndex(p => p.id === id);
    if (index < 0) return;
    const p = account.positions[index], q = currentQuote(p.symbol);
    if (!canTrade(p.symbol)) return showMessage('报价或换算汇率已过期，暂时无法平仓。','error');
    const pnl = markToMarket(p);
    if (pnl == null) return showMessage('暂时无法计算美元盈亏。','error');
    const price = p.side === 'long' ? q.bid : q.ask;
    account.balance += pnl;account.positions.splice(index,1);
    account.history.unshift({time:new Date().toISOString(),symbol:p.symbol,action:reason,units:p.units,price,pnl});
    account.history = account.history.slice(0,100);
    save();render();showMessage(`${reason==='平仓'?'已平仓':reason+'已触发'}，${pnl >= 0 ? '盈利' : '亏损'} ${money(Math.abs(pnl))}。`,pnl >= 0 ? 'success' : 'error');
  }
  function processTriggers() {
    for(const p of [...account.positions]) {
      if(!canTrade(p.symbol)) continue;
      const q=currentQuote(p.symbol),exit=p.side==='long'?q.bid:q.ask;
      if(liquidationReached(p))closePosition(p.id,'强制平仓');
      else if(p.takeProfit!=null && (p.side==='long'?exit>=p.takeProfit:exit<=p.takeProfit)) closePosition(p.id,'止盈平仓');
      else if(p.stopLoss!=null && (p.side==='long'?exit<=p.stopLoss:exit>=p.stopLoss)) closePosition(p.id,'止损平仓');
    }
  }
  function setLeaderboardStatus(message,kind='') { $('leaderboard-status').textContent=message;$('leaderboard-status').className=`leaderboard-status ${kind}`; }
  function boardElement(tag,className,textValue) { const el=document.createElement(tag);if(className)el.className=className;if(textValue!=null)el.textContent=textValue;return el; }
  function renderLeaderboardHistory(detail,history) {
    detail.replaceChildren(boardElement('p','leaderboard-detail-title','最近 20 条交易记录 · 按发布时间保存的快照'));
    if(!history.length){detail.append(boardElement('p','leaderboard-detail-message','暂无交易记录；旧版榜单记录需由本人重新发布后才会显示。'));return;}
    const rows=boardElement('div','leaderboard-history');
    history.forEach(record=>{
      const row=boardElement('div','leaderboard-history-row');
      row.append(boardElement('small','',localTime(record.time)),boardElement('span','',`${pairName(record.symbol)} · ${record.action} · ${Number(record.units).toLocaleString()} ${record.symbol.slice(0,3)} · ${rate(Number(record.price),record.symbol)}`),boardElement('strong',record.pnl==null?'':positiveClass(record.pnl),record.pnl==null?'—':`${record.pnl>=0?'+':''}${money(record.pnl)}`));
      rows.append(row);
    });
    detail.append(rows);
  }
  async function toggleLeaderboardDetail(button,detail,id) {
    const open=button.getAttribute('aria-expanded')!=='true';
    button.setAttribute('aria-expanded',String(open));detail.hidden=!open;
    if(!open || detail.dataset.loaded==='true')return;
    detail.replaceChildren(boardElement('p','leaderboard-detail-message','正在读取交易记录…'));
    try {
      const response=await leaderboardFetch(`/${id}`,{cache:'no-store',signal:AbortSignal.timeout(12000)});
      const data=await response.json();if(!response.ok)throw Error(data.error||'无法读取交易记录。');
      detail.dataset.loaded='true';if(!detail.hidden)renderLeaderboardHistory(detail,Array.isArray(data.entry?.history)?data.entry.history:[]);
    } catch(error) {if(!detail.hidden)detail.replaceChildren(boardElement('p','leaderboard-detail-message',error.message||'无法读取交易记录，请稍后重试。'));}
  }
  function renderLeaderboard(entries) {
    const list=$('leaderboard-list');list.replaceChildren();
    if(!entries.length){list.append(boardElement('p','leaderboard-empty','还没有人发布盈亏，快来占据第一席。'));return;}
    entries.forEach((entry,index)=>{
      const card=boardElement('article','leaderboard-entry'),head=boardElement('button','leaderboard-entry-toggle');
      const detail=boardElement('div','leaderboard-detail');detail.hidden=true;
      head.type='button';head.setAttribute('aria-expanded','false');head.setAttribute('aria-label',`查看 ${entry.name} 的最近交易记录`);
      head.append(boardElement('span','leaderboard-rank',`#${index+1}`),boardElement('strong','leaderboard-name',entry.name),boardElement('span',`leaderboard-score ${positiveClass(entry.score)}`,`${entry.score>=0?'+':''}${money(entry.score)}`),boardElement('span','leaderboard-chevron','⌄'));
      head.addEventListener('click',()=>toggleLeaderboardDetail(head,detail,entry.id));
      card.append(head,boardElement('p','leaderboard-meta',`发布于 ${localTime(entry.updatedAt)}`),detail);list.append(card);
    });
  }
  async function refreshLeaderboard() {
    try {
      const response=await leaderboardFetch('',{cache:'no-store',signal:AbortSignal.timeout(12000)});
      const data=await response.json();if(!response.ok)throw Error(data.error||'无法读取排行榜。');
      leaderboardMine=data.mine;
      $('leaderboard-publish').disabled=false;
      if(data.mine && !$('leaderboard-name').value) $('leaderboard-name').value=data.mine.name;
      $('leaderboard-remove').hidden=!data.mine;
      $('leaderboard-remove').disabled=false;
      renderLeaderboard(Array.isArray(data.entries)?data.entries:[]);
      setLeaderboardStatus(data.mine?'此浏览器已发布记录；再次发布会覆盖旧记录。':'填写展示名即可自愿发布盈亏。','success');
    } catch(error) {
      $('leaderboard-publish').disabled=true;
      $('leaderboard-remove').disabled=true;
      setLeaderboardStatus(GITHUB_MIRROR?'抱歉，镜像站暂时无法连接主站排行榜。请稍后点击“刷新”重试；模拟交易和行情仍可使用。':error.message||'排行榜暂不可用，请稍后刷新。','error');
    }
  }
  async function publishLeaderboard(event) {
    event.preventDefault();if(leaderboardBusy)return;
    const t=totals();if(!t.complete)return setLeaderboardStatus('行情尚未齐全，暂时无法计算模拟收益。','error');
    const name=$('leaderboard-name').value.trim();if(name.length<2||name.length>24)return setLeaderboardStatus('展示名需为 2 至 24 个字。','error');
    leaderboardBusy=true;$('leaderboard-publish').disabled=true;setLeaderboardStatus('正在发布盈亏…');
    try {
      const history=account.history.slice(0,20).map(({time,symbol,action,units,price,pnl})=>({time,symbol,action,units,price,pnl}));
      const response=await leaderboardFetch('',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,balance:account.balance,startingBalance:account.startingBalance,floating:t.floating,history}),signal:AbortSignal.timeout(12000)});
      const data=await response.json();if(!response.ok)throw Error(data.error||'发布失败。');
      leaderboardMine=data.entry;await refreshLeaderboard();setLeaderboardStatus('盈亏和最近 20 条交易记录已公开。此浏览器再次发布会覆盖这条记录。','success');
    } catch(error) {setLeaderboardStatus(error.message||'发布失败，请稍后重试。','error');}
    finally {leaderboardBusy=false;$('leaderboard-publish').disabled=false;}
  }
  async function removeLeaderboard() {
    if(leaderboardBusy)return;leaderboardBusy=true;$('leaderboard-remove').disabled=true;
    try {
      const response=await leaderboardFetch('',{method:'DELETE',signal:AbortSignal.timeout(12000)});
      const data=await response.json();if(!response.ok)throw Error(data.error||'撤下失败。');
      leaderboardMine=null;await refreshLeaderboard();setLeaderboardStatus('你的公开记录已撤下。','success');
    } catch(error) {setLeaderboardStatus(error.message||'撤下失败，请稍后重试。','error');}
    finally {leaderboardBusy=false;$('leaderboard-remove').disabled=false;}
  }
  function openRiskDialog(id) {
    const p=account.positions.find(item=>item.id===id);if(!p)return;
    editingPositionId=id;$('risk-pair').textContent=`${pairName(p.symbol)} · ${p.side==='long'?'买入做多':'卖出做空'} · 当前价 ${rate((currentQuote(p.symbol)?.mid),p.symbol)}`;
    setRiskValue($('risk-tp'),p.takeProfit,p.symbol);setRiskValue($('risk-sl'),p.stopLoss,p.symbol);$('risk-message').textContent='淡色当前价仅作参考，点箭头或输入后生效；留空可取消已有设置。';$('risk-dialog').showModal();
  }
  function saveRisk(event) {
    event.preventDefault();const p=account.positions.find(item=>item.id===editingPositionId),q=p&&currentQuote(p.symbol);
    if(!p||!q||!canTrade(p.symbol)){$('risk-message').textContent='请等待该货币对的最新报价。';return;}
    const exit=p.side==='long'?q.bid:q.ask,takeProfit=riskValue('risk-tp'),stopLoss=riskValue('risk-sl');
    const error=riskError(p.side,p.entry,exit,takeProfit,stopLoss);if(error){$('risk-message').textContent=error;return;}
    p.takeProfit=takeProfit;p.stopLoss=stopLoss;save();renderRecords();$('risk-dialog').close();editingPositionId=null;showMessage(`${pairName(p.symbol)} 的止盈止损已保存。`,'success');
  }
  function chartConfig() {
    const interval = $('chart-interval').value, range = $('chart-range').value;
    return {interval,range,count:Math.min(500,Math.ceil(RANGES[range]/PERIODS[interval])+1)};
  }
  function syncIntervalPicker() {
    const select=$('chart-interval');
    $('chart-interval-label').textContent=select.selectedOptions[0].textContent;
    document.querySelectorAll('[data-interval]').forEach(option=>option.setAttribute('aria-selected',String(option.dataset.interval===select.value)));
  }
  function adjustChartSelection(changed) {
    let interval = $('chart-interval').value, range = $('chart-range').value;
    const periods = Object.keys(PERIODS), ranges = Object.keys(RANGES);
    if (changed === 'range') {
      while (RANGES[range]/PERIODS[interval] > 500 && periods.indexOf(interval) < periods.length-1) interval=periods[periods.indexOf(interval)+1];
      while (RANGES[range]/PERIODS[interval] < 12 && periods.indexOf(interval) > 0) interval=periods[periods.indexOf(interval)-1];
      $('chart-interval').value=interval;
    } else {
      while (RANGES[range]/PERIODS[interval] > 500 && ranges.indexOf(range) > 0) range=ranges[ranges.indexOf(range)-1];
      while (RANGES[range]/PERIODS[interval] < 12 && ranges.indexOf(range) < ranges.length-1) range=ranges[ranges.indexOf(range)+1];
      $('chart-range').value=range;
    }
    syncIntervalPicker();
    chartBars = []; visibleCount = null; rightOffset = 0; chartHover = -1;
    refreshChart();
  }
  function chartTime(stamp) {
    return new Date(stamp).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  }
  function drawHover() {
    const layer=$('chart-hover'),tooltip=$('chart-tooltip'),bar=visibleBars[chartHover];
    if (!bar || dragStart) { layer.innerHTML='';tooltip.hidden=true;return; }
    const left=45,right=726,top=24,bottom=304,x=left+(chartHover+.5)*(right-left)/visibleBars.length;
    const min=Math.min(...visibleBars.map(b=>b.low)),max=Math.max(...visibleBars.map(b=>b.high)),pad=Math.max((max-min)*.1,min*.00005);
    const y=bottom-(bar.close-(min-pad))/(max-min+2*pad)*(bottom-top);
    layer.innerHTML=`<path d="M ${x} ${top} V ${bottom} M ${left} ${y} H ${right}" stroke="#bddff0" stroke-opacity=".65" stroke-dasharray="3 4"/><circle cx="${x}" cy="${y}" r="4" fill="#e4f5ff"/>`;
    tooltip.innerHTML=`<strong>${chartTime(bar.time)}</strong><span>开 ${rate(bar.open,selected)}　高 ${rate(bar.high,selected)}</span><span>低 ${rate(bar.low,selected)}　收 ${rate(bar.close,selected)}</span>`;
    tooltip.hidden=false;
  }
  function drawChart() {
    if (!chartBars.length) { visibleBars=[];$('chart-hover').innerHTML='';$('chart-tooltip').hidden=true;return; }
    const count=Math.min(chartBars.length,visibleCount || chartBars.length);
    rightOffset=Math.min(rightOffset,chartBars.length-count);
    const end=chartBars.length-rightOffset,bars=chartBars.slice(end-count,end),left=45,right=726,top=24,bottom=304;
    visibleBars=bars;
    const min=Math.min(...bars.map(b=>b.low)),max=Math.max(...bars.map(b=>b.high));
    const pad=Math.max((max-min)*.1,min*.00005),low=min-pad,high=max+pad;
    const y=v=>bottom-(v-low)/(high-low)*(bottom-top),x=i=>left+(i+.5)*(right-left)/bars.length;
    const grid=[],axis=[];
    for(let i=0;i<=4;i++){
      const gy=top+i*(bottom-top)/4;
      grid.push(`<path d="M ${left} ${gy} H ${right}"/>`);
      axis.push(`<text x="739" y="${gy+4}">${rate(high-i*(high-low)/4,selected)}</text>`);
      const index=Math.min(bars.length-1,Math.round(i*(bars.length-1)/4));
      const label=chartTime(bars[index].time,true);
      if(chartSurface.clientWidth>=500 || i%2===0) axis.push(`<text x="${x(index)}" y="340" text-anchor="middle">${label}</text>`);
    }
    $('chart-grid').innerHTML=grid.join('');$('chart-axis').innerHTML=axis.join('');
    if(chartMode==='candles'){
      const width=Math.max(1,Math.min(9,(right-left)/bars.length*.66));
      $('chart-candles').innerHTML=bars.map((b,i)=>{
        const cx=x(i),color=b.close>=b.open?'#64e8c1':'#fa7894',bodyTop=Math.min(y(b.open),y(b.close)),height=Math.max(1.4,Math.abs(y(b.close)-y(b.open)));
        return `<path d="M ${cx} ${y(b.high)} V ${y(b.low)}" stroke="${color}" stroke-width="1.2"/><rect x="${cx-width/2}" y="${bodyTop}" width="${width}" height="${height}" fill="${color}"/>`;
      }).join('');
      $('chart-line').setAttribute('d','');$('chart-fill').setAttribute('d','');
    } else {
      const points=bars.map((b,i)=>`${x(i).toFixed(1)},${y(b.close).toFixed(1)}`);
      $('chart-candles').innerHTML='';
      $('chart-line').setAttribute('d',`M ${points.join(' L ')}`);
      $('chart-fill').setAttribute('d',`M ${x(0)},${bottom} L ${points.join(' L ')} L ${x(bars.length-1)},${bottom} Z`);
    }
    const q=currentQuote(selected),last=q?(q.mid||(q.bid+q.ask)/2):bars[bars.length-1].close,ly=Math.max(top,Math.min(bottom,y(last)));
    $('chart-last').innerHTML=rightOffset===0 ? `<path d="M ${left} ${ly} H ${right}" stroke="#dcefff" stroke-opacity=".45" stroke-dasharray="4 5"/><circle cx="${x(bars.length-1)}" cy="${ly}" r="3.5" fill="#dcefff"/>` : '';
    $('chart-empty').style.display='none';
    $('chart-detail').textContent=`${$('chart-interval').selectedOptions[0].textContent}周期 · 近 ${$('chart-range').selectedOptions[0].textContent} · ${chartMode==='candles'?'K 线':'分时线'}${visibleCount || rightOffset?' · 自定义视图':''}`;
    drawHover();
  }
  async function refreshChart() {
    const symbol=selected,{interval,count}=chartConfig(),request=++chartRequest;
    chartLastFetch=Date.now();
    if (!chartBars.length) { $('chart-empty').style.display='grid'; $('chart-empty').textContent='正在读取行情图表…'; }
    try {
      const response=await fetch(`https://biquote.io/api/${symbol}/ohlc?interval=${interval}&limit=${count}`,{cache:'no-store',signal:AbortSignal.timeout(12000)});
      if(!response.ok) throw Error(`HTTP ${response.status}`);
      const raw=await response.json();
      if(request!==chartRequest) return;
      chartBars=(Array.isArray(raw.bars)?raw.bars:[]).map(b=>({time:Date.parse(b.openTime),open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close)})).filter(b=>Number.isFinite(b.time)&&[b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0)).sort((a,b)=>a.time-b.time).slice(-count);
      if(chartBars.length<2) throw Error('No chart data');
      drawChart();
    } catch { if(request===chartRequest && !chartBars.length) $('chart-empty').textContent='暂时无法读取图表，报价仍可单独使用。'; }
  }
  function updateCurrentBar(tick) {
    if(tick.symbol!==selected) return;
    if(!chartBars.length) return;
    const mid=Number(tick.mid||(tick.bid+tick.ask)/2),time=quoteTime(tick);
    if(!Number.isFinite(mid)||!Number.isFinite(time)) return;
    const period=PERIODS[$('chart-interval').value]*60000,bucket=Math.floor(time/period)*period,last=chartBars[chartBars.length-1];
    if(bucket===last.time){last.close=mid;last.high=Math.max(last.high,mid);last.low=Math.min(last.low,mid);schedulePlot();}
    else if(bucket>last.time&&Date.now()-chartLastFetch>10000) refreshChart();
  }
  async function refreshQuotes() {
    if(quoteRequestRunning) return;
    quoteRequestRunning=true;
    try{
      const response=await fetch(`https://biquote.io/api/latest?${PAIRS.map(s=>`symbols=${s}`).join('&')}`,{cache:'no-store',signal:AbortSignal.timeout(12000)});
      if(!response.ok) throw Error(`HTTP ${response.status}`);
      const data=await response.json();
      PAIRS.forEach(s=>{if(acceptQuote(data[s])) updateCurrentBar(data[s]);});
      processTriggers();render();
    }catch{
      if(!streamConnected){$('feed-status').textContent='行情连接中断';$('feed-status').className='status status-stale';renderTrade();}
    }finally{quoteRequestRunning=false;}
  }
  async function startStream() {
    if(!window.signalR || streamConnected || streamStarting) return;
    streamStarting = true;
    clearTimeout(streamRetryTimer);
    stream=new signalR.HubConnectionBuilder().withUrl('https://biquote.io/hubs/tick',{skipNegotiation:true,transport:signalR.HttpTransportType.WebSockets}).withAutomaticReconnect([0,2000,5000,10000]).build();
    stream.on('ReceiveTick',tick=>{if(acceptQuote(tick)){updateCurrentBar(tick);processTriggers();scheduleRender();}});
    stream.onreconnecting(()=>{streamConnected=false;renderStatus();});
    stream.onreconnected(async()=>{try{await stream.invoke('Subscribe',PAIRS);streamConnected=true;refreshQuotes();renderStatus();}catch{streamConnected=false;renderStatus();}});
    stream.onclose(()=>{streamConnected=false;renderStatus();streamRetryTimer=setTimeout(startStream,15000);});
    try{await stream.start();await stream.invoke('Subscribe',PAIRS);streamConnected=true;renderStatus();}
    catch{streamConnected=false;renderStatus();streamRetryTimer=setTimeout(startStream,15000);}
    finally{streamStarting=false;}
  }
  $('pair-list').addEventListener('click',e=>{const b=e.target.closest('[data-symbol]');if(!b||!PAIRS.includes(b.dataset.symbol))return;selected=b.dataset.symbol;chartBars=[];visibleCount=null;rightOffset=0;chartHover=-1;resetRiskReference($('take-profit'),selected);resetRiskReference($('stop-loss'),selected);render();refreshChart();});
  document.querySelector('.watch-filter').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;filter=b.dataset.filter;renderPairList();});
  document.querySelector('.segmented').addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(!b)return;chartMode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(item=>{item.classList.toggle('active',item===b);item.setAttribute('aria-pressed',item===b?'true':'false');});drawChart();});
  const intervalPicker=document.querySelector('.interval-picker'),intervalTrigger=$('chart-interval-trigger'),intervalMenu=$('chart-interval-menu');
  function closeIntervalMenu(){intervalMenu.hidden=true;intervalTrigger.setAttribute('aria-expanded','false');}
  intervalTrigger.addEventListener('click',()=>{
    const open=intervalMenu.hidden;intervalMenu.hidden=!open;intervalTrigger.setAttribute('aria-expanded',String(open));
  });
  intervalMenu.addEventListener('click',event=>{
    const option=event.target.closest('[data-interval]');if(!option || option.getAttribute('aria-disabled')==='true')return;
    $('chart-interval').value=option.dataset.interval;
    closeIntervalMenu();$('chart-interval').dispatchEvent(new Event('change'));
  });
  intervalPicker.addEventListener('keydown',event=>{
    if(event.key==='Escape'){closeIntervalMenu();intervalTrigger.focus();return;}
    if(event.key==='ArrowDown' || event.key==='ArrowUp'){
      event.preventDefault();if(intervalMenu.hidden){intervalMenu.hidden=false;intervalTrigger.setAttribute('aria-expanded','true');}
      const options=[...intervalMenu.querySelectorAll('[data-interval]')],current=options.indexOf(document.activeElement);
      options[(current+(event.key==='ArrowDown'?1:-1)+options.length)%options.length].focus();
    }
  });
  document.addEventListener('pointerdown',event=>{if(!intervalPicker.contains(event.target))closeIntervalMenu();});
  $('chart-interval').addEventListener('change',()=>adjustChartSelection('interval'));
  $('chart-range').addEventListener('change',()=>adjustChartSelection('range'));
  $('chart-reset').addEventListener('click',()=>{visibleCount=null;rightOffset=0;drawChart();});
  const chartSurface=$('chart-wrap');
  function pointerBar(e) {
    if(!visibleBars.length) return;
    const rect=chartSurface.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width*800;
    chartHover=Math.max(0,Math.min(visibleBars.length-1,Math.floor((x-45)/(726-45)*visibleBars.length)));
    const tooltip=$('chart-tooltip');
    tooltip.style.left=`${Math.max(8,Math.min(rect.width-192,e.clientX-rect.left+12))}px`;
    tooltip.style.top=`${Math.max(8,Math.min(rect.height-83,e.clientY-rect.top-88))}px`;
    drawHover();
  }
  chartSurface.addEventListener('pointermove',e=>{
    if(dragStart){
      const rect=chartSurface.getBoundingClientRect(),step=(rect.width*(726-45)/800)/Math.max(1,visibleBars.length);
      rightOffset=Math.max(0,Math.min(chartBars.length-visibleBars.length,dragStart.offset+Math.round((e.clientX-dragStart.x)/step)));
      drawChart();return;
    }
    pointerBar(e);
  });
  chartSurface.addEventListener('pointerleave',()=>{if(!dragStart){chartHover=-1;drawHover();}});
  chartSurface.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button===0&&chartBars.length>visibleBars.length){dragStart={x:e.clientX,offset:rightOffset};chartSurface.setPointerCapture(e.pointerId);chartSurface.classList.add('dragging');chartHover=-1;drawHover();}});
  chartSurface.addEventListener('pointerup',e=>{if(dragStart){dragStart=null;chartSurface.classList.remove('dragging');if(chartSurface.hasPointerCapture(e.pointerId))chartSurface.releasePointerCapture(e.pointerId);pointerBar(e);}});
  chartSurface.addEventListener('pointercancel',()=>{dragStart=null;chartSurface.classList.remove('dragging');});
  chartSurface.addEventListener('wheel',e=>{
    if(chartBars.length<2)return;
    e.preventDefault();
    const rect=chartSurface.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,((e.clientX-rect.left)/rect.width*800-45)/(726-45)));
    const current=visibleBars.length,oldStart=chartBars.length-rightOffset-current,anchor=oldStart+Math.floor(fraction*current);
    const next=Math.max(Math.min(8,chartBars.length),Math.min(chartBars.length,Math.round(current*(e.deltaY<0?.8:1.25))));
    visibleCount=next;
    const nextStart=Math.max(0,Math.min(chartBars.length-next,anchor-Math.floor(fraction*next)));
    rightOffset=chartBars.length-nextStart-next;
    chartHover=-1;drawChart();pointerBar(e);
  },{passive:false});
  $('leverage').value=String(account.leverage);
  $('leverage').addEventListener('change',()=>{account.leverage=Number($('leverage').value);save();renderTrade();});
  $('order-margin').addEventListener('input',renderTrade);
  for(const id of ['take-profit','stop-loss','risk-tp','risk-sl'])$(id).addEventListener('input',event=>{event.currentTarget.dataset.reference='false';event.currentTarget.classList.remove('reference-value');});
  document.querySelectorAll('[data-margin]').forEach(b=>b.addEventListener('click',()=>{$('order-margin').value=b.dataset.margin;renderTrade();}));
  $('buy-button').addEventListener('click',()=>trade('long'));
  $('sell-button').addEventListener('click',()=>trade('short'));
  $('positions-body').addEventListener('click',e=>{const close=e.target.closest('[data-close]'),risk=e.target.closest('[data-risk]');if(close)closePosition(close.dataset.close);else if(risk)openRiskDialog(risk.dataset.risk);});
  $('risk-form').addEventListener('submit',saveRisk);
  $('risk-cancel').addEventListener('click',()=>{$('risk-dialog').close();editingPositionId=null;});
  $('leaderboard-form').addEventListener('submit',publishLeaderboard);
  $('leaderboard-remove').addEventListener('click',removeLeaderboard);
  $('leaderboard-refresh').addEventListener('click',refreshLeaderboard);
  $('reset-button').addEventListener('click',()=>{if(!confirm('确定重置模拟账户？所有持仓和交易记录都会清空。'))return;account.balance=START;account.startingBalance=START;account.positions=[];account.history=[];save();render();showMessage('模拟账户已重置。','success');});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshQuotes();refreshChart();}});
  if(GITHUB_MIRROR)document.querySelector('.leaderboard-note').append(' GitHub 镜像的榜单仍由 fx-kantan.top 提供；如果该服务无法连接，榜单会暂时不可用。');
  resetRiskReference($('take-profit'),selected);resetRiskReference($('stop-loss'),selected);
  render();refreshQuotes();refreshChart();startStream();refreshLeaderboard();
  setInterval(()=>{if(!document.hidden&&!streamConnected)refreshQuotes();},3000);
  setInterval(()=>{if(!document.hidden&&streamConnected)refreshQuotes();},30000);
  setInterval(()=>{if(!document.hidden)refreshChart();},20000);
  setInterval(()=>{if(!document.hidden)render();},10000);
})();
