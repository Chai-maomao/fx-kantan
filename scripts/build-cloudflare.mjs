import {copyFileSync,cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.cloudflare/assets');
mkdirSync(out,{recursive:true});
for(const file of ['index.html','app.js','recovery.js','style.css'])copyFileSync(resolve(root,'dist',file),resolve(out,file));
cpSync(resolve(root,'dist/assets'),resolve(out,'assets'),{recursive:true});
writeFileSync(resolve(out,'_headers'),'/*\n  Cache-Control: no-cache\n');
console.log('Cloudflare assets prepared');
