/**
 * Der Standard-Seed bleibt absichtlich leer: Eine neue Installation muss durch den
 * geschützten Einrichtungsdialog gehen und darf keine echten Behörden-, Schul- oder
 * Personendaten mitbringen. Explizite Demo-Daten liegen getrennt in seed-musterstadt.ts.
 */
async function main() {
  console.log('Keine Standarddaten angelegt. Bitte die Ersteinrichtung im Browser abschließen.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
