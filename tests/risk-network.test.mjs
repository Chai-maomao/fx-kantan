import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const app=readFileSync('dist/app.js','utf8');
const section=(a,b)=>app.slice(app.indexOf(a),app.indexOf(b));
const code=section('  function sameAccountSnapshot','  function mirrorHeaders')+
  section('  function save()','  function currentQuote')+
  section('  function closePosition','  function setLeaderboardStatus');
function session(storage=new Map(),restored=null) {
  const account=restored||{balance:100000,leverage:20,positions:[],history:[]};
  let remote={revision:4,account:JSON.parse(JSON.stringify(account))};
  const sent=[],timers=[];
  const ctx=vm.createContext({
    account,KEY:'fx-kantan-paper-v1',SERVER_ACCOUNTS:true,GITHUB_MIRROR:false,
    accountReady:true,riskReady:true,syncConflict:false,recovering:false,
    syncBusy:false,syncDirty:true,syncTimer:0,checkpointAt:Date.now(),pendingUpload:null,serverRevision:4,
    quotes:{},AbortSignal,API_ORIGIN:'',mirrorHeaders:h=>h,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    $:()=>({}),render(){},showMessage(){},recoveryStatus:t=>{ctx.status=t;},
    currentQuote:()=>({bid:159.886,ask:159.896}),canTrade:()=>true,
    markToMarket:p=>-(159.896-p.entry)*p.units/159.896,
    liquidationReached:()=>false,liquidationPrice:()=>160.667,money:String,
    FXRecovery:{recover:async()=>({notices:[]})},
    setTimeout:(f,ms)=>{timers.push({f,ms});return timers.length;},clearTimeout(){},
    fetch:async(url,options)=>{
      if(ctx.offline)throw new TypeError('offline');
      if(options.method==='POST') {
        const snapshot=JSON.parse(options.body);sent.push(options.body);
        if(snapshot.revision===remote.revision)remote={revision:remote.revision+1,account:snapshot.account};
        else if(!(snapshot.revision+1===remote.revision&&JSON.stringify(snapshot.account)===JSON.stringify(remote.account)))return new Response('{"error":"conflict"}',{status:409});
        if(ctx.loseAck){ctx.loseAck=false;ctx.offline=true;throw new TypeError('reply lost');}
      }
      return new Response(JSON.stringify(remote),{headers:{'content-type':'application/json'}});
    }
  });
  vm.runInContext(code,ctx);
  ctx.request=()=>vm.runInContext('syncAccount()',ctx);
  ctx.tick=()=>vm.runInContext('processTriggers()',ctx);
  ctx.remote=()=>remote;ctx.sent=sent;ctx.timers=timers;ctx.storage=storage;
  return ctx;
}
const position=(id,side='short')=>({id,symbol:'USDJPY',side,entry:157.427,units:6000133,margin:120000,stopLoss:159,takeProfit:156.7,checkedAt:Date.now(),time:new Date().toISOString()});

// Reproduce the screenshot: upload failed, ask crossed a short stop.
let page=session();page.account.positions=[position('short')];page.offline=true;
await page.request();assert.equal(page.accountReady,false);assert.equal(page.riskReady,true);
page.tick();assert.equal(page.account.positions.length,0);
assert.equal(page.account.history[0].action,'止损平仓');
const balance=page.account.balance;page.tick();assert.equal(page.account.balance,balance);
assert.equal(JSON.parse(page.storage.get('fx-kantan-paper-v1')).positions.length,0);
assert.equal(page.storage.get('fxk-server-pending'),'true');
page.offline=false;await page.request();await page.request();
assert.equal(page.remote().account.positions.length,0);assert.equal(page.remote().account.history.length,1);
assert.equal(page.remote().account.balance,balance);assert.equal(page.syncDirty,false);

// Server committed the OLD position snapshot, but its acknowledgement was lost.
page=session();page.account.positions=[position('ack-lost')];page.loseAck=true;
await page.request();const journal=page.pendingUpload;page.tick();
assert.equal(page.account.history.length,1);page.offline=false;
await page.request();assert.equal(page.sent[0],page.sent[1],'replay the exact uncertain snapshot');
assert.equal(page.sent[1],journal);await page.request();
assert.equal(page.remote().account.positions.length,0);assert.equal(page.remote().account.history.length,1);

// Reload while disconnected: replay old upload before saving newer risk exits.
const storage=page.storage;
page=session(storage);page.account.positions=[position('reload')];page.loseAck=true;
await page.request();page.tick();const local=JSON.parse(storage.get('fx-kantan-paper-v1'));
const oldRemote=page.remote(),sent=[];
const reload=session(storage,local);reload.accountReady=false;reload.riskReady=false;
reload.fetch=async(url,options)=>{
  if(options.method==='POST') {
    sent.push(options.body);const data=JSON.parse(options.body);
    assert.equal(data.revision+1,oldRemote.revision);
    assert.deepEqual(data.account,oldRemote.account);
  }
  return new Response(JSON.stringify(oldRemote));
};
await vm.runInContext('recoverAccount(true)',reload);
assert.equal(reload.account.positions.length,0,'never overwrite newer local stop settlement');
assert.equal(reload.account.history.length,1);assert.equal(sent.length,1);

// A previously confirmed local account keeps risk exits active on startup failure.
storage.set('fxk-server-revision','4');storage.set('fx-kantan-paper-v1',JSON.stringify(local));
page=session(storage,{...local,positions:[position('startup')],history:[]});
page.offline=true;page.riskReady=false;page.accountReady=false;
await vm.runInContext('recoverAccount(true)',page);
assert.equal(page.account.positions.length,0);assert.equal(page.account.history[0].action,'止损平仓');
assert.equal(page.accountReady,false,'new orders stay blocked');

// A long-running upload must not prevent a tick from closing an overdue stop.
page=session();page.account.positions=[{...position('slow'),checkedAt:Date.now()-60000}];
page.syncBusy=true;page.tick();
assert.equal(page.account.positions.length,0);
assert.equal(page.account.history[0].action,'止损平仓');

// Checkpoints must not continually postpone the outstanding retry timer.
page=session();page.offline=true;await page.request();const timer=page.syncTimer;
vm.runInContext('save();save();save()',page);assert.equal(page.syncTimer,timer);

// A genuine account revision conflict is never silently overwritten.
page=session();page.fetch=async()=>new Response('{"error":"conflict"}',{status:409});
await page.request();assert.equal(page.syncConflict,true);assert.equal(page.riskReady,false);
const attempts=page.timers.length;await page.request();assert.equal(page.timers.length,attempts);

// Long stop, both take-profit directions and liquidation use the same offline guard.
for(const [side,sl,tp,liq,reason] of [
  ['long',160,null,false,'止损平仓'],
  ['short',null,160,false,'止盈平仓'],
  ['long',null,159,false,'止盈平仓'],
  ['short',159,null,true,'强制平仓']
]) {
  page=session();page.account.positions=[{...position('risk',side),stopLoss:sl,takeProfit:tp}];
  page.offline=true;await page.request();page.liquidationReached=()=>liq;page.tick();
  assert.equal(page.account.history[0].action,reason);
}
console.log('PASS: stop exits survive account outage/startup failure, long/short TP/SL and liquidation, exact uncertain upload replay, reload preserves newer exits, no duplicate settlement');
