import { qualificationDetailLabels, type TeacherQualificationDetails as Details } from '@/lib/teacherQualifications';

export function TeacherQualificationDetails({ teacher }: { teacher: Details }) {
  return <div className="my-2 space-y-1 text-xs text-muted-foreground">
    {qualificationDetailLabels(teacher).map(label => <p key={label}>{label}</p>)}
  </div>;
}
