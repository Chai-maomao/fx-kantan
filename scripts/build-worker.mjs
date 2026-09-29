import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = {
  '/': ['dist/index.html', 'text/html; charset=utf-8'],
  '/index.html': ['dist/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['dist/app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['dist/style.css', 'text/css; charset=utf-8'],
  '/assets/signalr.min.js': ['dist/assets/signalr.min.js', 'text/javascript; charset=utf-8'],
  '/assets/signalr.LICENSE.txt': ['dist/assets/signalr.LICENSE.txt', 'text/plain; charset=utf-8'],
  '/assets/kurumi-hero.png': ['dist/assets/kurumi-hero.png', 'image/png']
};
const assets = Object.fromEntries(Object.entries(files).map(([url, [file, type]]) =>
  [url, { data: readFileSync(resolve(root, file)).toString('base64'), type }]));
const template = readFileSync(resolve(root, 'worker/index.js'), 'utf8');
if (!template.includes('/* __ASSETS__ */')) throw new Error('Missing asset slot');
mkdirSync(resolve(root, 'dist/server'), { recursive: true });
mkdirSync(resolve(root, 'dist/.openai'), { recursive: true });
writeFileSync(resolve(root, 'dist/server/index.js'), template.replace('/* __ASSETS__ */', `const ASSETS = ${JSON.stringify(assets)};`));
writeFileSync(resolve(root, 'dist/.openai/hosting.json'), readFileSync(resolve(root, '.openai/hosting.json')));
