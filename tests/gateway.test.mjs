import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import gateway from '../cloudflare/gateway.mjs';
const original=globalThis.fetch;
let assetCalls=0,upstreamCalls=0,sent;
const env={MAIN_ORIGIN:'https://main.test',ASSETS:{fetch:async()=>{assetCalls++;return new Response('<html>Cloudflare frontend</html>');}}};
const call=(path,options={})=>gateway.fetch(new Request('https://entry.test'+path,options),env);
try {
  globalThis.fetch=async()=>{throw Error('origin offline');};
  for(const path of ['/','/?__served=1','/app.js']) {
    const result=await call(path,{headers:{cookie:'fxk_route=main'}});
    assert.equal(result.status,200);
    assert((await result.text()).includes('Cloudflare frontend'));
    assert.equal(result.headers.get('set-cookie'),null);
  }
  assert.equal(assetCalls,3,'frontend is independent of the account origin');
  const config=JSON.parse(readFileSync('cloudflare/wrangler.jsonc','utf8'));
  assert.deepEqual(config.assets.run_worker_first,['/api/*'],'static requests must bypass the dynamic quota');
  globalThis.fetch=async request=>{
    sent=request;upstreamCalls++;
    return new Response('{"revision":2}',{headers:{'content-type':'application/json','set-cookie':'fxk_board_browser=existing; Path=/; HttpOnly'}});
  };
  for(const mode of ['main','cloud']) {
    const result=await call('/api/account',{headers:{cookie:'fxk_route='+mode+'; fxk_board_browser=existing',origin:'https://entry.test'}});
    assert.equal(result.status,200);assert.equal(await result.text(),'{"revision":2}');
    assert(sent.headers.get('cookie').includes('fxk_board_browser=existing'));
    assert.equal(sent.headers.get('origin'),'https://main.test');
    assert.equal(new URL(sent.url).origin,'https://main.test');
    assert(result.headers.get('set-cookie').includes('fxk_board_browser=existing'));
  }
  await call('/api/account',{method:'POST',headers:{origin:'https://entry.test','content-type':'application/json'},body:'{"revision":1}'});
  assert.equal(sent.method,'POST');assert.equal(await sent.text(),'{"revision":1}');
  const mh={origin:'https://chai-maomao.github.io','x-fxk-visitor-id':'12345678-1234-4234-8234-123456789abc'};
  const cross=await call('/api/account',{headers:mh});
  assert.equal(cross.status,200);assert.equal(cross.headers.get('access-control-allow-origin'),mh.origin);
  assert.equal(cross.headers.get('set-cookie'),null);assert.equal(sent.headers.get('origin'),mh.origin);
  const before=upstreamCalls;
  assert.equal((await call('/api/account',{method:'OPTIONS',headers:{origin:mh.origin}})).status,204);
  assert.equal((await call('/api/account',{headers:{origin:'https://evil.test'}})).status,403);
  assert.equal((await call('/api/account',{headers:{origin:mh.origin}})).status,400);
  assert.equal(upstreamCalls,before);
  globalThis.fetch=async()=>new Response('<!DOCTYPE html>blocked',{status:403});
  const blocked=await call('/api/account',{headers:mh});
  assert.equal(blocked.status,503);assert((await blocked.json()).error.includes('本地备份'));
  assert.equal(blocked.headers.get('access-control-allow-origin'),mh.origin);
  globalThis.fetch=async()=>{throw Error('timeout');};
  assert.equal((await call('/api/account')).status,503);
  assert.equal((await gateway.fetch(new Request('https://entry.test/api/account'),{...env,MAIN_ORIGIN:'https://entry.test'})).status,503);
} finally {globalThis.fetch=original;}
console.log('PASS: one CF frontend, static quota bypass, unchanged cookie/UUID, API forwarding, CORS and offline JSON errors');
