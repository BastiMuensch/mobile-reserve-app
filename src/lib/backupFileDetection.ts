// Browser-only format recognition. Full integrity/schema checks still happen
// in the authenticated server import or the offline restore tool.
const MAGIC = 'MRBACKUP1';
const MAX_ARCHIVE_BYTES = 192 * 1024 * 1024 + 1024;
const MAX_JSON_BYTES = 50 * 1024 * 1024;

export type BackupFileKind = 'full' | 'legacy';

export async function detectBackupFile(file: Blob): Promise<BackupFileKind> {
  if (!file.size || file.size > MAX_ARCHIVE_BYTES) throw new Error('Die Datei ist leer oder zu groß für eine unterstützte Sicherung.');
  const header = await file.slice(0, MAGIC.length).text();
  if (header === MAGIC) {
    if (file.size < MAGIC.length + 16 + 12 + 16 + 1) throw new Error('Die Vollbackup-Datei ist unvollständig.');
    return 'full';
  }
  if (file.size > MAX_JSON_BYTES) throw new Error('Die Datei ist kein unterstütztes Vollbackup oder überschreitet die Größe für ältere Sicherungen.');
  let value: unknown;
  try { value = JSON.parse(await file.text()); }
  catch { throw new Error('Die Datei wurde nicht als Sicherung erkannt. Bitte eine unveränderte Backupdatei auswählen.'); }
  if (!value || typeof value !== 'object' || !('version' in value) || !['1.0', '2.0'].includes(String(value.version)) ||
    !('data' in value) || !value.data || typeof value.data !== 'object' || Array.isArray(value.data)) {
    throw new Error('Diese Datei enthält kein unterstütztes Backup.');
  }
  return 'legacy';
}
