import { deploymentSchoolName } from './schoolLocations';

export type EmailRequest = {
  id?: string;
  substitutedTeacher: string;
  className?: string | null;
  date?: Date | string;
  endDate?: Date | string | null;
  isOpenEnded?: boolean;
  school: { name: string };
  location?: { name: string } | null;
};

export function emailDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
}

export function requestEmailLabel(request: EmailRequest): string {
  return `${request.substitutedTeacher.trim() || 'Lehrkraft nicht angegeben'}${request.className?.trim() ? ` · Klasse ${request.className.trim()}` : ''}`.replace(/[\r\n]+/g, ' ');
}

/** Only explicitly selected operational fields; never includes urgency/absence notes. */
export function requestEmailDetails(request: EmailRequest): string {
  return [
    `Zu vertreten: ${request.substitutedTeacher.trim() || 'Nicht angegeben'}`,
    ...(request.className?.trim() ? [`Klasse: ${request.className.trim()}`] : []),
    `Schule / Standort: ${deploymentSchoolName(request)}`,
    ...(request.date ? [`Anforderungszeitraum: ${emailDate(request.date)}${request.endDate ? ` – ${emailDate(request.endDate)}` : request.isOpenEnded ? ' bis auf Weiteres' : ''}`] : []),
    ...(request.id ? [`Vorgangsnummer: ${request.id}`] : []),
  ].join('\n');
}

export function buildUnfilledEmail(
  request: EmailRequest,
  days: { date: string; hours: number }[],
  reason?: string | null,
): { subject: string; body: string } {
  if (!days.length) throw new Error('Eine Absage benötigt mindestens einen Einsatztag.');
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const singleDay = sorted.length === 1;
  const period = singleDay ? emailDate(sorted[0].date) : `${emailDate(sorted[0].date)} – ${emailDate(sorted[sorted.length - 1].date)}`;
  return {
    subject: `Keine Reserve verfügbar: ${requestEmailLabel(request)} · ${period}`,
    body: 'Für den folgenden Vertretungsbedarf konnte leider keine Mobile Reserve gestellt werden.\n\n'
      + `Betroffene Anforderung:\n${requestEmailDetails(request)}\n\n`
      + `Abgesagte Einsatztage:\n${sorted.map(day => `- ${emailDate(day.date)}: ${day.hours} Stunde(n) unbesetzt`).join('\n')}\n\n`
      + (reason?.trim() ? `Begründung:\n${reason.trim()}\n\n` : '')
      + 'Weitere Planung:\n'
      + `Die Absage gilt ausschließlich für ${singleDay ? 'diesen Tag' : 'die aufgeführten Tage'}. Weitere Einsatztage der Anforderung bleiben offen, soweit sie noch nicht besetzt sind. Bereits zugewiesene Einsätze bleiben bestehen.\n\n`
      + `Das Schulamt kann die Absage ${singleDay ? 'für diesen Tag' : 'für einzelne Tage'} zurücknehmen, falls eine Reserve verfügbar wird.`,
  };
}

export function buildReopenedEmail(request: EmailRequest, date?: string): { subject: string; body: string } {
  const range = date ? emailDate(date) : request.date ? `${emailDate(request.date)}${request.endDate ? ` – ${emailDate(request.endDate)}` : request.isOpenEnded ? ' bis auf Weiteres' : ''}` : 'gesamter Anforderungszeitraum';
  return {
    subject: `Anforderung wieder offen: ${requestEmailLabel(request)} · ${range}`,
    body: 'Das Schulamt hat die Absage für den folgenden Vertretungsbedarf zurückgenommen.\n\n'
      + `Betroffene Anforderung:\n${requestEmailDetails(request)}\n\n`
      + `Wieder offener Zeitraum: ${range}\n\n`
      + 'Der Bedarf wird wieder für eine Besetzung mit einer Mobilen Reserve berücksichtigt. Dies ist noch keine Zusage einer Vertretung.',
  };
}
