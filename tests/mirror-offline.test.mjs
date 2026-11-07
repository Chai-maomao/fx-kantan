import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync('dist/app.js','utf8');
const section = (from,to) => source.slice(source.indexOf(from),source.indexOf(to));
const prelude = section("  const PAIRS =",'  let selected');
const recovery = section('  async function recoverAccount(', '  function mirrorHeaders');
const saving = section('  function save()', '  function currentQuote');
const trading = section('  function trade(', '  function processTriggers');

function session(storage) {
  const fields = new Map();
  const context = vm.createContext({
    location:{hostname:'chai-maomao.github.io'},
    localStorage:{getItem:key=>storage.get(key) ?? null,setItem:(key,value)=>storage.set(key,value)},
    document:{getElementById:id=>{if(!fields.has(id)) fields.set(id,{});return fields.get(id);}},
    crypto, Headers, AbortSignal,
    selected:'EURUSD', accountReady:false,recovering:false,syncBusy:false,syncDirty:false,serverRevision:0,
    quotes:{},
    accountRequest:async()=>{throw Error('The mirror must not request a remote trading account');},
    FXRecovery:{recover:async()=>({notices:[]})},
    recoveryStatus(message){context.status=message;},render(){},showMessage(){},
    currentQuote:()=>({bid:1.1,ask:1.1001}),marginBudget:()=>1000,validMargin:()=>true,canTrade:()=>true,
    orderFor:()=>({units:10000,entry:1.1001,margin:1000}),totals:()=>({free:99000,complete:true}),
    liquidationReached:()=>false,riskValue:()=>null,riskError:()=>null,resetRiskReference(){},
    markToMarket:()=>12
  });
  vm.runInContext(prelude+recovery+saving+trading,context);
  return context;
}
const storage = new Map([
  ['fx-kantan-paper-v1',JSON.stringify({balance:93456,startingBalance:100000,leverage:100,positions:[],history:[]})],
  ['fx-kantan-board-id-v1','12345678-1234-4234-8234-123456789abc']
]);
let page = session(storage);
await vm.runInContext('recoverAccount(true)',page);
assert.equal(page.accountReady,true);
assert.equal(vm.runInContext('account.balance',page),93456,'retain the existing browser balance');
vm.runInContext("trade('long')",page);
assert.equal(JSON.parse(storage.get('fx-kantan-paper-v1')).positions.length,1);
assert.equal(page.syncDirty,false,'local trading never waits for a server acknowledgement');
page = session(storage);
await vm.runInContext('recoverAccount(true)',page);
assert.equal(vm.runInContext('account.positions.length',page),1,'reload restores the saved position');
vm.runInContext('closePosition(account.positions[0].id)',page);
const closed = JSON.parse(storage.get('fx-kantan-paper-v1'));
assert.equal(closed.positions.length,0);
assert.equal(closed.balance,93468);
assert.equal(closed.history[0].action,'平仓');
assert.equal(storage.get('fx-kantan-board-id-v1'),'12345678-1234-4234-8234-123456789abc');
page.localStorage.setItem=()=>{throw Error('quota exceeded');};
vm.runInContext('save()',page);
assert.equal(page.accountReady,false,'stop further trades when local storage cannot persist');
assert(page.status.includes('本机存档失败'));

const boardCode=section('  async function leaderboardFetch(', '  function save()');
const calls=[];
let failAll=false;
const board=vm.createContext({
  GITHUB_MIRROR:true,LEADERBOARD_API:'',
  MIRROR_BOARD_ORIGINS:['https://fx-kantan.top','https://gateway.test'],leaderboardOrigin:'https://fx-kantan.top',
  AbortSignal,mirrorHeaders:()=>({'X-FXK-Visitor-ID':'same-id'}),
  fetch:async(url,options)=>{
    calls.push({url,options});
    if(failAll||url.startsWith('https://fx-kantan.top'))throw new TypeError('network unavailable');
    return new Response('{"entries":[],"mine":null}',{headers:{'content-type':'application/json'}});
  }
});
vm.runInContext(boardCode,board);
assert.equal((await vm.runInContext('leaderboardFetch()',board)).status,200);
assert.equal(calls.length,2);
assert.equal(board.leaderboardOrigin,'https://gateway.test');
assert(calls.every(call=>call.options.headers['X-FXK-Visitor-ID']==='same-id'));
failAll=true;calls.length=0;
await assert.rejects(vm.runInContext("leaderboardFetch('',{method:'POST',body:'snapshot'})",board));
assert.equal(calls.length,1,'never replay an uncertain write against another endpoint');
calls.length=0;
await assert.rejects(vm.runInContext('leaderboardFetch()',board));
assert.equal(calls.length,2);
console.log('PASS: mirror trades and restores local positions with blocked account APIs, retains balances/UUIDs, guards failed storage and safely retries leaderboard reads');
