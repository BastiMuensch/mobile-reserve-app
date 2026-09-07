"use client";

import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import L from 'leaflet';
import { useEffect, useState } from 'react';
import {
  MAP_TILE_ATTRIBUTION,
  MAP_TILE_MAX_ZOOM,
  MAP_TILE_SUBDOMAINS,
  MAP_TILE_URL,
} from '@/lib/mapTiles';

// Explicit local icons avoid browser requests to third-party asset CDNs.
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

import MarkerClusterGroup from 'react-leaflet-cluster';
import { useMap } from 'react-leaflet';

// Internal component to handle map flying
function MapFlyTo({ location }: { location: { lat: number, lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (location) {
      map.flyTo([location.lat, location.lng], 15, { duration: 1.5 });
    }
  }, [location, map]);
  return null;
}

function CenterUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  const [latitude, longitude] = center;
  useEffect(() => {
    map.setView([latitude, longitude], map.getZoom());
  }, [latitude, longitude, map]);
  return null;
}

import { SchoolData, TeacherData, RequestData } from '@/types/models';

export default function MapComponent({ 
  schools, 
  teachers, 
  activeRequest, 
  focusedLocation, 
  centerCoord 
}: {
  schools?: SchoolData[],
  teachers?: TeacherData[],
  activeRequest?: (RequestData & { candidates?: TeacherData[] }) | null,
  focusedLocation?: {lat: number, lng: number} | null,
  centerCoord?: [number, number] | null
}) {
  const [tileError, setTileError] = useState(false);
  const center: [number, number] = centerCoord && centerCoord.length === 2 && centerCoord[0] !== null && centerCoord[1] !== null 
    ? [centerCoord[0], centerCoord[1]] 
    : [48.79, 11.49]; // Approx center of Bayern (Ingolstadt)

  return (
    <div className="h-[420px] max-h-[65dvh] w-full overflow-hidden z-0 relative">
      {tileError && <div role="status" className="absolute bottom-12 left-3 right-3 z-[500] rounded-lg bg-card/95 border border-border p-2 text-xs shadow-sm">Der Kartenhintergrund ist teilweise nicht verfügbar. Die Standort-Pins bleiben sichtbar.</div>}
      <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }}>
        <CenterUpdater center={center} />
        <MapFlyTo location={focusedLocation || null} />
        <TileLayer
          attribution={MAP_TILE_ATTRIBUTION}
          maxZoom={MAP_TILE_MAX_ZOOM}
          subdomains={MAP_TILE_SUBDOMAINS}
          url={MAP_TILE_URL}
          eventHandlers={{ loading: () => setTileError(false), tileerror: () => setTileError(true) }}
        />

        <MarkerClusterGroup chunkedLoading maxClusterRadius={40}>
          {/* Render Schools */}
          {schools?.filter((school) => school.latitude != null && school.longitude != null).map((school) => (
            <Marker 
              key={`school-${school.id}`} 
              position={[school.latitude!, school.longitude!]}
              icon={customSchoolIcon}
            >
              <Popup>
                <strong>{school.name}</strong><br/>
                {school.type === 'GRUNDSCHULE' ? 'Grundschule' : school.type === 'MITTELSCHULE' ? 'Mittelschule' : school.type}
              </Popup>
            </Marker>
          ))}

          {/* Render Teachers */}
          {teachers?.map((teacher) => (
            <Marker 
              key={`teacher-${teacher.id}`} 
              position={[teacher.homeLat, teacher.homeLng]}
              icon={customTeacherIcon}
              opacity={teacher.status === 'UNAVAILABLE' || teacher.isAbsentToday || teacher.currentLeave ? 0.4 : 1}
            >
              <Popup>
                <strong>{teacher.name}</strong><br/>
                {teacher.currentLeave ? 'Langzeitabwesenheit' : teacher.isAbsentToday || teacher.status === 'UNAVAILABLE' ? 'Heute abwesend' : teacher.status === 'ACTIVE' ? 'Aktives Profil' : 'Freigabe ausstehend'}<br/>
                Qualifikation: {teacher.qualifications}
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>

        {/* Render Lines for Active Request Candidates */}
        {activeRequest && activeRequest.candidates?.map((candidate: TeacherData) => {
          const requestingSchool = schools?.find((s) => s.id === activeRequest.schoolId);
          if (!requestingSchool || requestingSchool.latitude == null || requestingSchool.longitude == null) return null;
          
          return (
            <Polyline 
              key={`line-${candidate.id}`}
              positions={[
                [requestingSchool.latitude, requestingSchool.longitude],
                [candidate.homeLat, candidate.homeLng]
              ]}
              color="indigo"
              weight={2}
              opacity={0.6}
              dashArray="5, 10"
            />
          );
        })}
      </MapContainer>
    </div>
  );
}
