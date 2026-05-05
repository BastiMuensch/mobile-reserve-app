"use client";

import dynamic from 'next/dynamic';

const MapComponent = dynamic(() => import('./MapComponent'), {
  ssr: false,
  loading: () => <div className="h-[500px] w-full bg-slate-100 dark:bg-slate-800 animate-pulse rounded-lg flex items-center justify-center text-slate-500">Loading Map...</div>
});

export function MapWrapper({ schools, teachers, activeRequest, focusedLocation }: any) {
  return <MapComponent schools={schools} teachers={teachers} activeRequest={activeRequest} focusedLocation={focusedLocation} />;
}
