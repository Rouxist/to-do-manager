const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../dist/index.html'),'utf8');
const script=html.match(/<script>([\s\S]*)<\/script>/)[1];
function createApp(){
  const nodes=new Map(),documentEvents={},windowEvents={},requests=[];
  let downloads=0;
  function node(id){
    if(!nodes.has(id))nodes.set(id,{
      value:'',dataset:{},disabled:false,open:false,hidden:false,events:{},style:{setProperty(){}},
      addEventListener(type,callback){this.events[type]=callback;},setAttribute(){},
      setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);},
      setSelectionRange(start,end,direction){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;},
      showModal(){this.open=true;},close(){this.open=false;},click(){return this.events.click?.();},
    });
    return nodes.get(id);
  }
  for(const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g))node('#'+match[1]).hidden=/\shidden(?:\s|>)/.test(match[0]);
  const context=vm.createContext({
    document:{querySelector(selector){assert(nodes.has(selector),selector);return node(selector);},querySelectorAll(){return [];},addEventListener(type,callback){documentEvents[type]=callback;},createElement(){return {click(){downloads++;}};}},
    window:{addEventListener(type,callback){windowEvents[type]=callback;}},location:{protocol:'http:',hostname:'127.0.0.1'},
    get localStorage(){throw new Error('No browser storage for notes or raw token');},get sessionStorage(){throw new Error('No browser storage for notes or raw token');},
    fetch(url,options){return new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}));},
    Blob:class{},URL:class extends URL{static createObjectURL(){return 'blob:test';}static revokeObjectURL(){}},
    setTimeout(){},confirm(){return true;},alert(message){throw new Error(message);},
  });
  vm.runInContext(script,context);
  return {node,nodes,context,requests,documentEvents,windowEvents,get downloads(){return downloads;},get latest(){return requests.at(-1);}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=(status=200,text='',etag='"initial"')=>({ok:status>=200&&status<300,status,text:async()=>text,headers:{get(name){return name.toLowerCase()==='etag'?'W/'+etag:name.toLowerCase()==='x-r2-version'?etag:null;}}});
const notes=Object.fromEntries(['chores','annual','quarterly','monthly','weekly','daily','tuesday','wednesday','thursday','friday','saturday','sunday'].map(key=>[key,'Remote '+key]));
const remoteText='<!-- todo-manager-backup-v1:'+encodeURIComponent(JSON.stringify(notes))+' -->';
(async()=>{
  const app=createApp(),{node,context}=app;
  const isDirty=()=>vm.runInContext('hasUnsavedChanges()',context);
  const edit=value=>{node('#editor-daily').value=value;node('#editor-daily').events.input();};
  const leaving=()=>{let prevented=false;app.windowEvents.beforeunload({preventDefault(){prevented=true;}});return prevented;};
  const shortcut=()=>{let prevented=false;app.documentEvents.keydown({key:'ß',code:'KeyS',altKey:true,preventDefault(){prevented=true;}});assert(prevented);};
  const submit=token=>{node('#notes-token').value=token;return node('#token-form').events.submit({preventDefault(){}});};
  assert(!app.nodes.has('#backup'));assert(!app.nodes.has('#import'));assert(!app.nodes.has('#import-file'));
  assert.equal(app.latest.url,'/api/notes');assert.equal(app.latest.options.credentials,'same-origin');
  assert(!node('#token-dialog').open,'Try the existing cookie before prompting');
  app.latest.resolve(response(401,'Please sign in.'));await vm.runInContext('initialLoadPromise',context);
  assert(node('#token-dialog').open);assert(node('#editor-daily').disabled);assert.equal(node('#editor-daily').value,'');
  let pending=submit('wrong');assert.equal(app.latest.url,'/api/session');assert.equal(node('#notes-token').value,'');
  app.latest.resolve(response(401,'Incorrect NOTES_TOKEN.'));await pending;
  assert(node('#token-dialog').open);assert(node('#editor-daily').disabled);
  pending=submit('correct-token');assert.equal(JSON.parse(app.latest.options.body).token,'correct-token');
  app.latest.resolve(response());await tick();assert.equal(app.latest.url,'/api/notes');
  app.latest.resolve(response(200,remoteText));await pending;
  assert.equal(node('#editor-research').value,'');assert.equal(node('#editor-daily').value,'Remote daily');assert(!node('#token-dialog').open);assert(!node('#logout').hidden);
  assert.equal(vm.runInContext('typeof notesToken',context),'undefined');assert(!isDirty());assert(!leaving());
  edit('change');assert(isDirty());assert(leaving());edit('Remote daily');assert(!isDirty());
  node('#editor-research').value='## Research\n- 📚 Sources';node('#editor-research').events.input();
  edit('Save this to R2');shortcut();
  assert(app.latest.options.body.includes('# Research\n\n## Research'));
  const exported=vm.runInContext('markdownBackup()',context);
  assert.equal(vm.runInContext('parseMarkdownBackup('+JSON.stringify(exported)+').research',context),'## Research\n- 📚 Sources');
  assert(node('#preview-research').innerHTML.includes('<h2>Research</h2>'));assert.equal(app.latest.options.method,'PUT');
  assert.equal(app.latest.options.headers.Authorization,undefined);assert.equal(app.latest.options.headers['If-Match'],'"initial"');
  assert(leaving());edit('Edited during save');app.latest.resolve(response());await tick();assert(isDirty());
  shortcut();app.latest.resolve(response(200,'','"newer"'));await tick();assert(!isDirty());assert(!leaving());
  edit('Keep these unsaved edits');pending=node('#r2-save').click();
  app.latest.resolve(response(401,'Session expired.'));await pending;
  assert(node('#token-dialog').open);assert(isDirty());assert.equal(node('#editor-daily').value,'Keep these unsaved edits');
  node('#token-cancel').click();assert(!node('#token-dialog').open);assert(isDirty());
  shortcut();app.latest.resolve(response(401,'Session expired.'));await tick();
  pending=submit('correct-token');app.latest.resolve(response());await tick();
  assert.equal(app.latest.options.method,'PUT','Reauthentication retries saving, not loading');
  app.latest.resolve(response());await pending;assert(!isDirty());
  edit('Conflict');pending=node('#r2-save').click();app.latest.resolve(response(412,'Changed in R2.'));await pending;
  assert(isDirty());assert.equal(node('#editor-daily').value,'Conflict');
  pending=node('#r2-save').click();app.latest.reject(new Error('Offline'));await pending;assert(isDirty());
  node('#download').click();assert.equal(app.downloads,1);assert(isDirty());
  edit('- [ ] Task');pending=node('#r2-save').click();app.latest.resolve(response());await pending;
  node('#preview-daily').events.change({target:{matches(){return true;},dataset:{line:'0'},checked:true}});
  assert.equal(node('#editor-daily').value,'- [x] Task');assert(leaving());
  pending=node('#initial-load-retry').click();app.latest.reject(new Error('Unavailable'));await pending;
  assert.equal(node('#editor-daily').value,'- [x] Task');assert(isDirty());
  pending=node('#initial-load-retry').click();edit('Edit during loading');app.latest.resolve(response(200,remoteText));await pending;
  assert.equal(node('#editor-daily').value,'Edit during loading');assert(isDirty());
  function duplicate(input,start,end,key,expected,newStart,newEnd=start===end?newStart:end){
    const editor=node('#editor-daily');editor.value=input;editor.setSelectionRange(start,end,'forward');let prevented=false;
    editor.events.keydown({altKey:true,key,preventDefault(){prevented=true;}});
    assert(prevented);assert.equal(editor.value,expected);assert.equal(editor.selectionStart,newStart);assert.equal(editor.selectionEnd,newEnd);assert(isDirty());assert(leaving());
  }
  duplicate('first\n  - 📚 task\nlast',9,9,'ArrowDown','first\n  - 📚 task\n  - 📚 task\nlast',21);
  duplicate('one\ntwo',5,5,'ArrowUp','one\ntwo\ntwo',5);duplicate('one\ntwo',5,5,'ArrowDown','one\ntwo\ntwo',9);
  duplicate('one\ntwo',0,0,'ArrowUp','one\none\ntwo',0);duplicate('',0,0,'ArrowDown','\n',1);
  duplicate('\nnext',0,0,'ArrowUp','\n\nnext',0);duplicate('one\ntwo\nthree',0,8,'ArrowDown','one\ntwo\none\ntwo\nthree',8,16);
  duplicate('one\ntwo\nthree',1,6,'ArrowUp','one\ntwo\none\ntwo\nthree',1,6);
  const unchanged=node('#editor-daily').value;
  node('#editor-daily').events.keydown({altKey:false,key:'ArrowDown',preventDefault(){throw new Error('Normal arrows must remain unchanged');}});
  assert.equal(node('#editor-daily').value,unchanged);
  for(const key of Object.keys(notes))assert.equal(typeof node('#editor-'+key).events.keydown,'function');
  context.confirm=()=>false;let count=app.requests.length;await node('#logout').click();assert.equal(app.requests.length,count);assert(isDirty());
  context.confirm=()=>true;pending=node('#logout').click();app.latest.resolve(response(500,'Logout failed'));await pending;
  assert.equal(node('#editor-daily').value,unchanged);assert(isDirty());
  pending=node('#logout').click();assert.equal(app.latest.url,'/api/session');assert.equal(app.latest.options.method,'DELETE');
  app.latest.resolve(response());await pending;
  assert(node('#logout').hidden);assert(node('#token-dialog').open);assert(node('#editor-daily').disabled);assert(!isDirty());assert(!leaving());
  for(const key of [...Object.keys(notes),'research']){assert.equal(node('#editor-'+key).value,'');assert(!node('#preview-'+key).innerHTML.includes('Remote'));}
  const reopened=createApp();reopened.latest.resolve(response(200,remoteText));await vm.runInContext('initialLoadPromise',reopened.context);
  assert(!reopened.node('#token-dialog').open);assert.equal(reopened.requests.length,1,'A valid browser cookie should avoid logging in again');
  assert.equal(reopened.node('#editor-daily').value,'Remote daily');
  const loggedOut=createApp();loggedOut.latest.resolve(response(401,'Sign in'));await vm.runInContext('initialLoadPromise',loggedOut.context);
  assert(loggedOut.node('#token-dialog').open);assert.equal(loggedOut.node('#editor-daily').value,'');
  assert(!('pagehide' in app.windowEvents));
  console.log('Passed persistent-login frontend flow, expiry and reauthentication, logout/cancel/failure, dirty tracking, shortcuts, duplication, and simulated reopening.');
})().catch(error=>{console.error(error);process.exitCode=1;});
