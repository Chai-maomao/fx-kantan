const MIRROR_ORIGIN = 'https://chai-maomao.github.io';
const jsonError = (error, status = 503) => new Response(JSON.stringify({error}), {
  status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Static assets normally bypass this handler and the dynamic request quota.
    // One frontend is served regardless of cookies or account-origin availability.
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const origin=request.headers.get('origin'), mirror=origin===MIRROR_ORIGIN;
    if (origin && origin!==url.origin && !mirror) return jsonError('跨站请求被拒绝。',403);
    const cors=response=>{
      if (!mirror) return response;
      const headers=new Headers(response.headers);
      headers.set('access-control-allow-origin',MIRROR_ORIGIN);
      headers.set('vary','Origin');
      headers.delete('set-cookie');
      return new Response(response.body,{status:response.status,headers});
    };
    if (mirror && request.method==='OPTIONS') return new Response(null,{status:204,headers:{
      'access-control-allow-origin':MIRROR_ORIGIN,'access-control-allow-methods':'GET, POST, DELETE, OPTIONS',
      'access-control-allow-headers':'Content-Type, X-FXK-Visitor-ID','access-control-max-age':'600','vary':'Origin'
    }});
    if (mirror && !request.headers.get('x-fxk-visitor-id')) return cors(jsonError('缺少浏览器身份。',400));
    const main=new URL(env.MAIN_ORIGIN);
    if (main.origin===url.origin) return cors(jsonError('账户服务配置错误。'));
    const upstream=new URL(url.pathname+url.search,main.origin);
    const headers=new Headers(request.headers);
    headers.delete('host');
    // Preserve existing host-only cookies / mirror UUIDs, and use one ledger.
    if (headers.has('origin')) headers.set('origin',main.origin);
    if (headers.has('x-fxk-visitor-id')) headers.set('origin',MIRROR_ORIGIN);
    try {
      const result=await fetch(new Request(new Request(upstream,request),{
        headers,
        redirect:'manual',signal:AbortSignal.timeout(15000)
      }));
      if (!(result.headers.get('content-type')||'').includes('application/json'))
        return cors(jsonError('账户服务暂不可用；本地备份已保留，请稍后重试。'));
      const outgoing=new Headers(result.headers);
      outgoing.set('cache-control','no-store');
      return cors(new Response(result.body,{status:result.status,headers:outgoing}));
    } catch {
      return cors(jsonError('账户服务暂不可用；本地备份已保留，请稍后重试。'));
    }
  }
};
