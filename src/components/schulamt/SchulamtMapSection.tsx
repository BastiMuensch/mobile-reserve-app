import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Map as MapIcon } from "lucide-react";
import { MapWrapper } from "@/components/MapWrapper";
import { SchoolData, TeacherData, RequestData } from "@/types/models";

interface SchulamtMapSectionProps {
  schools: SchoolData[];
  teachers: TeacherData[];
  activeRequest: RequestData | null;
  focusedLocation: { lat: number; lng: number; } | null;
}

export function SchulamtMapSection({
  schools,
  teachers,
  activeRequest,
  focusedLocation
}: SchulamtMapSectionProps) {
  return (
    <Card className="shadow-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-slate-200/60 dark:border-slate-800/60 overflow-hidden">
      <CardHeader className="bg-slate-50/80 dark:bg-slate-900/50 pb-4 border-b border-slate-100 dark:border-slate-800">
        <CardTitle className="flex items-center gap-2 text-xl">
          <MapIcon className="h-6 w-6 text-indigo-500" />
          Regionale Übersicht (Unterallgäu)
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <MapWrapper 
          schools={schools} 
          teachers={teachers} 
          activeRequest={activeRequest}
          focusedLocation={focusedLocation}
        />
      </CardContent>
    </Card>
  );
}
