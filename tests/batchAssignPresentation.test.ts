import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BatchSchoolCard } from '@/components/schulamt/BatchAssignView';

const noop = () => {};
const row = {
  date: '2026-10-20', endDate: '2026-10-22', hours: 5, weeklyHours: 15, startHour: 2,
  priority: 'FORTBILDUNG', substitutedTeacher: 'Johanna Beispiel', qualifications: 'Grundschule',
  className: '3b', location: { name: 'Nebenstandort' }, status: 'PENDING',
  openDays: [{ date: '2026-10-20', hours: 5 }, { date: '2026-10-22', hours: 4 }],
};
const proposal = {
  requestId: 'proposed', segments: [{
    teacherId: 'reserve', teacherName: 'Alexandra Reserve', entries: [{ date: '2026-10-20', hours: 5 }],
    score: 5, reasons: [], alternatives: [],
  }], coverage: { assignedHours: 5, requiredHours: 9 }, urgency: { score: 1, reasons: [] },
};
const props: ComponentProps<typeof BatchSchoolCard> = {
  school: {
    schoolId: 'school', schoolName: 'Beispielschule',
    coverage: { filledRequests: 0, totalRequests: 2, assignedHours: 5, requiredHours: 18 },
    proposals: [proposal], unfillable: [{ requestId: 'unfillable', reason: 'Keine passende Lehrkraft verfügbar.' }],
  },
  requestsById: { proposed: row, unfillable: { ...row, substitutedTeacher: 'Max Nichtbesetzbar' } },
  selected: { proposed: true }, swaps: {}, conflictingSegmentKeys: new Set(), interactionLocked: false,
  onToggle: noop, onSwap: noop, onApprove: noop, isApproving: false, approvedInfo: undefined,
  openUnfillableId: null, unfillableDraft: '', unfillableScope: 'all', unfillingId: null,
  onOpenUnfillable: noop, onCancelUnfillable: noop, onDraftChange: noop, onScopeChange: noop, onSubmitUnfillable: noop,
};
const render = (override: Partial<typeof props> = {}) => renderToStaticMarkup(createElement(BatchSchoolCard, { ...props, ...override }));

test('unfillable requests identify the replaced teacher, open hours, class, qualification and reason', () => {
  const html = render().split('Nicht besetzbar (')[1];
  assert.match(html, /Zu vertreten: Max Nichtbesetzbar/);
  assert.match(html, /9 offene Std. im Vorschlagszeitraum/);
  assert.match(html, /Fortbildung/);
  assert.match(html, /5 Std.\/Tag/);
  assert.match(html, /ab 2. Std./);
  assert.match(html, /Nebenstandort/);
  assert.match(html, /Qualifikation<\/dt><dd[^>]*>Grundschule/);
  assert.match(html, /Klasse: 3b/);
  assert.match(html, /Keine passende Lehrkraft verfügbar/);
});

test('a manual refusal control appears only after deselecting a proposed requirement', () => {
  assert.equal((render().match(/Bedarf absagen/g) ?? []).length, 1, 'only the unfillable row offers refusal');
  assert.equal((render({ selected: { proposed: false } }).match(/Bedarf absagen/g) ?? []).length, 2);
});

test('weekly request details show daily lessons instead of the legacy start placeholder', () => {
  const html = render({
    requestsById: Object.fromEntries(Object.entries(props.requestsById).map(([id, request]) => [
      id, { ...request, startHour: 1, schedule: JSON.stringify({ '2': [3, 4], '4': [5, 6] }) },
    ])),
  });
  assert.match(html, /Di: 3., 4. Std. · Do: 5., 6. Std./);
  assert.doesNotMatch(html, /ab 1. Std./);
});

test('refusal form labels exact scope and disables every editing control while saving', () => {
  const html = render({
    selected: { proposed: false }, openUnfillableId: 'proposed', interactionLocked: true, unfillingId: 'proposed',
  });
  assert.match(html, /Alle offenen Tage im Vorschlagszeitraum \(2\)/);
  assert.match(html, /value=\"2026-10-22\"/);
  assert.match(html, /2 Tag\(e\) · 9 offene Std./);
  assert.match(html, /select[^>]*disabled/);
  assert.match(html, /textarea[^>]*disabled/);
  assert.match(html, /Wird gespeichert/);
});

test('rechecking a requirement removes its open refusal form', () => {
  const html = render({ openUnfillableId: 'proposed' });
  assert.doesNotMatch(html, /refusal-scope-proposed/);
});

test('school coverage includes unfillable demand and immediately reflects deselection', () => {
  const coverageText = (html: string) => html.match(/aria-label="Gesamtabdeckung der Schule"[^>]*>(.*?)<\/p>/)?.[1].replace(/<[^>]+>/g, '');
  assert.equal(coverageText(render()), '18 Std. Bedarf·5 Std. ausgewählt·13 Std. offen');
  assert.equal(coverageText(render({ selected: { proposed: false } })), '18 Std. Bedarf·0 Std. ausgewählt·18 Std. offen');
  const unchecked = render({ selected: { proposed: false } });
  assert.match(unchecked, /Nicht zur Freigabe ausgewählt/);
  assert.match(unchecked, /Es wurde keine Absage verschickt/);
  assert.match(unchecked, /<details[^>]*><summary[^>]*>Bisherigen Vorschlag ansehen/);
});

test('deliberately deferred requests remain actionable without being called unfillable', () => {
  const html = render({ excludedRequestIds: ['unfillable'], onReconsider: noop });
  assert.doesNotMatch(html, /Nicht besetzbar \(/);
  assert.match(html, /Zurückgestellt \(1\)/);
  assert.match(html, /Der Bedarf bleibt offen und wurde nicht abgesagt/);
  assert.match(html, /Wieder berücksichtigen/);
  assert.match(html, /Bedarf absagen/);
});
