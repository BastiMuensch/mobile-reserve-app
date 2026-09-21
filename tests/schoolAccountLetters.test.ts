import assert from 'node:assert/strict';
import test from 'node:test';
import { createSchoolAccountLetters } from '../src/lib/schoolAccountLetters';

test('school account letters create one A4 page per school and keep credentials out of the login URL', async () => {
  const pdf = await createSchoolAccountLetters({
    appUrl: 'https://portal.example.test',
    accounts: [
      { schoolName: 'Grundschule mit einem besonders langen Schulnamen', email: 'verwaltung+sehr-lange-adresse@example.test', initialPassword: 'A2b3C4d5E6f7G8h9' },
      { schoolName: 'Mittelschule Beispielstadt', email: 'schule@example.test', initialPassword: 'J7k8L9m2N3p4Q5r6' },
    ],
  });
  const source = Buffer.from(pdf).toString('latin1');
  assert.match(source, /^%PDF-/);
  assert.equal((source.match(/\/Type \/Page\b/g) ?? []).length, 2);
  assert.doesNotMatch(source, /A2b3C4d5E6f7G8h9/);
  assert.doesNotMatch(source, /portal\.example\.test\/?\?.*password/i);
});
