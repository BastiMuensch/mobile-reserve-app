import { TeacherData } from "@/types/models";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Clock, MapPin, BookOpen } from "lucide-react";

export function PendingTeachersList({
  teachers,
  onApprove,
  onReject
}: {
  teachers: TeacherData[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  if (teachers.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Clock className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p>Der Warteraum ist leer.</p>
          <p className="text-sm mt-2">Aktuell warten keine neuen Registrierungen auf Freigabe.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Warteraum ({teachers.length})</CardTitle>
          <CardDescription>
            Folgende Lehrkräfte haben sich selbst registriert und warten auf Ihre Freigabe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {teachers.map(teacher => (
              <div key={teacher.id} className="p-4 border border-border rounded-xl flex flex-col md:flex-row justify-between gap-4 items-start md:items-center bg-muted/50">
                <div className="space-y-1">
                  <div className="font-bold text-lg">{teacher.name}</div>
                  <div className="text-sm text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-4 w-4" /> {teacher.stammschule?.name} ({teacher.maxWeeklyHours}h{teacher.isPartTime ? ' - Teilzeit' : ''})
                  </div>
                  <div className="text-sm text-muted-foreground flex items-center gap-1">
                    <BookOpen className="h-4 w-4" /> {teacher.qualifications} | {teacher.email}
                  </div>
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                  <Button variant="outline" className="w-full md:w-auto border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10" onClick={() => onReject(teacher.id)}>
                    <XCircle className="h-4 w-4 mr-2" /> Ablehnen
                  </Button>
                  <Button className="w-full md:w-auto bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white" onClick={() => onApprove(teacher.id)}>
                    <CheckCircle2 className="h-4 w-4 mr-2" /> Freigeben
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
