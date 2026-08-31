export type GeocodingResult =
  | { status: "RESOLVED"; latitude: number; longitude: number }
  | { status: "NOT_FOUND"; error: string }
  | { status: "UNAVAILABLE"; error: string };

export async function geocodeAddress(address: string): Promise<GeocodingResult> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`,
      {
        headers: { "User-Agent": "MobileReserve.digital/1.0 (school authority installation)" },
        signal: AbortSignal.timeout(7000),
        cache: "no-store",
      },
    );
    if (!response.ok) {
      return { status: "UNAVAILABLE", error: `Geokodierungsdienst antwortete mit HTTP ${response.status}.` };
    }

    const results: unknown = await response.json();
    if (!Array.isArray(results) || !results[0] || typeof results[0] !== "object") {
      return { status: "NOT_FOUND", error: "Die Adresse wurde nicht gefunden." };
    }

    const item = results[0] as { lat?: unknown; lon?: unknown };
    const latitude = Number(item.lat);
    const longitude = Number(item.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { status: "NOT_FOUND", error: "Die Adresse lieferte keine gültigen Koordinaten." };
    }
    return { status: "RESOLVED", latitude, longitude };
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      error: error instanceof Error ? `Geokodierung derzeit nicht verfügbar: ${error.message}` : "Geokodierung derzeit nicht verfügbar.",
    };
  }
}
