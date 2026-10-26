const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../dist/index.html'),'utf8');
const script=html.match(/<script type="module">([\s\S]*)<\/script>/)[1].replace(/import \* as Calendar from .*?;/, '');
function createApp(initialNow){
  let now=initialNow;
  class AppDate extends Date { constructor(...args){super(...(args.length?args:now?[now]:[]));} static now(){return now?new Date(now).getTime():Date.now();} }
  const nodes=new Map(),documentEvents={},windowEvents={},requests=[];
  let downloads=0;
  function node(id){
    if(!nodes.has(id))nodes.set(id,{
      value:'',dataset:{},disabled:false,open:false,hidden:false,events:{},style:{setProperty(){}},
      addEventListener(type,callback){this.events[type]=callback;},setAttribute(){},querySelector(){return null;},querySelectorAll(){return [];},focus(){},
      setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);},
      setSelectionRange(start,end,direction){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;},
      showModal(){this.open=true;},close(){this.open=false;},click(){return this.events.click?.();},
    });
    return nodes.get(id);
  }
  for(const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g))node('#'+match[1]).hidden=/\shidden(?:\s|>)/.test(match[0]);
  const context=vm.createContext({
    document:{querySelector(selector){assert(nodes.has(selector),selector);return node(selector);},querySelectorAll(selector){return selector==='[name="routine-weekday"]'?[0,1,2,3,4,5,6].map(day=>{const item=node('#routine-weekday-'+day);item.value=String(day);return item;}):[];},addEventListener(type,callback){documentEvents[type]=callback;},createElement(){return {click(){downloads++;}};}},
    window:{addEventListener(type,callback){windowEvents[type]=callback;}},location:{protocol:'http:',hostname:'127.0.0.1'},
    get localStorage(){throw new Error('No browser storage for notes or raw token');},get sessionStorage(){throw new Error('No browser storage for notes or raw token');},
    fetch(url,options){return new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}));},
    Date:AppDate,crypto:{randomUUID:require('node:crypto').randomUUID},
    Blob:class{},URL:class extends URL{static createObjectURL(){return 'blob:test';}static revokeObjectURL(){}},
    setTimeout(){},confirm(){return true;},alert(message){throw new Error(message);},
  });
  const core=fs.readFileSync(path.join(__dirname,'../dist/calendar-core.js'),'utf8').replace(/export /g,'');
  vm.runInContext('const Calendar=(()=>{'+core+';return {dateKey,dateObject,validDate,shiftDate,shiftMonth,lineCount,normalizeCalendar,ruleOn,occursOn,reviseRoutine};})();',context);
  vm.runInContext(script,context);
  return {setNow(value){now=value;},node,nodes,context,requests,documentEvents,windowEvents,get downloads(){return downloads;},get latest(){return requests.at(-1);}};
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
    editor.events.keydown({altKey:true,shiftKey:true,key,preventDefault(){prevented=true;}});
    assert(prevented);assert.equal(editor.value,expected);assert.equal(editor.selectionStart,newStart);assert.equal(editor.selectionEnd,newEnd);assert(isDirty());assert(leaving());
  }
  duplicate('first\n  - 📚 task\nlast',9,9,'ArrowDown','first\n  - 📚 task\n  - 📚 task\nlast',21);
  duplicate('one\ntwo',5,5,'ArrowUp','one\ntwo\ntwo',5);duplicate('one\ntwo',5,5,'ArrowDown','one\ntwo\ntwo',9);
  duplicate('one\ntwo',0,0,'ArrowUp','one\none\ntwo',0);duplicate('',0,0,'ArrowDown','\n',1);
  duplicate('\nnext',0,0,'ArrowUp','\n\nnext',0);duplicate('one\ntwo\nthree',0,8,'ArrowDown','one\ntwo\none\ntwo\nthree',8,16);
  duplicate('one\ntwo\nthree',1,6,'ArrowUp','one\ntwo\none\ntwo\nthree',1,6);
  function move(input,start,end,key,expected,newStart,newEnd=newStart){
    const editor=node('#editor-daily');editor.value=input;editor.setSelectionRange(start,end,'backward');
    editor.scrollTop=20;editor.scrollLeft=10;let prevented=false;
    editor.events.keydown({altKey:true,shiftKey:false,key,preventDefault(){prevented=true;}});
    assert(prevented);assert.equal(editor.value,expected);
    assert.equal(editor.selectionStart,newStart);assert.equal(editor.selectionEnd,newEnd);
    assert.equal(editor.selectionDirection,'backward');assert.equal(editor.scrollTop,20);assert.equal(editor.scrollLeft,10);
  }
  move('one\ntwo\nthree',5,5,'ArrowUp','two\none\nthree',1);
  move('one\ntwo\nthree',5,5,'ArrowDown','one\nthree\ntwo',11);
  move('one\ntwo\nthree',0,8,'ArrowDown','three\none\ntwo',6,13);
  move('one\ntwo\nthree',4,13,'ArrowUp','two\nthree\none',0,9);
  move('first\n  - 📚 task\nlast',9,9,'ArrowDown','first\nlast\n  - 📚 task',14);
  move('\nnext',0,0,'ArrowDown','next\n',5);
  move('one\n',4,4,'ArrowUp','\none',0);
  move('one\ntwo',0,0,'ArrowUp','one\ntwo',0);
  move('one\ntwo',5,5,'ArrowDown','one\ntwo',5);
  move('',0,0,'ArrowDown','',0);
  function indent(input,start,end,shift,expected,newStart,newEnd=newStart){
    const editor=node('#editor-daily');editor.value=input;editor.setSelectionRange(start,end,'forward');let prevented=false;
    editor.events.keydown({key:'Tab',shiftKey:shift,preventDefault(){prevented=true;}});
    assert(prevented);assert.equal(editor.value,expected);assert.equal(editor.selectionStart,newStart);assert.equal(editor.selectionEnd,newEnd);
  }
  indent('- Parent\n- Child',9,9,false,'- Parent\n  - Child',11);
  assert(node('#preview-daily').innerHTML.includes('<ul><li>Child'));
  indent('one\ntwo\nthree',0,8,false,'  one\n  two\nthree',2,12);
  indent('  one\n  two\nthree',2,12,true,'one\ntwo\nthree',0,8);
  indent('  - Child',5,5,true,'- Child',3);
  indent(' - Child',1,1,true,'- Child',0);
  indent('\t- Child',1,1,true,'- Child',0);
  indent('one',1,1,true,'one',1);
  indent('',0,0,false,'  ',2);
  assert(isDirty());assert(leaving());
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
  const undoEditor=reopened.node('#editor-daily');
  const press=options=>{let prevented=false;undoEditor.events.keydown({...options,preventDefault(){prevented=true;}});assert(prevented);};
  const undoDirty=()=>vm.runInContext('hasUnsavedChanges()',reopened.context);
  undoEditor.setSelectionRange(3,3,'forward');undoEditor.scrollTop=12;undoEditor.scrollLeft=4;
  press({altKey:true,shiftKey:true,key:'ArrowDown'});
  assert.equal(undoEditor.value,'Remote daily\nRemote daily');assert(undoDirty());
  press({metaKey:true,key:'z'});
  assert.equal(undoEditor.value,'Remote daily');assert.equal(undoEditor.selectionStart,3);assert(!undoDirty());
  assert.equal(undoEditor.scrollTop,12);assert.equal(undoEditor.scrollLeft,4);
  press({metaKey:true,shiftKey:true,key:'z'});
  assert.equal(undoEditor.value,'Remote daily\nRemote daily');
  press({metaKey:true,key:'z'});
  undoEditor.events.beforeinput({inputType:'insertText'});
  undoEditor.value='Remote daily!';undoEditor.setSelectionRange(13,13,'forward');undoEditor.events.input();
  press({metaKey:true,shiftKey:true,key:'z'});assert.equal(undoEditor.value,'Remote daily!','Typing clears redo');
  press({ctrlKey:true,key:'z'});assert.equal(undoEditor.value,'Remote daily');assert(!undoDirty());
  press({key:'Tab'});assert.equal(undoEditor.value,'Rem  ote daily');
  press({metaKey:true,key:'z'});assert.equal(undoEditor.value,'Remote daily');
  undoEditor.events.beforeinput({inputType:'insertFromPaste'});
  undoEditor.value='one\ntwo';undoEditor.setSelectionRange(5,5,'forward');undoEditor.events.input();
  press({altKey:true,key:'ArrowUp'});assert.equal(undoEditor.value,'two\none');
  press({metaKey:true,key:'z'});assert.equal(undoEditor.value,'one\ntwo');assert.equal(undoEditor.selectionStart,5);
  assert.equal(reopened.node('#editor-weekly').value,'Remote weekly');
  undoEditor.events.beforeinput({inputType:'historyUndo',preventDefault(){}});
  assert.equal(undoEditor.value,'Remote daily');assert(!undoDirty());
  press({metaKey:true,key:'z'});assert.equal(undoEditor.value,'Remote daily','Cannot undo loading notes');

  // Calendar integration uses a controlled local day and the same auth/save lifecycle.
  process.env.TZ='Asia/Seoul';
  const dated=createApp('2026-10-26T10:00:00+09:00'),run=code=>vm.runInContext(code,dated.context);
  const calendarPayload={...notes,scheduledByDate:{'2026-10-26':'- [ ] Today task','2026-10-27':'Tomorrow'},routines:[],routineCompletions:{}};
  const backup=value=>'<!-- todo-manager-backup-v1:'+encodeURIComponent(JSON.stringify(value))+' -->';
  dated.latest.resolve(response(200,backup(calendarPayload)));await run('initialLoadPromise');
  const scheduled=dated.node('#editor-scheduled');
  assert(!dated.nodes.has('#editor-today'));assert(!dated.nodes.has('#preview-today'));assert(!dated.nodes.has('#routines-today'));
  assert.equal(scheduled.value,'- [ ] Today task');assert.equal(run('selectedDate'),'2026-10-26');assert(!run('hasUnsavedChanges()'));
  scheduled.value='- [ ] Today task\n\nSecond line';scheduled.events.input();
  assert(run('hasUnsavedChanges()'));assert(dated.node('#calendar-grid').innerHTML.includes('2 lines'));
  scheduled.events.keydown({metaKey:true,key:'z',preventDefault(){}});
  assert.equal(scheduled.value,'- [ ] Today task');assert(!run('hasUnsavedChanges()'),'Undo restores the selected date');
  run("selectDate('2026-10-27')");assert.equal(scheduled.value,'Tomorrow');assert(!run('hasUnsavedChanges()'));
  scheduled.value='Tomorrow\n- [ ] Plan';scheduled.events.input();assert.equal(run("calendarData.scheduledByDate['2026-10-26']"),'- [ ] Today task');
  run("selectDate('2026-10-26')");scheduled.events.keydown({metaKey:true,key:'z',preventDefault(){}});assert.equal(scheduled.value,'- [ ] Today task','Undo never crosses dates');
  run("selectDate('2026-10-27')");scheduled.events.keydown({metaKey:true,key:'z',preventDefault(){}});assert.equal(scheduled.value,'Tomorrow');assert(!run('hasUnsavedChanges()'));
  run("selectDate('2026-10-26')");
  dated.node('#preview-scheduled').events.change({target:{matches(){return true;},dataset:{line:'0'},checked:true}});
  assert.equal(scheduled.value,'- [x] Today task');
  dated.node('#routine-title').value='Monthly review';dated.node('#routine-start').value='2026-10-01';dated.node('#routine-frequency').value='monthly';dated.node('#routine-month-day').value='1';
  dated.node('#routine-form').events.submit({preventDefault(){}});assert.equal(run('calendarData.routines.length'),1);
  run("selectDate('2026-11-01')");assert(dated.node('#routines-scheduled').innerHTML.includes('Monthly review'));
  const routineId=run('calendarData.routines[0].id');
  dated.node('#routines-scheduled').events.change({target:{dataset:{routineId,occurrence:'2026-11-01'},checked:true}});
  assert(run(`calendarData.routineCompletions['${routineId}']['2026-11-01']`));
  run("selectDate('2026-12-01')");assert(!dated.node('#routines-scheduled').innerHTML.includes('checked'));
  assert.equal(run("Calendar.lineCount(calendarData.scheduledByDate['2026-12-01'])"),0);
  const roundTrip=run('markdownBackup()');
  assert.equal(run('JSON.stringify(parseMarkdownBackup('+JSON.stringify(roundTrip)+'))'),run('JSON.stringify(noteSnapshot())'));

  // Routine edits are effective today; previous schedules retain their title and cadence.
  dated.node('#routine-list').events.click({target:{closest(){return {dataset:{editRoutine:routineId}};}}});
  dated.node('#routine-title').value='Updated review';dated.node('#routine-month-day').value='15';
  dated.node('#routine-form').events.submit({preventDefault(){}});
  assert.equal(run("Calendar.ruleOn(calendarData.routines[0],'2026-10-01').title"),'Monthly review');
  assert.equal(run("Calendar.ruleOn(calendarData.routines[0],'2026-11-15').title"),'Updated review');
  assert(run("Calendar.occursOn(calendarData.routines[0],'2026-11-15')"));
  assert(!run("Calendar.occursOn(calendarData.routines[0],'2026-11-01')"));
  assert(run(`calendarData.routineCompletions['${routineId}']['2026-11-01']`),'Editing does not erase completion records');
  // Weekly form validation requires a selected weekday.
  dated.node('#routine-title').value='Weekly';dated.node('#routine-frequency').value='weekly';
  dated.node('#routine-form').events.submit({preventDefault(){}});assert.equal(run('calendarData.routines.length'),1);
  assert(dated.node('#routine-message').textContent.includes('weekday'));
  dated.node('#routine-weekday-1').checked=true;
  dated.node('#routine-form').events.submit({preventDefault(){}});assert.equal(run('calendarData.routines.length'),2);
  assert(run("Calendar.occursOn(calendarData.routines[1],'2026-10-26')"));
  const weeklyId=run('calendarData.routines[1].id');
  dated.node('#routine-list').events.click({target:{closest(){return {dataset:{stopRoutine:weeklyId}};}}});
  assert(!run("Calendar.occursOn(calendarData.routines[1],'2026-10-26')"));
  // Calendar keyboard navigation crosses month and year boundaries without editing data.
  const beforeNavigation=run('JSON.stringify(noteSnapshot())');
  dated.node('#calendar-grid').events.keydown({key:'ArrowRight',target:{closest(){return {dataset:{date:'2026-12-31'}};}},preventDefault(){}});
  assert.equal(run('selectedDate'),'2027-01-01');
  dated.node('#calendar-grid').events.keydown({key:'PageUp',target:{closest(){return {dataset:{date:'2027-01-31'}};}},preventDefault(){}});
  assert.equal(run('selectedDate'),'2026-12-31');assert.equal(run('JSON.stringify(noteSnapshot())'),beforeNavigation);
  run("selectDate('2026-12-01')");
  // Save captures all dates and routines; later edits remain dirty.
  run("selectDate('2026-10-26')");
  pending=dated.node('#r2-save').click();assert(dated.latest.options.body.includes('# Calendar'));assert(dated.latest.options.body.includes('# Routines'));
  scheduled.value='Edited during calendar save';scheduled.events.input();dated.latest.resolve(response());await pending;assert(run('hasUnsavedChanges()'));
  pending=dated.node('#r2-save').click();dated.latest.resolve(response(412,'Changed in R2'));await pending;assert.equal(scheduled.value,'Edited during calendar save');assert(run('hasUnsavedChanges()'));

  pending=dated.node('#r2-save').click();dated.latest.resolve(response(401,'Expired'));await pending;
  assert(dated.node('#token-dialog').open);assert.equal(scheduled.value,'Edited during calendar save');
  dated.node('#notes-token').value='correct-token';pending=dated.node('#token-form').events.submit({preventDefault(){}});
  dated.latest.resolve(response());await tick();assert.equal(dated.latest.options.method,'PUT');
  dated.latest.resolve(response(200,'','"reauthenticated"'));await pending;assert(!run('hasUnsavedChanges()'));
  dated.node('#routine-start').value='2026-12-20';
  // Midnight updates the current-day marker without switching the selected date or its edits.
  run("selectDate('2026-12-01')");
  dated.setNow('2026-10-27T00:01:00+09:00');dated.windowEvents.focus();
  assert.equal(scheduled.value,'');assert.equal(run('todayKey'),'2026-10-27');assert.equal(dated.node('#routine-start').value,'2026-12-20','Midnight keeps an explicitly chosen routine start date');assert.equal(run('selectedDate'),'2026-12-01');assert.equal(run("calendarData.scheduledByDate['2026-10-26']"),'Edited during calendar save');
  assert(!run("Calendar.occursOn(calendarData.routines[0],todayKey)"),'Missed routines do not carry over');
  dated.node('#calendar-today').click();assert.equal(run('selectedDate'),'2026-10-27');assert.equal(scheduled.value,'Tomorrow');
  assert(dated.node('#selected-date-heading').textContent.includes('27'));
  // Empty entries do not survive an export; navigation itself does not change the snapshot.
  run("selectDate('2026-10-27')");scheduled.value='';scheduled.events.input();assert.equal(scheduled.value,'');assert.equal(run("noteSnapshot().scheduledByDate['2026-10-27']"),undefined);
  pending=dated.node('#logout').click();dated.latest.resolve(response());await pending;
  assert.equal(run('calendarData.routines.length'),0);assert.equal(run('Object.keys(calendarData.scheduledByDate).length'),0);assert.equal(scheduled.value,'');assert(scheduled.disabled);
  console.log('Passed selected-date editing, per-date undo, isolation across dates, routine occurrences, line counts, backup round trips, save races/conflicts, rollover, and logout cleanup.');

  const loggedOut=createApp();loggedOut.latest.resolve(response(401,'Sign in'));await vm.runInContext('initialLoadPromise',loggedOut.context);
  assert(loggedOut.node('#token-dialog').open);assert.equal(loggedOut.node('#editor-daily').value,'');
  assert(!('pagehide' in app.windowEvents));
  console.log('Passed persistent-login frontend flow, expiry and reauthentication, logout/cancel/failure, dirty tracking, shortcuts, duplication, and simulated reopening.');
})().catch(error=>{console.error(error);process.exitCode=1;});
