"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Map as MapIcon, Maximize2, ChevronDown } from "lucide-react";
import { MapWrapper } from "@/components/MapWrapper";
import { SchoolData, TeacherData, RequestData } from "@/types/models";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface SchulamtMapSectionProps {
  schools: SchoolData[];
  teachers: TeacherData[];
  activeRequest: RequestData | null;
  focusedLocation: { lat: number; lng: number; } | null;
  centerCoord?: [number, number] | null;
}

export function SchulamtMapSection(props: SchulamtMapSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [large, setLarge] = useState(false);
  return (
    <Card className="shadow-none bg-card ring-border/70 overflow-hidden xl:sticky xl:top-5 py-0 gap-0">
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border/70 px-5 sm:px-6 py-6">
        <div><CardTitle className="flex items-center gap-2 text-lg"><MapIcon className="size-5 text-primary" />Reserven & Schulen</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">Gesetzte Wohnort-Pins und Schulstandorte</p></div>
        <div className="flex">
          <Button variant="ghost" size="icon" aria-label="Karte vergrößern" onClick={() => setLarge(true)}><Maximize2 className="size-4" /></Button>
          <Button variant="ghost" size="icon" aria-label={expanded ? 'Karte ausblenden' : 'Karte anzeigen'} aria-expanded={expanded} aria-controls="authority-map" onClick={() => setExpanded(!expanded)}><ChevronDown className={`size-4 ${expanded ? 'rotate-180' : ''}`} /></Button>
        </div>
      </CardHeader>
      {expanded && <CardContent id="authority-map" className="p-0 [&_.leaflet-tile-pane]:saturate-[.45] [&_.leaflet-tile-pane]:opacity-85">
        <MapWrapper {...props} />
        <div className="flex flex-wrap gap-x-4 gap-y-2 px-5 py-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-600" />Mobile Reserve</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-blue-700" />Schule</span>
          <span>Abwesende Reserven: blasser Pin</span>
        </div>
      </CardContent>}
      <Dialog open={large} onOpenChange={setLarge}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader><DialogTitle>Reserven & Schulen</DialogTitle></DialogHeader>
          {large && <MapWrapper {...props} />}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
