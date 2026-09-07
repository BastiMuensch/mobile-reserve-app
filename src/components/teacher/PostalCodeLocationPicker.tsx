"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MapPin, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const LocationPickerMap = dynamic(() => import("@/components/LocationPickerMap"), {
  ssr: false,
  loading: () => <div className="h-[250px] animate-pulse rounded-md border border-border bg-muted/40" aria-label="Karte wird geladen" />,
});

type Position = { lat: number; lng: number };
type LocationState = "IDLE" | "LOADING" | "PROVISIONAL" | "CHANGED" | "CONFIRMED" | "ERROR";

interface PostalCodeLocationPickerProps {
  postalCode: string;
  token?: string | null;
  latitude: number | null;
  longitude: number | null;
  onChange: (latitude: number | null, longitude: number | null) => void;
}

export function PostalCodeLocationPicker({
  postalCode,
  token,
  latitude,
  longitude,
  onChange,
}: PostalCodeLocationPickerProps) {
  const titleId = useId();
  const initialPosition = latitude !== null && longitude !== null ? { lat: latitude, lng: longitude } : null;
  const [draftPosition, setDraftPosition] = useState<Position | null>(initialPosition);
  const [state, setState] = useState<LocationState>(initialPosition ? "CONFIRMED" : "IDLE");
  const [error, setError] = useState("");
  const [latitudeInput, setLatitudeInput] = useState(initialPosition ? String(initialPosition.lat) : "");
  const [longitudeInput, setLongitudeInput] = useState(initialPosition ? String(initialPosition.lng) : "");
  const previousPostalCode = useRef(postalCode);
  const initialized = useRef(false);
  const requestSequence = useRef(0);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const geocodePostalCode = useCallback(async (value: string) => {
    if (!/^[0-9]{5}$/.test(value)) return;

    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setState("LOADING");
    setError("");
    setDraftPosition(null);

    try {
      const response = await fetch("/api/geocode/postal-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postalCode: value, ...(token ? { token } : {}) }),
      });
      const result = await response.json().catch(() => null) as {
        status?: string;
        latitude?: number;
        longitude?: number;
        error?: string;
      } | null;

      if (sequence !== requestSequence.current) return;
      if (!response.ok) throw new Error(result?.error || "Die Position der Postleitzahl konnte nicht ermittelt werden.");
      if (result?.status !== "RESOLVED" || !Number.isFinite(result.latitude) || !Number.isFinite(result.longitude)) {
        throw new Error("Der Kartendienst hat keine gültige Position zurückgegeben.");
      }

      setDraftPosition({ lat: result.latitude!, lng: result.longitude! });
      setLatitudeInput(String(result.latitude!));
      setLongitudeInput(String(result.longitude!));
      setState("PROVISIONAL");
    } catch (caught) {
      if (sequence !== requestSequence.current) return;
      setError(caught instanceof Error ? caught.message : "Die Position der Postleitzahl konnte nicht ermittelt werden.");
      setState("ERROR");
    }
  }, [token]);

  useEffect(() => {
    const isFirstRun = !initialized.current;
    const postalCodeChanged = postalCode !== previousPostalCode.current;
    initialized.current = true;
    previousPostalCode.current = postalCode;

    if (!isFirstRun && postalCodeChanged) {
      requestSequence.current += 1;
      onChangeRef.current(null, null);
      setDraftPosition(null);
      setLatitudeInput("");
      setLongitudeInput("");
      setError("");

      if (/^[0-9]{5}$/.test(postalCode)) {
        void geocodePostalCode(postalCode);
      } else {
        setState("IDLE");
      }
      return;
    }

    if (latitude !== null && longitude !== null) {
      requestSequence.current += 1;
      setDraftPosition({ lat: latitude, lng: longitude });
      setLatitudeInput(String(latitude));
      setLongitudeInput(String(longitude));
      setError("");
      setState("CONFIRMED");
      return;
    }

    if (isFirstRun && /^[0-9]{5}$/.test(postalCode)) {
      void geocodePostalCode(postalCode);
    }
  }, [geocodePostalCode, latitude, longitude, postalCode]);

  const moveDraftPin = (lat: number, lng: number) => {
    // A manual choice wins over an in-flight PLZ lookup. Otherwise a late
    // network response could silently move the pin away again.
    requestSequence.current += 1;
    setDraftPosition({ lat, lng });
    setLatitudeInput(String(lat));
    setLongitudeInput(String(lng));
    onChangeRef.current(null, null);
    setError("");
    setState("CHANGED");
  };

  const confirmPosition = () => {
    if (!draftPosition) return;
    onChangeRef.current(draftPosition.lat, draftPosition.lng);
    setState("CONFIRMED");
  };

  const useEnteredCoordinates = () => {
    const lat = Number(latitudeInput.replace(",", "."));
    const lng = Number(longitudeInput.replace(",", "."));
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      setError("Bitte geben Sie gültige Koordinaten ein (Breite −90 bis 90, Länge −180 bis 180).");
      setState("ERROR");
      return;
    }
    moveDraftPin(lat, lng);
  };

  if (!/^[0-9]{5}$/.test(postalCode)) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" /> Geben Sie zuerst eine fünfstellige Postleitzahl ein. Danach können Sie die ungefähre Kartenposition prüfen.
      </p>
    );
  }

  return (
    <section className="space-y-3" aria-labelledby={titleId}>
      <div>
        <h4 id={titleId} className="font-medium">Ungefähre Kartenposition prüfen</h4>
        <p className="text-xs text-muted-foreground">Die PLZ-Suche setzt nur einen groben Vorschlag. Wählen Sie per Klick oder Ziehen Ihre Heimposition, oder geben Sie Koordinaten ein, und bestätigen Sie diese anschließend. Der bestätigte Pin ist für das zuständige Schulamt sichtbar und wird zur Entfernungsberechnung verwendet. Die vollständige Anschrift wird nicht an den Geodienst übertragen.</p>
      </div>

      {state === "LOADING" && (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> Ungefähre Position wird ermittelt …
        </p>
      )}

      {state === "ERROR" && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" role="alert">
          <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Die automatische PLZ-Suche ist gerade nicht verfügbar. {error}</p>
          <p>Sie können es erneut versuchen, Ihren Pin auf der Karte setzen oder unten Koordinaten eingeben und anschließend bestätigen.</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void geocodePostalCode(postalCode)}>
            <RefreshCw /> Erneut versuchen
          </Button>
        </div>
      )}

      <LocationPickerMap
        lat={draftPosition?.lat ?? null}
        lng={draftPosition?.lng ?? null}
        onChange={moveDraftPin}
        markerType="teacher"
        draggable
        showDefaultMarker={false}
        positionZoom={12}
      />

      <fieldset className="rounded-lg border border-border bg-muted/20 p-3">
        <legend className="px-1 text-sm font-medium">Position ohne Karte eingeben</legend>
        <p className="mb-3 text-xs text-muted-foreground">Diese Alternative ist für Tastaturbedienung und den Fall gedacht, dass die Kartensuche nicht verfügbar ist. Dezimalkomma ist erlaubt.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="teacher-latitude">Breitengrad</Label>
            <Input id="teacher-latitude" inputMode="decimal" value={latitudeInput} onChange={event => setLatitudeInput(event.target.value)} placeholder="z. B. 48,1234" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="teacher-longitude">Längengrad</Label>
            <Input id="teacher-longitude" inputMode="decimal" value={longitudeInput} onChange={event => setLongitudeInput(event.target.value)} placeholder="z. B. 11,5678" />
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" className="mt-3" onClick={useEnteredCoordinates}>
          <MapPin /> Koordinaten verwenden
        </Button>
      </fieldset>

      {state === "PROVISIONAL" && <p className="text-sm text-muted-foreground" role="status">Ungefährer PLZ-Vorschlag gefunden. Verschieben Sie den Pin bei Bedarf und bestätigen Sie Ihre gewählte Heimposition.</p>}
      {state === "CHANGED" && <p className="text-sm text-muted-foreground" role="status">Pin verschoben. Bitte die neue Position bestätigen.</p>}
      {state === "CONFIRMED" && (
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400" role="status">
          <CheckCircle2 className="h-4 w-4" /> Pin-Position bestätigt
        </p>
      )}

      <Button type="button" variant="outline" onClick={confirmPosition} disabled={!draftPosition || state === "CONFIRMED" || state === "LOADING"}>
        <MapPin /> {state === "CONFIRMED" ? "Diese Pin-Position ist bestätigt" : "Diese Pin-Position verwenden"}
      </Button>
    </section>
  );
}
