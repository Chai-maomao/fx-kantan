/* __ASSETS__ */

const COOKIE_NAME = 'fxk_board_browser';
const COOKIE_PATTERN = /^[0-9a-f-]{36}$/;
const PAIRS = new Set(['EURUSD','USDJPY','GBPUSD','AUDUSD','NZDUSD','USDCHF','USDCAD','EURJPY','GBPJPY','AUDJPY','NZDJPY','CADJPY','EURGBP','EURCHF']);

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff', ...extraHeaders }
  });
}

function browserIdentity(request) {
  const cookie = request.headers.get('cookie') || '';
  const token = cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (token && COOKIE_PATTERN.test(token)) return { id:token, setCookie:null };
  const id = crypto.randomUUID();
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return { id, setCookie:`${COOKIE_NAME}=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict${secure}` };
}

function headersFor(identity) { return identity.setCookie ? { 'set-cookie':identity.setCookie } : {}; }

function normalizeHistory(record) {
  if (!record || !PAIRS.has(record.symbol) || !['买入开仓','卖出开仓','平仓','止盈平仓','止损平仓'].includes(record.action)) return null;
  const units = Number(record.units), price = Number(record.price), time = Date.parse(record.time);
  const pnl = record.pnl == null ? null : Number(record.pnl);
  if (!Number.isInteger(units) || units < 1000 || units > 1000000 || !Number.isFinite(price) || price <= 0 || !Number.isFinite(time) || (pnl != null && (!Number.isFinite(pnl) || Math.abs(pnl) > 1e12))) return null;
  return { symbol:record.symbol, action:record.action, units, price, pnl, time:new Date(time).toISOString() };
}

async function publicId(browserId) {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(browserId));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}

async function publicEntry(row) {
  return { id:await publicId(row.browser_id), name:row.display_name, score:row.score, updatedAt:row.updated_at };
}

async function listEntries(db, identity) {
  const [list, mine] = await Promise.all([
    db.prepare('SELECT browser_id, display_name, score, updated_at FROM leaderboard_entries ORDER BY score DESC, updated_at ASC LIMIT 50').all(),
    db.prepare('SELECT browser_id, display_name, score, updated_at FROM leaderboard_entries WHERE browser_id = ?').bind(identity.id).first()
  ]);
  return json({ entries:await Promise.all((list.results || []).map(publicEntry)), mine:mine ? await publicEntry(mine) : null },200,headersFor(identity));
}

async function entryDetail(db, id, identity) {
  const list = await db.prepare('SELECT browser_id, display_name, snapshot, score, updated_at FROM leaderboard_entries ORDER BY score DESC, updated_at ASC LIMIT 50').all();
  for (const row of list.results || []) {
    if (await publicId(row.browser_id) !== id) continue;
    let history = [];
    try { const snapshot=JSON.parse(row.snapshot);history=Array.isArray(snapshot?.history) ? snapshot.history.slice(0,20).map(normalizeHistory).filter(Boolean) : []; } catch {}
    return json({ entry:{ ...await publicEntry(row), history } },200,headersFor(identity));
  }
  return json({ error:'这条排行已不在前 50 名，请刷新排行榜。' },404,headersFor(identity));
}

async function publishEntry(db, request, identity) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) return json({ error:'需要 JSON 数据。' },415,headersFor(identity));
  const body = await request.text();
  if (body.length > 16000) return json({ error:'提交内容过大。' },413,headersFor(identity));
  let data;
  try { data = JSON.parse(body); } catch { return json({ error:'提交内容无法读取。' },400,headersFor(identity)); }
  const name = String(data?.name || '').trim().replace(/\s+/g,' ');
  if (name.length < 2 || name.length > 24 || /[<>\u0000-\u001f]/.test(name)) return json({ error:'展示名需为 2 至 24 个字，且不能包含特殊控制字符。' },400,headersFor(identity));
  if (!Array.isArray(data.history) || data.history.length > 20) return json({ error:'交易记录无效或过多。' },400,headersFor(identity));
  const history = data.history.map(normalizeHistory);
  if (history.some(record => record == null)) return json({ error:'交易记录无效。' },400,headersFor(identity));
  const balance = Number(data.balance), floating = Number(data.floating);
  if (![balance,floating].every(v => Number.isFinite(v) && Math.abs(v) <= 1e12)) return json({ error:'模拟收益数据无效。' },400,headersFor(identity));
  const score = Math.round((balance + floating - 10000) * 100) / 100, now = Date.now();
  await db.prepare('INSERT INTO leaderboard_entries (browser_id, display_name, snapshot, score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(browser_id) DO UPDATE SET display_name = excluded.display_name, snapshot = excluded.snapshot, score = excluded.score, updated_at = excluded.updated_at').bind(identity.id,name,JSON.stringify({history}),score,now,now).run();
  return json({ entry:{ id:await publicId(identity.id), name, score, updatedAt:now } },200,headersFor(identity));
}

async function removeEntry(db, identity) {
  await db.prepare('DELETE FROM leaderboard_entries WHERE browser_id = ?').bind(identity.id).run();
  return json({ ok:true },200,headersFor(identity));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/leaderboard' || url.pathname.startsWith('/api/leaderboard/')) {
      if (!env.DB) return json({ error:'排行榜暂不可用，请稍后重试。' },503);
      const identity = browserIdentity(request);
      if (request.method !== 'GET' && request.headers.get('origin') && request.headers.get('origin') !== url.origin) return json({ error:'跨站请求被拒绝。' },403,headersFor(identity));
      try {
        if (request.method === 'GET' && url.pathname === '/api/leaderboard') return await listEntries(env.DB,identity);
        if (request.method === 'GET' && /^\/api\/leaderboard\/[0-9a-f]{64}$/.test(url.pathname)) return await entryDetail(env.DB,url.pathname.slice('/api/leaderboard/'.length),identity);
        if (request.method === 'POST' && url.pathname === '/api/leaderboard') return await publishEntry(env.DB,request,identity);
        if (request.method === 'DELETE' && url.pathname === '/api/leaderboard') return await removeEntry(env.DB,identity);
        return json({ error:'不支持此操作。' },405,headersFor(identity));
      } catch (error) {
        console.error('leaderboard request failed',error);
        return json({ error:'排行榜暂不可用，请稍后重试。' },503,headersFor(identity));
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed',{status:405});
    const asset = ASSETS[url.pathname];
    if (!asset) return new Response('Not found',{status:404});
    const bytes = Uint8Array.from(atob(asset.data),char => char.charCodeAt(0));
    return new Response(request.method === 'HEAD' ? null : bytes, {
      headers:{ 'content-type':asset.type, 'cache-control':url.pathname.startsWith('/assets/') ? 'public, max-age=86400' : 'no-cache', 'x-content-type-options':'nosniff' }
    });
  }
};
