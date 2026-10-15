import test from 'node:test';
import assert from 'node:assert/strict';
import { profileSectionValues } from '../src/lib/profileSections';
import type { TemplateSettingsForm } from '../src/types/models';

const saved: TemplateSettingsForm = {
  headerText: 'Schulamt', returnAddress: 'Amtsweg 1', contactAddress: 'Amtsweg 1', contactPerson: 'Sekretariat', city: 'Musterstadt', amtsleitungName: 'Amtsleitung', amtsleitungTitle: 'Leitung',
  logoUrl: '', signatureUrl: '', documentSubject: 'Abordnung', documentIntro: 'Einleitung', documentLegalText: 'Vorgabe', documentClosing: 'Viele Grüße',
  mailProvider: 'SMTP', smtpHost: 'mail.example.test', smtpPass: '********', reserveShortageMode: false, requestUrgencyNoteEnabled: false,
};
const draft = { ...saved, headerText: 'Neuer Briefkopf', smtpHost: 'draft.example.test', smtpPass: 'unsaved', reserveShortageMode: true };

test('saving documents never submits unsaved notification or assignment changes', () => {
  const payload = profileSectionValues(draft, 'documents');
  assert.equal(payload.headerText, draft.headerText);
  assert.equal(payload.smtpHost, undefined);
  assert.equal(payload.smtpPass, undefined);
  assert.equal(payload.reserveShortageMode, undefined);
});
test('saving notifications preserves saved document and assignment values', () => {
  const payload = profileSectionValues(draft, 'notifications');
  assert.equal(payload.smtpHost, draft.smtpHost);
  assert.equal(payload.headerText, undefined);
  assert.equal(payload.reserveShortageMode, undefined);
});
test('assignment preferences do not include document contents or credentials', () => {
  assert.deepEqual(profileSectionValues(draft, 'assignment'), { requestUrgencyNoteEnabled: false, reserveShortageMode: true });
});
