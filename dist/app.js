(() => {
  'use strict';
  const PAIRS = ['EURUSD','USDJPY','GBPUSD','AUDUSD','NZDUSD','USDCHF','USDCAD','EURJPY','GBPJPY','AUDJPY','NZDJPY','CADJPY','EURGBP','EURCHF'];
  const MAJORS = new Set(PAIRS.slice(0, 7));
  const LEVERAGES = [1,2,5,10,20,50,100];
  const PERIODS = {'30s':.5,'1m':1,'5m':5,'15m':15,'1h':60,'4h':240,'1d':1440};
  const RANGES = {'1h':60,'2h':120,'8h':480,'1d':1440,'1w':10080,'1mo':43200,'3mo':129600};
  const START = 10000, KEY = 'fx-kantan-paper-v1', SHORT_BARS_KEY = 'fx-kantan-30s-bars-v1';
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
        leverage:LEVERAGES.includes(raw.leverage) ? raw.leverage : 20,
        positions:raw.positions.filter(p => PAIRS.includes(p.symbol) && ['long','short'].includes(p.side) && Number.isFinite(p.entry) && p.entry > 0 && Number.isInteger(p.units) && p.units > 0 && Number.isFinite(p.margin) && p.margin > 0).map(p => ({...p,leverage:LEVERAGES.includes(p.leverage) ? p.leverage : 20})),
        history:raw.history.filter(h => PAIRS.includes(h.symbol) && ['买入开仓','卖出开仓','平仓'].includes(h.action) && Number.isFinite(Number(h.price)) && Number.isFinite(Number(h.units))).slice(0,100)
      };
    } catch { return {balance:START,leverage:20,positions:[],history:[]}; }
  }
  const account = load();
  let selected = 'EURUSD', filter = 'all', quotes = {}, chartBars = [], chartMode = 'candles';
  let visibleCount = null, rightOffset = 0, visibleBars = [], chartHover = -1, dragStart = null, shortBarsSaveTimer = 0;
  let shortBars = {};
  try {
    const saved = JSON.parse(localStorage.getItem(SHORT_BARS_KEY)) || {};
    for (const symbol of PAIRS) shortBars[symbol] = (Array.isArray(saved[symbol]) ? saved[symbol] : []).filter(b => Number.isFinite(b.time) && Number.isFinite(b.open) && Number.isFinite(b.high) && Number.isFinite(b.low) && Number.isFinite(b.close) && b.time > Date.now() - 2 * 60 * 60 * 1000).sort((a,b) => a.time - b.time).slice(-240);
  } catch { for (const symbol of PAIRS) shortBars[symbol] = []; }
  let chartRequest = 0, chartLastFetch = 0, quoteRequestRunning = false, streamConnected = false;
  let renderTimer = 0, plotTimer = 0, streamRetryTimer = 0, streamStarting = false, stream;
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
  function orderUnits() { return Number($('units').value); }
  function orderMargin(symbol,units,leverage) {
    const q = currentQuote(symbol), factor = quoteToUsd(symbol.slice(3),true);
    return q && factor != null ? units * q.ask * factor / leverage : null;
  }
  function showMessage(message,kind='') { $('trade-message').textContent = message; $('trade-message').className = `trade-message ${kind}`; }
  function acceptQuote(tick) {
    if (!tick || !PAIRS.includes(tick.symbol)) return false;
    const incoming = quoteTime(tick), previous = quotes[tick.symbol] || {};
    if (!Number.isFinite(incoming) || incoming < quoteTime(previous)) return false;
    quotes[tick.symbol] = {...previous,...tick,marketState:tick.marketState ?? previous.marketState ?? 'open',stale:tick.stale ?? false};
    if (quotes[tick.symbol].marketState === 'open' && quotes[tick.symbol].stale === false) recordShortBar(quotes[tick.symbol]);
    return Boolean(currentQuote(tick.symbol));
  }
  function recordShortBar(tick) {
    const time = quoteTime(tick), mid = Number(tick.mid || (Number(tick.bid) + Number(tick.ask)) / 2);
    if (!Number.isFinite(time) || Math.abs(Date.now() - time) > 45000 || !Number.isFinite(mid) || mid <= 0 || tick.marketState === 'closed') return;
    const bucket = Math.floor(time / 30000) * 30000, bars = shortBars[tick.symbol], last = bars[bars.length - 1];
    if (last && bucket < last.time) return;
    if (last && bucket === last.time) { last.high = Math.max(last.high,mid);last.low = Math.min(last.low,mid);last.close = mid; }
    else { bars.push({time:bucket,open:mid,high:mid,low:mid,close:mid}); if (bars.length > 240) bars.shift(); }
    if (!shortBarsSaveTimer) shortBarsSaveTimer = setTimeout(() => { shortBarsSaveTimer = 0;try { localStorage.setItem(SHORT_BARS_KEY,JSON.stringify(shortBars)); } catch {} },5000);
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
    $('realized').textContent = money(account.balance-START);
    $('realized').className = positiveClass(account.balance-START);
  }
  function renderTrade() {
    const q = currentQuote(selected), live = canTrade(selected);
    $('trade-pair').textContent = pairName(selected);
    $('trade-state').textContent = !q ? '等待报价' : live ? '可交易' : q.marketState === 'open' ? '报价或换算汇率过期' : '市场休市';
    $('bid').textContent = q ? rate(q.bid,selected) : '—';
    $('ask').textContent = q ? rate(q.ask,selected) : '—';
    const units = orderUnits(), valid = Number.isInteger(units) && units >= 1000 && units <= 1000000 && units % 1000 === 0;
    const margin = valid ? orderMargin(selected,units,account.leverage) : null, t = totals();
    $('estimated-margin').textContent = margin == null ? '—' : money(margin);
    $('buy-button').disabled = $('sell-button').disabled = !(live && valid && margin != null && t.complete && margin <= t.free);
  }
  function renderChartHeading() {
    const q = currentQuote(selected);
    $('chart-title').textContent = pairName(selected);
    $('pair-price').textContent = q ? rate(q.mid || (q.bid+q.ask)/2,selected) : '—';
    $('pair-change').textContent = q && isLive(q) && Number.isFinite(q.dayDiffPercent) ? `${q.dayDiffPercent >= 0 ? '+' : ''}${q.dayDiffPercent.toFixed(2)}% 今日` : '—';
    $('pair-change').className = q ? positiveClass(q.dayDiffPercent) : '';
  }
  function renderRecords() {
    $('positions-body').innerHTML = account.positions.length ? account.positions.map(p => {
      const q = currentQuote(p.symbol), pnl = markToMarket(p), exit = q ? p.side === 'long' ? q.bid : q.ask : null;
      return `<tr><td><b>${pairName(p.symbol)}</b></td><td class="${p.side === 'long' ? 'side-long' : 'side-short'}">${p.side === 'long' ? '买入' : '卖出'}</td><td>${p.units.toLocaleString()}</td><td>${p.leverage}×</td><td>${rate(p.entry,p.symbol)}</td><td>${exit == null ? '—' : rate(exit,p.symbol)}</td><td class="${pnl == null ? '' : positiveClass(pnl)}">${pnl == null ? '—' : money(pnl)}</td><td><button class="close-button" type="button" data-close="${p.id}" ${canTrade(p.symbol) ? '' : 'disabled'}>平仓</button></td></tr>`;
    }).join('') : '<tr class="empty-row"><td colspan="8">还没有持仓。选择货币对，试着开第一单。</td></tr>';
    $('history-body').innerHTML = account.history.length ? account.history.map(h => `<tr><td>${localTime(h.time)}</td><td>${pairName(h.symbol)}</td><td>${h.action}</td><td>${Number(h.units).toLocaleString()}</td><td>${rate(Number(h.price),h.symbol)}</td><td class="${h.pnl == null ? '' : positiveClass(h.pnl)}">${h.pnl == null ? '—' : money(h.pnl)}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="6">交易记录会显示在这里。</td></tr>';
  }
  function render() { renderStatus(); renderPairList(); renderAccount(); renderTrade(); renderChartHeading(); renderRecords(); }
  function scheduleRender() { if (!renderTimer) renderTimer = setTimeout(() => {renderTimer=0;render();},100); }
  function schedulePlot() { if (!plotTimer) plotTimer = setTimeout(() => {plotTimer=0;drawChart();},150); }
  function trade(side) {
    const q = currentQuote(selected), units = orderUnits();
    if (!canTrade(selected)) return showMessage('当前报价不可交易，请等待最新行情。','error');
    if (!Number.isInteger(units) || units < 1000 || units > 1000000 || units % 1000) return showMessage('请输入 1,000 至 1,000,000 之间的整千数量。','error');
    const margin = orderMargin(selected,units,account.leverage), t = totals();
    if (margin == null || !t.complete || margin > t.free) return showMessage('可用保证金不足或换算汇率不可用。','error');
    const entry = side === 'long' ? q.ask : q.bid;
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    account.positions.unshift({id,symbol:selected,side,units,entry,margin,leverage:account.leverage,time:new Date().toISOString()});
    account.history.unshift({time:new Date().toISOString(),symbol:selected,action:side === 'long' ? '买入开仓' : '卖出开仓',units,price:entry,pnl:null});
    account.history = account.history.slice(0,100);
    save();render();showMessage(`${pairName(selected)} 已${side === 'long' ? '买入' : '卖出'} ${units.toLocaleString()} 单位，杠杆 ${account.leverage}×。`,'success');
  }
  function closePosition(id) {
    const index = account.positions.findIndex(p => p.id === id);
    if (index < 0) return;
    const p = account.positions[index], q = currentQuote(p.symbol);
    if (!canTrade(p.symbol)) return showMessage('报价或换算汇率已过期，暂时无法平仓。','error');
    const pnl = markToMarket(p);
    if (pnl == null) return showMessage('暂时无法计算美元盈亏。','error');
    const price = p.side === 'long' ? q.bid : q.ask;
    account.balance += pnl;account.positions.splice(index,1);
    account.history.unshift({time:new Date().toISOString(),symbol:p.symbol,action:'平仓',units:p.units,price,pnl});
    account.history = account.history.slice(0,100);
    save();render();showMessage(`已平仓，${pnl >= 0 ? '盈利' : '亏损'} ${money(Math.abs(pnl))}。`,pnl >= 0 ? 'success' : 'error');
  }
  function chartConfig() {
    const interval = $('chart-interval').value, range = $('chart-range').value;
    return {interval,range,count:Math.min(500,Math.ceil(RANGES[range]/PERIODS[interval])+1)};
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
    chartBars = []; visibleCount = null; rightOffset = 0; chartHover = -1;
    refreshChart();
  }
  function chartTime(stamp,axis=false) {
    if(axis && $('chart-interval').value==='30s') return new Date(stamp).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    return new Date(stamp).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',...( $('chart-interval').value === '30s' ? {second:'2-digit'} : {})});
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
    $('chart-detail').textContent=`${$('chart-interval').selectedOptions[0].textContent}周期 · 近 ${$('chart-range').selectedOptions[0].textContent} · ${chartMode==='candles'?'K 线':'分时线'}${$('chart-interval').value==='30s'?' · 本机采集':''}${visibleCount || rightOffset?' · 自定义视图':''}`;
    drawHover();
  }
  async function refreshChart() {
    const symbol=selected,{interval,count}=chartConfig(),request=++chartRequest;
    chartLastFetch=Date.now();
    if (interval==='30s') {
      chartBars=shortBars[symbol].filter(b=>b.time >= Date.now()-RANGES[$('chart-range').value]*60000).slice(-count);
      if(chartBars.length) drawChart();
      else {$('chart-empty').style.display='grid';$('chart-empty').textContent='正在采集 30 秒 K 线，首次使用没有往时记录。';}
      return;
    }
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
    if($('chart-interval').value==='30s') { chartBars=shortBars[selected].filter(b=>b.time >= Date.now()-RANGES[$('chart-range').value]*60000);schedulePlot();return; }
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
      render();
    }catch{
      if(!streamConnected){$('feed-status').textContent='行情连接中断';$('feed-status').className='status status-stale';renderTrade();}
    }finally{quoteRequestRunning=false;}
  }
  async function startStream() {
    if(!window.signalR || streamConnected || streamStarting) return;
    streamStarting = true;
    clearTimeout(streamRetryTimer);
    stream=new signalR.HubConnectionBuilder().withUrl('https://biquote.io/hubs/tick',{skipNegotiation:true,transport:signalR.HttpTransportType.WebSockets}).withAutomaticReconnect([0,2000,5000,10000]).build();
    stream.on('ReceiveTick',tick=>{if(acceptQuote(tick)){updateCurrentBar(tick);scheduleRender();}});
    stream.onreconnecting(()=>{streamConnected=false;renderStatus();});
    stream.onreconnected(async()=>{try{await stream.invoke('Subscribe',PAIRS);streamConnected=true;refreshQuotes();renderStatus();}catch{streamConnected=false;renderStatus();}});
    stream.onclose(()=>{streamConnected=false;renderStatus();streamRetryTimer=setTimeout(startStream,15000);});
    try{await stream.start();await stream.invoke('Subscribe',PAIRS);streamConnected=true;renderStatus();}
    catch{streamConnected=false;renderStatus();streamRetryTimer=setTimeout(startStream,15000);}
    finally{streamStarting=false;}
  }
  $('pair-list').addEventListener('click',e=>{const b=e.target.closest('[data-symbol]');if(!b||!PAIRS.includes(b.dataset.symbol))return;selected=b.dataset.symbol;chartBars=[];visibleCount=null;rightOffset=0;chartHover=-1;render();refreshChart();});
  document.querySelector('.watch-filter').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;filter=b.dataset.filter;renderPairList();});
  document.querySelector('.segmented').addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(!b)return;chartMode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(item=>{item.classList.toggle('active',item===b);item.setAttribute('aria-pressed',item===b?'true':'false');});drawChart();});
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
  $('units').addEventListener('input',renderTrade);
  document.querySelectorAll('[data-units]').forEach(b=>b.addEventListener('click',()=>{$('units').value=b.dataset.units;renderTrade();}));
  $('buy-button').addEventListener('click',()=>trade('long'));
  $('sell-button').addEventListener('click',()=>trade('short'));
  $('positions-body').addEventListener('click',e=>{const b=e.target.closest('[data-close]');if(b)closePosition(b.dataset.close);});
  $('reset-button').addEventListener('click',()=>{if(!confirm('确定重置模拟账户？所有持仓和交易记录都会清空。'))return;account.balance=START;account.positions=[];account.history=[];save();render();showMessage('模拟账户已重置。','success');});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshQuotes();refreshChart();}});
  render();refreshQuotes();refreshChart();startStream();
  setInterval(()=>{if(!document.hidden&&!streamConnected)refreshQuotes();},3000);
  setInterval(()=>{if(!document.hidden&&streamConnected)refreshQuotes();},30000);
  setInterval(()=>{if(!document.hidden)refreshChart();},20000);
  setInterval(()=>{if(!document.hidden)render();},10000);
})();
