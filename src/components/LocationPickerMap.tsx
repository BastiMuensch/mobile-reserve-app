"use client";

import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
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

function LocationMarker({ position, setPosition }: { position: {lat: number, lng: number}, setPosition: (p: {lat: number, lng: number}) => void }) {
  useMapEvents({
    click(e) {
      setPosition({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });

  return position === null ? null : (
    <Marker position={[position.lat, position.lng]} icon={customSchoolIcon} />
  )
}

export default function LocationPickerMap({ lat, lng, onChange }: { lat: number | null, lng: number | null, onChange: (lat: number, lng: number) => void }) {
  useEffect(() => {
    // Delete default icon to prevent missing icon error
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });
  }, []);

  const defaultLat = lat ?? 48.79; // Approx center of Bayern
  const defaultLng = lng ?? 11.49;
  const position = { lat: defaultLat, lng: defaultLng };

  return (
    <div className="h-[250px] w-full rounded-md overflow-hidden border border-border z-10 relative mt-2">
      <MapContainer center={[defaultLat, defaultLng]} zoom={lat === null ? 7 : 16} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; OSM'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />
        <LocationMarker position={position} setPosition={(p) => onChange(p.lat, p.lng)} />
      </MapContainer>
    </div>
  );
}
