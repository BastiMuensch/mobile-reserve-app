import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Map as MapIcon } from "lucide-react";
import { MapWrapper } from "@/components/MapWrapper";
import { SchoolData, TeacherData, RequestData } from "@/types/models";

interface SchulamtMapSectionProps {
  schools: SchoolData[];
  teachers: TeacherData[];
  activeRequest: RequestData | null;
  focusedLocation: { lat: number; lng: number; } | null;
  centerCoord?: [number, number] | null;
}

export function SchulamtMapSection({
  schools,
  teachers,
  activeRequest,
  focusedLocation,
  centerCoord
}: SchulamtMapSectionProps) {
  return (
    <Card className="shadow-xl bg-card/80 backdrop-blur-sm border-border/60 overflow-hidden">
      <CardHeader className="bg-muted/80 pb-4 border-b border-border">
        <CardTitle className="flex items-center gap-2 text-xl">
          <MapIcon className="h-6 w-6 text-primary" />
          Regionale Übersicht
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <MapWrapper 
          schools={schools} 
          teachers={teachers} 
          activeRequest={activeRequest}
          focusedLocation={focusedLocation}
          centerCoord={centerCoord}
        />
      </CardContent>
    </Card>
  );
}
