import assert from 'node:assert/strict';
import { createNotesHandler } from '../api/notes.js';

const periods = ['chores','annual','quarterly','monthly','weekly','daily','tuesday','wednesday','thursday','friday','saturday','sunday'];
const notes = Object.fromEntries(periods.map(key => [key, `# ${key}\n\n- 📚 Parent\n  - [x] Child`]));
const content = '# Monday\n\n📚\n\n<!-- todo-manager-backup-v1:' + encodeURIComponent(JSON.stringify(notes)) + ' -->\n';
const env = { NOTES_TOKEN:'test-app-token-with-at-least-32-characters', R2_ACCOUNT_ID: 'test-account', R2_ACCESS_KEY_ID: 'test-key', R2_SECRET_ACCESS_KEY: 'test-secret' };
let stored = content, etag = '"initial"', writes = 0, failure;
const handler = createNotesHandler({ env, clientFactory: () => ({
  async send(command) {
    if (failure) throw failure;
    const input = command.input;
    assert.equal(input.Bucket, 'main-blog');
    assert.equal(input.Key, 'to-do-manager/to-do-manger-backup.md');
    if (command.constructor.name === 'GetObjectCommand') return { ETag: etag, ContentLength: Buffer.byteLength(stored), Body: { transformToString: async () => stored } };
    assert.equal(command.constructor.name, 'PutObjectCommand');
    assert.equal(input.ContentType, 'text/markdown; charset=utf-8');
    if (input.IfMatch !== etag) throw { $metadata: { httpStatusCode: 412 } };
    stored = input.Body; etag = '"saved-' + ++writes + '"';
    return { ETag: etag };
  },
}) });
const auth = {Authorization:'Bearer '+env.NOTES_TOKEN};
const call = (method, headers = {}, body) => handler(new Request('https://app.example/api/notes', { method, headers, body }));
assert.equal((await call('GET')).status, 401);
assert.equal((await call('PUT',{'Content-Type':'text/markdown','If-Match':'"initial"'},content)).status,401);
assert.equal(writes,0);
assert.equal((await call('DELETE', auth)).status, 405);
assert.equal((await createNotesHandler({env:{}})(new Request('https://app.example/api/notes'))).status, 503);
let response = await call('GET', auth);
assert.equal(response.status, 200); assert.equal(await response.text(), content);
assert.equal(response.headers.get('ETag'), '"initial"');
assert.equal(response.headers.get('X-R2-Version'),'"initial"');
assert.equal(response.headers.get('Cache-Control'), 'no-store');
const headers = { ...auth, 'Content-Type': 'text/markdown', 'If-Match': '"initial"' };
response = await call('PUT', headers, content);
assert.equal(response.status, 200); assert.equal(writes, 1);
assert.equal(response.headers.get('ETag'), '"saved-1"');
assert.equal(response.headers.get('X-R2-Version'),'"saved-1"');
assert.equal((await call('PUT', headers, content)).status, 412);
assert.equal(writes, 1, 'A stale save must not overwrite newer content');
assert.equal((await call('PUT', { ...headers, 'If-Match': '*' }, content)).status, 428);
assert.equal((await call('PUT', { ...headers, 'If-Match': '"saved-1"' }, 'not a backup')).status, 400);
assert.equal((await call('PUT', { ...headers, 'Content-Length': String(3*1024*1024) }, content)).status, 413);
failure = { name: 'NoSuchKey' };
assert.equal((await call('GET', auth)).status, 404);
failure = new Error('credential details must never leak');
response = await call('GET', auth);
assert.equal(response.status, 502); assert(!(await response.text()).includes('credential details'));
console.log('Passed Vercel API environment configuration, all-panel validation, Unicode, R2 target, reads/writes, limits, and stale-save protection.');

let publicRequest;
const publicHandler=createNotesHandler({env:{NOTES_TOKEN:env.NOTES_TOKEN,R2_PUBLIC_URL:'https://example.com/notes.md'},fetchPublic:async(url,options)=>{
  publicRequest={url,options};return new Response(content,{headers:{'Content-Type':'text/markdown','ETag':'"public-etag"'}});
}});
response=await publicHandler(new Request('https://app.example/api/notes?source=public',{headers:auth}));
assert.equal(response.status,200);assert.equal(await response.text(),content);assert.equal(response.headers.get('ETag'),'"public-etag"');
assert.equal(publicRequest.url,'https://example.com/notes.md');
assert.equal(publicRequest.options.cache,'no-store');
const unavailable=createNotesHandler({env:{NOTES_TOKEN:env.NOTES_TOKEN,R2_PUBLIC_URL:'https://example.com/notes.md'},fetchPublic:async()=>new Response('No',{status:403})});
assert.equal((await unavailable(new Request('https://app.example/api/notes?source=public',{headers:auth}))).status,502);
assert.equal((await publicHandler(new Request('https://app.example/api/notes?source=public',{method:'PUT'}))).status,401);
console.log('Passed public URL proxy loading with ETag propagation; writes still require server-side R2 configuration.');

const unconfigured=createNotesHandler({env:{NOTES_TOKEN:env.NOTES_TOKEN},fetchPublic:async()=>{throw new Error('Must not fetch without URL');}});
assert.equal((await unconfigured(new Request('https://app.example/api/notes?source=public',{headers:auth}))).status,503);

publicRequest=null;
assert.equal((await publicHandler(new Request('https://app.example/api/notes?source=public'))).status,401);
assert.equal((await publicHandler(new Request('https://app.example/api/notes?source=public',{headers:{Authorization:'Bearer incorrect'}}))).status,401);
assert.equal(publicRequest,null,'Unauthorized reads must never fetch the Markdown source');

// New exports persist Research; older backups remain accepted.
failure=undefined;
const withResearch={...notes,research:'## Sources\n- 📚 Reading list'};
const researchBackup='<!-- todo-manager-backup-v1:'+encodeURIComponent(JSON.stringify(withResearch))+' -->';
response=await call('PUT',{...auth,'Content-Type':'text/markdown','If-Match':etag},researchBackup);
assert.equal(response.status,200);assert.equal(stored,researchBackup);

assert.equal((await call('PUT',{...auth,'Content-Type':'text/markdown','If-Match':'W/'+etag},researchBackup)).status,428);
const secondRead=await call('GET',auth);
// Simulate a CDN weakening the page ETag while preserving the opaque R2 version.
const transportedVersion=secondRead.headers.get('X-R2-Version');
const nextSave=await call('PUT',{...auth,'Content-Type':'text/markdown','If-Match':transportedVersion},researchBackup);
assert.equal(nextSave.status,200);
assert.equal((await call('PUT',{...auth,'Content-Type':'text/markdown','If-Match':transportedVersion},researchBackup)).status,412);
console.log('Passed independent R2 version transport, consecutive saves, and stale-version rejection.');
