import path from 'path';
import fs from 'fs/promises';
import { getPrivateSignaturePath } from '@/lib/mediaStorage';

// Resolves a relative URL path to a safe absolute path within public/ or private-uploads/signatures/.
// Prevents path traversal attacks by ensuring the resolved path stays inside the intended directory.
export function safePublicPath(relativePath: string): string | null {
  const publicDir = path.join(process.cwd(), 'public');
  const resolved = path.resolve(publicDir, relativePath.replace(/^\/+/, ''));
  if (!resolved.startsWith(publicDir + path.sep) && resolved !== publicDir) {
    return null; // Path traversal attempt
  }
  return resolved;
}

export function safeMediaPath(relativePath: string): string | null {
  if (relativePath.startsWith('/api/media/')) {
    return getPrivateSignaturePath(relativePath);
  }
  return safePublicPath(relativePath);
}

// Helper to sanitize filenames according to German spelling and avoid encoding issues in HTTP headers
export function sanitizeFilenamePart(text: string): string {
  return text
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_');
}

export function getSalutation(firstName: string, lastName: string, gender?: string | null): { salutation: string; honorific: string } {
  let isFemale: boolean;
  
  if (gender === 'FEMALE') {
    isFemale = true;
  } else if (gender === 'MALE') {
    isFemale = false;
  } else if (gender === 'DIVERSE') {
    // Diverse: use neutral form without Herr/Frau
    return { salutation: `Sehr geehrte/r ${firstName} ${lastName},`, honorific: '' };
  } else {
    // Fallback heuristic when gender is not set
    const fLower = firstName.toLowerCase();
    const femaleNames = [
      'anna', 'julia', 'sabine', 'lisa', 'maria', 'petra', 'tanja', 'sarah', 'laura', 
      'melanie', 'christina', 'karen', 'karin', 'monika', 'ursula', 'nicole', 
      'daniela', 'heike', 'susanne', 'brigitte', 'claudia', 'angelika', 'barbara', 
      'gabriele', 'elisabeth', 'renate', 'ingrid', 'gisela', 'helga', 'hannelore',
      'tamara', 'frauke', 'antje', 'katrin', 'stefanie', 'steffi', 'christiane',
      'anja', 'kathrin', 'ulrike', 'verena', 'sandra', 'nadine', 'sonja'
    ];
    isFemale = femaleNames.includes(fLower) || 
               (fLower.endsWith('a') && !['luca', 'mika', 'mustafa'].includes(fLower)) || 
               (fLower.endsWith('e') && !['rene', 'uwe', 'pepe', 'basti'].includes(fLower));
  }
  
  if (isFemale) {
    return { salutation: `Sehr geehrte Frau ${lastName},`, honorific: 'Frau' };
  } else {
    return { salutation: `Sehr geehrter Herr ${lastName},`, honorific: 'Herrn' };
  }
}

export function getImageRatioFromBuffer(buffer: Buffer): number {
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504E47 && buffer.readUInt32BE(4) === 0x0D0A1A0A) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (height > 0) return width / height;
  }
  if (buffer.length >= 2 && buffer.readUInt16BE(0) === 0xFFD8) {
    let offset = 2;
    while (offset + 4 < buffer.length) {
      const marker = buffer.readUInt16BE(offset);
      offset += 2;
      if (marker === 0xFFC0 || marker === 0xFFC2) {
        if (offset + 7 <= buffer.length) {
          const height = buffer.readUInt16BE(offset + 3);
          const width = buffer.readUInt16BE(offset + 5);
          if (height > 0) return width / height;
        }
        break;
      }
      if (offset + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(offset);
      if (length < 2) break;
      offset += length;
    }
  }
  return 1;
}

export function getPdfImageFormatFromBuffer(buffer: Buffer): 'PNG' | 'JPEG' {
  if (buffer.length >= 8 && buffer.readUInt32BE(0) === 0x89504E47 && buffer.readUInt32BE(4) === 0x0D0A1A0A) return 'PNG';
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'JPEG';
  throw new Error('Nicht unterstütztes Bildformat für PDF. Erlaubt sind PNG und JPEG.');
}

export async function getImageRatio(filePath: string): Promise<number> {
  try {
    const buffer = await fs.readFile(filePath);
    return getImageRatioFromBuffer(buffer);
  } catch (e) {
    console.error('Failed to parse image ratio:', e);
    return 1.0;
  }
}

export async function getPdfImageFormat(filePath: string): Promise<'PNG' | 'JPEG'> {
  const buffer = await fs.readFile(filePath);
  return getPdfImageFormatFromBuffer(buffer);
}
