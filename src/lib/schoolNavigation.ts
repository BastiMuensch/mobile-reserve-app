export type SchoolNavigationPoints = {
  entranceLat?: number | null;
  entranceLng?: number | null;
  parkingLat?: number | null;
  parkingLng?: number | null;
};

/** New arrival points have explicit meaning; legacy pin coordinates are not input. */
export function validateSchoolNavigationPoints(points: SchoolNavigationPoints): string | null {
  const entranceSet = points.entranceLat != null || points.entranceLng != null;
  const entranceComplete = points.entranceLat != null && points.entranceLng != null;
  const parkingSet = points.parkingLat != null || points.parkingLng != null;
  const parkingComplete = points.parkingLat != null && points.parkingLng != null;
  if (entranceSet && !entranceComplete) return 'Eingang-Koordinaten müssen paarweise angegeben werden.';
  if (parkingSet && !parkingComplete) return 'Parkplatz-Koordinaten müssen paarweise angegeben werden.';
  if (parkingComplete && !entranceComplete) return 'Ein Parkplatz kann nur zusammen mit einem Eingang gespeichert werden.';
  return null;
}

/** PATCH payloads are partial; validate the resulting persisted state, not only the body. */
export function mergeSchoolNavigationPoints(existing: Required<SchoolNavigationPoints>, update: SchoolNavigationPoints): Required<SchoolNavigationPoints> {
  return {
    entranceLat: update.entranceLat === undefined ? existing.entranceLat : update.entranceLat,
    entranceLng: update.entranceLng === undefined ? existing.entranceLng : update.entranceLng,
    parkingLat: update.parkingLat === undefined ? existing.parkingLat : update.parkingLat,
    parkingLng: update.parkingLng === undefined ? existing.parkingLng : update.parkingLng,
  };
}
