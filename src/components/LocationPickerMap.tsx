"use client";

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
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

const customTeacherIcon = new L.Icon({
  iconUrl: '/map-markers/teacher.svg',
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

type MarkerType = 'school' | 'teacher' | 'parking';
type Position = { lat: number; lng: number };

const markerIcons: Record<MarkerType, L.Icon> = {
  school: customSchoolIcon,
  teacher: customTeacherIcon,
  parking: customParkingIcon,
};

function LocationMarker({
  position,
  setPosition,
  markerType,
  draggable,
  markerLabel,
}: {
  position: Position | null;
  setPosition: (p: Position) => void;
  markerType: MarkerType;
  draggable: boolean;
  markerLabel: string;
}) {
  useMapEvents({
    click(e) {
      setPosition({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });

  return position === null ? null : (
    <Marker
      position={[position.lat, position.lng]}
      icon={markerIcons[markerType]}
      title={markerLabel}
      alt={markerLabel}
      draggable={draggable}
      eventHandlers={draggable ? {
        dragend(event) {
          const marker = event.target as L.Marker;
          const nextPosition = marker.getLatLng();
          setPosition({ lat: nextPosition.lat, lng: nextPosition.lng });
        },
      } : undefined}
    />
  )
}

function RecenterMap({ position, zoom }: { position: Position | null; zoom: number }) {
  const map = useMap();
  const latitude = position?.lat;
  const longitude = position?.lng;

  useEffect(() => {
    if (latitude !== undefined && longitude !== undefined) {
      map.setView([latitude, longitude], zoom);
    }
  }, [latitude, longitude, map, zoom]);

  return null;
}

interface LocationPickerMapProps {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
  heightClass?: string;
  markerType?: MarkerType;
  draggable?: boolean;
  showDefaultMarker?: boolean;
  positionZoom?: number;
  markerLabel?: string;
}

export default function LocationPickerMap({
  lat,
  lng,
  onChange,
  heightClass = "h-[250px]",
  markerType = 'school',
  draggable = false,
  showDefaultMarker = true,
  positionZoom = 16,
  markerLabel = 'Ausgewählter Standort',
}: LocationPickerMapProps) {
  const defaultLat = 48.79; // Approx center of Bayern
  const defaultLng = 11.49;
  const hasPosition = lat !== null && lng !== null;
  const position = hasPosition
    ? { lat, lng }
    : showDefaultMarker
      ? { lat: defaultLat, lng: defaultLng }
      : null;
  const zoom = hasPosition ? positionZoom : 7;

  return (
    <div
      className={`${heightClass} w-full rounded-md overflow-hidden border border-border z-10 relative mt-2`}
      role="region"
      aria-label="Karte zur Auswahl der ungefähren Position. Alternativ können Koordinaten im Formular eingegeben werden."
    >
      <MapContainer center={[lat ?? defaultLat, lng ?? defaultLng]} zoom={zoom} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution={MAP_TILE_ATTRIBUTION}
          maxZoom={MAP_TILE_MAX_ZOOM}
          subdomains={MAP_TILE_SUBDOMAINS}
          url={MAP_TILE_URL}
        />
        <RecenterMap position={hasPosition ? position : null} zoom={zoom} />
        <LocationMarker
          position={position}
          setPosition={(p) => onChange(p.lat, p.lng)}
          markerType={markerType}
          draggable={draggable}
          markerLabel={markerLabel}
        />
      </MapContainer>
    </div>
  );
}
