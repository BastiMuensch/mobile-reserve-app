import { Badge } from "@/components/ui/badge";
import { BookOpen, Clock, FileText, MapPin } from "lucide-react";
import Image from "next/image";
import { AssignmentMapWrapper } from "../AssignmentMapWrapper";
import { AssignmentData, SchoolData } from "@/types/models";
import { useState } from "react";

export function TeacherNextAssignment({ nextAssignment }: { nextAssignment: AssignmentData }) {
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{nextAssignment.request?.school.name}</h2>
          <p className="text-slate-500 flex items-center gap-1 mt-1">
            <MapPin className="h-4 w-4" /> {nextAssignment.request?.school.address}
          </p>
        </div>
        <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-200 text-sm py-1">
          {new Date(nextAssignment.date).toLocaleDateString('de-DE')}
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
          <div className="text-slate-500 text-xs font-semibold mb-1 uppercase">Stunden</div>
          <div className="font-bold text-lg flex items-center gap-2"><Clock className="h-4 w-4 text-orange-500"/> {nextAssignment.hours} Std.</div>
        </div>
        <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
          <div className="text-slate-500 text-xs font-semibold mb-1 uppercase">Ab Stunde</div>
          <div className="font-bold text-lg flex items-center gap-2"><Clock className="h-4 w-4 text-orange-500"/> {nextAssignment.request?.startHour}. Std</div>
        </div>
        <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
          <div className="text-slate-500 text-xs font-semibold mb-1 uppercase">Klasse / Schulart</div>
          <div className="font-bold text-lg flex items-center gap-2"><BookOpen className="h-4 w-4 text-orange-500"/> {nextAssignment.request?.schoolType === 'GRUNDSCHULE' ? 'GS' : nextAssignment.request?.schoolType === 'MITTELSCHULE' ? 'MS' : 'GS/MS'}</div>
        </div>
        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl space-y-2 h-full">
          <div className="font-medium flex items-center gap-2"><FileText className="h-4 w-4" /> Bemerkungen</div>
          <div className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
            {nextAssignment.request?.comments || 'Keine Bemerkungen hinterlegt.'}
          </div>
        </div>
      </div>

      {nextAssignment.status === 'PENDING' && (
        <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-xl border border-amber-200 dark:border-amber-800/30">
          <h3 className="text-amber-800 dark:text-amber-400 font-bold mb-2">Bitte bestätigen Sie diesen Einsatz</h3>
          <div className="flex flex-wrap gap-4">
            <button 
              disabled={isUpdatingStatus}
              onClick={async () => {
                if (isUpdatingStatus) return;
                setIsUpdatingStatus(true);
                try {
                  const res = await fetch(`/api/assignments/${nextAssignment.id}/status`, {
                    method: 'PATCH', body: JSON.stringify({status: 'ACCEPTED'}), headers: {'Content-Type': 'application/json'}
                  });
                  if (!res.ok) {
                    const err = await res.json();
                    alert(`Fehler: ${err.error || 'Einsatz konnte nicht akzeptiert werden'}`);
                    return;
                  }
                  window.dispatchEvent(new Event('app-refresh'));
                } catch (error) {
                  alert('Netzwerkfehler. Bitte versuchen Sie es erneut.');
                } finally {
                  setIsUpdatingStatus(false);
                }
              }}
              className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUpdatingStatus ? 'Wird verarbeitet...' : 'Einsatz akzeptieren'}
            </button>
            <button 
              disabled={isUpdatingStatus}
              onClick={async () => {
                if (isUpdatingStatus) return;
                if(confirm("Diesen Einsatz wirklich ablehnen?")) {
                  setIsUpdatingStatus(true);
                  try {
                    const res = await fetch(`/api/assignments/${nextAssignment.id}/status`, {
                      method: 'PATCH', body: JSON.stringify({status: 'REJECTED'}), headers: {'Content-Type': 'application/json'}
                    });
                    if (!res.ok) {
                      const err = await res.json();
                      alert(`Fehler: ${err.error || 'Einsatz konnte nicht abgelehnt werden'}`);
                      return;
                    }
                    window.dispatchEvent(new Event('app-refresh'));
                  } catch (error) {
                    alert('Netzwerkfehler. Bitte versuchen Sie es erneut.');
                  } finally {
                    setIsUpdatingStatus(false);
                  }
                }
              }}
              className="bg-slate-200 hover:bg-slate-300 text-slate-800 px-4 py-2 rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Ablehnen
            </button>
          </div>
        </div>
      )}

      {/* School Info & Comments */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-100 dark:border-slate-800">
        <div className="space-y-4">
          {nextAssignment.request?.comments && (
            <div>
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2 mb-2">
                <FileText className="h-4 w-4 text-indigo-500" />
                Bemerkungen zum Einsatz
              </h3>
              <p className="text-sm bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                {nextAssignment.request?.comments}
              </p>
            </div>
          )}
          
          <div>
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2 mb-2">
              <BookOpen className="h-4 w-4 text-indigo-500" />
              Informationen zur Schule
            </h3>
            <div className="bg-indigo-50/50 dark:bg-indigo-900/10 p-3 rounded-lg border border-indigo-100 dark:border-indigo-900/30 text-sm">
              {nextAssignment.request?.school.generalInfo ? (
                <div className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{nextAssignment.request?.school.generalInfo}</div>
              ) : (
                <div className="text-slate-500 italic">Die Schule hat noch keine allgemeinen Informationen hinterlegt (z.B. wo Sie sich morgens melden sollen).</div>
              )}
              {nextAssignment.request?.school.imageUrl && (
                <div className="mt-3">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Schul-Foto</span>
                  <div className="mt-1 relative h-32 w-full rounded-md overflow-hidden">
                    <Image src={nextAssignment.request.school.imageUrl} alt="Schule" fill className="object-cover" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2 mb-2">
            <MapPin className="h-4 w-4 text-indigo-500" />
            Anfahrt & Parkplatz
          </h3>
          <AssignmentMapWrapper school={nextAssignment.request?.school as SchoolData} />
        </div>
      </div>
    </div>
  );
}
