import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { AssignmentProofList } from '@/components/AssignmentProofList';
import { FileDown } from 'lucide-react';
import type { TeacherData, AssignmentData } from '@/types/models';
import { handleUnauthorized } from '@/lib/authClient';

interface ArchiveDialogProps {
  archiveTeacher: TeacherData | null;
  setArchiveTeacher: (value: TeacherData | null) => void;
}

export function ArchiveDialog({ archiveTeacher, setArchiveTeacher }: ArchiveDialogProps) {
  return <Dialog open={!!archiveTeacher} onOpenChange={open => !open && setArchiveTeacher(null)}>
    <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
      <DialogHeader className="pr-8">
        <DialogTitle>Archiv: {archiveTeacher?.name}</DialogTitle>
        <DialogDescription>Einsatznachweise für {archiveTeacher?.schoolYear}. Zusammenhängende Tage derselben Zuweisung stehen in einem PDF; Stornierungen sind gesondert gekennzeichnet.</DialogDescription>
      </DialogHeader>
      {archiveTeacher && <ArchiveContents key={archiveTeacher.id} teacher={archiveTeacher} />}
    </DialogContent>
  </Dialog>;
}

// Keyed by teacher: never display the previous person's links while a new
// archive is loading, and discard responses after closing/switching the dialog.
function ArchiveContents({ teacher }: { teacher: TeacherData }) {
  const [assignments, setAssignments] = useState<AssignmentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    async function load() {
      try {
        const response = await fetch(`/api/teachers/${encodeURIComponent(teacher.id)}/assignments`, { cache: 'no-store', signal: controller.signal });
        if (response.status === 401) { handleUnauthorized(); return; }
        if (!response.ok) throw new Error('Das Archiv konnte nicht geladen werden. Bitte versuchen Sie es erneut.');
        const rows = await response.json();
        if (!controller.signal.aborted) setAssignments(rows);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Das Archiv konnte nicht geladen werden.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [teacher.id, attempt]);

  return <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-1">
    {loading ? <p role="status" className="py-6 text-center text-muted-foreground">Einsatznachweise werden geladen …</p>
      : error ? <div role="alert" className="space-y-3"><p className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Erneut laden</Button></div>
        : <>
          <AssignmentProofList assignments={assignments} />
          {assignments.length > 0 && <a href={`/api/teachers/${encodeURIComponent(teacher.id)}/export`} className={buttonVariants({ variant: 'outline', className: 'w-full' })}><FileDown className="size-4" />Zusätzlich als Excel exportieren</a>}
        </>}
  </div>;
}
