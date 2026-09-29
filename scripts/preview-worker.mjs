import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const database = new DatabaseSync(':memory:');
for (const filename of readdirSync(resolve(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort()) {
  database.exec(readFileSync(resolve(root, 'drizzle', filename), 'utf8').replaceAll('--> statement-breakpoint',''));
}
const worker = (await import('../dist/server/index.js')).default;
function prepare(sql) {
  const statement = database.prepare(sql);
  const methods = values => ({
    bind: (...next) => methods(next),
    all: async () => ({ results:statement.all(...values) }),
    first: async () => statement.get(...values) || null,
    run: async () => statement.run(...values)
  });
  return methods([]);
}
const env = { DB:{ prepare } };
createServer(async (incoming,outgoing) => {
  try {
    const chunks=[];
    for await (const chunk of incoming) chunks.push(chunk);
    const body=Buffer.concat(chunks);
    const headers=new Headers();for (const [name,value] of Object.entries(incoming.headers)) if(value)headers.set(name,Array.isArray(value)?value.join(', '):value);
    const request=new Request(`http://127.0.0.1:8765${incoming.url}`,{method:incoming.method,headers,body:body.length?body:undefined});
    const response=await worker.fetch(request,env);
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch(error) {console.error(error);outgoing.writeHead(500);outgoing.end('Local preview error');}
}).listen(8765,'127.0.0.1',()=>console.log('Local preview: http://127.0.0.1:8765/'));
