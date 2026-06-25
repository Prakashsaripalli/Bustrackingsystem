"use client";

/**
 * AdminMap — Admin Live Map
 * Fully upgraded to support the premium student map features:
 *  • Draws Start A + End B pins, teardrop intermediate stops, marching-dash line animations
 *  • Shows alternative routes when active tracking is happening
 *  • Queries and overlays previous completed trip path as a dashed purple line
 *  • Implements deviation detection (displays deviation warning badge if >100m away)
 *  • Smooth lerped position updates for active buses
 */

import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getDirectionalStops } from "@/utils/routeDirection";

interface Stop { name: string; lat: number; lng: number; }

interface ActiveBus {
  busId:       string;
  lat:         number;
  lng:         number;
  speed:       number;
  heading?:    number;
  lastUpdated: string;
  routeName?:  string;
  driverName?: string;
}

interface AdminMapProps {
  activeBuses:  ActiveBus[];
  selectedBusId?: string | null;
  onBusSelect?: (busId: string) => void;
  buses?: any[];
  routes?: any[];
  userLocation?: { lat: number; lng: number } | null;
  students?: any[];
}

function parseStopCoords(raw: any): Stop[] {
  if (!raw) return [];
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return []; } }
  if (Array.isArray(raw)) return raw;
  return [];
}

/* ── smooth lerp ── */
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

/* ── Distance calculator (Haversine in meters) ── */
function getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/* ── Calculate minimum distance to a route path ── */
function getDistanceToRoute(lat: number, lng: number, path: L.LatLngTuple[]): number {
  if (path.length === 0) return Infinity;
  if (path.length <= 4) {
    let minD = Infinity;
    for (const coord of path) {
      const d = getDistance(lat, lng, coord[0], coord[1]);
      if (d < minD) minD = d;
    }
    return minD;
  }
  let minD = Infinity;
  for (let i = 3; i < path.length; i++) {
    const d = getDistance(lat, lng, path[i][0], path[i][1]);
    if (d < minD) minD = d;
  }
  return minD;
}

/* ── Slice route path to start at tracker position ── */
function slicePathFromTracker(lat: number, lng: number, path: L.LatLngTuple[]): L.LatLngTuple[] {
  if (path.length < 2) return path;
  
  let closestIdx = 0;
  let minD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = getDistance(lat, lng, path[i][0], path[i][1]);
    if (d < minD) {
      minD = d;
      closestIdx = i;
    }
  }
  
  const startSlice = Math.max(0, closestIdx - 1);
  const sliced = path.slice(startSlice);
  
  if (sliced.length < 2) {
    return [[lat, lng], path[path.length - 1]];
  }
  
  sliced[0] = [lat, lng];
  return sliced;
}

interface OSRMRoute {
  path: L.LatLngTuple[];
  distKm: number;
  durMin: number;
}

/* ── Fetch path from OSRM with alternatives ── */
async function fetchDynamicRoadPaths(start: L.LatLngTuple, end: L.LatLngTuple): Promise<OSRMRoute[]> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson&alternatives=false`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    if (d.code !== "Ok" || !d.routes || d.routes.length === 0) {
      return [{ path: [start, end], distKm: 0, durMin: 0 }];
    }
    return d.routes.map((route: any) => ({
      path: (route.geometry.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng] as L.LatLngTuple),
      distKm: +(route.distance / 1000).toFixed(1),
      durMin: Math.round(route.duration / 60),
    }));
  } catch (e) {
    console.error("fetchDynamicRoadPaths error:", e);
    return [{ path: [start, end], distKm: 0, durMin: 0 }];
  }
}

/* ── Fetch multi-stop path ── */
async function fetchMultiStopPaths(trackerCoords: L.LatLngTuple, remainingStops: Stop[]): Promise<OSRMRoute[]> {
  if (remainingStops.length === 0) {
    return [{ path: [trackerCoords], distKm: 0, durMin: 0 }];
  }

  const orderedCoords = [
    `${trackerCoords[1]},${trackerCoords[0]}`,
    ...remainingStops.map(s => `${s.lng},${s.lat}`),
  ];

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${orderedCoords.join(";")}?overview=full&geometries=geojson&steps=false&alternatives=false`;
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const data = await response.json();

    if (data.code !== "Ok" || !data.routes?.[0]) {
      const endCoords: L.LatLngTuple = [remainingStops[remainingStops.length - 1].lat, remainingStops[remainingStops.length - 1].lng];
      return fetchDynamicRoadPaths(trackerCoords, endCoords);
    }

    const route = data.routes[0];
    const path = (route.geometry.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng] as L.LatLngTuple);
    return [{
      path,
      distKm: +(route.distance / 1000).toFixed(1),
      durMin: Math.max(1, Math.round(route.duration / 60)),
    }];
  } catch (e) {
    console.error("fetchMultiStopPaths error:", e);
    const endCoords: L.LatLngTuple = [remainingStops[remainingStops.length - 1].lat, remainingStops[remainingStops.length - 1].lng];
    return fetchDynamicRoadPaths(trackerCoords, endCoords);
  }
}


/* ── Fetch OSRM road path computed leg-by-leg in parallel ── */
async function fetchRoadPath(stops: Stop[]): Promise<L.LatLngTuple[]> {
  if (stops.length < 2) return stops.map(s => [s.lat, s.lng] as L.LatLngTuple);
  
  const legPromises = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const start = stops[i];
    const end = stops[i + 1];
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
    
    legPromises.push(
      fetch(url, { signal: AbortSignal.timeout(10000) })
        .then(async (r) => {
          if (!r.ok) return null;
          const d = await r.json();
          if (d.code !== "Ok" || !d.routes?.[0]) return null;
          return (d.routes[0].geometry.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng] as L.LatLngTuple);
        })
        .catch(() => null)
    );
  }

  const legs = await Promise.all(legPromises);

  const combinedPath: L.LatLngTuple[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const legPath = legs[i];
    if (legPath) {
      if (combinedPath.length === 0) {
        combinedPath.push(...legPath);
      } else {
        combinedPath.push(...legPath.slice(1));
      }
    } else {
      const start = stops[i];
      const end = stops[i + 1];
      if (combinedPath.length === 0) {
        combinedPath.push([start.lat, start.lng], [end.lat, end.lng]);
      } else {
        combinedPath.push([end.lat, end.lng]);
      }
    }
  }

  return combinedPath;
}

/* ── Snap coordinates to closest point on a road path (if within ~500m) ── */
function snapToPath(lat: number, lng: number, path: L.LatLngTuple[]): L.LatLngTuple {
  if (!path || path.length === 0) return [lat, lng];
  if (path.length === 1) return path[0];

  let minDistance = Infinity;
  let snappedPoint: L.LatLngTuple = path[0];

  for (let i = 0; i < path.length - 1; i++) {
    const A = path[i];
    const B = path[i + 1];

    const latA = A[0], lngA = A[1];
    const latB = B[0], lngB = B[1];

    const dLat = latB - latA;
    const dLng = lngB - lngA;

    const ab2 = dLat * dLat + dLng * dLng;
    let t = 0;
    if (ab2 > 0) {
      t = ((lat - latA) * dLat + (lng - lngA) * dLng) / ab2;
      t = Math.max(0, Math.min(1, t));
    }

    const snapLat = latA + t * dLat;
    const snapLng = lngA + t * dLng;

    const d = (lat - snapLat) * (lat - snapLat) + (lng - snapLng) * (lng - snapLng);
    if (d < minDistance) {
      minDistance = d;
      snappedPoint = [snapLat, snapLng];
    }
  }

  // 0.000025 in degrees squared is roughly 500 meters squared
  if (minDistance < 0.000025) {
    return snappedPoint;
  }
  return [lat, lng];
}

function makePin(type: "start" | "end", label: string): L.DivIcon {
  const color  = type === "start" ? "#16A34A" : "#DC2626";
  const letter = type === "start" ? "A" : "B";
  return L.divIcon({
    html: `
      <div style="position:relative;width:38px">
        <svg width="38" height="52" viewBox="0 0 38 52" style="display:block;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.18))">
          <path d="M19 1C9.33 1 1.5 8.83 1.5 18.5C1.5 32.5 19 51 19 51S36.5 32.5 36.5 18.5C36.5 8.83 28.67 1 19 1Z" fill="${color}" stroke="white" stroke-width="1.5"/>
          <circle cx="19" cy="18" r="9" fill="white"/>
        </svg>
        <span style="position:absolute;top:5px;left:50%;transform:translateX(-50%);font-size:13px;font-weight:800;color:${color};font-family:Inter,system-ui,sans-serif;line-height:1">${letter}</span>
        <div style="position:absolute;top:56px;left:50%;transform:translateX(-50%);background:rgba(255,255,255,0.96);color:#475569;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:800;white-space:nowrap;box-shadow:0 1px 5px rgba(37,99,235,0.08);font-family:Inter,system-ui,sans-serif;max-width:160px;overflow:hidden;text-overflow:ellipsis;pointer-events:none;border:1px solid rgba(37,99,235,0.08)">${label}</div>
      </div>`,
    className: "", iconSize: [38,52], iconAnchor: [19,52], popupAnchor: [0,-56],
  });
}

/* ── Top-view animated bus icon (same as TrackingMap) ── */
function makeBusIcon(busId: string, isSelected: boolean, heading: number): L.DivIcon {
  const sz   = isSelected ? 52 : 44;
  const color = isSelected
    ? "linear-gradient(145deg,#7C3AED,#9333EA)"
    : "linear-gradient(145deg,#1D4ED8,#3B82F6)";
  const shadow = isSelected
    ? "0 0 0 6px rgba(124,58,237,0.25), 0 6px 24px rgba(124,58,237,0.55)"
    : "0 0 0 4px rgba(37,99,235,0.2), 0 4px 16px rgba(37,99,235,0.45)";
  const pulse  = isSelected
    ? `<div style="position:absolute;inset:-9px;border-radius:50%;border:3px solid rgba(${isSelected?"124,58,237":"37,99,235"},0.4);animation:__admpulse 1.5s ease-in-out infinite;pointer-events:none;"></div>
       <div style="position:absolute;inset:-3px;border-radius:50%;border:2px solid rgba(${isSelected?"124,58,237":"37,99,235"},0.5);animation:__admpulse 1.5s ease-in-out 0.35s infinite;pointer-events:none;"></div>`
    : `<div style="position:absolute;inset:-5px;border-radius:50%;border:2px solid rgba(37,99,235,0.3);animation:__admpulse 2s ease-in-out infinite;pointer-events:none;"></div>`;

  return L.divIcon({
    html: `
      <div style="position:relative;display:flex;align-items:center;justify-content:center;">
        ${pulse}
        <div style="
          width:${sz}px;height:${sz}px;
          background:${color};
          border-radius:50%;
          border:3px solid white;
          box-shadow:${shadow};
          display:flex;align-items:center;justify-content:center;
          transform:rotate(${heading}deg);
          transition:transform 0.45s ease, width 0.2s, height 0.2s;
          position:relative;
        ">
          <!-- Top-view bus SVG -->
          <svg width="${Math.round(sz*0.6)}" height="${Math.round(sz*0.6)}" viewBox="0 0 64 80" fill="none">
            <rect x="8" y="8" width="48" height="64" rx="10" fill="white" opacity="0.95"/>
            <rect x="14" y="12" width="36" height="16" rx="4" fill="#BFDBFE" opacity="0.9"/>
            <rect x="14" y="52" width="36" height="14" rx="4" fill="#BFDBFE" opacity="0.7"/>
            <rect x="10" y="32" width="10" height="12" rx="2" fill="#DBEAFE" opacity="0.8"/>
            <rect x="44" y="32" width="10" height="12" rx="2" fill="#DBEAFE" opacity="0.8"/>
            <rect x="8"  y="30" width="48" height="20" rx="0" fill="rgba(37,99,235,0.13)"/>
            <rect x="16" y="5"  width="32" height="6"  rx="3" fill="#93C5FD"/>
            <rect x="16" y="69" width="32" height="5"  rx="3" fill="#BFDBFE"/>
            <ellipse cx="14" cy="22" rx="5" ry="6" fill="#1E293B" opacity="0.7"/>
            <ellipse cx="14" cy="58" rx="5" ry="6" fill="#1E293B" opacity="0.7"/>
            <ellipse cx="50" cy="22" rx="5" ry="6" fill="#1E293B" opacity="0.7"/>
            <ellipse cx="50" cy="58" rx="5" ry="6" fill="#1E293B" opacity="0.7"/>
          </svg>
          <!-- Forward direction arrow -->
          <div style="position:absolute;top:-8px;left:50%;transform:translateX(-50%);
                      width:0;height:0;
                      border-left:7px solid transparent;
                      border-right:7px solid transparent;
                      border-bottom:10px solid white;"></div>
        </div>
        <!-- Bus ID label -->
        <div style="
          position:absolute;bottom:-22px;left:50%;transform:translateX(-50%);
          background:${isSelected?"#7C3AED":"#1D4ED8"};color:white;
          padding:2px 9px;border-radius:20px;
          font-size:10px;font-weight:800;white-space:nowrap;
          font-family:Inter,system-ui,sans-serif;
          box-shadow:0 2px 8px rgba(0,0,0,0.2);
          pointer-events:none;
        ">${busId}</div>
      </div>`,
    className: "",
    iconSize:   [sz + 20, sz + 30],
    iconAnchor: [(sz + 20) / 2, sz / 2 + 8],
    popupAnchor:[0, -(sz / 2 + 8)],
  });
}

function makePopup(bus: ActiveBus): string {
  return `
    <div style="font-family:Inter,system-ui,sans-serif;min-width:190px;padding:4px 0">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="width:38px;height:38px;background:linear-gradient(135deg,#1D4ED8,#3B82F6);
                    border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center">
          <svg width="20" height="20" viewBox="0 0 64 80" fill="none">
            <rect x="8" y="8" width="48" height="64" rx="10" fill="white" opacity="0.95"/>
            <rect x="14" y="12" width="36" height="16" rx="4" fill="#BFDBFE"/>
            <rect x="16" y="5" width="32" height="6" rx="3" fill="#93C5FD"/>
          </svg>
        </div>
        <div>
          <div style="font-weight:800;font-size:15px;color:#1E293B">${bus.busId}</div>
          <span style="background:#16A34A;color:white;padding:1px 8px;border-radius:20px;font-size:10px;font-weight:700">● LIVE</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div style="background:#EFF6FF;border-radius:10px;padding:8px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:#22D3EE;line-height:1">${bus.speed.toFixed(1)}</div>
          <div style="font-size:10px;color:#64748B;font-weight:600;text-transform:uppercase;margin-top:2px">km/h</div>
        </div>
        <div style="background:#F8FAFC;border-radius:10px;padding:8px;text-align:center">
          <div style="font-size:10px;font-weight:700;color:#1E293B;line-height:1.5">${bus.lat.toFixed(5)}<br>${bus.lng.toFixed(5)}</div>
          <div style="font-size:10px;color:#94A3B8;font-weight:600;text-transform:uppercase;margin-top:2px">GPS</div>
        </div>
      </div>
      ${bus.routeName  ? `<div style="font-size:12px;color:#1E293B;margin-bottom:3px">🗺️ <b>${bus.routeName}</b></div>` : ""}
      ${bus.driverName ? `<div style="font-size:12px;color:#1E293B;margin-bottom:3px">👨‍✈️ ${bus.driverName}</div>` : ""}
      <div style="font-size:11px;color:#94A3B8;margin-top:4px">🕐 ${new Date(bus.lastUpdated).toLocaleTimeString()}</div>
    </div>`;
}

export default function AdminMap({ activeBuses, selectedBusId, onBusSelect, buses, routes, userLocation, students = [] }: AdminMapProps) {
  const divRef     = useRef<HTMLDivElement>(null);
  const mapRef     = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const isMounted  = useRef(true);

  /* Marker state with smooth animation data */
  const markersRef = useRef<Map<string, {
    marker:    L.Marker;
    prevLat:   number; prevLng:   number;
    targetLat: number; targetLng: number;
    heading:   number;
    rafId:     number | null;
  }>>(new Map());

  const prevStopKey   = useRef("");
  const lastQueryLatLngRef = useRef<{ lat: number; lng: number } | null>(null);
  const prevSelectedBusIdRef = useRef<string | null>(null);
  const prevStopsKeyRef = useRef<string>("");

  const [prevPath, setPrevPath] = useState<L.LatLngTuple[]>([]);
  const [isDeviated, setIsDeviated] = useState(false);

  // Get active selected bus coordinate
  const selectedBusLoc = selectedBusId ? activeBuses.find(b => b.busId === selectedBusId) : null;
  const trackerLat = selectedBusLoc?.lat ?? 0;
  const trackerLng = selectedBusLoc?.lng ?? 0;

  const selectedBusInfo = buses?.find(b => b.busId === selectedBusId);
  const selectedRoute = routes?.find(r => r.id === selectedBusInfo?.routeId);
  const routeStops = selectedRoute ? getDirectionalStops(selectedRoute as any) : [];

  const [fullRouteRoadPath, setFullRouteRoadPath] = useState<L.LatLngTuple[]>([]);

  useEffect(() => {
    if (routeStops.length < 2) {
      setFullRouteRoadPath([]);
      return;
    }
    fetchRoadPath(routeStops)
      .then(path => {
        setFullRouteRoadPath(path);
      })
      .catch(() => {
        setFullRouteRoadPath(routeStops.map(s => [s.lat, s.lng] as L.LatLngTuple));
      });
  }, [selectedBusId, buses, routes]);


  // 1. Fetch previous completed path of selected bus
  useEffect(() => {
    if (!selectedBusId) {
      setPrevPath([]);
      setIsDeviated(false);
      return;
    }
    fetch(`/api/trips/previous-path?busId=${selectedBusId}`)
      .then(res => res.json())
      .then(data => {
        if (data?.path && !data.isMock) {
          setPrevPath(data.path.map((p: any) => [p.lat, p.lng] as L.LatLngTuple));
        } else {
          setPrevPath([]);
        }
      })
      .catch(err => {
        console.error("Error fetching previous path:", err);
        setPrevPath([]);
      });
  }, [selectedBusId]);

  /* ════ 2. Init map + inject CSS ════ */
  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    isMounted.current = true;

    /* Inject animation keyframes into <head> so divIcon HTML can use them */
    const STYLE_ID = "__admin_map_anim";
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement("style");
      s.id = STYLE_ID;
      s.textContent = `
        @keyframes __admpulse {
          0%   { transform: scale(1);    opacity: 0.75; }
          50%  { transform: scale(1.5);  opacity: 0.1;  }
          100% { transform: scale(1);    opacity: 0.75; }
        }
      `;
      document.head.appendChild(s);
    }

    const map = L.map(divRef.current, {
      center: [17.045, 82.065],
      zoom: 12,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);

    routeLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      isMounted.current = false;
      markersRef.current.forEach(d => { if (d.rafId) cancelAnimationFrame(d.rafId); });
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /* ════ 3. Draw route lines, alternative routes, start/end pins, stops and check deviation ════ */
  useEffect(() => {
    const map = mapRef.current;
    const lg  = routeLayerRef.current;
    if (!map || !lg) return;

    const selectedBusInfo = buses?.find(b => b.busId === selectedBusId);
    const selectedRoute = routes?.find(r => r.id === selectedBusInfo?.routeId);
    const routeStops = selectedRoute ? getDirectionalStops(selectedRoute as any) : [];

    if (!selectedBusId || routeStops.length < 2) {
      lg.clearLayers();
      prevStopKey.current = "";
      lastQueryLatLngRef.current = null;
      setIsDeviated(false);
      return;
    }

    const stopsKey = routeStops.map(s => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join("|");
    const isTrackerActive = trackerLat !== 0 && trackerLng !== 0;

    let isTrackerNearRoute = false;
    if (isTrackerActive && routeStops.length > 0) {
      let minDist = Infinity;
      routeStops.forEach(s => {
        const d = getDistance(trackerLat, trackerLng, s.lat, s.lng) / 1000;
        if (d < minDist) minDist = d;
      });
      isTrackerNearRoute = minDist < 100; // within 100km
    }
    const shouldDrawDynamic = isTrackerActive && isTrackerNearRoute;

    // Check if tracker or stops changed to reset throttle ref
    if (prevSelectedBusIdRef.current !== selectedBusId || prevStopsKeyRef.current !== stopsKey) {
      prevSelectedBusIdRef.current = selectedBusId;
      prevStopsKeyRef.current = stopsKey;
      lastQueryLatLngRef.current = null;
      prevStopKey.current = "";
      lg.clearLayers();
    }

    // Check distance threshold to throttle OSRM API calls when tracking
    if (shouldDrawDynamic) {
      const currentLatLng = { lat: trackerLat, lng: trackerLng };
      if (lastQueryLatLngRef.current) {
        const dist = getDistance(
          lastQueryLatLngRef.current.lat,
          lastQueryLatLngRef.current.lng,
          currentLatLng.lat,
          currentLatLng.lng
        );
        if (dist < 20) {
          // Bus moved less than 20 meters, keep current line to avoid API spamming
          return;
        }
      }
      lastQueryLatLngRef.current = currentLatLng;
    } else {
      if (stopsKey === prevStopKey.current) return;
      prevStopKey.current = stopsKey;
      lg.clearLayers();
      lastQueryLatLngRef.current = null;
    }

    (async () => {
      let paths: OSRMRoute[] = [];
      let startPointName = "";
      let endPointName = "";
      const destinationCoords: L.LatLngTuple = [
        routeStops[routeStops.length - 1].lat,
        routeStops[routeStops.length - 1].lng
      ];

      if (shouldDrawDynamic) {
        const trackerCoords: L.LatLngTuple = [trackerLat, trackerLng];

        // Find next stop index
        let nearIdx = 0, nearDist = Infinity;
        routeStops.forEach((s, i) => {
          const d = getDistance(trackerLat, trackerLng, s.lat, s.lng);
          if (d < nearDist) {
            nearDist = d;
            nearIdx = i;
          }
        });
        const nextIdx = Math.min(
          routeStops.length - 1,
          Math.max(nearDist < 250 ? nearIdx + 1 : nearIdx, 0)
        );
        const remainingStops = routeStops.slice(nextIdx);

        paths = await fetchMultiStopPaths(trackerCoords, remainingStops);
        startPointName = `Bus ${selectedBusId}`;
        endPointName = routeStops[routeStops.length - 1].name;

        // Auto routing swapping logic if driver goes to alternative
        if (paths.length > 1) {
          const distToPrim = getDistanceToRoute(trackerLat, trackerLng, paths[0].path);
          const distToAlt = getDistanceToRoute(trackerLat, trackerLng, paths[1].path);
          if (distToAlt < distToPrim && distToAlt < 50) {
            const temp = paths[0];
            paths[0] = paths[1];
            paths[1] = temp;
          }
        }

        // Deviation detection check
        let deviated = false;
        if (false && prevPath.length > 0) {
          let minDistanceToPrev = Infinity;
          for (const coord of prevPath) {
            const d = getDistance(trackerLat, trackerLng, coord[0], coord[1]);
            if (d < minDistanceToPrev) minDistanceToPrev = d;
          }
          if (minDistanceToPrev > 100) {
            deviated = true;
          }
        }
        setIsDeviated(deviated);
      } else {
        const pathCoords = await fetchRoadPath(routeStops);
        paths = [{
          path: pathCoords,
          distKm: 0,
          durMin: 0
        }];
        startPointName = routeStops[0].name;
        endPointName = routeStops[routeStops.length - 1].name;
        setIsDeviated(false);
      }

      if (!isMounted.current || !routeLayerRef.current) return;
      const lg2 = routeLayerRef.current;
      lg2.clearLayers();

      // 0. Draw previous completed route if available
      if (false && prevPath.length > 0) {
        L.polyline(prevPath, { color: "#E9D5FF", weight: 12, opacity: 0.2, lineCap: "round", lineJoin: "round", interactive: false }).addTo(lg2);
        L.polyline(prevPath, { color: "#7C3AED", weight: 4, opacity: 0.6, lineCap: "round", lineJoin: "round", dashArray: "8, 8" }).addTo(lg2)
          .bindPopup(`<div style="font-family:Inter,sans-serif;text-align:center;padding:2px"><b>Previous Completed Trip Route</b><br><span style="color:#7C3AED;font-weight:700">Dotted Purple Line</span></div>`);
      }

      // 1. Draw alternative route(s) underneath
      if (false && shouldDrawDynamic && paths.length > 1) {
        for (let i = 1; i < paths.length; i++) {
          const alt = paths[i];
          const altPath = slicePathFromTracker(trackerLat, trackerLng, alt.path);
          const color = "#94A3B8"; // gray for alternative
          
          L.polyline(altPath, { color, weight: 16, opacity: 0.1, lineCap: "round", lineJoin: "round", interactive: false }).addTo(lg2);
          L.polyline(altPath, { color: "#fff", weight: 10, opacity: 1, lineCap: "round", lineJoin: "round", interactive: false }).addTo(lg2);
          L.polyline(altPath, { color, weight: 5, opacity: 0.8, lineCap: "round", lineJoin: "round", dashArray: "10, 6" }).addTo(lg2)
            .bindPopup(`<div style="font-family:Inter,sans-serif;text-align:center;padding:2px"><b>Alternative Route</b><br><span style="color:#64748B;font-weight:700">${alt.distKm} km · ~${alt.durMin} min</span></div>`);

          if (altPath.length > 2) {
            const midIdx = Math.floor(altPath.length / 2);
            const [midLat, midLng] = altPath[midIdx];
            L.marker([midLat, midLng] as L.LatLngTuple, {
              icon: L.divIcon({
                html: `<div style="background:rgba(15,23,42,0.92);color:white;padding:3.5px 8px;border-radius:12px;font-size:10px;font-weight:700;white-space:nowrap;font-family:Inter,system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);border:1.5px solid rgba(255,255,255,0.9);">Alt: ${alt.distKm} km · ${alt.durMin}m</div>`,
                className: "", iconSize: [110, 24], iconAnchor: [55, 12]
              }),
              interactive: false
            }).addTo(lg2);
          }
        }
      }

      // 2. Draw primary route
      const prim = paths[0];
      const primPath = shouldDrawDynamic ? slicePathFromTracker(trackerLat, trackerLng, prim.path) : prim.path;
      const primColor = "#60A5FA"; // soft blue
      
      L.polyline(primPath, { color: "#FFFFFF", weight: 14, opacity: 0.20, lineCap: "round", lineJoin: "round", interactive: false }).addTo(lg2);
      L.polyline(primPath, { color: "#FFFFFF", weight: 8, opacity: 0.72, lineCap: "round", lineJoin: "round", interactive: false }).addTo(lg2);
      L.polyline(primPath, { color: primColor, weight: 5, opacity: 0.92, lineCap: "round", lineJoin: "round" }).addTo(lg2)
        .bindPopup(`<div style="font-family:Inter,sans-serif;text-align:center;padding:2px"><b>${startPointName} → ${endPointName}</b>${shouldDrawDynamic ? `<br><span style="color:#22D3EE;font-weight:700">${prim.distKm} km · ~${prim.durMin} min</span>` : ""}</div>`);

      // 3. Draw label badge on primary route
      if (shouldDrawDynamic && paths.length > 0) {
        let labelText = "Recommended";
        if (paths.length > 1) {
          const primRoute = paths[0];
          const altRoute = paths[1];
          if (primRoute.durMin <= altRoute.durMin && primRoute.distKm <= altRoute.distKm) {
            labelText = "⚡ Fastest & Shortest";
          } else if (primRoute.durMin < altRoute.durMin) {
            labelText = "⚡ Fastest / Min Time";
          } else if (primRoute.distKm < altRoute.distKm) {
            labelText = "📏 Shortest Path";
          }
        }
        
        if (primPath.length > 2) {
          const labelIdx = Math.floor(primPath.length / 3);
          const [lblLat, lblLng] = primPath[labelIdx];
          L.marker([lblLat, lblLng] as L.LatLngTuple, {
            icon: L.divIcon({
              html: `<div style="background:#22D3EE;color:white;padding:4px 10px;border-radius:20px;font-size:10px;font-weight:800;white-space:nowrap;font-family:Inter,system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.25);border:2px solid white;">${labelText}: ${prim.distKm} km · ${prim.durMin} min</div>`,
              className: "", iconSize: [160, 26], iconAnchor: [80, 13]
            }),
            interactive: false
          }).addTo(lg2);
        }
      }

      /* Arrows along primary path */
      const step = Math.max(4, Math.floor(primPath.length / 10));
      for (let i = step; i < primPath.length - 1; i += step) {
        const [la1, ln1] = primPath[i - 1] as [number, number];
        const [la2, ln2] = primPath[i] as [number, number];
        const ang = (Math.atan2(ln2 - ln1, la2 - la1) * 180) / Math.PI;
        L.marker(primPath[i] as L.LatLngTuple, {
          icon: L.divIcon({
            html: `<svg width="16" height="16" viewBox="0 0 24 24" style="transform:rotate(${90 - ang}deg);display:block" fill="none" stroke="#1D4ED8" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
            className: "", iconSize: [16, 16], iconAnchor: [8, 8]
          }),
          interactive: false, zIndexOffset: 50
        }).addTo(lg2);
      }

      // Helper to calculate student counts per stop
      const getStudentCountForStop = (stopName: string) => {
        if (!students || !selectedBusId) return 0;
        return students.filter((st: any) => {
          return st.assignedBusId === selectedBusId &&
            st.boardingStop?.toLowerCase().trim() === stopName.toLowerCase().trim();
        }).length;
      };

      /* Intermediate stop teardrops */
      routeStops.slice(1, -1).forEach(s => {
        if (shouldDrawDynamic && Math.abs(s.lat - destinationCoords[0]) < 0.0001 && Math.abs(s.lng - destinationCoords[1]) < 0.0001) {
          return;
        }
        const count = getStudentCountForStop(s.name);
        const countSuffix = count > 0 ? ` (👥 ${count})` : "";
        const popupDetails = count > 0 
          ? `<br><span style="color:#2563EB;font-size:11px;font-weight:700">👥 ${count} student${count !== 1 ? 's' : ''} boarding</span>`
          : "";

        L.marker([s.lat, s.lng] as L.LatLngTuple, {
          icon: L.divIcon({
            html: `
              <div style="position:relative; display:flex; flex-direction:column; align-items:center;">
                <svg width="24" height="32" viewBox="0 0 24 30" fill="none" style="filter:drop-shadow(0 2px 5px rgba(0,0,0,0.22))">
                  <path d="M12 0C5.37 0 0 5.37 0 12C0 21 12 30 12 30C12 30 24 21 24 12C24 5.37 18.63 0 12 0Z" fill="#3B82F6" stroke="white" stroke-width="1.8"/>
                  <circle cx="12" cy="12" r="5" fill="white"/>
                </svg>
                <div style="position:absolute; top:36px; left:50%; transform:translateX(-50%); background:rgba(255,255,255,0.96); color:#475569; padding:2.5px 8px; border-radius:12px; font-size:10px; font-weight:800; white-space:nowrap; box-shadow:0 1px 5px rgba(37,99,235,0.08); font-family:Inter,sans-serif; border:1px solid rgba(37,99,235,0.08)">${s.name}${countSuffix}</div>
              </div>`,
            className: "", iconSize: [24, 32], iconAnchor: [12, 30]
          }),
          zIndexOffset: 200
        }).addTo(lg2).bindPopup(`<div style="font-family:Inter,sans-serif"><b>${s.name}</b><br><span style="color:#0F172A;font-size:11px;font-weight:600">Bus Stop</span>${popupDetails}</div>`);
      });

      /* Start A + End B pins */
      const startCount = getStudentCountForStop(routeStops[0].name);
      const startCountSuffix = startCount > 0 ? ` (👥 ${startCount})` : "";
      const startPopupDetails = startCount > 0 
        ? `<br><span style="color:#2563EB;font-size:11px;font-weight:700">👥 ${startCount} student${startCount !== 1 ? 's' : ''} boarding</span>`
        : "";

      const endCount = getStudentCountForStop(routeStops[routeStops.length - 1].name);
      const endCountSuffix = endCount > 0 ? ` (👥 ${endCount})` : "";
      const endPopupDetails = endCount > 0 
        ? `<br><span style="color:#2563EB;font-size:11px;font-weight:700">👥 ${endCount} student${endCount !== 1 ? 's' : ''} boarding</span>`
        : "";

      if (shouldDrawDynamic) {
        L.marker([routeStops[0].lat, routeStops[0].lng] as L.LatLngTuple, { icon: makePin("start", routeStops[0].name + startCountSuffix), zIndexOffset: 1000 }).addTo(lg2)
          .bindPopup(`<div style="font-family:Inter,sans-serif"><b>${routeStops[0].name}</b><br><span style="color:#16A34A;font-size:11px;font-weight:600">📍 Starting Point</span>${startPopupDetails}</div>`);
        L.marker(destinationCoords, { icon: makePin("end", endPointName + endCountSuffix), zIndexOffset: 1000 }).addTo(lg2)
          .bindPopup(`<div style="font-family:Inter,sans-serif"><b>${endPointName}</b><br><span style="color:#DC2626;font-size:11px;font-weight:600">🏁 Destination</span>${endPopupDetails}</div>`);
      } else {
        L.marker([routeStops[0].lat, routeStops[0].lng] as L.LatLngTuple, { icon: makePin("start", routeStops[0].name + startCountSuffix), zIndexOffset: 1000 }).addTo(lg2)
          .bindPopup(`<div style="font-family:Inter,sans-serif"><b>${routeStops[0].name}</b><br><span style="color:#16A34A;font-size:11px;font-weight:600">📍 Starting Point</span>${startPopupDetails}</div>`);
        const en = routeStops[routeStops.length - 1];
        L.marker([en.lat, en.lng] as L.LatLngTuple, { icon: makePin("end", en.name + endCountSuffix), zIndexOffset: 1000 }).addTo(lg2)
          .bindPopup(`<div style="font-family:Inter,sans-serif"><b>${en.name}</b><br><span style="color:#DC2626;font-size:11px;font-weight:600">🏁 Destination</span>${endPopupDetails}</div>`);
      }

      if (!shouldDrawDynamic) {
        mapRef.current?.fitBounds(L.latLngBounds(primPath).pad(0.12), { animate: true, duration: 0.8 });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusId, trackerLat, trackerLng, prevPath, buses, routes]);

  /* ════ 4. Update animated bus markers ════ */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    activeBuses.forEach(bus => {
      /* Skip invalid GPS */
      if (bus.lat === 0 && bus.lng === 0) return;

      const isSelected = bus.busId === selectedBusId;

      // Snap coordinates to route if selected, otherwise snap to its assigned route's stops
      let busLat = bus.lat;
      let busLng = bus.lng;
      if (isSelected && fullRouteRoadPath.length > 0) {
        const snapped = snapToPath(bus.lat, bus.lng, fullRouteRoadPath);
        busLat = snapped[0];
        busLng = snapped[1];
      } else if (buses && routes) {
        const busInfo = buses.find((b: any) => b.busId === bus.busId);
        if (busInfo && busInfo.routeId) {
          const routeObj = routes.find((r: any) => r.id === busInfo.routeId);
          if (routeObj) {
            const stops = parseStopCoords(routeObj.stopCoordinates);
            if (stops.length > 1) {
              const stopsPath = stops.map(s => [s.lat, s.lng] as L.LatLngTuple);
              const snapped = snapToPath(bus.lat, bus.lng, stopsPath);
              busLat = snapped[0];
              busLng = snapped[1];
            }
          }
        }
      }

      if (markersRef.current.has(bus.busId)) {
        /* Update existing marker with smooth animation */
        const data = markersRef.current.get(bus.busId)!;
        const currentLatLng = data.marker.getLatLng();
        const startLat = currentLatLng.lat;
        const startLng = currentLatLng.lng;

        const computedHeading = (bus.heading && bus.heading !== 0) ? bus.heading
          : (Math.abs(busLng - startLng) > 0.00001 || Math.abs(busLat - startLat) > 0.00001)
            ? Math.atan2(busLng - startLng, busLat - startLat) * 180 / Math.PI
            : data.heading;

        data.targetLat = busLat;
        data.targetLng = busLng;
        data.heading   = computedHeading;

        if (data.rafId) { cancelAnimationFrame(data.rafId); data.rafId = null; }

        const startTime = performance.now();
        const duration  = 800;

        function step(now: number) {
          if (!isMounted.current) return;
          const t      = Math.min((now - startTime) / duration, 1);
          const eased  = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
          const lat    = lerp(startLat, data.targetLat, eased);
          const lng    = lerp(startLng, data.targetLng, eased);
          data.marker.setLatLng([lat, lng]);
          data.marker.setIcon(makeBusIcon(bus.busId, isSelected, data.heading));
          data.marker.setZIndexOffset(isSelected ? 2000 : 1000);
          if (t < 1) {
            data.rafId = requestAnimationFrame(step);
          } else {
            data.prevLat = data.targetLat;
            data.prevLng = data.targetLng;
            data.rafId   = null;
          }
        }
        data.rafId = requestAnimationFrame(step);
        data.marker.setPopupContent(makePopup({ ...bus, lat: busLat, lng: busLng }));

      } else {
        /* Create new marker */
        const heading = bus.heading || 0;
        const marker  = L.marker([busLat, busLng], {
          icon:         makeBusIcon(bus.busId, isSelected, heading),
          zIndexOffset: isSelected ? 2000 : 1000,
        }).addTo(map).bindPopup(makePopup({ ...bus, lat: busLat, lng: busLng }));

        if (onBusSelect) marker.on("click", () => onBusSelect(bus.busId));

        markersRef.current.set(bus.busId, {
          marker,
          prevLat: busLat, prevLng: busLng,
          targetLat: busLat, targetLng: busLng,
          heading, rafId: null,
        });
      }
    });

    /* Remove stale markers */
    markersRef.current.forEach((data, id) => {
      if (!activeBuses.find(b => b.busId === id)) {
        if (data.rafId) cancelAnimationFrame(data.rafId);
        map.removeLayer(data.marker);
        markersRef.current.delete(id);
      }
    });

    /* Map view: zoom to selected, or fit all */
    if (selectedBusId) {
      const sel = activeBuses.find(b => b.busId === selectedBusId);
      if (sel && sel.lat !== 0) {
        let targetLat = sel.lat;
        let targetLng = sel.lng;
        if (fullRouteRoadPath.length > 0) {
          const snapped = snapToPath(sel.lat, sel.lng, fullRouteRoadPath);
          targetLat = snapped[0];
          targetLng = snapped[1];
        }
        const selectedBusInfo = buses?.find(b => b.busId === selectedBusId);
        const selectedRoute = routes?.find(r => r.id === selectedBusInfo?.routeId);
        const stops = selectedRoute ? parseStopCoords(selectedRoute.stopCoordinates) : [];
        let isNear = false;
        if (stops.length > 0) {
          let minDist = Infinity;
          stops.forEach(s => {
            const d = getDistance(targetLat, targetLng, s.lat, s.lng) / 1000;
            if (d < minDist) minDist = d;
          });
          isNear = minDist < 100;
        }
        if (isNear) {
          map.panTo([targetLat, targetLng], { animate: true, duration: 0.5 });
        } else {
          map.setView([targetLat, targetLng], 15, { animate: true });
        }
      }
    } else if (activeBuses.length > 0 && activeBuses.some(b => b.lat !== 0)) {
      const valid  = activeBuses.filter(b => b.lat !== 0 && b.lng !== 0);
      const bounds = L.latLngBounds(valid.map(b => [b.lat, b.lng] as L.LatLngTuple));
      map.fitBounds(bounds.pad(0.2));
    }
  }, [activeBuses, selectedBusId, onBusSelect, buses, routes, fullRouteRoadPath, students]);

  /* ════ 5. Draw admin/user live location ════ */
  const userMarkerRef = useRef<L.Marker | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (userLocation && userLocation.lat !== 0 && userLocation.lng !== 0) {
      const icon = L.divIcon({
        html: `
          <div style="position:relative;display:flex;align-items:center;justify-content:center;">
            <div style="position:absolute;inset:-8px;border-radius:50%;border:3px solid rgba(124,58,237,0.35);animation:__admpulse 1.5s ease-in-out infinite;"></div>
            <div style="
              width:32px;height:32px;
              background:linear-gradient(145deg,#7C3AED,#C084FC);
              border-radius:50%;
              border:2.5px solid white;
              box-shadow:0 4px 12px rgba(124,58,237,0.4);
              display:flex;align-items:center;justify-content:center;
            ">
              <span style="font-size:12px">👤</span>
            </div>
            <div style="
              position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);
              background:#7C3AED;color:white;
              padding:1px 6px;border-radius:10px;
              font-size:9px;font-weight:800;white-space:nowrap;
              font-family:Inter,system-ui,sans-serif;
              box-shadow:0 1px 4px rgba(0,0,0,0.15);
            ">Admin</div>
          </div>`,
        className: "",
        iconSize: [32, 40],
        iconAnchor: [16, 16],
      });

      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng([userLocation.lat, userLocation.lng]);
      } else {
        userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], { icon })
          .addTo(map)
          .bindPopup('<div style="font-family:Inter,sans-serif;font-weight:700">📍 Your Location (Admin)</div>');
      }
    } else {
      if (userMarkerRef.current) {
        map.removeLayer(userMarkerRef.current);
        userMarkerRef.current = null;
      }
    }
  }, [userLocation]);

  return (
    <div style={{ position: "relative", height: "420px", zIndex: 1 }}>
      <div ref={divRef} style={{ position: "absolute", inset: 0, borderRadius: "0 0 16px 16px", overflow: "hidden" }} />

      {isDeviated && (
        <div style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 1000,
          background: "rgba(220, 38, 38, 0.95)",
          color: "#fff",
          borderRadius: 12,
          padding: "6px 12px",
          fontSize: 11,
          fontWeight: 700,
          boxShadow: "0 4px 14px rgba(220, 38, 38, 0.35)",
          fontFamily: "Inter,system-ui,sans-serif",
          display: "flex",
          alignItems: "center",
          gap: 6,
          border: "1px solid rgba(255, 255, 255, 0.2)"
        }}>
          <span style={{ fontSize: 13, animation: "pulse 1.5s infinite" }}>⚠️</span>
          <span>Deviated from Previous Route</span>
        </div>
      )}

      {/* No buses placeholder */}
      {activeBuses.length === 0 && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none", zIndex: 500,
        }}>
          <div style={{
            background: "rgba(255,255,255,0.97)", borderRadius: 20,
            padding: "28px 36px", textAlign: "center",
            boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: "50%", background: "#DBEAFE",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 14px",
            }}>
              <svg width="26" height="26" fill="none" viewBox="0 0 24 24" stroke="#22D3EE" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>
              </svg>
            </div>
            <p style={{ fontWeight: 700, fontSize: 14, color: "#1E293B", fontFamily: "Inter,system-ui,sans-serif", margin: "0 0 6px" }}>
              No active buses
            </p>
            <p style={{ fontSize: 12, color: "#94A3B8", fontFamily: "Inter,system-ui,sans-serif" }}>
              Bus locations appear here when drivers start trips
            </p>
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{
        position: "absolute", bottom: 12, right: 12, zIndex: 1000,
        background: "rgba(255,255,255,0.97)", backdropFilter: "blur(8px)",
        borderRadius: 12, padding: "7px 12px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.1)",
        display: "flex", flexDirection: "column", gap: 5,
        fontSize: 11, fontFamily: "Inter,system-ui,sans-serif", color: "#475569", fontWeight: 600,
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 64 80" fill="none">
            <rect x="8" y="8" width="48" height="64" rx="10" fill="#22D3EE"/>
            <rect x="14" y="12" width="36" height="16" rx="4" fill="#BFDBFE"/>
          </svg>
          Live Bus
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 64 80" fill="none">
            <rect x="8" y="8" width="48" height="64" rx="10" fill="#7C3AED"/>
            <rect x="14" y="12" width="36" height="16" rx="4" fill="#DDD6FE"/>
          </svg>
          Selected
        </span>
      </div>
    </div>
  );
}








