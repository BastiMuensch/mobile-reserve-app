"use client";

import dynamic from 'next/dynamic';

const MapComponent = dynamic(() => import('./MapComponent'), {
  ssr: false,
  loading: () => <div role="status" className="h-[420px] max-h-[65dvh] w-full bg-muted rounded-lg flex items-center justify-center text-muted-foreground">Karte wird geladen …</div>
});

import { SchoolData, TeacherData, RequestData } from '@/types/models';

export function MapWrapper({ 
  schools, 
  teachers, 
  activeRequest, 
  focusedLocation, 
  centerCoord 
}: {
  schools?: SchoolData[],
  teachers?: TeacherData[],
  activeRequest?: RequestData | null,
  focusedLocation?: {lat: number, lng: number} | null,
  centerCoord?: [number, number] | null
}) {
  return <MapComponent schools={schools} teachers={teachers} activeRequest={activeRequest} focusedLocation={focusedLocation} centerCoord={centerCoord} />;
}
