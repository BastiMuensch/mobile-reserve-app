"use client";

import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { useEffect } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  MAP_TILE_ATTRIBUTION,
  MAP_TILE_MAX_ZOOM,
  MAP_TILE_SUBDOMAINS,
  MAP_TILE_URL,
} from '@/lib/mapTiles';

const customSchoolIcon = new L.Icon({
  iconUrl: '/map-markers/school.svg',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

const customParkingIcon = new L.Icon({
  iconUrl: '/map-markers/parking.svg',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

const customEntranceIcon = L.divIcon({
  className: 'assignment-entrance-marker',
  html: '<span aria-hidden="true" style="display:grid;place-items:center;width:26px;height:26px;border-radius:9999px;background:#2563eb;color:white;border:2px solid white;font:700 13px sans-serif;box-shadow:0 1px 3px #334155">E</span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

import { SchoolData } from '@/types/models';

type Point = [number, number];

function FitArrivalPoints({ points }: { points: Point[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) {
      map.setView(points[0], 15);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 15 });
  }, [map, points]);
  return null;
}

export default function AssignmentMap({ school }: { school: SchoolData }) {
  if (!school) return null;
  const hasSchoolLocation = school.latitude != null && school.longitude != null;
  const hasEntrance = school.entranceLat != null && school.entranceLng != null;
  const hasParking = hasEntrance && school.parkingLat != null && school.parkingLng != null;
  const hasLegacyPin = school.pinLat != null && school.pinLng != null;
  const points: Point[] = [
    ...(hasSchoolLocation ? [[school.latitude!, school.longitude!] as Point] : []),
    ...(hasEntrance ? [[school.entranceLat!, school.entranceLng!] as Point] : []),
    ...(hasParking ? [[school.parkingLat!, school.parkingLng!] as Point] : []),
  ];
  if (points.length === 0) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Der Schulstandort wird noch ermittelt. Die Adresse bleibt in den Einsatzdetails sichtbar.</div>;
  }
  const centerLat = points.reduce((sum, [lat]) => sum + lat, 0) / points.length;
  const centerLng = points.reduce((sum, [, lng]) => sum + lng, 0) / points.length;

  return (
    <div className="space-y-2">
      {hasLegacyPin && !hasEntrance && <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">Ein älterer Karten-Pin ist vorhanden, aber nicht als Eingang oder Parkplatz eingeordnet.</p>}
      <div className="h-48 w-full rounded-xl overflow-hidden border border-border shadow-sm z-10 relative">
      <MapContainer center={[centerLat, centerLng]} zoom={15} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution={MAP_TILE_ATTRIBUTION}
          maxZoom={MAP_TILE_MAX_ZOOM}
          subdomains={MAP_TILE_SUBDOMAINS}
          url={MAP_TILE_URL}
        />
        
        <FitArrivalPoints points={points} />
        {hasSchoolLocation && <Marker position={[school.latitude!, school.longitude!]} icon={customSchoolIcon} title="Schulstandort" alt="Schulstandort">
          <Popup>
            <strong>{school.name}</strong><br/>
            Schulstandort
          </Popup>
        </Marker>}

        {hasEntrance && <Marker position={[school.entranceLat!, school.entranceLng!]} icon={customEntranceIcon} title="Eingang" alt="Eingang">
          <Popup><strong>Eingang</strong><br/>Treffpunkt für Mobile Reserven</Popup>
        </Marker>}
        {hasParking && (
          <Marker position={[school.parkingLat!, school.parkingLng!]} icon={customParkingIcon} title="Parkplatz" alt="Parkplatz">
            <Popup>
              <strong>Parkplatz</strong><br/>
              Für Mobile Reserven
            </Popup>
          </Marker>
        )}
      </MapContainer>
      </div>
    </div>
  );
}
