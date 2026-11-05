import { School } from 'lucide-react';

interface ReserveSchoolInfoProps {
  teacher: { stammschule?: { name?: string } | null; schoolDistrict?: string | null };
  showDistrict?: boolean;
  className?: string;
}

/** One quiet line for affiliation; the district is the reserve's own entry. */
export function ReserveSchoolInfo({ teacher, showDistrict = false, className = '' }: ReserveSchoolInfoProps) {
  const school = teacher.stammschule?.name?.trim();
  const district = showDistrict ? teacher.schoolDistrict?.trim() : undefined;
  if (!school && !district) return null;

  return <p className={`flex min-w-0 items-start gap-1.5 text-xs leading-relaxed text-muted-foreground ${className}`}>
    <School aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
    <span className="min-w-0 [overflow-wrap:anywhere]">
      {school && <>Stammschule: {school}</>}
      {school && district && <span aria-hidden="true"> · </span>}
      {district && <>Bezirk: {district}</>}
    </span>
  </p>;
}
