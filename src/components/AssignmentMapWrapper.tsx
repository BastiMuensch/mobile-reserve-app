"use client";

import dynamic from 'next/dynamic';

const AssignmentMap = dynamic(() => import('./AssignmentMap'), {
  ssr: false,
  loading: () => <div className="h-48 w-full bg-slate-100 dark:bg-slate-800 animate-pulse rounded-xl flex items-center justify-center text-slate-500">Karte wird geladen...</div>
});

import { SchoolData } from '@/types/models';

export function AssignmentMapWrapper({ school }: { school: SchoolData }) {
  return <AssignmentMap school={school} />;
}
