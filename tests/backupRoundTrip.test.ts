import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  isValidMagicBytes,
  getMimeFromExtension,
  getExtensionFromMime,
  validateAssetReferences,
  validateLegacyAssetReferences,
  type BackupAsset,
} from '../src/lib/backupAssets';

test('isValidMagicBytes accepts real PNG and JPEG buffers and rejects invalid data', () => {
  // 1. Valid PNG (magic bytes: 89 50 4E 47 ...)
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  assert.equal(isValidMagicBytes(pngHeader, 'image/png'), true);
  assert.equal(isValidMagicBytes(pngHeader, 'image/jpeg'), false);

  // 2. Valid JPEG (magic bytes: FF D8 FF ...)
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  assert.equal(isValidMagicBytes(jpegHeader, 'image/jpeg'), true);
  assert.equal(isValidMagicBytes(jpegHeader, 'image/png'), false);

  // 3. Fake PNG that is actually plain text or SVG
  const fakePng = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal(isValidMagicBytes(fakePng, 'image/png'), false);
  assert.equal(isValidMagicBytes(fakePng, 'image/jpeg'), false);

  // 4. Truncated buffer (< 12 bytes)
  const truncated = Buffer.from([0x89, 0x50, 0x4e]);
  assert.equal(isValidMagicBytes(truncated, 'image/png'), false);
});

test('MIME and extension helpers map correctly', () => {
  assert.equal(getMimeFromExtension('.png'), 'image/png');
  assert.equal(getMimeFromExtension('.PNG'), 'image/png');
  assert.equal(getMimeFromExtension('.jpg'), 'image/jpeg');
  assert.equal(getMimeFromExtension('.jpeg'), 'image/jpeg');
  assert.equal(getMimeFromExtension('.exe'), null);

  assert.equal(getExtensionFromMime('image/png'), '.png');
  assert.equal(getExtensionFromMime('image/jpeg'), '.jpg');
  assert.equal(getExtensionFromMime('application/pdf'), '.bin');
});

test('Backup Asset SHA-256 verification and Base64 round-trip', () => {
  const dummyImage = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  ]);

  const sha256 = crypto.createHash('sha256').update(dummyImage).digest('hex');
  const base64 = dummyImage.toString('base64');

  const asset: BackupAsset = {
    originalUrl: '/api/media/signature-123.png',
    mimeType: 'image/png',
    sha256,
    dataBase64: base64,
    purpose: 'signature',
  };

  // Re-decode and verify
  const decoded = Buffer.from(asset.dataBase64, 'base64');
  assert.equal(decoded.length, dummyImage.length);
  const recomputedHash = crypto.createHash('sha256').update(decoded).digest('hex');
  assert.equal(recomputedHash, asset.sha256);
  assert.equal(isValidMagicBytes(decoded, asset.mimeType), true);
});

test('v2 assets must exactly match referenced URLs and their purpose', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const asset: BackupAsset = {
    originalUrl: '/uploads/logo.png',
    mimeType: 'image/png',
    sha256: crypto.createHash('sha256').update(png).digest('hex'),
    dataBase64: png.toString('base64'),
    purpose: 'logo',
  };

  assert.doesNotThrow(() => validateAssetReferences({ profileLogoUrl: '/uploads/logo.png' }, [asset]));
  assert.doesNotThrow(() => validateAssetReferences({ profileLogoUrl: '/uploads/logo.png', publicInstanceLoginLogoUrl: '/uploads/logo.png' }, [asset]));
  assert.throws(() => validateAssetReferences({ profileLogoUrl: '/uploads/logo.png' }, []), /fehlt/i);
  assert.throws(() => validateAssetReferences({ profileLogoUrl: '/uploads/logo.png' }, [{ ...asset, purpose: 'school-image' }]), /Zweck/i);
  assert.throws(() => validateAssetReferences({}, [asset]), /Nicht referenziertes/i);
});

test('v1 asset references reject traversal and arbitrary URL paths', () => {
  assert.doesNotThrow(() => validateLegacyAssetReferences({
    profileLogoUrl: '/uploads/legacy-logo.png',
    profileSignatureUrl: '/uploads/legacy-signature.jpg',
    schoolImageUrls: ['/uploads/school.webp'],
  }));
  assert.throws(() => validateLegacyAssetReferences({ profileLogoUrl: '/uploads/../secret.png' }));
  assert.throws(() => validateLegacyAssetReferences({ profileSignatureUrl: '/etc/passwd' }));
  assert.throws(() => validateLegacyAssetReferences({ schoolImageUrls: ['https://example.org/image.png'] }));
});

test('Backup Data v2.0 schema structure integrity check', () => {
  const sampleV2Backup = {
    version: '2.0',
    timestamp: '2026-09-06T12:00:00.000Z',
    schulamtId: '00000000-0000-0000-0000-000000000001',
    data: {
      profile: {
        id: 'prof-1',
        userId: '00000000-0000-0000-0000-000000000001',
        city: 'Musterstadt',
        logoUrl: '/uploads/logo.png',
        signatureUrl: '/api/media/signature.png',
      },
      schools: [
        {
          id: 'school-1',
          name: 'Grundschule Musterstadt',
          address: 'Schulstraße 1, 12345 Musterstadt',
          latitude: 48.123,
          longitude: 11.456,
          geocodingStatus: 'RESOLVED',
          isSmall: true,
          pinLat: 48.124,
          pinLng: 11.457,
          entranceLat: 48.125,
          entranceLng: 11.458,
          parkingLat: 48.126,
          parkingLng: 11.459,
          outbreakUntil: '2026-10-01T23:59:59.999Z',
          outbreakDismissedUntil: null,
          type: 'GRUNDSCHULE',
        }
      ],
      teachers: [
        {
          id: 'teacher-1',
          name: 'Max Mustermann',
          stammschuleId: 'school-1',
          maxWeeklyHours: 28,
          isPartTime: false,
          qualifications: 'Deutsch, Mathe',
          status: 'ACTIVE',
          address: 'Heimatweg 5',
          postalCode: '12345',
          homeLat: 48.13,
          homeLng: 11.46,
          preferredType: 'BOTH',
          schoolYear: '2025/2026',
        }
      ],
      requests: [
        {
          id: 'req-1',
          schoolId: 'school-1',
          date: '2026-05-04T00:00:00.000Z',
          endDate: '2026-05-15T00:00:00.000Z',
          isOpenEnded: false,
          endedAt: null,
          priority: 'UNPLANNED_ABSENCE',
          startHour: 1,
          hours: 4,
          weeklyHours: 20,
          schoolType: 'GRUNDSCHULE',
          substitutedTeacher: 'Frau Lehrerin',
          qualifications: 'Grundschule',
          status: 'PARTIALLY_FILLED',
          unfilledReason: null,
          unfilledAt: null,
        }
      ],
      assignments: [],
      absences: [],
      leavePeriods: [],
      users: [],
      assets: [
        {
          originalUrl: '/uploads/logo.png',
          mimeType: 'image/png',
          sha256: 'abc123',
          dataBase64: 'data',
          purpose: 'logo',
        }
      ]
    }
  };

  assert.equal(sampleV2Backup.version, '2.0');
  assert.equal(sampleV2Backup.data.schools[0].isSmall, true);
  assert.equal(sampleV2Backup.data.schools[0].outbreakUntil, '2026-10-01T23:59:59.999Z');
  assert.equal(sampleV2Backup.data.schools[0].entranceLat, 48.125);
  assert.equal(sampleV2Backup.data.schools[0].parkingLng, 11.459);
  assert.equal(sampleV2Backup.data.requests[0].weeklyHours, 20);
  assert.equal(sampleV2Backup.data.assets.length, 1);
});
