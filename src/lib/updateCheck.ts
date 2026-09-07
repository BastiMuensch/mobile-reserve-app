import { z } from 'zod';
import packageJson from '../../package.json';

const RELEASE_REPOSITORY = 'BastiMuensch/mobile-reserve-app';
const RELEASE_API_URL = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;
const RELEASE_PAGE_URL = `https://github.com/${RELEASE_REPOSITORY}/releases/tag`;
const SUCCESS_CACHE_MS = 24 * 60 * 60 * 1000;
const FAILURE_CACHE_MS = 5 * 60 * 1000;
const MANUAL_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_RELEASE_NOTES_LENGTH = 12_000;

const releaseSchema = z.object({
  tag_name: z.string().min(1).max(80),
  name: z.string().max(200).nullable().optional(),
  body: z.string().max(MAX_RESPONSE_BYTES).nullable().optional(),
  published_at: z.string().max(80).refine(value => !Number.isNaN(Date.parse(value))),
  draft: z.boolean(),
  prerelease: z.boolean(),
});

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

export interface UpdateStatus {
  enabled: boolean;
  currentVersion: string;
  currentCommit: string | null;
  updateAvailable: boolean | null;
  latestVersion: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  checkedAt: string | null;
  lastSuccessfulCheckAt: string | null;
  checkFailed: boolean;
  noRelease: boolean;
}

type CachedStatus = { status: UpdateStatus; expiresAt: number };

let cachedStatus: CachedStatus | null = null;
let lastSuccessfulStatus: UpdateStatus | null = null;
let inFlightCheck: Promise<UpdateStatus> | null = null;
let lastAttemptAt = 0;

function updateChecksEnabled(): boolean {
  return !['0', 'false', 'off', 'no'].includes((process.env.UPDATE_CHECK_ENABLED || 'true').trim().toLowerCase());
}

function currentVersion(): string {
  return process.env.APP_VERSION?.trim() || packageJson.version;
}

function currentCommit(): string | null {
  const value = process.env.APP_COMMIT_SHA?.trim();
  return value && /^[a-f0-9]{7,40}$/i.test(value) ? value.slice(0, 12) : null;
}

export function parseSemVer(value: string): ParsedVersion | null {
  const match = value.trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/);
  if (!match) return null;

  const numericParts = [match[1], match[2], match[3]].map(Number);
  if (numericParts.some(part => !Number.isSafeInteger(part))) return null;

  const prerelease = match[4] ? match[4].split('.') : [];
  const build = match[5] ? match[5].split('.') : [];
  const validIdentifier = (part: string) => /^[0-9A-Za-z-]+$/.test(part);
  if (prerelease.some(part => !validIdentifier(part) || (/^\d+$/.test(part) && part.length > 1 && part.startsWith('0')))) return null;
  if (build.some(part => !validIdentifier(part))) return null;

  return {
    major: numericParts[0],
    minor: numericParts[1],
    patch: numericParts[2],
    prerelease,
  };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      if (leftPart.length !== rightPart.length) return leftPart.length > rightPart.length ? 1 : -1;
      return leftPart > rightPart ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

/** Returns a positive value when left is newer than right. */
export function compareSemVer(left: string, right: string): number | null {
  const parsedLeft = parseSemVer(left);
  const parsedRight = parseSemVer(right);
  if (!parsedLeft || !parsedRight) return null;

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (parsedLeft[key] !== parsedRight[key]) return parsedLeft[key] > parsedRight[key] ? 1 : -1;
  }
  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}

function baseStatus(): UpdateStatus {
  return {
    enabled: updateChecksEnabled(),
    currentVersion: currentVersion(),
    currentCommit: currentCommit(),
    updateAvailable: null,
    latestVersion: null,
    releaseName: null,
    releaseNotes: null,
    releaseUrl: null,
    publishedAt: null,
    checkedAt: null,
    lastSuccessfulCheckAt: null,
    checkFailed: false,
    noRelease: false,
  };
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) throw new Error('Unexpected content type');

  const announcedLength = Number(response.headers.get('content-length') || 0);
  if (announcedLength > MAX_RESPONSE_BYTES) throw new Error('Response too large');

  if (!response.body) throw new Error('Empty response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Response too large');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(text);
}

async function performUpdateCheck(): Promise<UpdateStatus> {
  const checkedAt = new Date().toISOString();
  const base = baseStatus();

  const response = await fetch(RELEASE_API_URL, {
    cache: 'no-store',
    redirect: 'error',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'MobileReserve-Update-Check',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 404) {
    return {
      ...base,
      updateAvailable: false,
      checkedAt,
      lastSuccessfulCheckAt: checkedAt,
      noRelease: true,
    };
  }
  if (!response.ok) throw new Error(`GitHub release check failed with ${response.status}`);

  const parsed = releaseSchema.safeParse(await readLimitedJson(response));
  if (!parsed.success || parsed.data.draft || parsed.data.prerelease) throw new Error('Invalid release response');

  const latestParsed = parseSemVer(parsed.data.tag_name);
  if (!latestParsed) throw new Error('Release tag is not semantic versioning');

  const latestVersion = parsed.data.tag_name.replace(/^v/, '');
  const comparison = compareSemVer(latestVersion, base.currentVersion);

  return {
    ...base,
    updateAvailable: comparison === null ? null : comparison > 0,
    latestVersion,
    releaseName: parsed.data.name?.trim() || `Version ${latestVersion}`,
    releaseNotes: parsed.data.body?.trim().slice(0, MAX_RELEASE_NOTES_LENGTH) || null,
    releaseUrl: `${RELEASE_PAGE_URL}/${encodeURIComponent(parsed.data.tag_name)}`,
    publishedAt: parsed.data.published_at,
    checkedAt,
    lastSuccessfulCheckAt: checkedAt,
    checkFailed: comparison === null,
    noRelease: false,
  };
}

async function refreshStatus(): Promise<UpdateStatus> {
  lastAttemptAt = Date.now();
  try {
    const status = await performUpdateCheck();
    lastSuccessfulStatus = status;
    cachedStatus = { status, expiresAt: Date.now() + SUCCESS_CACHE_MS };
    return status;
  } catch {
    const checkedAt = new Date().toISOString();
    const status: UpdateStatus = lastSuccessfulStatus
      ? { ...lastSuccessfulStatus, checkedAt, checkFailed: true }
      : { ...baseStatus(), checkedAt, checkFailed: true };
    cachedStatus = { status, expiresAt: Date.now() + FAILURE_CACHE_MS };
    return status;
  } finally {
    inFlightCheck = null;
  }
}

export async function getUpdateStatus(forceRefresh = false): Promise<UpdateStatus> {
  const base = baseStatus();
  if (!base.enabled) return base;

  const now = Date.now();
  if (inFlightCheck) return inFlightCheck;
  if (forceRefresh && cachedStatus && now - lastAttemptAt < MANUAL_REFRESH_MIN_INTERVAL_MS) return cachedStatus.status;
  if (!forceRefresh && cachedStatus && cachedStatus.expiresAt > now) return cachedStatus.status;

  inFlightCheck = refreshStatus();
  return inFlightCheck;
}
