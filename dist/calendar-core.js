// Calendar dates are local civil dates, never UTC timestamps.
export function dateKey(date = new Date()) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function dateObject(key) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(2000, month - 1, day, 12);
  date.setFullYear(year);
  return date;
}
export function validDate(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key) || key.slice(0, 4) === '0000') return false;
  return dateKey(dateObject(key)) === key;
}
export function shiftDate(key, days) {
  const date = dateObject(key); date.setDate(date.getDate() + days); return dateKey(date);
}
export function shiftMonth(key, months) {
  const date = dateObject(key), day = date.getDate();
  date.setDate(1); date.setMonth(date.getMonth() + months);
  const last = new Date(date.getTime()); last.setMonth(last.getMonth() + 1, 0);
  date.setDate(Math.min(day, last.getDate())); return dateKey(date);
}
export function lineCount(text = '') { return text.split(/\r?\n/).filter(line => line.trim()).length; }
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const requireValid = condition => { if (!condition) throw new Error('This backup contains invalid calendar data.'); };
export function normalizeCalendar(notes) {
  const scheduled = notes.scheduledByDate === undefined ? {} : notes.scheduledByDate;
  const routines = notes.routines === undefined ? [] : notes.routines;
  const completions = notes.routineCompletions === undefined ? {} : notes.routineCompletions;
  requireValid(record(scheduled) && Array.isArray(routines) && record(completions));
  const scheduledByDate = {};
  for (const key of Object.keys(scheduled).sort()) {
    requireValid(validDate(key) && typeof scheduled[key] === 'string');
    if (scheduled[key].trim()) scheduledByDate[key] = scheduled[key];
  }
  const ids = new Set();
  for (const routine of routines) {
    requireValid(record(routine) && typeof routine.id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(routine.id) && !Object.hasOwn(Object.prototype, routine.id) && !ids.has(routine.id));
    ids.add(routine.id);
    requireValid(Array.isArray(routine.revisions) && routine.revisions.length > 0);
    let previous = '';
    for (const rule of routine.revisions) {
      requireValid(record(rule) && validDate(rule.effectiveFrom) && rule.effectiveFrom > previous && validDate(rule.startDate));
      previous = rule.effectiveFrom;
      requireValid(typeof rule.title === 'string' && rule.title.trim().length > 0 && rule.title.length <= 500 && typeof rule.stopped === 'boolean');
      requireValid(['daily', 'weekly', 'monthly'].includes(rule.frequency));
      if (rule.frequency === 'weekly') requireValid(Array.isArray(rule.weekdays) && rule.weekdays.length > 0 && rule.weekdays.length <= 7 && new Set(rule.weekdays).size === rule.weekdays.length && rule.weekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6));
      if (rule.frequency === 'monthly') requireValid(Number.isInteger(rule.monthDay) && rule.monthDay >= 1 && rule.monthDay <= 31);
    }
  }
  const routineCompletions = {};
  for (const id of Object.keys(completions).sort()) {
    requireValid(ids.has(id) && record(completions[id]));
    const dates = {};
    for (const date of Object.keys(completions[id]).sort()) {
      requireValid(validDate(date) && completions[id][date] === true); dates[date] = true;
    }
    if (Object.keys(dates).length) routineCompletions[id] = dates;
  }
  return { scheduledByDate, routines: JSON.parse(JSON.stringify(routines)), routineCompletions };
}
export function ruleOn(routine, date) {
  return routine.revisions.filter(rule => rule.effectiveFrom <= date).at(-1);
}
export function occursOn(routine, date) {
  const rule = ruleOn(routine, date);
  if (!rule || rule.stopped || date < rule.startDate) return false;
  const day = dateObject(date);
  if (rule.frequency === 'daily') return true;
  if (rule.frequency === 'weekly') return rule.weekdays.includes(day.getDay());
  const last = new Date(day.getTime()); last.setMonth(last.getMonth() + 1, 0);
  return day.getDate() === Math.min(rule.monthDay, last.getDate());
}
export function reviseRoutine(routine, rule, today) {
  routine.revisions = routine.revisions.filter(version => version.effectiveFrom < today);
  routine.revisions.push({ ...rule, effectiveFrom: today });
}
