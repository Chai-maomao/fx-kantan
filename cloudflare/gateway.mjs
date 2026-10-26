const ROUTE_COOKIE='fxk_route';
const html=main=>`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FX kantan! · 正在选择线路</title><style>body{font:16px system-ui;background:#071124;color:#eaf5ff;display:grid;place-content:center;min-height:90vh;margin:24px}a{color:#69e9c2;margin-right:22px}p{max-width:500px;line-height:1.7}</style><h1>FX kantan!</h1><p id="status">正在检查主站连接…</p><p><a href="/__fxk/route?target=main">进入主站</a><a href="/__fxk/route?target=cloud">使用副站</a></p><p>两条线路共用同一交易账户。行情仍由 BiQuote 提供。</p><script>
(async()=>{let target='cloud';try{const r=await fetch(${JSON.stringify(main+'/api/health')},{mode:'cors',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(3500)});const data=await r.json();if(r.ok&&data.ok===true&&data.service==='fx-kantan-main')target='main';}catch{}document.getElementById('status').textContent=target==='main'?'主站连接正常，正在进入…':'主站连接不可用，正在进入副站…';location.replace('/__fxk/route?target='+target+location.hash);})();
</script></html>`;
const responseJSON=(value,status)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
export default {
 async fetch(request,env) {
  const url=new URL(request.url),main=new URL(env.MAIN_ORIGIN);
  if(main.origin===url.origin)return responseJSON({error:'分流目标配置错误。'},503);
  if(url.pathname==='/__fxk/route') {
   const mode=url.searchParams.get('target');if(!['main','cloud'].includes(mode))return new Response('Invalid route',{status:400});
   return new Response(null,{status:303,headers:{location:'/?__served=1','set-cookie':`${ROUTE_COOKIE}=${mode}; Path=/; Max-Age=1800; HttpOnly; Secure; SameSite=Lax`,'cache-control':'no-store'}});
  }
  if(url.pathname==='/'&&!url.searchParams.has('__served'))return new Response(html(main.origin),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
  const mode=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(ROUTE_COOKIE+'='))?.split('=')[1]||'cloud';
  if(mode==='cloud'&&!url.pathname.startsWith('/api/')) {
   const assetURL=new URL(request.url);assetURL.search='';
   const asset=await env.ASSETS.fetch(new Request(assetURL,{method:request.method}));
   if((url.pathname==='/'||url.pathname==='/index.html')&&request.method==='GET'&&asset.ok) {
    const source=await asset.text();
    const headers=new Headers(asset.headers);headers.delete('content-length');headers.delete('etag');headers.set('cache-control','no-store');
    return new Response(source,{status:asset.status,headers});
   }
   return asset;
  }
  const upstream=new URL(url.pathname+url.search,main.origin);
  const headers=new Headers(request.headers);headers.delete('host');
  // The public host remains unchanged, so its existing anonymous account cookie
  // keeps identifying the same main-site account through the reverse proxy.
  if(headers.has('origin'))headers.set('origin',main.origin);
  if(url.pathname.startsWith('/api/leaderboard')&&headers.has('x-fxk-visitor-id'))headers.set('origin','https://chai-maomao.github.io');
  try {
   const result=await fetch(new Request(upstream,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,redirect:'manual',signal:AbortSignal.timeout(15000)}));
   if(url.pathname.startsWith('/api/')) {
    if(!(result.headers.get('content-type')||'').includes('application/json'))return responseJSON({error:'主站服务暂不可用；账户备份已保留，请稍后重试。'},503);
   }
   let body=result.body;
   if((url.pathname==='/'||url.pathname==='/index.html')&&request.method==='GET') {
    const source=await result.text();
    if(!result.ok||!source.includes('id="chart-wrap"'))return new Response(null,{status:303,headers:{location:'/__fxk/route?target=cloud','cache-control':'no-store'}});
    body=source;
   }
   const outgoing=new Headers(result.headers);outgoing.set('cache-control','no-store');
   const redirect=outgoing.get('location');if(redirect?.startsWith(main.origin))outgoing.set('location',url.origin+redirect.slice(main.origin.length));
   return new Response(body,{status:result.status,headers:outgoing});
  }catch {
   if(url.pathname==='/'&&request.method==='GET')return new Response(null,{status:303,headers:{location:'/__fxk/route?target=cloud','cache-control':'no-store'}});
   return responseJSON({error:'主站连接暂不可用，请稍后重试。'},503);
  }
 }
};
