import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const envFile = resolve(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
// Import after loading local credentials so the handler sees them.
const { default: notes } = await import('../api/notes.js');
const { default: session } = await import('../api/session.js');
let port = Number(process.env.PORT || 3000);

const server = createServer(async (incoming, outgoing) => {
  try {
    const host = incoming.headers.host;
    if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) {
      outgoing.writeHead(403).end('Use the local development address.');return;
    }
    const url = new URL(incoming.url, `http://${host}`);
    if (url.pathname === '/api/notes' || url.pathname === '/api/session') {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of incoming) {
        bytes += chunk.length;
        if (bytes > 3 * 1024 * 1024) {
          outgoing.writeHead(413).end('Request exceeds 3 MB.');
          return;
        }
        chunks.push(chunk);
      }
      const request = new Request(url, {
        method: incoming.method,
        headers: incoming.headers,
        ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Buffer.concat(chunks) } : {}),
      });
      const response = await (url.pathname === '/api/session' ? session : notes).fetch(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (!['GET', 'HEAD'].includes(incoming.method)) {
      outgoing.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed.');
      return;
    }
    if (url.pathname === '/calendar-core.js') {
      const source = await readFile(resolve(root, 'dist/calendar-core.js'));
      outgoing.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      outgoing.end(incoming.method === 'HEAD' ? undefined : source); return;
    }
    if (url.pathname !== '/' && url.pathname !== '/index.html') {
      outgoing.writeHead(404).end('Not found.');
      return;
    }
    const html = await readFile(resolve(root, 'dist/index.html'));
    outgoing.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    outgoing.end(incoming.method === 'HEAD' ? undefined : html);
  } catch (error) {
    console.error('Local request failed:', error.message);
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end('Local request failed. Check the terminal.');
  }
});
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && !process.env.PORT && port < 3010) {
    port++;
    server.listen(port, '127.0.0.1');
    return;
  }
  console.error(error.message); process.exitCode = 1;
});
server.on('listening', () => {
  console.log(`To-Do Manager: http://127.0.0.1:${port}`);
  console.log('Keep this terminal open. Press Ctrl+C to stop.');
  if (!process.env.R2_ACCESS_KEY_ID) {
    console.log('R2 is not configured yet. Fill in .env and restart to enable R2.');
  }
});

server.listen(port, '127.0.0.1');
