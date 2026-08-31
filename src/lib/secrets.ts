import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';

function parseEncryptionKey(configured: string | undefined, variableName: string): Buffer {
  if (!configured) {
    throw new Error(`${variableName} ist nicht gesetzt.`);
  }

  const key = Buffer.from(configured, 'base64');
  if (key.length !== 32) {
    throw new Error(`${variableName} muss ein Base64-kodierter Schlüssel mit 32 Byte sein.`);
  }
  return key;
}

function getEncryptionKey(): Buffer {
  if (!process.env.SMTP_ENCRYPTION_KEY) {
    throw new Error('SMTP_ENCRYPTION_KEY ist nicht gesetzt. SMTP-Zugangsdaten werden nicht unverschlüsselt gespeichert.');
  }
  return parseEncryptionKey(process.env.SMTP_ENCRYPTION_KEY, 'SMTP_ENCRYPTION_KEY');
}

function decryptWithKey(value: string, key: Buffer): string {
  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Ungültiges verschlüsseltes SMTP-Secret.');

  const [iv, tag, ciphertext] = parts.map(part => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Verschlüsselt ein Secret mit AES-256-GCM. Der Schlüssel bleibt außerhalb der Datenbank. */
export function protectSecret(value: string): string {
  if (!value || value.startsWith(PREFIX)) return value;

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/** Entschlüsselt neue Werte; bestehende Klartextwerte bleiben für die Migration lesbar. */
export function revealSecret(value: string): string {
  if (!value.startsWith(PREFIX)) return value;

  try {
    return decryptWithKey(value, getEncryptionKey());
  } catch (currentKeyError) {
    const previous = process.env.SMTP_ENCRYPTION_KEY_PREVIOUS;
    if (!previous) throw currentKeyError;
    return decryptWithKey(value, parseEncryptionKey(previous, 'SMTP_ENCRYPTION_KEY_PREVIOUS'));
  }
}

/** Erkennt Klartext- und mit dem vorherigen Schlüssel geschützte Werte. */
export function secretNeedsReencryption(value: string): boolean {
  if (!value.startsWith(PREFIX)) return true;
  try {
    decryptWithKey(value, getEncryptionKey());
    return false;
  } catch {
    // revealSecret validiert, dass der Wert tatsächlich mit dem Übergangsschlüssel
    // entschlüsselt werden kann, bevor er mit dem aktuellen Schlüssel neu gespeichert wird.
    revealSecret(value);
    return true;
  }
}
