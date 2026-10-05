/** A site never replaces the organizational school ID or its eligibility rules. */
export type SchoolLocationData = {
  id: string;
  schoolId: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  generalInfo: string | null;
  imageUrl: string | null;
  entranceLat: number | null;
  entranceLng: number | null;
  parkingLat: number | null;
  parkingLng: number | null;
  isActive: boolean;
};

export function deploymentSchoolName(request: { school: { name: string }; location?: { name: string } | null }): string {
  return request.location ? `${request.school.name} · ${request.location.name}` : request.school.name;
}

/** No fallback to the main site's address, pins, photo or notes for a branch. */
export function deploymentSchool<T extends { name: string }>(school: T, location?: SchoolLocationData | null) {
  if (!location) return school;
  return { ...school, name: `${school.name} · ${location.name}`, address: location.address,
    latitude: location.latitude, longitude: location.longitude,
    generalInfo: location.generalInfo, imageUrl: location.imageUrl,
    pinLat: null, pinLng: null, entranceLat: location.entranceLat, entranceLng: location.entranceLng,
    parkingLat: location.parkingLat, parkingLng: location.parkingLng };
}

export function deploymentCoordinates(
  school: { latitude: number | null; longitude: number | null },
  request: { locationId?: string | null; location?: { latitude: number | null; longitude: number | null } | null },
) {
  // A missing relation must not quietly route an outside-site request to main.
  return request.location ?? (request.locationId ? { latitude: null, longitude: null } : school);
}
