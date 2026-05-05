"use client";

import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect } from 'react';

const customSchoolIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const customParkingIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

export default function AssignmentMap({ school }: any) {
  useEffect(() => {
    delete (L.Icon.Default.prototype as any)._getIconUrl;
  }, []);

  if (!school) return null;

  const hasParking = school.pinLat != null && school.pinLng != null;
  const centerLat = hasParking ? (school.latitude + school.pinLat) / 2 : school.latitude;
  const centerLng = hasParking ? (school.longitude + school.pinLng) / 2 : school.longitude;

  return (
    <div className="h-48 w-full rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm z-10 relative">
      <MapContainer center={[centerLat, centerLng]} zoom={15} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; OSM'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
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
          <Marker position={[school.pinLat, school.pinLng]} icon={customParkingIcon}>
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
