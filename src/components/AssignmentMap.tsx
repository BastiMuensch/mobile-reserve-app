"use client";

import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
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

import { SchoolData } from '@/types/models';

export default function AssignmentMap({ school }: { school: SchoolData }) {
  if (!school) return null;
  if (school.latitude == null || school.longitude == null) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Der Schulstandort wird noch ermittelt. Die Adresse bleibt in den Einsatzdetails sichtbar.</div>;
  }

  const hasParking = school.pinLat != null && school.pinLng != null;
  const centerLat = hasParking ? (school.latitude + school.pinLat!) / 2 : school.latitude;
  const centerLng = hasParking ? (school.longitude + school.pinLng!) / 2 : school.longitude;

  return (
    <div className="h-48 w-full rounded-xl overflow-hidden border border-border shadow-sm z-10 relative">
      <MapContainer center={[centerLat, centerLng]} zoom={15} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution={MAP_TILE_ATTRIBUTION}
          maxZoom={MAP_TILE_MAX_ZOOM}
          subdomains={MAP_TILE_SUBDOMAINS}
          url={MAP_TILE_URL}
        />
        
        {/* School Building */}
        <Marker position={[school.latitude, school.longitude]} icon={customSchoolIcon}>
          <Popup>
            <strong>{school.name}</strong><br/>
            Haupteingang
          </Popup>
        </Marker>

        {/* Parking Pin */}
        {hasParking && (
          <Marker position={[school.pinLat!, school.pinLng!]} icon={customParkingIcon}>
            <Popup>
              <strong>Parkplatz</strong><br/>
              Für Mobile Reserven
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
