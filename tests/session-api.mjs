import assert from 'node:assert/strict';
import { createSessionHandler } from '../api/session.js';
import { createNotesHandler } from '../api/notes.js';
import { SESSION_SECONDS, createSession, validSession, authorization } from '../lib/auth.js';

const env = { NOTES_TOKEN: 'test-notes-secret-that-is-at-least-32-characters', R2_PUBLIC_URL: 'https://example.com/notes.md', R2_ACCOUNT_ID: 'account', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret' };
const origin = 'https://app.example';
const handler = createSessionHandler({ env });
const request = (method, body, extra = {}, base = origin) => new Request(base + '/api/session', {
  method, headers: { Origin: base, 'Content-Type': 'application/json', ...extra },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
let response = await handler(request('POST', { token: 'incorrect' }));
assert.equal(response.status, 401); assert.equal(response.headers.get('Set-Cookie'), null);
response = await handler(request('POST', { token: env.NOTES_TOKEN }));
assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
const cookieHeader = response.headers.get('Set-Cookie');
const cookie = cookieHeader.split(';')[0], session = cookie.slice(cookie.indexOf('=') + 1);
for (const attribute of ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=7776000', 'Secure']) assert(cookieHeader.includes(attribute));
assert(!cookieHeader.includes('Domain='));assert(!cookieHeader.includes(env.NOTES_TOKEN));
assert(!(await response.text()).includes(env.NOTES_TOKEN));assert(validSession(session, env));
const claims = JSON.parse(Buffer.from(session.split('.')[0], 'base64url').toString());
assert.equal(claims.exp - claims.iat, SESSION_SECONDS);assert(!('token' in claims));
const time = 1700000000000, fixed = createSession(env, time);
assert(validSession(fixed, env, time + SESSION_SECONDS * 1000 - 1));
assert(!validSession(fixed, env, time + SESSION_SECONDS * 1000));
assert(!validSession(fixed, env, time - 1000));
assert(!validSession(fixed, { NOTES_TOKEN: env.NOTES_TOKEN + '-rotated' }, time));
assert(!validSession(fixed + 'x', env, time));
const [payload, signature] = fixed.split('.');
assert(!validSession(Buffer.from(JSON.stringify({ v: 1, iat: 0, exp: 9999999999 })).toString('base64url') + '.' + signature, env, time));
assert(!validSession('invalid', env));assert(!validSession('x'.repeat(3000), env));
assert.equal(authorization(new Request(origin, { headers: { Cookie: cookie + '; ' + cookie } }), env), null);
assert.equal((await handler(request('POST', { token: env.NOTES_TOKEN }, { Origin: 'https://other.example' }))).status, 403);
assert.equal((await handler(request('POST', { token: env.NOTES_TOKEN }, { Origin: 'null' }))).status, 403);
assert.equal((await handler(new Request(origin + '/api/session', { method: 'POST', body: '{}' }))).status, 403);
assert.equal((await handler(request('POST', { token: env.NOTES_TOKEN }, {}, 'http://app.example'))).status, 403);
for (const host of ['http://127.0.0.1:3000', 'http://localhost:3000']) {
  response = await handler(request('POST', { token: env.NOTES_TOKEN }, {}, host));
  assert.equal(response.status, 200);assert(!response.headers.get('Set-Cookie').includes('Secure'));
}
assert.equal((await handler(new Request(origin + '/api/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: 'invalid' }))).status, 400);
assert.equal((await handler(request('POST', { token: env.NOTES_TOKEN }, { 'Content-Length': '5000' }))).status, 413);
response = await handler(request('DELETE'));
assert.equal(response.status, 200);assert(response.headers.get('Set-Cookie').includes('Max-Age=0'));
assert.equal((await handler(request('DELETE', undefined, { Origin: 'https://other.example' }))).status, 403);
let reads = 0, writes = 0;
const notes = Object.fromEntries(['chores','annual','quarterly','monthly','weekly','daily','tuesday','wednesday','thursday','friday','saturday','sunday'].map(key => [key, key]));
const body = '<!-- todo-manager-backup-v1:' + encodeURIComponent(JSON.stringify(notes)) + ' -->';
const api = createNotesHandler({ env, fetchPublic: async () => { reads++;return new Response(body, { headers: { ETag: '"one"' } }); }, clientFactory: () => ({
  send: async command => {
    if (command.constructor.name === 'GetObjectCommand') {reads++;return { ETag: '"one"', Body: { transformToString: async () => body } };}
    writes++;return { ETag: '"two"' };
  },
}) });
for (const path of ['/api/notes', '/api/notes?source=public']) {
  assert.equal((await api(new Request(origin + path))).status, 401);
  assert.equal((await api(new Request(origin + path, { headers: { Cookie: 'todo_session=tampered' } }))).status, 401);
  assert.equal(reads, 0);
}
for (const path of ['/api/notes', '/api/notes?source=public']) {
  response = await api(new Request(origin + path, { headers: { Cookie: cookie } }));
  assert.equal(response.status, 200);assert.equal(response.headers.get('Set-Cookie'), null, 'Reads must not extend fixed expiry');
}
for (const source of [undefined, 'https://other.example', 'null']) {
  const headers = { Cookie: cookie, 'Content-Type': 'text/markdown', 'If-Match': '"one"' };
  if (source) headers.Origin = source;
  assert.equal((await api(new Request(origin + '/api/notes', { method: 'PUT', headers, body }))).status, 403);
}
assert.equal(writes, 0);
response = await api(new Request(origin + '/api/notes', { method: 'PUT', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'text/markdown', 'If-Match': '"one"' }, body }));
assert.equal(response.status, 200);assert.equal(writes, 1);
console.log('Passed 90-day sessions, cookie flags, auth/expiry/tampering/rotation, CSRF, loopback login, logout, and cookie-based notes access.');
