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

export default function MapComponent({ schools, teachers, activeRequest, focusedLocation }: any) {
  useEffect(() => {
    // Delete default icon to prevent missing icon error
    delete (L.Icon.Default.prototype as any)._getIconUrl;
  }, []);

  const center: [number, number] = [48.01, 10.5]; // Approx center of Unterallgäu

  return (
    <div className="h-[500px] w-full rounded-lg overflow-hidden border border-slate-200 shadow-inner z-10 relative">
      <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }}>
        <MapFlyTo location={focusedLocation} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />

        <MarkerClusterGroup chunkedLoading maxClusterRadius={40}>
          {/* Render Schools */}
          {schools?.map((school: any) => (
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
          {teachers?.map((teacher: any) => (
            <Marker 
              key={`teacher-${teacher.id}`} 
              position={[teacher.homeLat, teacher.homeLng]}
              icon={customTeacherIcon}
              opacity={teacher.status === 'SICK' ? 0.4 : 1}
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
        {activeRequest && activeRequest.candidates?.map((candidate: any) => {
          const requestingSchool = schools.find((s: any) => s.id === activeRequest.schoolId);
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
