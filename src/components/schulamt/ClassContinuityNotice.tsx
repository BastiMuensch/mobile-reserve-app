import { classContinuityLabel, type ClassContinuity } from '@/lib/classContinuity';

export function ClassContinuityNotice({ continuity }: { continuity?: ClassContinuity }) {
  if (!continuity) return null;
  const format = (key: string) => new Date(key).toLocaleDateString('de-DE', { timeZone: 'UTC' });
  return <p className={`mt-2 text-xs ${continuity.days ? 'font-medium text-primary' : 'text-muted-foreground'}`}>
    {continuity.days > 0 ? classContinuityLabel(continuity) : 'Keine passenden Einsätze in der Vorwoche erfasst.'}
    <span className="block font-normal text-muted-foreground">{format(continuity.weekStart)}–{format(continuity.weekEnd)}{continuity.bonus > 0 ? ' · Bei der Empfehlung berücksichtigt' : ''}</span>
  </p>;
}
