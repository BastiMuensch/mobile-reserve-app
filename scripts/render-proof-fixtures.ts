import fs from 'node:fs/promises';
import path from 'node:path';
import { createDeploymentProof, type DeploymentProofInput } from '../src/lib/deploymentProof';

// Synthetic data only; exercises the same renderer as the authenticated endpoint.
const target = path.resolve('output/ui-audit/pdf');
const base: DeploymentProofInput = {
  teacher: { name: 'Alexandra Beispiel', gender: 'FEMALE', address: 'Musterweg 12, 81234 Beispielstadt', stammschule: { name: 'Grundschule Beispielberg', address: 'Schulstraße 2, 81234 Beispielstadt' } },
  school: { name: 'Mittelschule Musterpark', address: 'Parkweg 7, 81234 Beispielstadt' },
  profile: { headerText: 'Staatliches Schulamt\nBeispielstadt', returnAddress: 'Schulamt Beispielstadt · Behördenweg 1 · 81234 Beispielstadt', contactAddress: 'Behördenweg 1\n81234 Beispielstadt', contactPerson: 'Sachbearbeitung Mobile Reserve\nTelefon: 01234 56789', city: 'Beispielstadt', documentSubject: 'Bestätigung des Einsatzes als Mobile Reserve', documentIntro: 'hiermit bestätigen wir Ihren Einsatz als Mobile Reserve an der nachfolgend genannten Schule.', documentClosing: 'Mit freundlichen Grüßen', amtsleitungName: 'Andrea Muster', amtsleitungTitle: 'Schulamtsdirektorin', logoUrl: '/logo_transparent.png', signatureUrl: null },
  assignments: [{ id: 'one', date: '2026-09-07', hours: 3, status: 'ACCEPTED' }],
  substitutedTeacher: 'Kim Beispiel', priority: 'UNPLANNED_ABSENCE', now: new Date('2026-09-07T12:00:00Z'),
};
async function main() {
await fs.mkdir(target, { recursive: true });
const fixtures = {
  single: base,
  series: { ...base, assignments: [...base.assignments, { id: 'two', date: '2026-09-08', hours: 5, status: 'ACCEPTED' }] },
  cancelled: { ...base, assignments: [{ ...base.assignments[0], status: 'REJECTED' }] },
  long: { ...base, profile: { ...base.profile, headerText: 'Staatliches Schulamt für die Grund- und Mittelschulen der großen Beispielregion mit ausführlicher Behördenbezeichnung', contactPerson: 'Kontakt und weitere Ansprechpartner\n'.repeat(24), documentIntro: 'Ein ausführlicher, individuell konfigurierter Einleitungstext zur Bestätigung des Einsatzes. '.repeat(12) }, school: { ...base.school, name: 'Staatliche Grund- und Mittelschule mit einem sehr langen Namen und zusätzlicher Schulbezeichnung am Beispielpark' } },
};
for (const [name, input] of Object.entries(fixtures)) {
  const doc = await createDeploymentProof(input);
  await fs.writeFile(path.join(target, `${name}.pdf`), Buffer.from(doc.output('arraybuffer')));
  console.log(`${name}: ${doc.getNumberOfPages()} page(s)`);
}
}
void main();
