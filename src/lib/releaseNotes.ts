import { parseSemVer } from './updateCheck';

export type ReleaseAudience = 'SCHULAMT' | 'SCHOOL';

export interface ReleaseNotes {
  version: string;
  changes: Record<ReleaseAudience, readonly string[]>;
}

export interface ReleaseNotice {
  version: string;
  changes: readonly string[];
}

// Add an entry with every version bump. Keep SCHOOL empty when a release does
// not affect schools. These notes ship with the app and need no GitHub access.
export const RELEASE_NOTES: readonly ReleaseNotes[] = [
  {
    version: '0.1.28',
    changes: {
      SCHULAMT: [
        'Schulen können bei besonders dringenden Bedarfen eine Begründung für das Schulamt ergänzen. Sie ist in der Bedarfsübersicht und der Idealbesetzung sichtbar.',
        'Nach Updates informiert ein kurzer Hinweis über die neue Version und ihre Änderungen. Schulen erhalten nur für sie relevante Informationen.',
      ],
      SCHOOL: [
        'Bei besonders dringenden Bedarfen können Sie jetzt eine Begründung für das Schulamt ergänzen. Diese wird nicht an die Lehrkräfte weitergegeben.',
        'Nach Updates sehen Sie einmalig die neue Version und die Änderungen, die Ihre Schule betreffen.',
      ],
    },
  },
];

export function getReleaseNotice(
  installedVersion: string,
  role: string,
  releases: readonly ReleaseNotes[] = RELEASE_NOTES,
): ReleaseNotice | null {
  if (role !== 'SCHULAMT' && role !== 'SCHOOL') return null;
  const parsed = parseSemVer(installedVersion);
  if (!parsed) return null;
  // Development/prerelease images carry the same changes as their base version,
  // but display and acknowledge their actual installed version separately.
  const baseVersion = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  const release = releases.find(entry => entry.version === baseVersion);
  const changes = release?.changes[role];
  if (!changes?.length) return null;
  return { version: installedVersion.trim().replace(/^v/, ''), changes };
}

export function releaseSeenKey(userId: string, version: string): string {
  return `installed-release-seen:${userId}:${version}`;
}
