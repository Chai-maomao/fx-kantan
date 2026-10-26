import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('dist/app.js','utf8');
const code=source.slice(source.indexOf('  function addMargin('),source.indexOf('  function openRiskDialog'));
function run(amount,free,{closed=false,ready=true}={}) {
 const p={id:'p',symbol:'EURUSD',side:'long',units:20000,entry:1.1,margin:1000,leverage:20};
 const account={balance:100000,positions:[p],history:[]};let saved=false,previewed=false;
 const fields={'margin-add-amount':{value:String(amount)},'margin-add-message':{},'margin-add-dialog':{close(){}}};
 const context={account,marginPositionId:'p',accountReady:ready,recovering:false,syncBusy:false,syncDirty:false,$:id=>fields[id],processTriggers(){if(closed)account.positions=[];},totals:()=>({free,complete:true}),validMargin:n=>Number.isFinite(n)&&n>=1&&n<=1e9&&Math.abs(n*100-Math.round(n*100))<1e-6,canTrade:()=>true,currentQuote:()=>({bid:1.1,ask:1.1001}),marginPreview:()=>previewed=true,save:()=>saved=true,render(){},showMessage(){},pairName:String,money:String};
 vm.runInNewContext(code+';addMargin({preventDefault(){}})',context);
 return {account,p,saved,previewed};
}
const a=run(250.5,10000);assert.equal(a.p.margin,1250.5);assert.equal(a.p.initialMargin,1000);assert.equal(a.account.balance,100000);assert.equal(a.p.units,20000);assert.equal(a.p.entry,1.1);assert.equal(a.account.history[0].marginAdded,250.5);assert(a.saved);
for(const amount of [0,-1,0.5,1.001,10001,Infinity]){const b=run(amount,10000);assert.equal(b.p.margin,1000);assert.equal(b.saved,false);}
assert.equal(run(100,10000,{closed:true}).saved,false);assert.equal(run(100,10000,{ready:false}).saved,false);
console.log('PASS: margin transfer, preserved exposure/balance, decimal validation, insufficient funds, recovery and forced-close guards');

const totalsCode=source.slice(source.indexOf('  function totals()'),source.indexOf('  function liquidationPrice'));
for(const floating of [-500,0,5000]) {
 const result=vm.runInNewContext(totalsCode+';totals()',{account:{balance:10000,positions:[{margin:1000}]},markToMarket:()=>floating});
 assert.equal(result.free,9000);assert.equal(result.equity,10000+floating);
}
console.log('PASS: floating P/L changes equity but cannot fund additional isolated margin');
