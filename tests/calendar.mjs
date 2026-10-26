import assert from 'node:assert/strict';
import {dateKey,dateObject,validDate,shiftDate,shiftMonth,lineCount,normalizeCalendar,occursOn,ruleOn,reviseRoutine} from '../dist/calendar-core.js';
assert(validDate('2024-02-29'));assert(!validDate('2025-02-29'));assert(!validDate('2026-04-31'));assert(!validDate('0000-01-01'));assert(!validDate('2026-1-01'));
assert.equal(dateKey(dateObject('0099-01-02')),'0099-01-02');
assert.equal(shiftDate('2026-12-31',1),'2027-01-01');assert.equal(shiftMonth('2024-01-31',1),'2024-02-29');
for(const timezone of ['Asia/Seoul','America/Los_Angeles','Pacific/Kiritimati']){
  process.env.TZ=timezone;
  assert.equal(dateKey(dateObject('2026-10-26')),'2026-10-26');
  assert.equal(shiftDate('2026-03-08',1),'2026-03-09');
  assert.equal(shiftDate('2026-11-01',1),'2026-11-02');
}
assert.equal(lineCount('  \r\n# Heading\r\n- [x] Done\n\ntext that visually wraps\n'),3);
const rule={effectiveFrom:'2024-01-01',startDate:'2024-01-01',title:'Review',frequency:'monthly',monthDay:31,stopped:false};
const routine={id:'routine-1',revisions:[rule]};
assert(occursOn(routine,'2024-02-29'));assert(occursOn(routine,'2025-02-28'));assert(occursOn(routine,'2026-04-30'));assert(!occursOn(routine,'2026-04-29'));
assert(!occursOn(routine,'2023-12-31'));
const weekly={id:'weekly',revisions:[{...rule,frequency:'weekly',weekdays:[1,3]}]};
assert(occursOn(weekly,'2026-10-26'));assert(!occursOn(weekly,'2026-10-27'));assert(occursOn(weekly,'2026-10-28'));
const daily={id:'daily',revisions:[{...rule,frequency:'daily'}]};assert(occursOn(daily,'2026-10-27'));
reviseRoutine(routine,{...rule,title:'New review',monthDay:1},'2026-10-26');
assert(occursOn(routine,'2026-09-30'));assert.equal(ruleOn(routine,'2026-09-30').title,'Review');assert(!occursOn(routine,'2026-10-31'));assert(occursOn(routine,'2026-11-01'));
reviseRoutine(routine,{...rule,stopped:true},'2026-11-02');assert(occursOn(routine,'2026-11-01'));assert(!occursOn(routine,'2026-12-31'));
reviseRoutine(routine,{...rule,stopped:true},'2026-11-02');assert.equal(routine.revisions.length,3,'Same-day edits replace the same revision');
const data=normalizeCalendar({scheduledByDate:{'2026-10-27':'\n','2026-10-26':'- [ ] Work'},routines:[routine],routineCompletions:{'routine-1':{'2026-11-01':true}}});
assert.deepEqual(Object.keys(data.scheduledByDate),['2026-10-26']);assert.equal(data.routineCompletions['routine-1']['2026-12-01'],undefined);
assert.deepEqual(normalizeCalendar({}),{scheduledByDate:{},routines:[],routineCompletions:{}});
for(const malformed of [
  {scheduledByDate:[]},{scheduledByDate:null},{scheduledByDate:{'2026-02-30':'Bad'}},{scheduledByDate:{'2026-01-01':3}},
  {routines:[{...routine,id:'__proto__'}]},{routines:[{...routine,id:'constructor'}]},{routines:[routine,routine]},
  {routines:[{id:'bad',revisions:[{...rule,frequency:'weekly',weekdays:[]}]}]},
  {routines:[{id:'bad',revisions:[{...rule,monthDay:32}]}]},
  {routines:[{id:'bad',revisions:[{...rule,title:''}]}]},
  {routines:[{id:'bad',revisions:[rule,rule]}]},
  {routineCompletions:{unknown:{'2026-01-01':true}}},
  {routines:[routine],routineCompletions:{'routine-1':{'2026-02-30':true}}},
])assert.throws(()=>normalizeCalendar(malformed));
console.log('Passed calendar dates/timezones, line counts, recurrence, short months, effective history, completion independence, and backup validation.');
