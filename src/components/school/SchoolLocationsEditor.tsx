"use client";

import { useState } from 'react';
import Image from 'next/image';
import { Building, DoorOpen, MapPin, ParkingCircle, Plus } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import type { SchoolLocationData } from '@/lib/schoolLocations';
import { ArrivalPointEditor } from './ArrivalPointEditor';

type LocationDraft = Omit<SchoolLocationData, 'id'> & { id?: string };
const emptyLocation = (schoolId: string): LocationDraft => ({ schoolId, name: '', address: '', latitude: null, longitude: null,
  generalInfo: '', imageUrl: null, entranceLat: null, entranceLng: null, parkingLat: null, parkingLng: null, isActive: true });

export function SchoolLocationsEditor() {
  const { user, setUser } = useAuth();
  const [adding, setAdding] = useState(false);
  if (!user?.school) return null;
  const locations = user.school.locations ?? [];
  function saved(location: SchoolLocationData) {
    if (!user?.school) return;
    const updated = [...locations.filter(item => item.id !== location.id), location].sort((a, b) => a.name.localeCompare(b.name, 'de'));
    setUser({ ...user, school: { ...user.school, locations: updated } });
    setAdding(false);
  }
  return <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-xl"><Building className="h-5 w-5" /> Außenstellen</CardTitle>
      <CardDescription>Fügen Sie weitere Standorte Ihrer Schule hinzu. Beim Melden eines Bedarfs wählen Sie den Einsatzort mit einem Klick.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {locations.length === 0 && !adding && <p className="text-sm text-muted-foreground">Ihre Schule hat bisher nur den Hauptstandort.</p>}
      {locations.map(location => <details key={location.id} className="rounded-xl border border-border p-4">
        <summary className="cursor-pointer font-medium break-words">{location.name}{!location.isActive && <span className="ml-2 text-sm font-normal text-muted-foreground">Inaktiv</span>}<span className="mt-1 block text-sm font-normal text-muted-foreground">{location.address}</span></summary>
        <LocationForm key={JSON.stringify(location)} initial={location} onSave={saved} />
      </details>)}
      {adding && <div className="rounded-xl border border-primary/30 p-4"><h3 className="font-semibold">Neue Außenstelle</h3><LocationForm initial={emptyLocation(user.school.id)} onSave={saved} onCancel={() => setAdding(false)} /></div>}
      {!adding && <Button type="button" variant="outline" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Außenstelle hinzufügen</Button>}
    </CardContent>
  </Card>;
}

function LocationForm({ initial, onSave, onCancel }: { initial: LocationDraft; onSave: (location: SchoolLocationData) => void; onCancel?: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [showPosition, setShowPosition] = useState(false);
  const [showArrival, setShowArrival] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || file !== null;
  const confirmDiscard = useUnsavedChanges(dirty);
  const prefix = initial.id ?? 'new-location';
  const center = { lat: draft.latitude, lng: draft.longitude };
  const change = (fields: Partial<LocationDraft>) => setDraft(current => ({ ...current, ...fields }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      let imageUrl = draft.imageUrl;
      if (file) {
        const uploadData = new FormData();
        uploadData.append('file', file);
        uploadData.append('purpose', 'school_image');
        const response = await fetch('/api/upload', { method: 'POST', body: uploadData });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Bild konnte nicht hochgeladen werden.');
        imageUrl = body.url;
      }
      const response = await fetch('/api/schools/locations', { method: draft.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, imageUrl }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Außenstelle konnte nicht gespeichert werden.');
      onSave(body.location);
      toast({ variant: body.warning ? 'info' : 'success', title: 'Außenstelle gespeichert.', description: body.warning });
    } catch (error) {
      toast({ variant: 'error', title: error instanceof Error ? error.message : 'Speichern fehlgeschlagen.' });
    } finally { setSaving(false); }
  }

  return <form onSubmit={save} className="mt-5">
    <fieldset disabled={saving} className="space-y-5 min-w-0">
      <div className="space-y-2"><Label htmlFor={`${prefix}-name`}>Bezeichnung</Label><Input id={`${prefix}-name`} required maxLength={120} placeholder="z. B. Außenstelle Oberdorf" value={draft.name} onChange={event => change({ name: event.target.value })} /></div>
      <div className="space-y-2"><Label htmlFor={`${prefix}-address`}>Adresse der Außenstelle</Label><Input id={`${prefix}-address`} required maxLength={500} placeholder="Straße, Hausnummer, PLZ und Ort" value={draft.address} onChange={event => change({ address: event.target.value, latitude: null, longitude: null })} /><p className="text-xs text-muted-foreground">Der Standort wird beim Speichern aus der Adresse ermittelt. Sie können ihn auch auf der Karte setzen.</p></div>
      <div className="space-y-2"><Label htmlFor={`${prefix}-info`}>Hinweise für diesen Standort</Label><Textarea id={`${prefix}-info`} maxLength={2000} value={draft.generalInfo ?? ''} onChange={event => change({ generalInfo: event.target.value })} placeholder="Wo melden sich Mobile Reserven bei der Ankunft?" /></div>
      <div className="space-y-2"><Label htmlFor={`${prefix}-photo`}>Foto der Außenstelle (optional)</Label><Input id={`${prefix}-photo`} type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={event => {
        const selected = event.target.files?.[0] ?? null;
        if (selected && (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(selected.type) || selected.size > 5 * 1024 * 1024)) {
          event.target.value = ''; setFile(null); toast({ variant: 'error', title: 'Bitte wählen Sie ein JPEG-, PNG-, GIF- oder WebP-Bild mit maximal 5 MB.' }); return;
        }
        setFile(selected);
      }} /><p className="text-xs text-muted-foreground">JPEG, PNG, GIF oder WebP, maximal 5 MB. Wird mit der Außenstelle gespeichert.</p>
        {draft.imageUrl && !file && <div className="flex items-center gap-3"><Image src={draft.imageUrl} alt={draft.name} width={100} height={80} className="rounded-md object-cover" /><Button type="button" variant="ghost" size="sm" onClick={() => change({ imageUrl: null })}>Foto entfernen</Button></div>}
      </div>
      <details className="rounded-lg border p-3" onToggle={event => setShowPosition(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">Standort auf der Karte {draft.latitude != null ? '· gesetzt' : '· noch offen'}</summary>{showPosition && <div className="mt-4"><ArrivalPointEditor icon={<MapPin className="h-4 w-4" />} title="Standort" description="Grundlage für die Entfernungsberechnung." lat={draft.latitude} lng={draft.longitude} markerType="school" markerLabel={`${draft.name} Standort`} onChange={(latitude, longitude) => change({ latitude, longitude })} /></div>}</details>
      <details className="rounded-lg border p-3" onToggle={event => setShowArrival(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">Eingang und Parkplatz {draft.entranceLat != null ? '· Eingang gesetzt' : '(optional)'}</summary>{showArrival && <div className="mt-4 space-y-6">
        <ArrivalPointEditor icon={<DoorOpen className="h-4 w-4" />} title="Eingang" description="Der genaue Treffpunkt an dieser Außenstelle." lat={draft.entranceLat} lng={draft.entranceLng} center={center} markerType="school" markerLabel={`${draft.name} Eingang`} onChange={(entranceLat, entranceLng) => change({ entranceLat, entranceLng })} onRemove={draft.entranceLat != null ? () => change({ entranceLat: null, entranceLng: null, parkingLat: null, parkingLng: null }) : undefined} removeLabel="Ankunftspunkte entfernen" />
        {draft.entranceLat != null && <ArrivalPointEditor icon={<ParkingCircle className="h-4 w-4" />} title="Parkplatz" description="Ein optionaler Parkplatz ergänzt die Anfahrt." lat={draft.parkingLat} lng={draft.parkingLng} center={{ lat: draft.entranceLat, lng: draft.entranceLng }} markerType="parking" markerLabel={`${draft.name} Parkplatz`} onChange={(parkingLat, parkingLng) => change({ parkingLat, parkingLng })} onRemove={draft.parkingLat != null ? () => change({ parkingLat: null, parkingLng: null }) : undefined} removeLabel="Entfernen" />}
      </div>}</details>
      {draft.id && <div className="space-y-1"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={event => change({ isActive: event.target.checked })} className="accent-primary" /> Für neue Anforderungen auswählbar</label><p className="text-xs text-muted-foreground">Bei Deaktivierung bleiben bestehende Bedarfe und Einsätze diesem Standort zugeordnet.</p></div>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={saving || (Boolean(draft.id) && !dirty)}>{saving ? 'Speichern…' : 'Außenstelle speichern'}</Button>{onCancel && <Button type="button" variant="ghost" onClick={() => { if (confirmDiscard()) onCancel(); }}>Abbrechen</Button>}</div>
    </fieldset>
  </form>;
}
