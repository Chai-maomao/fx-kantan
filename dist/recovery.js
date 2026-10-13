/* Shared historical replay for the main server and the static mirror. */
const FXRecovery = (() => {
  const MINUTE=60000;
  const PERIODS=[['1d',86400000],['1h',3600000],['5m',300000],['1m',MINUTE]];
  const conversion={JPY:'USDJPY',CHF:'USDCHF',CAD:'USDCAD',EUR:'EURUSD',GBP:'GBPUSD',AUD:'AUDUSD',NZD:'NZDUSD'};
  function factor(p,price,fx) {
    const currency=p.symbol.slice(3);
    if(currency==='USD')return 1;
    if(p.symbol.startsWith('USD'))return 1/price;
    return currency==='JPY'||currency==='CHF'||currency==='CAD'?1/fx:fx;
  }
  function threshold(p,fx) {
    const sign=p.side==='long'?1:-1,loss=p.margin/p.units;
    if(p.symbol.startsWith('USD'))return (p.entry-loss*Math.max(0,p.spread||0)/2)/(1+sign*loss);
    return p.entry-sign*p.margin/(p.units*factor(p,p.entry,fx));
  }
  function classify(p,bar,fx) {
    const sign=p.side==='long'?1:-1,half=Math.max(0,p.spread||0)/2;
    const open=bar.open-sign*half,adverse=(sign===1?bar.low:bar.high)-sign*half,favorable=(sign===1?bar.high:bar.low)-sign*half;
    const liq=threshold(p,fx);
    const levels=[{action:'强制平仓',price:liq,adverse:true}];
    if(p.stopLoss>0)levels.push({action:'止损平仓',price:p.stopLoss,adverse:true});
    if(p.takeProfit>0)levels.push({action:'止盈平仓',price:p.takeProfit,adverse:false});
    const crossed=(price,level)=>level.adverse?sign*(price-level.price)<=0:sign*(price-level.price)>=0;
    // At an opening gap we know the opening price precedes the extrema.
    const opening=levels.filter(l=>l.price>0&&crossed(open,l));
    if(opening.length)return {...opening.sort((a,b)=>a.action==='强制平仓'?-1:b.action==='强制平仓'?1:0)[0],price:open,gap:true};
    const hits=levels.filter(l=>l.price>0&&crossed(l.adverse?adverse:favorable,l));
    if(!hits.length)return null;
    // OHLC cannot reveal which of TP and an adverse level happened first.
    // Simulation chooses the adverse exit in an ambiguous minute and labels it.
    const adverseHits=hits.filter(l=>l.adverse).sort((a,b)=>sign*(b.price-a.price));
    return {...(adverseHits[0]||hits[0]),ambiguous:adverseHits.length>0&&hits.some(l=>!l.adverse)};
  }
  function createFeed(fetcher=fetch) {
    const cache=new Map();let requests=0;
    async function bars(symbol,interval,from,to) {
      const key=[symbol,interval,from,to].join(':');
      if(!cache.has(key))cache.set(key,(async()=>{
        if(++requests>40)throw Error('历史回查请求上限');
        const params=new URLSearchParams({interval,limit:'1000',from:new Date(from).toISOString(),to:new Date(to).toISOString()});
        const response=await fetcher(`https://biquote.io/api/${symbol}/ohlc?${params}`,{signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw Error('历史行情暂不可用');
        const data=await response.json();
        return (data.bars||[]).map(b=>({...b,time:Date.parse(b.openTime)})).filter(b=>b.time>=from&&b.time<to&&[b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0)&&b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close)).sort((a,b)=>a.time-b.time);
      })());
      return cache.get(key);
    }
    async function ticks(symbol) {
      const key='ticks:'+symbol;
      if(!cache.has(key))cache.set(key,(async()=>{
        if(++requests>40)throw Error('历史回查请求上限');
        const response=await fetcher(`https://biquote.io/api/${symbol}/history?count=1000`,{signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw Error('逐笔历史不可用');
        const data=await response.json();
        return (Array.isArray(data)?data:data.ticks||data.items||[]).map(t=>({...t,time:Date.parse(t.timestamp||t.lastQuoteAt)})).filter(t=>Number.isFinite(t.time)&&Number(t.bid)>0&&Number(t.ask)>=Number(t.bid)).sort((a,b)=>a.time-b.time);
      })());
      return cache.get(key);
    }
    return {bars,ticks};
  }
  async function recover(account,{now=Date.now(),feed=createFeed(),latest={}}={}) {
    const notices=[];let changed=false;
    for(const p of [...account.positions]) {
      const start=Math.max(Date.parse(p.time),Number(p.checkedAt)||Date.parse(p.time));
      if(!Number.isFinite(start)||now-start<15000)continue;
      const end=now;
      const currency=p.symbol.slice(3),fxSymbol=conversion[currency];
      let coverage=true,hit=null;
      async function scan(index,from,to) {
        const [interval,size]=PERIODS[index];
        const floor=Math.floor(from/size)*size;
        const candles=await feed.bars(p.symbol,interval,floor,to);
        if(!candles.length){coverage=false;return null;}
        // Historical retention may omit the oldest part of the requested span.
        if(candles[0].time>floor+size)coverage=false;
        const fxBars=currency==='USD'||p.symbol.startsWith('USD')?[]:await feed.bars(fxSymbol,interval,floor,to);
        for(const bar of candles) {
          if(bar.time+size<=from)continue;
          if(bar.time<from || bar.time+size>to) {
            if(index<PERIODS.length-1){const found=await scan(index+1,Math.max(from,bar.time),Math.min(to,bar.time+size));if(found)return found;continue;}
            // A partial opening minute is ambiguous: highs/lows may predate entry.
            // It is used only as an estimated result, never claimed as tick accuracy.
          }
          const fxBar=fxBars.find(b=>b.time===bar.time);
          const fx=currency==='USD'||p.symbol.startsWith('USD')?1:index===PERIODS.length-1?fxBar?.close:['JPY','CHF','CAD'].includes(currency)?fxBar?.low:fxBar?.high;
          if(!(fx>0)){coverage=false;continue;}
          let sample=bar;
          if(index===PERIODS.length-1&&bar.time<from) {
            const sign=p.side==='long'?1:-1;
            const known=Number(p.checkedPrice)>0?p.checkedPrice+sign*Math.max(0,p.spread||0)/2:p.entry;
            sample={...bar,open:known,low:Math.min(known,bar.close),high:Math.max(known,bar.close)};
          }
          const found=classify(p,sample,fx);
          if(found) {
            if(index<PERIODS.length-1){const refined=await scan(index+1,Math.max(from,bar.time),Math.min(to,bar.time+size));if(refined)return refined;continue;}
            if(feed.ticks)try {
              const ticks=await feed.ticks(p.symbol),begin=Math.max(from,bar.time),finish=Math.min(to,bar.time+size);
              if(ticks.length&&ticks[0].time<=begin&&ticks[ticks.length-1].time>=finish) {
                for(const tick of ticks.filter(t=>t.time>=begin&&t.time<finish)) {
                  const mid=(Number(tick.bid)+Number(tick.ask))/2;
                  const exact=classify({...p,spread:Number(tick.ask)-Number(tick.bid)},{open:mid,low:mid,high:mid,close:mid},fx);
                  if(exact)return {...exact,time:tick.time,fx,estimated:currency!=='USD'&&!p.symbol.startsWith('USD'),tick:true};
                }
                continue;
              }
            }catch{}
            return {...found,time:Math.max(from,bar.time),fx,estimated:true};
          }
        }
        return null;
      }
      try {if(end>start)hit=await scan(now-start>86400000?0:1,start,end);}catch{coverage=false;}
      const tick=latest[p.symbol],fxTick=latest[fxSymbol];
      const fxMid=fxTick&&(Number(fxTick.mid)||(Number(fxTick.bid)+Number(fxTick.ask))/2);
      const current=tick&&(p.side==='long'?Number(tick.bid):Number(tick.ask));
      if(!hit&&current>0&&Date.parse(tick.timestamp||tick.lastQuoteAt)>=start) {
        const fx=currency==='USD'||p.symbol.startsWith('USD')?1:fxMid;
        if(fx>0) {
          const price=threshold(p,fx),sign=p.side==='long'?1:-1;
          if(price>0&&sign*(current-price)<=0)hit={action:'强制平仓',price,time:now,fx,estimated:true,fallback:true};
        }
      }
      if(hit) {
        const sign=p.side==='long'?1:-1;
        const pnl=hit.fallback?-p.margin:sign*(hit.price-p.entry)*p.units*factor(p,hit.price+(p.side==='long'?1:-1)*Math.max(0,p.spread||0)/2,hit.fx);
        if(Number.isFinite(pnl)) {
          account.balance+=pnl;account.positions=account.positions.filter(item=>item.id!==p.id);
          account.history.unshift({time:new Date(hit.time).toISOString(),symbol:p.symbol,action:hit.action,units:p.units,price:hit.price,pnl,estimated:hit.estimated,recovery:hit.fallback?'数据不足，按强平价结算':hit.tick?'历史逐笔行情还原':hit.ambiguous?'分钟内顺序未知，按先止损估算':'历史分钟行情估算',positionId:p.id});
          notices.push(`${p.symbol} ${hit.action}：${hit.fallback?'按保证金结算':hit.tick?'已还原逐笔触发':'已回查至分钟级'}`);changed=true;
        }
      } else {
        if(!coverage)notices.push(`${p.symbol} 历史数据不足，未发现可确认的强平`);
        p.checkedAt=now;p.forceFallback=!coverage;changed=true;
      }
    }
    account.history=account.history.slice(0,100);
    return {account,notices,changed};
  }
  return {recover,createFeed,threshold,classify};
})();
