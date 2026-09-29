import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { QUALIFICATION_TYPES, isCurrentQualificationType, qualificationDetailLabels, teacherQualificationFields, storedQualificationTypeSchema } from '../src/lib/teacherQualifications';
import { teacherSelfProfileSchema } from '../src/lib/teacherSelfProfile';

const schema = z.object(teacherQualificationFields);

test('qualification requires an explicit status and an actual yes/no answer', () => {
  for (const qualificationType of ['TEACHER_GS', 'TEACHER_MS', 'SPECIALIST', 'SUPPORT']) {
    for (const canTeachSports of [true, false]) {
      assert.deepEqual(schema.parse({ qualificationType, canTeachSports }), { qualificationType, canTeachSports });
    }
  }
  for (const canTeachSports of [undefined, null, '', 'false', 0, 1]) {
    assert.equal(schema.safeParse({ qualificationType: 'TEACHER_MS', canTeachSports }).success, false);
  }
  for (const qualificationType of [undefined, null, '', 'Alles', 'ADMIN', 'TEACHER', 'STUDENT']) {
    assert.equal(schema.safeParse({ qualificationType, canTeachSports: true }).success, false);
  }
});

test('legacy generic teacher status can be restored but must be completed when editing', () => {
  assert.equal(storedQualificationTypeSchema.parse('TEACHER'), 'TEACHER');
  assert.match(qualificationDetailLabels({ qualificationType: 'TEACHER' })[0], /Schulart noch nicht angegeben/);
  assert.deepEqual(qualificationDetailLabels({ qualificationType: 'TEACHER_MS', canTeachSports: true }), ['Qualifikationsstatus: Lehrkraft – MS', 'Sport unterrichten: Ja']);
});

test('existing unknown qualifications are displayed differently from Sport: Nein', () => {
  assert.deepEqual(qualificationDetailLabels({}), ['Qualifikationsstatus: Noch nicht angegeben', 'Sport unterrichten: Noch nicht angegeben']);
  assert.deepEqual(qualificationDetailLabels({ qualificationType: 'SPECIALIST', canTeachSports: false }), ['Qualifikationsstatus: Fachlehrkraft', 'Sport unterrichten: Nein']);
});

test('self profile cannot be saved without completing both new fields', () => {
  const contact = { address: 'Musterstraße 12', postalCode: '80331', homeLat: 48, homeLng: 11 };
  assert.equal(teacherSelfProfileSchema.safeParse(contact).success, false);
  assert.equal(teacherSelfProfileSchema.safeParse({ ...contact, qualificationType: 'SUPPORT' }).success, false);
  assert.equal(teacherSelfProfileSchema.safeParse({ ...contact, qualificationType: 'SUPPORT', canTeachSports: false }).success, true);
});

test('only current choices are selectable; old student values remain readable and restorable', () => {
  assert.deepEqual(Object.values(QUALIFICATION_TYPES), ['Lehrkraft – GS', 'Lehrkraft – MS', 'Fachlehrkraft', 'Arbeitsvertrag']);
  for (const value of Object.keys(QUALIFICATION_TYPES)) assert.equal(isCurrentQualificationType(value), true);
  for (const value of ['STUDENT', 'TEACHER', null, undefined, 'toString']) assert.equal(isCurrentQualificationType(value), false);
  assert.equal(storedQualificationTypeSchema.parse('STUDENT'), 'STUDENT');
  assert.deepEqual(qualificationDetailLabels({ qualificationType: 'STUDENT', canTeachSports: true }), ['Qualifikationsstatus: Student/in (bisherige Angabe; bitte neu wählen)', 'Sport unterrichten: Ja']);
});
