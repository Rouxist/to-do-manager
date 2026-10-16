const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
const nodes = new Map();
function node(id) {
  if (!nodes.has(id)) nodes.set(id, {
    value: '', dataset: {}, disabled: false, open: false, events: {},
    style: { setProperty() {} },
    addEventListener(type, callback) { this.events[type] = callback; },
    setAttribute() {},
    showModal() { this.open = true; }, close() { this.open = false; },
    requestSubmit() { this.submission = this.events.submit({ preventDefault() {} }); },
    click() { this.events.click?.(); },
  });
  return nodes.get(id);
}
for (const match of html.matchAll(/id="([^"]+)"/g)) node('#' + match[1]);
const documentEvents = {}, windowEvents = {};
let resolveFetch, rejectFetch, request, downloads = 0;
const context = vm.createContext({
  document: {
    querySelector(selector) { assert(nodes.has(selector), selector); return node(selector); },
    querySelectorAll() { return []; },
    addEventListener(type, callback) { documentEvents[type] = callback; },
    createElement() { return { click() { downloads++; } }; },
  },
  window: { addEventListener(type, callback) { windowEvents[type] = callback; } },
  location: { protocol: 'http:', hostname: '127.0.0.1' },
  // Any accidental browser storage access must fail this test.
  get localStorage() { throw new Error('Browser storage must not be used'); },
  get sessionStorage() { throw new Error('Browser storage must not be used'); },
  fetch(url, options) {
    request = { url, options };
    return new Promise((resolve, reject) => { resolveFetch = resolve; rejectFetch = reject; });
  },
  Blob: class {}, URL: class extends URL { static createObjectURL() { return 'blob:test'; } static revokeObjectURL() {} },
  setTimeout() {}, confirm() { return true; }, alert(message) { throw new Error(message); },
});
vm.runInContext(script, context);
const isDirty = () => vm.runInContext('hasUnsavedChanges()', context);
const edit = (value) => { node('#editor-daily').value = value; node('#editor-daily').events.input(); };
function leaving() {
  let prevented = false;
  windowEvents.beforeunload({ preventDefault() { prevented = true; } });
  return prevented;
}
function shortcut(key = 'ß', code = 'KeyS') {
  let prevented = false;
  documentEvents.keydown({ key, code, altKey: true, preventDefault() { prevented = true; } });
  assert(prevented, 'Option+S should override the OS-specific character');
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function success(etag='"saved-etag"'){
  resolveFetch({ok:true,headers:{get(){return etag;}}});
}
(async()=>{
  assert(!nodes.has('#backup'));assert(!nodes.has('#import'));assert(!nodes.has('#import-file'));
  assert.equal(request.url,'/api/notes?source=public');
  assert(node('#editor-daily').disabled,'Disable editing during initial load');
  const remoteNotes=Object.fromEntries(vm.runInContext('periods',context).map(key=>[key,'Remote '+key]));
  const remoteText='<!-- todo-manager-backup-v1:'+encodeURIComponent(JSON.stringify(remoteNotes))+' -->';
  resolveFetch({ok:true,headers:{get(){return '"initial"';}},text:async()=>remoteText});
  await vm.runInContext('initialLoadPromise',context);
  assert.equal(node('#editor-daily').value,'Remote daily');assert(!isDirty());assert(!leaving());
  assert(!node('#editor-daily').disabled);
  edit('- [ ] Parent\n  - Child');assert(isDirty());assert(leaving());
  assert.equal(node('#status').textContent,'Unsaved changes');
  edit('Remote daily');assert(!isDirty());assert(!leaving());
  assert(!nodes.has('#r2-token'));assert(!nodes.has('#r2-form'));
  assert(!node('#r2-save').hidden,'Initial load enables saving without token entry');
  edit('Save this to R2');shortcut();
  assert(node('#token-dialog').open);assert(isDirty());
  node('#token-cancel').click();assert(!node('#token-dialog').open);assert(isDirty());
  shortcut();node('#notes-token').value='incorrect-token';
  const wrongToken=node('#token-form').events.submit({preventDefault(){}});
  resolveFetch({ok:false,status:401,text:async()=>'Incorrect NOTES_TOKEN.'});await wrongToken;
  assert(isDirty());assert(node('#token-dialog').open);
  node('#notes-token').value='correct-token';
  const firstSave=node('#token-form').events.submit({preventDefault(){}});
  assert.equal(request.options.headers.Authorization,'Bearer correct-token');
  assert.equal(request.options.method,'PUT');assert.equal(request.options.headers['If-Match'],'"initial"');
  assert(leaving(),'Pending save must still warn');
  edit('Edited while saving');success();await firstSave;assert(isDirty(),'Edits during save stay unsaved');
  shortcut();success('"newer"');await tick();
  assert(!isDirty());assert(!leaving());assert.equal(node('#status').textContent,'Saved to R2');
  edit('Conflict must keep these edits');
  const conflicting=node('#r2-save').events.click();
  resolveFetch({ok:false,text:async()=>'The file changed in R2.'});await conflicting;
  assert(isDirty());assert(leaving());assert.equal(node('#editor-daily').value,'Conflict must keep these edits');
  assert.equal(node('#initial-load-message').textContent,'The file changed in R2.');
  const failed=node('#r2-save').events.click();rejectFetch(new Error('Network unavailable'));await failed;
  assert(isDirty());assert(leaving());
  node('#download').click();assert.equal(downloads,1);assert(isDirty(),'Download cannot confirm a disk save');
  edit('- [ ] Task');
  const save=node('#r2-save').events.click();success();await save;assert(!isDirty());
  node('#preview-daily').events.change({target:{matches(){return true;},dataset:{line:'0'},checked:true}});
  assert.equal(node('#editor-daily').value,'- [x] Task');assert(leaving());
  const retry=node('#initial-load-retry').events.click();rejectFetch(new Error('Public URL unavailable'));await retry;
  assert.equal(node('#editor-daily').value,'- [x] Task');assert(isDirty());
  assert(!node('#initial-load-notice').hidden);assert(!node('#editor-daily').disabled);
  const delayed=node('#initial-load-retry').events.click();
  edit('Edit while request is pending');
  resolveFetch({ok:true,headers:{get(){return '"initial"';}},text:async()=>remoteText});await delayed;
  assert.equal(node('#editor-daily').value,'Edit while request is pending');assert(isDirty());
  context.location.protocol='file:';
  const previousRequest=request;
  await node('#r2-open').events.click();
  assert.equal(request,previousRequest);assert(node('#initial-load-message').textContent.includes('npm run dev'));
  assert(!('pagehide' in windowEvents));
  console.log('Passed initial URL loading, removed buttons, edit preservation, token-protected R2 saves, failure/retry, shortcuts, and close warning.');
})().catch(error=>{console.error(error);process.exitCode=1;});
