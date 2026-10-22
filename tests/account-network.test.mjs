import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const app=readFileSync('dist/app.js','utf8');
const fn=app.slice(app.indexOf('  async function accountRequest('),app.indexOf('  async function syncAccount'));
async function request(responses,options={}) {
 let calls=0;const bodies=[];
 const ctx={AbortSignal,fetch:async(url,args)=>{bodies.push(args.body);return responses[Math.min(calls++,responses.length-1)]();}};
 try{return {data:await vm.runInNewContext(fn+`;accountRequest('',${JSON.stringify(options)})`,ctx),calls,bodies};}
 catch(error){return {error,calls,bodies};}
}
const failedSave=await request([()=>new Response('<!DOCTYPE html><title>gateway timeout</title>',{status:504}),()=>new Response(JSON.stringify({revision:2,replayed:true}))],{method:'POST',body:'same liquidation snapshot'});
assert.equal(failedSave.calls,2);assert.equal(failedSave.data.revision,2);assert.equal(failedSave.bodies[0],failedSave.bodies[1]);
const denied=await request([()=>new Response('<!DOCTYPE html><title>Access denied</title>',{status:403})]);assert.equal(denied.calls,1);assert(denied.error.message.includes('403'));assert(!denied.error.message.includes('Unexpected token'));
const repeated=await request([()=>new Response('<!DOCTYPE html>',{status:502})]);assert.equal(repeated.calls,2);assert(repeated.error.message.includes('502'));
const conflict=await request([()=>new Response(JSON.stringify({error:'另一页面更新了账户'}),{status:409})]);assert.equal(conflict.calls,1);assert(conflict.error.message.includes('另一页面'));
const malformed=await request([()=>new Response(JSON.stringify({account:null}))]);assert(malformed.error.message.includes('不完整'));
let clock=1000,fetchCalls=0;
class Clock extends Date {static now(){return clock;}}
const recovery=readFileSync('dist/recovery.js','utf8');
const FX=vm.runInNewContext(recovery+';FXRecovery',{Date:Clock,AbortSignal,URLSearchParams,fetch});
const feed=FX.createFeed(async()=>{fetchCalls++;clock+=10;return new Response(JSON.stringify({bars:[]}));},{budgetMs:5});
await feed.bars('EURUSD','1h',0,10000);
await assert.rejects(feed.bars('EURUSD','1m',0,10000),/时间预算/);assert.equal(fetchCalls,1);
// A failed post-liquidation upload must keep the balance/history in local backup.
const sync=app.slice(app.indexOf('  async function syncAccount'),app.indexOf('  async function recoverAccount'));
const writes=new Map(),account={balance:99000,positions:[],history:[{action:'强制平仓',pnl:-1000}]};let status='';
const context={GITHUB_MIRROR:false,accountReady:true,recovering:false,syncBusy:false,syncDirty:true,serverRevision:1,account,accountRequest:async()=>{throw Error('账户接口服务暂时不可用（HTTP 504）。');},recoveryStatus:text=>status=text,localStorage:{setItem:(k,v)=>writes.set(k,v)},render(){},setTimeout(){}};
vm.runInNewContext("localStorage.setItem('fx-kantan-paper-v1',JSON.stringify(account));",context);
await vm.runInNewContext(sync+';syncAccount()',context);
assert.equal(JSON.parse(writes.get('fx-kantan-paper-v1')).balance,99000);assert.equal(account.history.length,1);assert(context.syncDirty);assert(status.includes('本地备份保留'));
const compare=app.slice(app.indexOf('  function sameAccountSnapshot'),app.indexOf('  async function accountRequest'));
const equal=vm.runInNewContext(compare+';sameAccountSnapshot',{});
assert(equal({balance:99000,history:[{action:'强制平仓',pnl:-1000}]},{history:[{pnl:-1000,action:'强制平仓'}],balance:99000}));
assert(!equal({balance:99000},{balance:100000}));
console.log('PASS: HTML gateway response, denied response, bounded retry, unchanged save body, conflict handling, total recovery time budget, liquidation backup retained');
