import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync('dist/app.js','utf8'),periods={'1m':1,'5m':5,'15m':15,'1h':60,'4h':240,'1d':1440},ranges={'1h':60,'2h':120,'8h':480,'1d':1440,'1w':10080,'1mo':43200,'3mo':129600};
const controls={'chart-interval':{value:'1m',get selectedOptions(){return [{textContent:this.value}]}},'chart-range':{value:'1w',get selectedOptions(){return [{textContent:this.value}]}},'chart-interval-label':{textContent:'5 分'},'chart-range-label':{textContent:'1 天'}};
const ctx={PERIODS:periods,RANGES:ranges,$:id=>controls[id],document:{querySelectorAll:()=>[]},refreshChart(){}};
const selection=source.slice(source.indexOf('  function syncChartPickers'),source.indexOf('  function chartTime'));
vm.runInNewContext(selection+";adjustChartSelection('range');",ctx);assert.equal(controls['chart-interval'].value,'1h');assert.equal(controls['chart-interval-label'].textContent,'1h');assert.equal(controls['chart-range-label'].textContent,'1w');
const now=Date.parse('2026-10-26T03:00:00Z');class Clock extends Date{static now(){return now;}}
let requested,drawn=false;controls['chart-interval'].value='5m';controls['chart-range'].value='1h';
for(const id of ['chart-empty','chart-candles','chart-line','chart-fill','chart-last','chart-axis','chart-hover','chart-tooltip'])controls[id]={style:{},innerHTML:'old',setAttribute(){}};
const chart=source.slice(source.indexOf('  async function refreshChart'),source.indexOf('  function updateCurrentBar'));
const test={...ctx,Date:Clock,encodeURIComponent,AbortSignal,selected:'EURUSD',chartBars:[],chartRequest:0,chartLastFetch:0,chartConfig:()=>({interval:'5m',range:'1h',count:13}),syncChartPickers(){},drawChart(){drawn=true;},fetch:async url=>{requested=new URL(url);return {ok:true,json:async()=>({symbol:'EURUSD',interval:'5m',bars:[{openTime:new Date(now-2*3600000).toISOString(),open:1,high:1.1,low:.9,close:1},{openTime:new Date(now-300000).toISOString(),open:1,high:1.1,low:.9,close:1}]})};}};
await vm.runInNewContext(chart+';refreshChart()',test);assert.equal(requested.searchParams.get('from'),new Date(now-3600000).toISOString());assert.equal(requested.searchParams.get('interval'),'5m');assert.equal(test.chartBars.length,1);assert(drawn);
assert(source.includes("render();adjustChartSelection('range');"));
console.log('PASS: restored controls normalize on startup; request period and true time window match chart; out-of-window bars excluded');
