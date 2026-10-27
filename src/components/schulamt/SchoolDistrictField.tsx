"use client";

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { schoolDistrictOptions } from '@/lib/schoolDistrict';

export function SchoolDistrictField({ id, value, onChange }: { id: string; value?: string | null; onChange: (value: string) => void }) {
  return <div className="space-y-2">
    <Label htmlFor={id}>Schulamtsbezirk</Label>
    <Input id={id} value={value ?? ''} maxLength={50} placeholder="Name oder Kürzel des Bezirks" onChange={event => onChange(event.target.value)} />
  </div>;
}

export function SchoolDistrictFilter({ id, value, onChange, districts }: { id: string; value: string; onChange: (value: string) => void; districts: (string | null | undefined)[] }) {
  return <div className="space-y-2 max-w-sm">
    <Label htmlFor={id}>Nach Schulamtsbezirk filtern</Label>
    <select id={id} className="min-h-11 w-full rounded-lg border border-input bg-card px-3 text-sm" value={value} onChange={event => onChange(event.target.value)}>
      <option value="ALL">Alle Schulamtsbezirke</option>
      <option value="UNASSIGNED">Ohne Zuordnung</option>
      {schoolDistrictOptions(districts).map(district => <option key={district} value={`district:${district}`}>{district}</option>)}
    </select>
  </div>;
}
