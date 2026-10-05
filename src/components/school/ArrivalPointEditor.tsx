"use client";
import { useEffect, useId, useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapPin, X } from "lucide-react";
// Im Großformat darf die Karte deutlich größer sein als im früheren 500px-Dialog –
// der Eingang/Parkplatz lässt sich so viel genauer setzen.
const LocationPickerMap = dynamic(() => import("@/components/LocationPickerMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[420px] w-full bg-muted animate-pulse rounded-md mt-2 flex items-center justify-center text-muted-foreground">
      Lade Karte...
    </div>
  ),
});

export function ArrivalPointEditor({ icon, title, description, lat, lng, markerType, markerLabel, onChange, onRemove, removeLabel, center }: {
  center?: { lat: number | null; lng: number | null };
  icon: React.ReactNode; title: string; description: string; lat: number | null; lng: number | null;
  markerType: "school" | "parking"; markerLabel: string; onChange: (lat: number, lng: number) => void; onRemove?: () => void; removeLabel?: string;
}) {
  const inputId = useId();
  const [latInput, setLatInput] = useState(lat == null ? "" : String(lat));
  const [lngInput, setLngInput] = useState(lng == null ? "" : String(lng));
  const [error, setError] = useState("");
  useEffect(() => { setLatInput(lat == null ? "" : String(lat)); }, [lat]);
  useEffect(() => { setLngInput(lng == null ? "" : String(lng)); }, [lng]);
  const setMapPosition = (nextLat: number, nextLng: number) => {
    setLatInput(String(nextLat));
    setLngInput(String(nextLng));
    setError("");
    onChange(nextLat, nextLng);
  };
  const useCoordinates = () => {
    const parsedLat = Number(latInput.replace(',', '.'));
    const parsedLng = Number(lngInput.replace(',', '.'));
    if (!latInput.trim() || !lngInput.trim() || !Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90 || !Number.isFinite(parsedLng) || parsedLng < -180 || parsedLng > 180) {
      setError("Bitte geben Sie ein vollständiges gültiges Koordinatenpaar ein (Breite −90 bis 90, Länge −180 bis 180).");
      return;
    }
    setMapPosition(parsedLat, parsedLng);
  };
  return <section aria-label={title} className="space-y-4">
    <div className="flex items-start justify-between gap-4"><div><h2 className="flex items-center gap-2 font-semibold">{icon}{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>{onRemove && <Button type="button" variant="ghost" size="sm" onClick={onRemove} className="gap-1 text-muted-foreground"><X className="h-4 w-4" /> {removeLabel}</Button>}</div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor={`${inputId}-lat`}>Breitengrad</Label><Input id={`${inputId}-lat`} inputMode="decimal" value={latInput} onChange={e => setLatInput(e.target.value)} placeholder="z. B. 48,7900" aria-label={`${title} Breitengrad`} /></div>
      <div className="space-y-1"><Label htmlFor={`${inputId}-lng`}>Längengrad</Label><Input id={`${inputId}-lng`} inputMode="decimal" value={lngInput} onChange={e => setLngInput(e.target.value)} placeholder="z. B. 11,4900" aria-label={`${title} Längengrad`} /></div>
    </div>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <Button type="button" size="sm" variant="outline" onClick={useCoordinates}><MapPin className="h-4 w-4" /> Koordinaten verwenden</Button>
    <LocationPickerMap lat={lat} lng={lng} center={center} showDefaultMarker={false} heightClass="h-[300px]" markerType={markerType} markerLabel={markerLabel} onChange={setMapPosition} />
  </section>;
}
