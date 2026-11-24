import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

import { api } from './supabase-api.mjs';

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
]);
createServer(async (request, response) => {
  if (request.url.startsWith('/api/')) return api(request,response);
  const asset = assets.get(request.url);
  if (request.method !== 'GET' || !asset) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(new URL(asset[0], import.meta.url));
    response.writeHead(200, {
      'Content-Type': asset[1] + '; charset=utf-8',
      'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; form-action 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    }).end(body);
  } catch {
    response.writeHead(500).end();
  }
}).listen(4173, '127.0.0.1', () => console.log('Gestão Pessoal: http://127.0.0.1:4173'));
