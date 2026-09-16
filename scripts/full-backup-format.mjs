// Shared by the server and the offline recovery tool. Only Node built-ins.
import { createCipheriv, createDecipheriv, randomBytes, scrypt, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';

export const MAX_PAYLOAD_BYTES = 192 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = MAX_PAYLOAD_BYTES + 1024;
const MAGIC = Buffer.from('MRBACKUP1');
const HEADER_BYTES = MAGIC.length + 16 + 12;
const derive = promisify(scrypt);
const zip = promisify(gzip), unzip = promisify(gunzip);
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function validateBackupPassword(password) {
  if (typeof password !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(password)) throw new Error('Invalid backup password format');
}

export async function encryptBackup(payload, password) {
  validateBackupPassword(password);
  const raw = Buffer.from(JSON.stringify(payload));
  if (raw.length > MAX_PAYLOAD_BYTES) throw new Error('Backup exceeds size limit');
  const compressed = await zip(raw);
  raw.fill(0);
  const salt = randomBytes(16), iv = randomBytes(12);
  const header = Buffer.concat([MAGIC, salt, iv]);
  const key = await derive(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    cipher.setAAD(header);
    return Buffer.concat([header, cipher.update(compressed), cipher.final(), cipher.getAuthTag()]);
  } finally { key.fill(0); compressed.fill(0); }
}

export async function decryptBackup(archive, password) {
  validateBackupPassword(password);
  if (!Buffer.isBuffer(archive) || archive.length < HEADER_BYTES + 17 || archive.length > MAX_ARCHIVE_BYTES || !archive.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Invalid backup format');
  const salt = archive.subarray(MAGIC.length, MAGIC.length + 16);
  const key = await derive(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  let compressed;
  try {
    const cipher = createDecipheriv('aes-256-gcm', key, archive.subarray(MAGIC.length + 16, HEADER_BYTES), { authTagLength: 16 });
    cipher.setAAD(archive.subarray(0, HEADER_BYTES));
    cipher.setAuthTag(archive.subarray(-16));
    // Never expose any plaintext before authentication succeeds.
    compressed = Buffer.concat([cipher.update(archive.subarray(HEADER_BYTES, -16)), cipher.final()]);
    const raw = await unzip(compressed, { maxOutputLength: MAX_PAYLOAD_BYTES });
    try { return JSON.parse(raw.toString('utf8')); } finally { raw.fill(0); }
  } catch { throw new Error('Backup could not be decrypted or is damaged'); }
  finally { key.fill(0); compressed?.fill(0); }
}

export function validateFilePath(name) {
  if (typeof name !== 'string' || name.length > 512 || /[\x00-\x1f\x7f\\:]/.test(name) || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe backup path');
  if (!/^(public-uploads|private-uploads|custom-signatures)\//.test(name)) throw new Error('Unknown backup root');
}

export function validatePayload(payload) {
  if (!payload || payload.format !== 'mobile-reserve-full-v1' || typeof payload.createdAt !== 'string' || !Number.isFinite(Date.parse(payload.createdAt))) throw new Error('Unsupported backup payload');
  if (!payload.environment || typeof payload.environment !== 'object' || Array.isArray(payload.environment) || Object.entries(payload.environment).some(([k,v]) => !/^[A-Z][A-Z0-9_]*$/.test(k) || typeof v !== 'string' || v.length > 16384 || /[\x00\r\n]/.test(v))) throw new Error('Invalid environment');
  if (!Array.isArray(payload.files) || payload.files.length > 10000) throw new Error('Invalid files');
  const paths = new Set();
  let bytes = 0;
  const decode = entry => {
    if (!entry || typeof entry.data !== 'string' || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid backup entry');
    const data = Buffer.from(entry.data, 'base64');
    if (data.toString('base64') !== entry.data || sha256(data) !== entry.sha256) throw new Error('Backup checksum mismatch');
    bytes += data.length;
    if (bytes > 128 * 1024 * 1024) throw new Error('Backup exceeds size limit');
    return data;
  };
  const database = decode(payload.database);
  if (!database.subarray(0, 5).equals(Buffer.from('PGDMP'))) throw new Error('Invalid PostgreSQL dump');
  const files = payload.files.map(file => {
    validateFilePath(file.path);
    if (paths.has(file.path)) throw new Error('Duplicate backup path');
    paths.add(file.path);
    return { path: file.path, data: decode(file) };
  });
  for (const file of files) {
    const parts = file.path.split('/');
    for (let i = 1; i < parts.length; i++) if (paths.has(parts.slice(0, i).join('/'))) throw new Error('Conflicting backup paths');
  }
  return { database, files };
}
