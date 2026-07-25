"use client";

import dynamic from 'next/dynamic';

const MapComponent = dynamic(() => import('./MapComponent'), {
  ssr: false,
  loading: () => <div className="h-[500px] w-full bg-muted animate-pulse rounded-lg flex items-center justify-center text-muted-foreground">Karte wird geladen...</div>
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
