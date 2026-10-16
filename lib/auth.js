import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'todo_session';
export const SESSION_SECONDS = 90 * 24 * 60 * 60;
export const configured = env => typeof env.NOTES_TOKEN === 'string' && env.NOTES_TOKEN.length >= 32;
const digest = value => createHash('sha256').update(value).digest();
const equal = (left, right) => timingSafeEqual(digest(left), digest(right));
const signature = (payload, secret) => createHmac('sha256', secret).update('todo-manager-session-v1.' + payload).digest('base64url');

export function validToken(token, env) {
  return configured(env) && typeof token === 'string' && equal(token, env.NOTES_TOKEN);
}
export function createSession(env, now = Date.now()) {
  const issued = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, iat: issued, exp: issued + SESSION_SECONDS, nonce: randomBytes(16).toString('base64url') })).toString('base64url');
  return payload + '.' + signature(payload, env.NOTES_TOKEN);
}
export function validSession(value, env, now = Date.now()) {
  if (!configured(env) || typeof value !== 'string' || value.length > 2048) return false;
  const parts = value.split('.');
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return false;
  if (!equal(parts[1], signature(parts[0], env.NOTES_TOKEN))) return false;
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const seconds = Math.floor(now / 1000);
    return data.v === 1 && Number.isInteger(data.iat) && Number.isInteger(data.exp) && data.iat <= seconds && data.exp === data.iat + SESSION_SECONDS && data.exp > seconds;
  } catch { return false; }
}
export function authorization(request, env, now) {
  const bearer = request.headers.get('Authorization');
  if (bearer?.startsWith('Bearer ') && validToken(bearer.slice(7), env)) return 'bearer';
  const cookies = (request.headers.get('Cookie') || '').split(';').map(part => part.trim());
  const sessions = cookies.filter(part => part.startsWith(COOKIE_NAME + '='));
  if (sessions.length === 1 && validSession(sessions[0].slice(COOKIE_NAME.length + 1), env, now)) return 'cookie';
  return null;
}
export function sameOrigin(request) {
  return request.headers.get('Origin') === new URL(request.url).origin;
}
export function cookieFor(request, value, clear = false) {
  const url = new URL(request.url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Sessions require HTTPS outside loopback development.');
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_SECONDS}${url.protocol === 'https:' ? '; Secure' : ''}`;
}
