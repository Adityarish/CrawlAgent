"use client";

import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";

const coordinates = {
  ahmedabad: [23.0225, 72.5714],
  bengaluru: [12.9716, 77.5946],
  bangalore: [12.9716, 77.5946],
  chennai: [13.0827, 80.2707],
  delhi: [28.6139, 77.209],
  gurugram: [28.4595, 77.0266],
  gurgaon: [28.4595, 77.0266],
  hyderabad: [17.385, 78.4867],
  kolkata: [22.5726, 88.3639],
  mumbai: [19.076, 72.8777],
  noida: [28.5355, 77.391],
  pune: [18.5204, 73.8567],
};

function locate(city = "") {
  const normalized = city.toLowerCase().trim();
  const match = Object.keys(coordinates).find((name) => normalized.includes(name));
  return coordinates[match] || [22.5937, 78.9629];
}

export default function JobsMap({ jobs, selectedId, onSelect }) {
  const groups = Object.values(
    jobs.reduce((result, job) => {
      const city = job.city || "Across India";
      if (!result[city]) result[city] = { city, position: locate(city), jobs: [] };
      result[city].jobs.push(job);
      return result;
    }, {})
  );

  return (
    <div className="map-shell">
      <MapContainer center={[22.5937, 78.9629]} zoom={5} minZoom={4} scrollWheelZoom className="jobs-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {groups.map((group) => {
          const selected = group.jobs.some((job) => job.id === selectedId);
          return (
            <CircleMarker
              key={group.city}
              center={group.position}
              radius={selected ? 15 : 12}
              pathOptions={{ color: selected ? "#173d2c" : "#ffffff", weight: 3, fillColor: selected ? "#d9ff6b" : "#173d2c", fillOpacity: 1 }}
              eventHandlers={{ click: () => onSelect(group.jobs[0]) }}
            >
              <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                <strong>{group.city}</strong><br />{group.jobs.length} {group.jobs.length === 1 ? "role" : "roles"}
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <div className="map-key"><span />Select a city marker to inspect its latest role</div>
    </div>
  );
}
