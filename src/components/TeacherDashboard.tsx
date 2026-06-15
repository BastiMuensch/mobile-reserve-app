"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import Image from "next/image";
import { MapPin, Calendar, Clock, BookOpen, MessageSquare, Info, FileDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AssignmentMapWrapper } from "./AssignmentMapWrapper";
import { getCurrentSchoolYear } from "@/lib/schoolYear";

type AssignmentData = { id: string; date: string; hours: number; status: string; request: { startHour: number; substitutedTeacher: string; schoolType: string; comments?: string; school: { name: string; address: string; generalInfo?: string; imageUrl?: string; latitude: number; longitude: number; pinLat?: number; pinLng?: number; } } };

export function TeacherDashboard() {
  const { user } = useAuth();
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const today = new Date(new Date().setHours(0, 0, 0, 0));

  const currentYear = getCurrentSchoolYear();
  const teacher = user?.teachers?.find(t => t.schoolYear === currentYear) || user?.teachers?.[0];

  if (!teacher) return <div className="p-8 text-center text-slate-500">Kein Lehrerprofil für das aktuelle Schuljahr ({currentYear}) gefunden. Bitte wenden Sie sich an Ihr Schulamt.</div>;

  // Separate upcoming and past assignments
  const allAssignments = teacher.assignments || [];
  
  const upcoming = (allAssignments as AssignmentData[])
    .filter((a) => new Date(a.date) >= today)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
  const past = (allAssignments as AssignmentData[])
    .filter((a) => new Date(a.date) < today)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const nextAssignment = upcoming.length > 0 ? upcoming[0] : null;
  const otherUpcoming = upcoming.slice(1);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex justify-between items-center bg-white/50 dark:bg-slate-900/50 p-6 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 backdrop-blur-md shadow-sm">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-orange-500">Lehrer-Dashboard</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">Willkommen zurück, {teacher.name}. Hier ist Ihre Einsatzübersicht.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* NEXT ASSIGNMENT */}
        <div className="lg:col-span-2 space-y-8">
          <Card className="shadow-xl border-t-4 border-t-emerald-500 overflow-hidden">
            <CardHeader className="bg-emerald-50/50 dark:bg-emerald-950/20">
              <CardTitle className="text-2xl flex items-center gap-2 text-emerald-800 dark:text-emerald-400">
                <Calendar className="h-6 w-6" /> Nächster Einsatz
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {nextAssignment ? (
                <div className="space-y-6">
                  <div className="flex justify-between items-start">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{nextAssignment.request.school.name}</h2>
                      <p className="text-slate-500 flex items-center gap-1 mt-1">
                        <MapPin className="h-4 w-4" /> {nextAssignment.request.school.address}
                      </p>
                    </div>
                    <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 text-sm py-1">
                      {new Date(nextAssignment.date).toLocaleDateString('de-DE')}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                      <div className="text-slate-500 text-xs font-semibold mb-1 uppercase">Stunden</div>
                      <div className="font-bold text-lg flex items-center gap-2"><Clock className="h-4 w-4 text-emerald-500"/> {nextAssignment.hours} Std.</div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                      <div className="text-slate-500 text-xs font-semibold mb-1 uppercase">Ab Stunde</div>
                      <div className="font-bold text-lg flex items-center gap-2"><Clock className="h-4 w-4 text-emerald-500"/> {nextAssignment.request.startHour}. Std</div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                      <div className="text-slate-500 text-xs font-semibold mb-1 uppercase">Klasse / Schulart</div>
                      <div className="font-bold text-lg flex items-center gap-2"><BookOpen className="h-4 w-4 text-emerald-500"/> {nextAssignment.request.schoolType === 'GRUNDSCHULE' ? 'GS' : nextAssignment.request.schoolType === 'MITTELSCHULE' ? 'MS' : 'GS/MS'}</div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                      <div className="text-slate-500 text-xs font-semibold mb-1 uppercase">Vertretung für</div>
                      <div className="font-bold text-sm flex items-center gap-2">{nextAssignment.request.substitutedTeacher || '-'}</div>
                    </div>
                  </div>

                  {nextAssignment.status === 'PENDING' && (
                    <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-xl border border-amber-200 dark:border-amber-800/30">
                      <h3 className="text-amber-800 dark:text-amber-400 font-bold mb-2">Bitte bestätigen Sie diesen Einsatz</h3>
                      <div className="flex gap-4">
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
                          className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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
                      {nextAssignment.request.comments && (
                        <div>
                          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2 mb-2">
                            <MessageSquare className="h-4 w-4 text-blue-500" /> Hinweise zum Einsatz (Startzeit/Parken)
                          </h3>
                          <div className="bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 p-4 rounded-xl text-sm leading-relaxed whitespace-pre-wrap">
                            {nextAssignment.request.comments}
                          </div>
                        </div>
                      )}
                      {nextAssignment.request.school.generalInfo && (
                        <div>
                          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2 mb-2">
                            <Info className="h-4 w-4 text-amber-500" /> Allgemeine Schulinformationen
                          </h3>
                          <div className="bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 p-4 rounded-xl text-sm leading-relaxed whitespace-pre-wrap">
                            {nextAssignment.request.school.generalInfo}
                          </div>
                        </div>
                      )}
                    </div>
                    
                    <div>
                      {nextAssignment.request.school.imageUrl && (
                        <div className="rounded-xl overflow-hidden shadow-sm border border-slate-200 dark:border-slate-800 mb-4">
                          <Image src={nextAssignment.request.school.imageUrl} alt="Schule" width={500} height={128} className="w-full h-32 object-cover" unoptimized />
                        </div>
                      )}
                      <AssignmentMapWrapper school={nextAssignment.request.school} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-slate-500">
                  Kein bevorstehender Einsatz geplant.
                </div>
              )}
            </CardContent>
          </Card>

          {/* OTHER UPCOMING */}
          {otherUpcoming.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Weitere anstehende Einsätze</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {otherUpcoming.map((a) => (
                    <div key={a.id} className="flex justify-between items-center p-4 border rounded-xl bg-slate-50 dark:bg-slate-900/50">
                      <div>
                        <div className="font-bold">{a.request.school.name}</div>
                        <div className="text-sm text-slate-500">
                          {new Date(a.date).toLocaleDateString('de-DE')} • {a.hours} Stunden (ab {a.request.startHour}. Std)
                          <br/>Vertretung für: {a.request.substitutedTeacher || '-'}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {a.status === 'PENDING' ? (
                           <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">Ausstehend</span>
                        ) : a.status === 'ACCEPTED' ? (
                           <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-1 rounded">Akzeptiert</span>
                        ) : (
                           <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">Abgelehnt</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ARCHIVE */}
        <div className="lg:col-span-1">
          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-xl flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-slate-500" />
                Archiv (Vergangene Einsätze)
              </CardTitle>
              {past.length > 0 && (
                <button
                  onClick={() => window.location.href = `/api/teachers/${teacher.id}/export`}
                  className="text-xs flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 px-3 py-1.5 rounded-md transition-colors text-slate-700 dark:text-slate-300"
                >
                  <FileDown className="h-3.5 w-3.5" /> Excel Export
                </button>
              )}
            </CardHeader>
            <CardContent>
              {past.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm">
                  Keine vergangenen Einsätze.
                </div>
              ) : (
                <div className="space-y-4">
                  {past.map((a) => (
                    <div key={a.id} className="p-4 border border-slate-100 dark:border-slate-800 border-l-4 border-l-emerald-500 bg-slate-50 dark:bg-slate-900/50 rounded-r-xl flex items-center justify-between gap-3 shadow-xs hover:shadow-sm transition-all duration-300">
                      <div>
                        <div className="font-bold text-slate-850 dark:text-slate-200 text-sm">{a.request.school.name}</div>
                        <div className="flex gap-4 text-xs text-slate-500 mt-1">
                          <span>📅 {new Date(a.date).toLocaleDateString('de-DE')}</span>
                          <span>⏰ {a.hours} Std.</span>
                        </div>
                      </div>
                      <button
                        onClick={() => window.open(`/api/assignments/${a.id}/pdf`, '_blank')}
                        className="p-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/30 dark:text-emerald-300 rounded-lg hover:scale-105 active:scale-95 transition-all duration-300 border border-emerald-100 dark:border-emerald-900/50 shrink-0"
                        title="Einsatznachweis (PDF) herunterladen"
                      >
                        <FileDown className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
