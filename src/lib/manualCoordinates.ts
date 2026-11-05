/** A blank field is missing input; an explicitly entered zero is a valid coordinate. */
export function parseManualCoordinates(latitudeInput: string, longitudeInput: string): { lat: number; lng: number } | null {
  if (!latitudeInput.trim() || !longitudeInput.trim()) return null;
  const lat = Number(latitudeInput.replace(',', '.'));
  const lng = Number(longitudeInput.replace(',', '.'));
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
