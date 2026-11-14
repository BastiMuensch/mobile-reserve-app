import test from 'node:test';
import assert from 'node:assert/strict';
import { schoolFreeReason } from '../src/lib/schoolCalendar';
import { getOpenRequestDays } from '../src/lib/requestDays';
import { getEffectiveRange, requiredLessonHoursForDay } from '../src/lib/matching';
import { approvedLessons, parseRequestChanges, lessonChangeSchema } from '../src/lib/requestChanges';
import { resolveAssignmentLessonHours } from '../src/lib/assignmentTiming';

test('Bavarian vacations include both boundaries, public holidays and repentance day', () => {
  for (const day of ['2026-11-02','2026-11-06','2026-11-18','2026-05-14','2026-12-24','2027-01-08','2027-02-08','2027-02-12','2030-09-09']) assert.ok(schoolFreeReason(day),day);
  for (const day of ['2026-11-09','2026-11-17','2026-11-19','2027-01-11','2027-02-15']) assert.equal(schoolFreeReason(day),null,day);
});
test('holiday-only ranges have no fallback assignment and open horizon counts teaching days', () => {
  assert.deepEqual(getOpenRequestDays({ date:'2026-11-18',hours:4 }),[]);
  assert.deepEqual(getOpenRequestDays({ date:'2026-11-02',endDate:'2026-11-06',hours:4 }),[]);
  const req={date:'2026-11-16',isOpenEnded:true,hours:4};
  assert.equal(getEffectiveRange(req,new Date('2026-11-16T12:00:00Z')).end.toISOString().slice(0,10),'2026-11-23');
  assert.deepEqual(getOpenRequestDays(req,[],new Date('2026-11-16T12:00:00Z')).map(d=>d.date),['2026-11-16','2026-11-17','2026-11-19','2026-11-20','2026-11-23']);
});
test('only approved day changes alter demand and immutable assignment slot creation', () => {
  const entry = {id:'123e4567-e89b-42d3-a456-426614174000',date:'2026-11-16',lessons:[2,3],createdAt:'2026-11-14T12:00:00.000Z',state:'PENDING'};
  const req={date:'2026-11-16',hours:4,startHour:1,lessonChanges:JSON.stringify([entry])};
  assert.equal(requiredLessonHoursForDay(req,req.date).length,4);
  req.lessonChanges=JSON.stringify([{...entry,state:'APPROVED'}]);
  assert.deepEqual(requiredLessonHoursForDay(req,req.date),[2,3]);
  assert.equal(getOpenRequestDays(req)[0].hours,2);
  assert.equal(resolveAssignmentLessonHours({request:req,date:req.date,teacher:{isPartTime:false},hours:2,existing:[]}),'[2,3]');
  assert.equal(approvedLessons(req.lessonChanges,'2026-11-17'),undefined);
  assert.throws(()=>parseRequestChanges('[{}]'));
  assert.equal(lessonChangeSchema.safeParse({date:'2026-11-16',lessons:[1,1]}).success,false);
});
