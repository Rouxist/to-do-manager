import { normalizeCalendar } from '../dist/calendar-core.js';
import { configured, authorization, sameOrigin } from '../lib/auth.js';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const LIMIT = 2 * 1024 * 1024;
const PERIODS = ['chores', 'annual', 'quarterly', 'monthly', 'weekly', 'daily', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'research'];
const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' };
const versionHeaders = etag => etag && /^"[^"\r\n]+"$/.test(etag) ? { ETag: etag, 'X-R2-Version': etag } : {};
const reply = (message, status, extra = {}) => new Response(message, { status, headers: { ...headers, ...extra } });

function clientFor(env) {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}


export function createNotesHandler({ env = process.env, clientFactory = clientFor, fetchPublic = fetch } = {}) {
  return async function handle(request) {
    if (!configured(env)) return reply('Configure NOTES_TOKEN in your environment (at least 32 characters).', 503);
    const access = authorization(request, env);
    if (!access) return reply('Please sign in with NOTES_TOKEN.', 401);
    if (access === 'cookie' && request.method !== 'GET' && !sameOrigin(request)) return reply('A same-origin request is required.', 403);
    // Require the app token before proxying the configured Markdown source.
    if (request.method === 'GET' && new URL(request.url).searchParams.get('source') === 'public') {
      try {
        const source = env.R2_PUBLIC_URL;
        if (!source) return reply('Set R2_PUBLIC_URL in your environment to load initial notes.', 503);
        const url = new URL(source);
        if (url.protocol !== 'https:') return reply('R2_PUBLIC_URL must use HTTPS.', 503);
        const response = await fetchPublic(url.href, {
          cache: 'no-store', signal: AbortSignal.timeout(15000),
          headers: { 'User-Agent': 'Mozilla/5.0 ToDoManager/1.0' },
        });
        if (!response.ok) return reply('Could not load the public Markdown file (HTTP ' + response.status + ').', 502);
        if (Number(response.headers.get('Content-Length')) > LIMIT) return reply('Backup exceeds 2 MB.', 413);
        const content = await response.text();
        if (Buffer.byteLength(content) > LIMIT) return reply('Backup exceeds 2 MB.', 413);
        return reply(content, 200, { 'Content-Type': 'text/markdown; charset=utf-8', ...versionHeaders(response.headers.get('ETag')) });
      } catch {
        return reply('Could not reach the public Markdown file. Please try again.', 502);
      }
    }
    if (!['GET', 'PUT'].includes(request.method)) return reply('Method not allowed.', 405, { Allow: 'GET, PUT' });
    if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return reply('Configure the R2 credentials in Vercel.', 503);
    const target = { Bucket: env.R2_BUCKET || 'main-blog', Key: env.R2_OBJECT_KEY || 'to-do-manager/to-do-manger-backup.md' };
    try {
      const client = clientFactory(env);
      if (request.method === 'GET') {
        const object = await client.send(new GetObjectCommand(target));
        if (object.ContentLength > LIMIT) return reply('Backup exceeds 2 MB.', 413);
        const content = await object.Body.transformToString('utf-8');
        if (Buffer.byteLength(content) > LIMIT) return reply('Backup exceeds 2 MB.', 413);
        return reply(content, 200, { 'Content-Type': 'text/markdown; charset=utf-8', ...versionHeaders(object.ETag) });
      }
      const etag = request.headers.get('If-Match');
      if (!etag || !/^"[^"\r\n]+"$/.test(etag)) return reply('Missing a valid R2 file version. Export your edits, then reload the app before saving.', 428);
      if (!request.headers.get('Content-Type')?.startsWith('text/markdown')) return reply('Expected Markdown.', 415);
      if (Number(request.headers.get('Content-Length')) > LIMIT) return reply('Backup exceeds 2 MB.', 413);
      const content = await request.text();
      if (Buffer.byteLength(content) > LIMIT) return reply('Backup exceeds 2 MB.', 413);
      try {
        const marker = content.match(/<!-- todo-manager-backup-v1:(.*?) -->\s*$/);
        const notes = JSON.parse(decodeURIComponent(marker?.[1] || ''));
        if (!notes || PERIODS.some(key => key === 'research' && notes[key] === undefined ? false : typeof notes[key] !== 'string')) throw new Error('Missing panel');
        normalizeCalendar(notes);
      } catch {
        return reply('Expected a valid all-panel Markdown backup from this app.', 400);
      }
      const result = await client.send(new PutObjectCommand({
        ...target, Body: content, ContentType: 'text/markdown; charset=utf-8', CacheControl: 'no-cache', IfMatch: etag,
      }));
      return reply('Saved to R2.', 200, versionHeaders(result.ETag));
    } catch (error) {
      const code = error.$metadata?.httpStatusCode;
      if (code === 404 || error.name === 'NoSuchKey') return reply('Markdown file not found in R2. Check R2_BUCKET and R2_OBJECT_KEY.', 404);
      if (code === 412 || code === 409) return reply('The file changed in R2. Export your edits, then reload R2 before saving again.', 412);
      return reply('R2 request failed. Check the server credentials and bucket permissions.', 502);
    }
  };
}

export default { fetch: createNotesHandler() };
