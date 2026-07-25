"use client";

import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import L from 'leaflet';
import { useEffect } from 'react';

// Fix for default Leaflet icons in Next.js
const customSchoolIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const customTeacherIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
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
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center[0], center[1], map]);
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
  useEffect(() => {
    // Delete default icon to prevent missing icon error
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });
  }, []);

  const center: [number, number] = centerCoord && centerCoord.length === 2 && centerCoord[0] !== null && centerCoord[1] !== null 
    ? [centerCoord[0], centerCoord[1]] 
    : [48.79, 11.49]; // Approx center of Bayern (Ingolstadt)

  return (
    <div className="h-[500px] w-full rounded-lg overflow-hidden border border-border shadow-inner z-10 relative">
      <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }}>
        <CenterUpdater center={center} />
        <MapFlyTo location={focusedLocation || null} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />

        <MarkerClusterGroup chunkedLoading maxClusterRadius={40}>
          {/* Render Schools */}
          {schools?.map((school) => (
            <Marker 
              key={`school-${school.id}`} 
              position={[school.latitude, school.longitude]}
              icon={customSchoolIcon}
            >
              <Popup>
                <strong>{school.name}</strong><br/>
                {school.type}
              </Popup>
            </Marker>
          ))}

          {/* Render Teachers */}
          {teachers?.map((teacher) => (
            <Marker 
              key={`teacher-${teacher.id}`} 
              position={[teacher.homeLat, teacher.homeLng]}
              icon={customTeacherIcon}
              opacity={teacher.status === 'UNAVAILABLE' ? 0.4 : 1}
            >
              <Popup>
                <strong>{teacher.name}</strong><br/>
                Status: {teacher.status}<br/>
                Quals: {teacher.qualifications}
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>

        {/* Render Lines for Active Request Candidates */}
        {activeRequest && activeRequest.candidates?.map((candidate: TeacherData) => {
          const requestingSchool = schools?.find((s) => s.id === activeRequest.schoolId);
          if (!requestingSchool) return null;
          
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
