import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUnfilledEmail, buildReopenedEmail, requestEmailDetails } from '../src/lib/requestEmail';
import { renderEmailHtml } from '../src/lib/emailTemplate';

const request = {
  id: '4fd3aca7-819b-4361-89d8-35b656254b00', substitutedTeacher: 'Anna Beispiel', className: '3b',
  school: { name: 'Grundschule am Park' }, location: { name: 'Außenstelle West' },
  date: new Date('2026-11-09'), endDate: new Date('2026-11-13'),
  urgencyNote: 'Interner Dringlichkeitsvermerk', comments: 'Vertrauliche Zusatzinformation',
};

test('single-day refusals distinguish concurrent requests, including the same teacher and date', () => {
  const day = [{ date: '2026-11-10', hours: 3 }];
  const first = buildUnfilledEmail(request, day, 'Keine Reserve verfügbar.');
  const second = buildUnfilledEmail({ ...request, id: 'another-request', substitutedTeacher: 'Ben Beispiel', className: '4a' }, day);
  const third = buildUnfilledEmail({ ...request, id: 'same-teacher-other-request' }, day);
  assert.match(first.subject, /Anna Beispiel · Klasse 3b · 10\.11\.2026/);
  assert.notEqual(first.subject, second.subject);
  assert.notEqual(first.body, third.body, 'full request ID distinguishes otherwise identical requests');
  for (const value of [request.id, 'Anna Beispiel', '3b', 'Grundschule am Park · Außenstelle West', '9.11.2026 – 13.11.2026', '10.11.2026: 3 Stunde(n) unbesetzt']) {
    assert.ok(first.body.includes(value), value);
    assert.ok(renderEmailHtml(first.subject, first.body).includes(value), value);
  }
  assert.match(first.body, /ausschließlich für diesen Tag/);
  assert.doesNotMatch(first.body, /Interner Dringlichkeitsvermerk|Vertrauliche Zusatzinformation/);
});

test('multi-day refusals list only selected dates with their remaining hours', () => {
  const mail = buildUnfilledEmail(request, [{ date: '2026-11-13', hours: 2 }, { date: '2026-11-09', hours: 5 }]);
  assert.match(mail.body, /- 9\.11\.2026: 5 Stunde\(n\) unbesetzt\n- 13\.11\.2026: 2 Stunde\(n\) unbesetzt/);
  assert.doesNotMatch(mail.body, /- 10\.11\.2026|Begründung:/);
  assert.match(mail.body, /ausschließlich für die aufgeführten Tage/);
  assert.match(mail.body, /Bereits zugewiesene Einsätze bleiben bestehen/);
  assert.throws(() => buildUnfilledEmail(request, []));
});

test('reopening and missing optional data preserve request identity and scope', () => {
  const ongoing = { ...request, endDate: null, isOpenEnded: true, className: null, location: null };
  const details = requestEmailDetails(ongoing);
  assert.match(details, /9\.11\.2026 bis auf Weiteres/);
  assert.doesNotMatch(details, /Klasse:|Außenstelle|null|undefined/);
  const oneDay = buildReopenedEmail(ongoing, '2026-11-10');
  assert.match(oneDay.body, /Wieder offener Zeitraum: 10\.11\.2026/);
  assert.match(oneDay.body, /noch keine Zusage/);
  assert.ok(oneDay.body.includes(request.id));
  assert.match(buildReopenedEmail(ongoing).subject, /bis auf Weiteres/);
  assert.match(buildUnfilledEmail({ ...ongoing, substitutedTeacher: '' }, [{ date: '2026-11-10', hours: 2 }]).subject, /Lehrkraft nicht angegeben/);
});

test('HTML rendering escapes every input context and keeps legacy paragraphs and safe URLs readable', () => {
  const html = renderEmailHtml('<img src=x onerror=alert(1)>', 'Hallo <script>alert(1)</script>\r\n\r\nHinweise:\nRaum: <b>3 & 4</b>\n- <svg onload=alert(1)>\n\nhttps://example.invalid/reset?token=a&next=b\n\njavascript:alert(1)\n\nFreier Text\nWeitere Zeile');
  assert.doesNotMatch(html, /<script|<img|<svg|<b>|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;b&gt;3 &amp; 4&lt;\/b&gt;/);
  assert.match(html, /href="https:\/\/example.invalid\/reset\?token=a&amp;next=b"/);
  assert.match(html, /Freier Text<br>Weitere Zeile/);
  assert.match(html, /lang="de"/);
  assert.doesNotMatch(html, /<link|<script|<img/);
});
