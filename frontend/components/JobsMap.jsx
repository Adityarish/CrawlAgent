"use client";

import { divIcon, latLngBounds } from "leaflet";
import { LocateFixed, LoaderCircle, Map as MapIcon, Minus, Mountain, Plus, Satellite } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import { groupJobsByLocation } from "../lib/jobLocations";

const TILE_STYLES = {
  street: {
    label: "Street",
    icon: MapIcon,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  },
  satellite: {
    label: "Satellite",
    icon: Satellite,
    attribution: "Tiles &copy; Esri",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  },
  terrain: {
    label: "Terrain",
    icon: Mountain,
    attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
  },
};

function FitMap({ groups, full }) {
  const map = useMap();

  useEffect(() => {
    if (!full || !groups.length) return;
    const bounds = latLngBounds(groups.map((group) => group.position));
    map.fitBounds(bounds, { padding: [64, 64], maxZoom: 6 });
  }, [full, groups, map]);

  return null;
}

function markerIcon(count, selected) {
  return divIcon({
    className: "job-map-marker-wrap",
    html: `<span class="job-map-marker${selected ? " selected" : ""}"><b>${count}</b></span>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

export default function JobsMap({ jobs, selectedId, selectedLocation, onSelect, onSelectGroup, full = false }) {
  const groups = useMemo(() => groupJobsByLocation(jobs), [jobs]);
  const mapRef = useRef(null);
  const [userPosition, setUserPosition] = useState(null);
  const [locationState, setLocationState] = useState("idle");
  const [tileStyle, setTileStyle] = useState("street");
  const activeTiles = TILE_STYLES[tileStyle];

  function locateUser() {
    if (!navigator.geolocation) {
      setLocationState("unsupported");
      return;
    }
    setLocationState("loading");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const position = [coords.latitude, coords.longitude];
        setUserPosition(position);
        setLocationState("found");
        mapRef.current?.flyTo(position, 12, { duration: 1.2 });
      },
      () => setLocationState("denied"),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  return (
    <div className={`map-shell ${full ? "map-shell-full" : ""}`}>
      <MapContainer ref={mapRef} center={[20.5937, 78.9629]} zoom={5} minZoom={3} scrollWheelZoom zoomControl={false} className="jobs-map">
        <FitMap groups={groups} full={full} />
        <TileLayer key={tileStyle} attribution={activeTiles.attribution} url={activeTiles.url} maxZoom={19} />
        {groups.map((group) => {
          const selected = selectedLocation === group.key || group.jobs.some((job) => job.id === selectedId);
          return (
            <Marker
              key={group.key}
              position={group.position}
              icon={markerIcon(group.jobs.length, selected)}
              eventHandlers={{ click: () => onSelectGroup ? onSelectGroup(group) : onSelect?.(group.jobs[0]) }}
            >
              <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                <strong>{group.label}</strong><br />{group.jobs.length} {group.jobs.length === 1 ? "role" : "roles"}
              </Tooltip>
            </Marker>
          );
        })}
        {userPosition && (
          <CircleMarker center={userPosition} radius={9} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#3277d5", fillOpacity: 1 }}>
            <Popup>You are here</Popup>
          </CircleMarker>
        )}
      </MapContainer>
      <div className="map-control-dock" aria-label="Map controls">
        <div className="map-tile-buttons" aria-label="Map style">
          {Object.entries(TILE_STYLES).map(([key, style]) => {
            const TileIcon = style.icon;
            return (
              <button
                className={tileStyle === key ? "active" : ""}
                key={key}
                onClick={() => setTileStyle(key)}
                aria-label={`${style.label} map`}
                aria-pressed={tileStyle === key}
                title={`${style.label} map`}
              >
                <TileIcon size={15} />
                <span>{style.label}</span>
              </button>
            );
          })}
        </div>
        <div className="map-navigation-buttons">
          <button className={`map-locate-control ${locationState}`} onClick={locateUser} aria-label="Show my current location" title="Show my current location">
            {locationState === "loading" ? <LoaderCircle className="spin" size={18} /> : <LocateFixed size={18} />}
          </button>
          <button onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in" title="Zoom in"><Plus size={19} /></button>
          <button onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out" title="Zoom out"><Minus size={19} /></button>
        </div>
      </div>
      {(locationState === "denied" || locationState === "unsupported") && (
        <div className="map-location-status">{locationState === "denied" ? "Location access was not available. Check your browser permission." : "This browser does not support location access."}</div>
      )}
      {!full && <div className="map-key"><span />Select a location marker to inspect its latest role</div>}
    </div>
  );
}
