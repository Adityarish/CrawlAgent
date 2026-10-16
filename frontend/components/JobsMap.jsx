"use client";

import { divIcon, latLngBounds } from "leaflet";
import { LocateFixed, LoaderCircle, Map as MapIcon, Minus, Mountain, Plus, Satellite, WalletCards } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
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

function expenseIcon(label, tier, clusterCount = null) {
  const content = clusterCount ? `<b>${clusterCount}</b><small>areas</small>` : `<b>${label}</b>`;
  const width = clusterCount ? 56 : label?.length > 1 ? 76 : 40;
  return divIcon({
    className: "expense-map-marker-wrap",
    html: `<span class="expense-map-marker ${tier}${clusterCount ? " expense-cluster" : ""}">${content}</span>`,
    iconSize: [width, clusterCount ? 42 : 34],
    iconAnchor: [clusterCount ? width / 2 : width / 2 - 12, clusterCount ? 21 : 5],
  });
}

function MapViewport({ onChange }) {
  const map = useMapEvents({ zoomend: () => onChange(), moveend: () => onChange() });
  useEffect(() => { onChange(); }, [map, onChange]);
  return null;
}

function expenseTier(total, thresholds) {
  if (total <= thresholds.low) return "affordable";
  if (total <= thresholds.high) return "moderate";
  return "expensive";
}

const EXPENSE_CATEGORIES = ["rent", "foodGroceries", "transportation", "utilities", "miscellaneous", "total"];

function expenseCostsFor(location, household) {
  const costs = Object.fromEntries(EXPENSE_CATEGORIES.map((category) => [category, Number(location?.costs?.[category]?.[household])]));
  return Object.values(costs).every(Number.isFinite) ? costs : null;
}

function ExpenseLayer({ locations, household }) {
  const map = useMap();
  const [viewportVersion, setViewportVersion] = useState(0);
  const onViewportChange = useCallback(() => setViewportVersion((value) => value + 1), []);
  const zoom = map.getZoom();
  const usableLocations = useMemo(() => locations
    .map((location) => ({ ...location, selectedCosts: expenseCostsFor(location, household) }))
    .filter((location) => (
      location.selectedCosts
      && Array.isArray(location.position)
      && location.position.length === 2
      && location.position.every(Number.isFinite)
    )), [household, locations]);
  const selectedCosts = usableLocations.map((location) => location.selectedCosts.total).sort((a, b) => a - b);
  const thresholds = {
    low: selectedCosts[Math.floor((selectedCosts.length - 1) / 3)] || 0,
    high: selectedCosts[Math.floor(((selectedCosts.length - 1) * 2) / 3)] || 0,
  };
  const visible = useMemo(() => {
    const bucketSize = zoom < 8 ? 64 : 88;
    const buckets = new Map();
    usableLocations.forEach((location) => {
      const point = map.latLngToLayerPoint(location.position);
      const key = `${Math.floor(point.x / bucketSize)}:${Math.floor(point.y / bucketSize)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(location);
    });
    return [...buckets.values()].map((items) => {
      const position = items.length === 1
        ? items[0].position
        : [items.reduce((sum, item) => sum + item.position[0], 0) / items.length, items.reduce((sum, item) => sum + item.position[1], 0) / items.length];
      return { items, position };
    });
  }, [map, usableLocations, viewportVersion, zoom]);

  return (
    <>
      <MapViewport onChange={onViewportChange} />
      {visible.map(({ items, position }) => {
        const total = items.reduce((sum, item) => sum + item.selectedCosts.total, 0) / items.length;
        const tier = expenseTier(total, thresholds);
        if (items.length > 1) {
          return (
            <Marker
              key={`expense-cluster-${items.map((item) => item.key).join("-")}`}
              position={position}
              icon={expenseIcon(null, tier, items.length)}
              eventHandlers={{ click: () => map.flyTo(position, Math.min(9, zoom + 2), { duration: .7 }) }}
            >
              <Tooltip direction="top" offset={[0, -18]} opacity={1}>{items.length} locations · zoom in to explore costs</Tooltip>
            </Marker>
          );
        }
        const location = items[0];
        return (
          <Marker
            key={`expense-${location.key}`}
            position={location.position}
            icon={expenseIcon(zoom >= 7 ? `₹${Math.round(location.selectedCosts.total / 1000)}k` : "₹", tier)}
          >
            <Popup className="expense-map-popup" minWidth={260} maxWidth={320}>
              <ExpenseBreakdown location={location} household={household} />
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

function ExpenseBreakdown({ location, household }) {
  const costs = location.selectedCosts || expenseCostsFor(location, household);
  const formatRupees = (value) => `₹${Number(value).toLocaleString("en-IN")}`;
  if (!costs) return <div className="expense-popup-content"><p className="expense-popup-note">Expense details are unavailable for this location.</p></div>;
  const rows = [
    ["Rent", costs.rent],
    ["Food & groceries", costs.foodGroceries],
    ["Transportation", costs.transportation],
    ["Utilities", costs.utilities],
    ["Miscellaneous", costs.miscellaneous],
  ];
  return (
    <div className="expense-popup-content">
      <div className="expense-popup-heading"><span className="eyebrow">Estimated monthly budget</span><h3>{location.name}</h3><p>{location.state} · {household === "single" ? "Single person" : "Family of 3"}</p></div>
      <div className="expense-breakdown-rows">{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{formatRupees(value)}</strong></div>)}</div>
      <div className="expense-breakdown-total"><span>Total / month</span><strong>{formatRupees(costs.total)}</strong></div>
      <p className="expense-popup-note">Modeled Oct 2026 estimate, not observed prices. Based on {location.sourceCount} linked urban estimate{location.sourceCount === 1 ? "" : "s"}. Food and groceries are combined; childcare, school, major healthcare, taxes and savings are excluded.</p>
    </div>
  );
}

function ExpenseControls({ enabled, onToggle, household, onHouseholdChange, loading, error, count }) {
  return (
    <div className={`map-expense-controls ${enabled ? "expanded" : ""}`}>
      <button className={`map-expense-toggle ${enabled ? "active" : ""}`} onClick={onToggle} aria-pressed={enabled}>
        <WalletCards size={16} />Expenses<span className="map-expense-switch" aria-hidden="true"><i /></span>
      </button>
      {enabled && (
        <div className="map-expense-options">
          <div className="map-expense-selector" role="group" aria-label="Household size">
            <button className={household === "single" ? "active" : ""} onClick={() => onHouseholdChange("single")} aria-pressed={household === "single"}>Single person</button>
            <button className={household === "family3" ? "active" : ""} onClick={() => onHouseholdChange("family3")} aria-pressed={household === "family3"}>Family of 3</button>
          </div>
          {loading ? <div className="map-expense-status"><LoaderCircle className="spin" size={14} />Loading estimates…</div> : error ? <div className="map-expense-status error">{error}</div> : (
            <>
              <div className="map-expense-legend"><span className="affordable" />Affordable<span className="moderate" />Moderate<span className="expensive" />Expensive</div>
              <p className="map-expense-caption">{count} city and district estimates · INR / month · zoom in for prices</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function JobsMap({ jobs, selectedId, selectedLocation, onSelect, onSelectGroup, full = false }) {
  const groups = useMemo(() => groupJobsByLocation(jobs), [jobs]);
  const mapRef = useRef(null);
  const [userPosition, setUserPosition] = useState(null);
  const [locationState, setLocationState] = useState("idle");
  const [tileStyle, setTileStyle] = useState("street");
  const [expensesEnabled, setExpensesEnabled] = useState(false);
  const [expenseLocations, setExpenseLocations] = useState([]);
  const [expenseLoading, setExpenseLoading] = useState(false);
  const [expenseError, setExpenseError] = useState("");
  const [household, setHousehold] = useState("single");
  const activeTiles = TILE_STYLES[tileStyle];

  useEffect(() => {
    if (!expensesEnabled || expenseLocations.length || expenseError) return;
    let cancelled = false;
    setExpenseLoading(true);
    fetch("/api/expenses")
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Expense estimates could not be loaded.");
        return payload;
      })
      .then((payload) => {
        if (!cancelled) setExpenseLocations(Array.isArray(payload.locations) ? payload.locations : []);
      })
      .catch((error) => { if (!cancelled) setExpenseError(error.message || "Expense estimates could not be loaded."); })
      .finally(() => { if (!cancelled) setExpenseLoading(false); });
    return () => { cancelled = true; };
  }, [expensesEnabled, expenseError, expenseLocations.length]);

  function toggleExpenses() {
    setExpensesEnabled((enabled) => !enabled);
    setExpenseError("");
  }

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
        {expensesEnabled && expenseLocations.length > 0 && <ExpenseLayer locations={expenseLocations} household={household} />}
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
      <ExpenseControls
        enabled={expensesEnabled}
        onToggle={toggleExpenses}
        household={household}
        onHouseholdChange={setHousehold}
        loading={expenseLoading}
        error={expenseError}
        count={expenseLocations.length}
      />
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
