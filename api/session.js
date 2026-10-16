import { configured, validToken, createSession, cookieFor, sameOrigin } from '../lib/auth.js';

const reply = (message, status, extra = {}) => new Response(message, { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', ...extra } });
export function createSessionHandler({ env = process.env, now = Date.now } = {}) {
  return async function handle(request) {
    if (!['POST', 'DELETE'].includes(request.method)) return reply('Method not allowed.', 405, { Allow: 'POST, DELETE' });
    if (!sameOrigin(request)) return reply('A same-origin request is required.', 403);
    try { cookieFor(request, ''); } catch { return reply('Sessions require HTTPS outside loopback development.', 403); }
    if (request.method === 'DELETE') return reply('Logged out.', 200, { 'Set-Cookie': cookieFor(request, '', true) });
    if (!configured(env)) return reply('Configure NOTES_TOKEN in your environment (at least 32 characters).', 503);
    if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return reply('Expected JSON.', 415);
    if (Number(request.headers.get('Content-Length')) > 4096) return reply('Login request too large.', 413);
    let data;
    try {
      const body = await request.text();
      if (Buffer.byteLength(body) > 4096) return reply('Login request too large.', 413);
      data = JSON.parse(body);
    } catch { return reply('Invalid JSON.', 400); }
    if (!data || typeof data.token !== 'string') return reply('Enter NOTES_TOKEN.', 400);
    if (!validToken(data.token, env)) return reply('Incorrect NOTES_TOKEN.', 401);
    return reply('Signed in for 90 days.', 200, { 'Set-Cookie': cookieFor(request, createSession(env, now())) });
  };
}
export default { fetch: createSessionHandler() };
