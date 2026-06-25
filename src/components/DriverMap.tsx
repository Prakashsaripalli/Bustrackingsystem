"use client";

/**
 * DriverMap — Driver Dashboard map + HUD
 *
 * HUD shows:
 *  • Live speed (km/h) with colour indicator
 *  • Elapsed trip time (stopwatch)
 *  • REMAINING distance to destination (road distance, from GPS position)
 *  • REMAINING TIME = multi-factor ETA using:
 *      - Road distance (OSRM)
 *      - Road-type friction (signals, turns, bus stops)
 *      - Time-of-day traffic (peak hour multiplier)
 *      - Live speed (smoothed GPS, blended)
 *  • Next stop name + distance + ETA
 */

import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { computeEta, formatEta, formatDist, pushSpeed, clearSpeedBuffer } from "@/services/eta";


interface Stop { name: string; lat: number; lng: number; }

interface DriverMapProps {
  location:        GeolocationCoordinates | null;
  positionHistory: { lat: number; lng: number }[];
  speed:           number;   // km/h
  route:           any;
  elapsed:         number;   // seconds since trip started
  hideHud?:        boolean;
  onEtaUpdate?:    (data: { destEtaMin: number | null; destDistKm: number | null; totalDistKm: number | null; totalDurMin: number | null }) => void;
  busId?:          string | null;
  assignedStudents?: any[];
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

/* ── Calculate minimum distance to a route path, skipping the first few coordinates ── */
function getDistanceToRoute(lat: number, lng: number, path: L.LatLngTuple[]): number {
  if (path.length === 0) return Infinity;
  if (path.length <= 4) {
    let minD = Infinity;
    for (const coord of path) {
      const d = hav(lat, lng, coord[0], coord[1]) * 1000;
      if (d < minD) minD = d;
    }
    return minD;
  }
  let minD = Infinity;
  for (let i = 3; i < path.length; i++) {
    const d = hav(lat, lng, path[i][0], path[i][1]) * 1000;
    if (d < minD) minD = d;
  }
  return minD;
}

/* ── Slice route path to start at tracker position and drop passed vertices ── */
function slicePathFromTracker(lat: number, lng: number, path: L.LatLngTuple[]): L.LatLngTuple[] {
  if (path.length < 2) return path;
  
  let closestIdx = 0;
  let minD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = hav(lat, lng, path[i][0], path[i][1]) * 1000;
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

/* ── Fetch multi-stop path: Tracker -> nextStop -> restOfStops -> destination ── */
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


/* ── OSRM: full route path + adjusted distance/time computed leg-by-leg in parallel ── */
async function fetchRouteInfo(stops: Stop[]): Promise<{
  path: L.LatLngTuple[];
  totalDistKm: number;
  totalDurMin: number;   // friction + traffic adjusted
}> {
  const fallback = fallbackRouteInfo(stops);
  if (stops.length < 2) return fallback;

  const legPromises = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const start = stops[i];
    const end = stops[i + 1];
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&steps=false`;
    
    legPromises.push(
      fetch(url, { signal: AbortSignal.timeout(10000) })
        .then(async (r) => {
          if (!r.ok) return null;
          const d = await r.json();
          if (d.code !== "Ok" || !d.routes?.[0]) return null;
          const route = d.routes[0];
          const path = (route.geometry.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng] as L.LatLngTuple);
          return {
            path,
            distance: route.distance, // meters
            duration: route.duration // seconds
          };
        })
        .catch(() => null)
    );
  }

  const legs = await Promise.all(legPromises);

  const combinedPath: L.LatLngTuple[] = [];
  let totalDistance = 0;
  let totalDuration = 0;

  for (let i = 0; i < stops.length - 1; i++) {
    const leg = legs[i];
    if (leg) {
      if (combinedPath.length === 0) {
        combinedPath.push(...leg.path);
      } else {
        combinedPath.push(...leg.path.slice(1));
      }
      totalDistance += leg.distance;
      totalDuration += leg.duration;
    } else {
      const start = stops[i];
      const end = stops[i + 1];
      if (combinedPath.length === 0) {
        combinedPath.push([start.lat, start.lng], [end.lat, end.lng]);
      } else {
        combinedPath.push([end.lat, end.lng]);
      }
      totalDistance += hav(start.lat, start.lng, end.lat, end.lng) * 1000;
      totalDuration += (hav(start.lat, start.lng, end.lat, end.lng) / 28) * 3600; // 28 km/h fallback
    }
  }

  const km = totalDistance / 1000;
  const minutes = totalDuration / 60;

  return {
    path: combinedPath,
    totalDistKm: +km.toFixed(2),
    totalDurMin: Math.max(1, Math.round(minutes * frictionFactor(km) * trafficMultiplier())),
  };
}

/* ── OSRM: remaining road distance from bus to destination ── */
async function fetchRemainingToDestination(
  fromLat: number, fromLng: number,
  destLat: number, destLng: number
): Promise<{ distKm: number } | null> {
  try {
    const r = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${destLng},${destLat}?overview=false`,
      { signal: AbortSignal.timeout(6000) }
    );
    const ct = r.headers.get("content-type") ?? "";
    if (!r.ok || !ct.includes("json")) return null;
    const d = await r.json();
    if (d.code !== "Ok" || !d.routes?.[0]) return null;
    return { distKm: +(d.routes[0].distance / 1000).toFixed(2) };
  } catch { return null; }
}

function parseStopCoords(raw: any): Stop[] {
  if (!raw) return [];
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return []; } }
  if (Array.isArray(raw)) return raw;
  return [];
}

function hav(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, r = Math.PI / 180;
  const a = Math.sin((lat2-lat1)*r/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin((lng2-lng1)*r/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function routeStraightDistance(stops: Stop[]): number {
  let total = 0;
  for (let i = 1; i < stops.length; i++) {
    total += hav(stops[i - 1].lat, stops[i - 1].lng, stops[i].lat, stops[i].lng);
  }
  return total;
}

function frictionFactor(km: number): number {
  if (km < 2) return 1.6;
  if (km < 5) return 1.5;
  if (km < 10) return 1.4;
  if (km < 20) return 1.35;
  if (km < 40) return 1.25;
  return 1.15;
}

function trafficMultiplier(): number {
  const h = new Date().getHours();
  if (h >= 7 && h <= 9) return 1.35;
  if (h >= 17 && h <= 20) return 1.40;
  if (h >= 22 || h <= 5) return 0.95;
  return 1.10;
}

function fallbackRouteInfo(stops: Stop[]) {
  const straightKm = routeStraightDistance(stops);
  const roadKm = +(straightKm * 1.25).toFixed(2);
  const averageKmh = 28;
  return {
    path: stops.map(s => [s.lat, s.lng] as L.LatLngTuple),
    totalDistKm: roadKm,
    totalDurMin: Math.max(1, Math.round((roadKm / averageKmh) * 60 * frictionFactor(roadKm) * trafficMultiplier())),
  };
}

function fallbackEtaFromDistance(distKm: number, speedKmh: number, totalDistKm?: number, totalDurMin?: number): number {
  if (speedKmh >= 5) {
    return Math.max(1, Math.round((distKm / speedKmh) * 60 * frictionFactor(distKm) * trafficMultiplier()));
  }
  if (totalDistKm && totalDurMin && totalDistKm > 0) {
    return Math.max(1, Math.round(totalDurMin * Math.min(1, distKm / totalDistKm)));
  }
  return Math.max(1, Math.round((distKm / 22) * 60 * frictionFactor(distKm) * trafficMultiplier()));
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

/* ── Driver bus animated icon ── */
function makeDriverBusIcon(heading: number): L.DivIcon {
  const sz = 54;
  return L.divIcon({
    html: `
      <div style="position:relative;display:flex;align-items:center;justify-content:center;">
        <div style="position:absolute;inset:-10px;border-radius:50%;border:3px solid rgba(37,99,235,0.3);animation:__dpulse 1.5s ease-in-out infinite;pointer-events:none;"></div>
        <div style="position:absolute;inset:-4px;border-radius:50%;border:2px solid rgba(37,99,235,0.4);animation:__dpulse 1.5s ease-in-out 0.35s infinite;pointer-events:none;"></div>
        <div style="width:${sz}px;height:${sz}px;background:linear-gradient(150deg,#1E40AF,#22D3EE,#3B82F6);border-radius:50%;border:3px solid white;box-shadow:0 0 0 4px rgba(37,99,235,0.18),0 8px 24px rgba(37,99,235,0.5);display:flex;align-items:center;justify-content:center;transform:rotate(${heading}deg);transition:transform 0.5s cubic-bezier(0.25,0.46,0.45,0.94);position:relative;">
          <svg width="${sz*0.62}" height="${sz*0.62}" viewBox="0 0 64 80" fill="none">
            <rect x="8" y="8" width="48" height="64" rx="10" fill="white" opacity="0.95"/>
            <rect x="14" y="12" width="36" height="16" rx="4" fill="#BFDBFE" opacity="0.9"/>
            <rect x="14" y="52" width="36" height="14" rx="4" fill="#BFDBFE" opacity="0.7"/>
            <rect x="10" y="32" width="10" height="12" rx="2" fill="#DBEAFE" opacity="0.8"/>
            <rect x="44" y="32" width="10" height="12" rx="2" fill="#DBEAFE" opacity="0.8"/>
            <rect x="8"  y="30" width="48" height="20" rx="0" fill="rgba(37,99,235,0.12)"/>
            <rect x="16" y="5"  width="32" height="6"  rx="3" fill="#93C5FD"/>
            <rect x="16" y="69" width="32" height="5"  rx="3" fill="#BFDBFE"/>
            <ellipse cx="14" cy="22" rx="5" ry="6" fill="#1E293B" opacity="0.8"/>
            <ellipse cx="14" cy="58" rx="5" ry="6" fill="#1E293B" opacity="0.8"/>
            <ellipse cx="50" cy="22" rx="5" ry="6" fill="#1E293B" opacity="0.8"/>
            <ellipse cx="50" cy="58" rx="5" ry="6" fill="#1E293B" opacity="0.8"/>
          </svg>
          <div style="position:absolute;top:-9px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:12px solid white;"></div>
        </div>
        <div style="position:absolute;bottom:-22px;left:50%;transform:translateX(-50%);background:#1D4ED8;color:white;padding:2px 10px;border-radius:20px;font-size:10px;font-weight:800;white-space:nowrap;font-family:Inter,system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.2);pointer-events:none;">YOU</div>
      </div>`,
    className: "", iconSize: [sz+24, sz+32], iconAnchor: [(sz+24)/2, sz/2+10], popupAnchor: [0,-(sz/2+10)],
  });
}

function makePin(type: "start"|"end", label: string): L.DivIcon {
  const color = type === "start" ? "#16A34A" : "#DC2626";
  const letter = type === "start" ? "A" : "B";
  return L.divIcon({
    html: `
      <div style="position:relative;width:38px">
        <svg width="38" height="52" viewBox="0 0 38 52" style="display:block;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.22))">
          <path d="M19 1C9.33 1 1.5 8.83 1.5 18.5C1.5 32.5 19 51 19 51S36.5 32.5 36.5 18.5C36.5 8.83 28.67 1 19 1Z" fill="${color}" stroke="white" stroke-width="1.5"/>
          <circle cx="19" cy="18" r="9" fill="white"/>
        </svg>
        <span style="position:absolute;top:5px;left:50%;transform:translateX(-50%);font-size:13px;font-weight:800;color:${color};font-family:Inter,system-ui,sans-serif;line-height:1">${letter}</span>
        <div style="position:absolute;top:56px;left:50%;transform:translateX(-50%);background:rgba(255,255,255,0.96);color:#475569;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:800;white-space:nowrap;box-shadow:0 1px 5px rgba(37,99,235,0.08);font-family:Inter,system-ui,sans-serif;max-width:160px;overflow:hidden;text-overflow:ellipsis;pointer-events:none;border:1px solid rgba(37,99,235,0.08)">${label}</div>
      </div>`,
    className: "", iconSize: [38,52], iconAnchor: [19,52], popupAnchor: [0,-56],
  });
}

/* Format elapsed time as stopwatch */
function fmtElapsed(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,"0")}m`;
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

/* Speed colour */
function speedColor(kmh: number): string {
  if (kmh > 30) return "#22C55E";   // green: moving well
  if (kmh > 8)  return "#F59E0B";   // amber: slow/traffic
  if (kmh > 0)  return "#F97316";   // orange: very slow
  return "#EF4444";                  // red: stopped
}

export default function DriverMap({ location, positionHistory, speed, route, elapsed, hideHud = false, onEtaUpdate, busId, assignedStudents = [] }: DriverMapProps) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const mapRef          = useRef<L.Map | null>(null);
  const routeLayerRef   = useRef<L.LayerGroup | null>(null);
  const driverMarkerRef = useRef<L.Marker | null>(null);
  const trailRef        = useRef<L.Polyline | null>(null);
  const prevRouteKey    = useRef("");
  const isMounted       = useRef(true);
  const prevPosRef      = useRef<{ lat: number; lng: number } | null>(null);
  const etaRef          = useRef(false);   // ETA computing lock

  const [nextStop,      setNextStop]      = useState<Stop | null>(null);
  const [nextDistKm,    setNextDistKm]    = useState(0);
  const [nextEtaMin,    setNextEtaMin]    = useState<number | null>(null);
  const [destDistKm,    setDestDistKm]    = useState<number | null>(null);   // remaining to DESTINATION
  const [destEtaMin,    setDestEtaMin]    = useState<number | null>(null);   // remaining ETA to destination
  const [routeInfo,     setRouteInfo]     = useState<{ totalDistKm: number; totalDurMin: number } | null>(null);
  const routeInfoRef = useRef<{ totalDistKm: number; totalDurMin: number } | null>(null);
  const [loadingRoute,  setLoadingRoute]  = useState(false);
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [stopExpanded,  setStopExpanded]  = useState(false);
  const baseStopsRef = useRef<Stop[]>([]);

  const stops = route ? parseStopCoords(route.stopCoordinates) : [];
  const [fullRouteRoadPath, setFullRouteRoadPath] = useState<L.LatLngTuple[]>([]);
  const prevStopsKeyRef = useRef("");

  useEffect(() => {
    const stopsKey = stops.map(s => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join("|");
    if (stopsKey === prevStopsKeyRef.current) return;
    prevStopsKeyRef.current = stopsKey;

    if (stops.length < 2) {
      setFullRouteRoadPath([]);
      return;
    }
    fetchRouteInfo(stops)
      .then(info => {
        setFullRouteRoadPath(info.path);
      })
      .catch(() => {
        setFullRouteRoadPath(stops.map(s => [s.lat, s.lng] as L.LatLngTuple));
      });
  }, [route]);

  const [prevPath, setPrevPath] = useState<L.LatLngTuple[]>([]);
  const [isDeviated, setIsDeviated] = useState(false);


  useEffect(() => {
    if (!busId) {
      setPrevPath([]);
      setIsDeviated(false);
      return;
    }
    fetch(`/api/trips/previous-path?busId=${busId}`)
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
  }, [busId]);

  /* ════ Init map ════ */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    isMounted.current = true;

    const STYLE_ID = "__dm_anim";
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement("style");
      s.id = STYLE_ID;
      s.textContent = `
        @keyframes __dpulse{0%{transform:scale(1);opacity:.75}50%{transform:scale(1.5);opacity:.1}100%{transform:scale(1);opacity:.75}}
        @keyframes __dsp{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.4)}}
      `;
      document.head.appendChild(s);
    }

    const map = L.map(containerRef.current, { center:[17.045,82.065], zoom:14, zoomControl:false, doubleClickZoom:true });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' }).addTo(map);
    L.control.zoom({ position:"bottomright" }).addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    driverMarkerRef.current = L.marker([17.045,82.065], { icon:makeDriverBusIcon(0), zIndexOffset:2000 })
      .addTo(map).bindPopup('<div style="font-family:Inter,sans-serif;font-weight:700">🚍 Your Bus</div>');
    mapRef.current = map;

    return () => {
      isMounted.current = false;
      clearSpeedBuffer();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Refs to optimize/throttle OSRM dynamic requests
  const lastQueryLatLngRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastPassedStopIdxRef = useRef<number>(-1);

  /* ════ Draw route on route change ════ */
  useEffect(() => {
    const map = mapRef.current;
    const lg  = routeLayerRef.current;
    if (!map || !lg || !route?.stopCoordinates) return;

    const stops = parseStopCoords(route.stopCoordinates);
    if (stops.length < 2) return;

    const key = stops.map((s:Stop) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join("|");
    baseStopsRef.current = stops;

    const isTrackerActive = location && location.latitude !== 0 && location.longitude !== 0;
    const trackerLat = location?.latitude ?? 0;
    const trackerLng = location?.longitude ?? 0;

    let isTrackerNearRoute = false;
    if (isTrackerActive && stops.length > 0) {
      const routePath = fullRouteRoadPath.length > 1
        ? fullRouteRoadPath
        : stops.map((s: Stop) => [s.lat, s.lng] as L.LatLngTuple);
      isTrackerNearRoute = getDistanceToRoute(trackerLat, trackerLng, routePath) <= 750;
    }

    const shouldDrawDynamic = isTrackerActive && isTrackerNearRoute;

    // Reset loop index and clear layers if route has changed
    if (prevRouteKey.current !== key) {
      lastPassedStopIdxRef.current = -1;
      lg.clearLayers();
    }

    console.log("Route drawing useEffect running. isTrackerActive:", isTrackerActive, "isTrackerNearRoute:", isTrackerNearRoute, "location:", location);

    // Check distance threshold to throttle OSRM API calls when tracking
    if (shouldDrawDynamic) {
      const currentLatLng = { lat: trackerLat, lng: trackerLng };
      if (lastQueryLatLngRef.current && prevRouteKey.current === key) {
        const dist = hav(
          lastQueryLatLngRef.current.lat,
          lastQueryLatLngRef.current.lng,
          currentLatLng.lat,
          currentLatLng.lng
        ) * 1000;
        if (dist < 20) {
          // Bus moved less than 20 meters and route didn't change, keep current line to avoid API spamming
          return;
        }
      }
      prevRouteKey.current = key;
      lastQueryLatLngRef.current = currentLatLng;
    } else {
      // In static mode, only draw if route key changed
      if (key === prevRouteKey.current) return;
      prevRouteKey.current = key;
      lg.clearLayers();
      lastQueryLatLngRef.current = null;
    }

    (async () => {
      let paths: OSRMRoute[] = [];
      let startPointName = "";
      let endPointName = "";
      const destinationCoords: L.LatLngTuple = [stops[stops.length - 1].lat, stops[stops.length - 1].lng];

      if (isTrackerNearRoute) {
        const trackerCoords: L.LatLngTuple = [trackerLat, trackerLng];
        let nearestStopIdx = 0;
        let nearestStopMeters = Infinity;
        stops.forEach((s: Stop, index: number) => {
          const meters = hav(trackerLat, trackerLng, s.lat, s.lng) * 1000;
          if (meters < nearestStopMeters) {
            nearestStopMeters = meters;
            nearestStopIdx = index;
          }
        });
        if (nearestStopMeters < 250) {
          lastPassedStopIdxRef.current = Math.max(lastPassedStopIdxRef.current, nearestStopIdx);
        }
        const nextIdx = Math.min(
          stops.length - 1,
          Math.max(lastPassedStopIdxRef.current + 1, nearestStopMeters < 250 ? nearestStopIdx + 1 : nearestStopIdx)
        );
        const remainingStops = stops.slice(nextIdx);

        paths = await fetchMultiStopPaths(trackerCoords, remainingStops);
        startPointName = "Your Bus";
        endPointName = stops[stops.length - 1].name;

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
            const d = hav(trackerLat, trackerLng, coord[0], coord[1]) * 1000; // in meters
            if (d < minDistanceToPrev) minDistanceToPrev = d;
          }
          if (minDistanceToPrev > 100) {
            deviated = true;
          }
        }
        setIsDeviated(deviated);
      } else {
        setLoadingRoute(true);
        const info = await fetchRouteInfo(stops);
        setLoadingRoute(false);
        paths = [{
          path: info.path,
          distKm: info.totalDistKm,
          durMin: info.totalDurMin
        }];
        startPointName = stops[0].name;
        endPointName = stops[stops.length - 1].name;
        setIsDeviated(false);
      }

      if (!isMounted.current || !routeLayerRef.current) return;
      const lg2 = routeLayerRef.current;
      lg2.clearLayers();

      const prim = paths[0];
      const ri = { totalDistKm: prim.distKm, totalDurMin: prim.durMin };
      setRouteInfo(ri);
      routeInfoRef.current = ri;

      // 0. Draw previous completed route if available
      if (false && prevPath.length > 0) {
        // Glow
        L.polyline(prevPath, { color: "#E9D5FF", weight: 12, opacity: 0.2, lineCap:"round", lineJoin:"round", interactive:false }).addTo(lg2);
        // Main line
        L.polyline(prevPath, { color: "#7C3AED", weight: 4, opacity: 0.6, lineCap:"round", lineJoin:"round", dashArray: "8, 8" }).addTo(lg2)
          .bindPopup(`<div style="font-family:Inter,sans-serif;text-align:center;padding:2px"><b>Previous Completed Trip Route</b><br><span style="color:#7C3AED;font-weight:700">Dotted Purple Line</span></div>`);
      }

      // 1. Draw alternative route(s) underneath
      if (false && isTrackerNearRoute && paths.length > 1) {
        for (let i = 1; i < paths.length; i++) {
          const alt = paths[i];
          const altPath = slicePathFromTracker(trackerLat, trackerLng, alt.path);
          const color = "#94A3B8"; // gray for alternative
          
          // Glow
          L.polyline(altPath, { color, weight: 16, opacity: 0.1, lineCap:"round", lineJoin:"round", interactive:false }).addTo(lg2);
          // White casing
          L.polyline(altPath, { color:"#fff",    weight: 10, opacity:1,    lineCap:"round", lineJoin:"round", interactive:false }).addTo(lg2);
          // Alt line
          L.polyline(altPath, { color, weight: 5,  opacity: 0.8,    lineCap:"round", lineJoin:"round", dashArray: "10, 6" }).addTo(lg2)
            .bindPopup(`<div style="font-family:Inter,sans-serif;text-align:center;padding:2px"><b>Alternative Route</b><br><span style="color:#64748B;font-weight:700">${alt.distKm} km · ~${alt.durMin} min</span></div>`);

          // Draw label badge on alternative route
          if (altPath.length > 2) {
            const midIdx = Math.floor(altPath.length / 2);
            const [midLat, midLng] = altPath[midIdx];
            L.marker([midLat, midLng] as L.LatLngTuple, {
              icon: L.divIcon({
                html: `<div style="
                  background:rgba(15,23,42,0.92);color:white;
                  padding:3.5px 8px;border-radius:12px;
                  font-size:10px;font-weight:700;
                  white-space:nowrap;
                  font-family:Inter,system-ui,sans-serif;
                  box-shadow:0 1px 6px rgba(0,0,0,0.2);
                  border:1.5px solid white;
                ">Alt: ${alt.distKm} km · ${alt.durMin}m</div>`,
                className: "",
                iconSize: [110, 24],
                iconAnchor: [55, 12],
              }),
              interactive: false,
            }).addTo(lg2);
          }
        }
      }

      // 2. Draw primary route
      const primPath = isTrackerNearRoute ? slicePathFromTracker(trackerLat, trackerLng, prim.path) : prim.path;
      const primColor = "#60A5FA"; // soft blue
      
      // Glow
      L.polyline(primPath, { color:"#0F172A", weight:18, opacity:0.20, lineCap:"round", lineJoin:"round", interactive:false }).addTo(lg2);
      // White casing
      L.polyline(primPath, { color:"#FFFFFF", weight:8, opacity:0.72,    lineCap:"round", lineJoin:"round", interactive:false }).addTo(lg2);
      // Primary line
      L.polyline(primPath, { color:primColor, weight:5,  opacity:0.92,    lineCap:"round", lineJoin:"round" }).addTo(lg2)
        .bindPopup(`<div style="font-family:Inter,sans-serif;text-align:center;padding:2px"><b>${startPointName} → ${endPointName}</b>${isTrackerNearRoute ? `<br><span style="color:#22D3EE;font-weight:700">${prim.distKm} km · ~${prim.durMin} min</span>` : ""}</div>`);
      // Flow animation overlay

      // 3. Draw label badge on primary route if tracker is active
      if (isTrackerNearRoute && paths.length > 0) {
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
          } else {
            labelText = "Recommended";
          }
        }
        
        if (primPath.length > 2) {
          const labelIdx = Math.floor(primPath.length / 3);
          const [lblLat, lblLng] = primPath[labelIdx];
          L.marker([lblLat, lblLng] as L.LatLngTuple, {
            icon: L.divIcon({
              html: `<div style="
                background:#22D3EE;color:white;
                padding:4px 10px;border-radius:20px;
                font-size:10px;font-weight:800;
                white-space:nowrap;
                font-family:Inter,system-ui,sans-serif;
                box-shadow:0 2px 8px rgba(0,0,0,0.25);
                border:2px solid white;
              ">${labelText}: ${prim.distKm} km · ${prim.durMin} min</div>`,
              className: "",
              iconSize: [160, 26],
              iconAnchor: [80, 13],
            }),
            interactive: false,
          }).addTo(lg2);
        }
      }

      // Arrows
      const step = Math.max(4, Math.floor(primPath.length / 10));
      for (let i = step; i < primPath.length-1; i += step) {
        const [la1,ln1]=primPath[i-1] as [number,number], [la2,ln2]=primPath[i] as [number,number];
        const ang=(Math.atan2(ln2-ln1,la2-la1)*180)/Math.PI;
        L.marker(primPath[i] as L.LatLngTuple, {
          icon:L.divIcon({ html:`<svg width="14" height="14" viewBox="0 0 24 24" style="transform:rotate(${90-ang}deg);display:block" fill="none" stroke="#1D4ED8" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`, className:"", iconSize:[14,14], iconAnchor:[7,7] }),
          interactive:false, zIndexOffset:50,
        }).addTo(lg2);
      }

      const getStudentCountForStop = (stopName: string) => {
        if (!assignedStudents) return 0;
        return assignedStudents.filter((st: any) => {
          return st.boardingStop?.toLowerCase().trim() === stopName.toLowerCase().trim();
        }).length;
      };

      // Intermediate stop teardrops
      stops.slice(1,-1).forEach((s:Stop) => {
        // Skip intermediate dots if they overlap with the destination
        if (isTrackerNearRoute && Math.abs(s.lat - destinationCoords[0]) < 0.0001 && Math.abs(s.lng - destinationCoords[1]) < 0.0001) {
          return;
        }
        const count = getStudentCountForStop(s.name);
        const countSuffix = count > 0 ? ` (👥 ${count})` : "";
        const popupDetails = count > 0 
          ? `<br><span style="color:#2563EB;font-size:11px;font-weight:700">👥 ${count} student${count !== 1 ? 's' : ''} boarding</span>`
          : "";

        L.marker([s.lat,s.lng] as L.LatLngTuple, {
          icon: L.divIcon({
            html:`
              <div style="position:relative; display:flex; flex-direction:column; align-items:center;">
                <svg width="24" height="32" viewBox="0 0 24 30" fill="none" style="filter:drop-shadow(0 2px 5px rgba(0,0,0,0.22))">
                  <path d="M12 0C5.37 0 0 5.37 0 12C0 21 12 30 12 30C12 30 24 21 24 12C24 5.37 18.63 0 12 0Z" fill="#3B82F6" stroke="white" stroke-width="1.8"/>
                  <circle cx="12" cy="12" r="5" fill="white"/>
                </svg>
                <div style="position:absolute; top:36px; left:50%; transform:translateX(-50%); background:rgba(255,255,255,0.96); color:#475569; padding:2.5px 8px; border-radius:12px; font-size:10px; font-weight:800; white-space:nowrap; box-shadow:0 1px 5px rgba(37,99,235,0.08); font-family:Inter,sans-serif; border:1px solid rgba(37,99,235,0.08)">${s.name}${countSuffix}</div>
              </div>`,
            className:"", iconSize:[24,32], iconAnchor:[12,30],
          }),
          zIndexOffset:200,
        }).addTo(lg2).bindPopup(`<div style="font-family:Inter,sans-serif"><b>${s.name}</b>${popupDetails}</div>`);
      });

      const startCount = getStudentCountForStop(stops[0].name);
      const startCountSuffix = startCount > 0 ? ` (👥 ${startCount})` : "";
      const endCount = getStudentCountForStop(stops[stops.length - 1].name);
      const endCountSuffix = endCount > 0 ? ` (👥 ${endCount})` : "";

      if (isTrackerNearRoute) {
        L.marker([stops[0].lat,stops[0].lng] as L.LatLngTuple, { icon:makePin("start",stops[0].name + startCountSuffix), zIndexOffset:1000 }).addTo(lg2);
        L.marker(destinationCoords, { icon:makePin("end",endPointName + endCountSuffix), zIndexOffset:1000 }).addTo(lg2);
      } else {
        L.marker([stops[0].lat,stops[0].lng] as L.LatLngTuple, { icon:makePin("start",stops[0].name + startCountSuffix), zIndexOffset:1000 }).addTo(lg2);
        L.marker([stops[stops.length-1].lat,stops[stops.length-1].lng] as L.LatLngTuple, { icon:makePin("end",stops[stops.length-1].name + endCountSuffix), zIndexOffset:1000 }).addTo(lg2);
        mapRef.current?.fitBounds(L.latLngBounds(primPath).pad(0.13), { animate:true, duration:0.8 });
      }
    })();
  }, [route, location, prevPath, fullRouteRoadPath]);

  /* ════ GPS update: marker + ETA computation ════ */
  useEffect(() => {
    if (!location || !mapRef.current || !driverMarkerRef.current) return;
    const { latitude:lat, longitude:lng, heading } = location;

    let snappedLat = lat;
    let snappedLng = lng;
    if (fullRouteRoadPath.length > 0) {
      const snapped = snapToPath(lat, lng, fullRouteRoadPath);
      snappedLat = snapped[0];
      snappedLng = snapped[1];
    }

    const base = baseStopsRef.current;
    if (base.length === 0) return;

    // Check if tracker is near the route
    const routePathForNearCheck = fullRouteRoadPath.length > 1
      ? fullRouteRoadPath
      : base.map(s => [s.lat, s.lng] as L.LatLngTuple);
    const isNear = getDistanceToRoute(snappedLat, snappedLng, routePathForNearCheck) <= 750;

    // Bearing from movement
    let bearing = heading ?? 0;
    if (!heading && prevPosRef.current) {
      const dx = snappedLng - prevPosRef.current.lng, dy = snappedLat - prevPosRef.current.lat;
      if (Math.abs(dx)>0.00001 || Math.abs(dy)>0.00001) bearing = Math.atan2(dx,dy)*180/Math.PI;
    }
    prevPosRef.current = { lat: snappedLat, lng: snappedLng };

    driverMarkerRef.current.setLatLng([snappedLat,snappedLng]).setIcon(makeDriverBusIcon(bearing))
      .setPopupContent(`<div style="font-family:Inter,sans-serif;padding:2px 0">
        <div style="font-weight:800;font-size:13px;color:#1E293B;margin-bottom:5px">🚍 Your Bus</div>
        <div style="display:flex;gap:8px">
          <div style="background:#EFF6FF;border-radius:8px;padding:6px 10px;text-align:center">
            <div style="font-size:18px;font-weight:800;color:#22D3EE;line-height:1">${speed.toFixed(0)}</div>
            <div style="font-size:9px;color:#64748B;font-weight:600">km/h</div>
          </div>
          <div style="background:#F8FAFC;border-radius:8px;padding:6px 10px;text-align:center;font-size:10px;font-weight:700;color:#1E293B">
            ${snappedLat.toFixed(5)}<br>${snappedLng.toFixed(5)}
          </div>
        </div>
      </div>`);

    if (isNear) {
      mapRef.current.panTo([snappedLat,snappedLng], { animate:true, duration:0.5 });
    }

    // Find upcoming stop. If the bus is already very close to a stop, show the next one.
    let nearIdx = 0, nearDist = Infinity;
    base.forEach((s,i) => { const d=hav(snappedLat,snappedLng,s.lat,s.lng); if(d<nearDist){nearDist=d;nearIdx=i;} });
    
    if (nearDist < 0.25) {
      lastPassedStopIdxRef.current = Math.max(lastPassedStopIdxRef.current, nearIdx);
    }
    const nextIdx = Math.min(
      base.length - 1,
      Math.max(lastPassedStopIdxRef.current + 1, nearDist < 0.25 ? nearIdx + 1 : nearIdx)
    );
    const next = base[nextIdx];
    const dest = base[base.length-1];
    setNextStop(next);

    const routeInfoNow = routeInfoRef.current;

    if (!isNear) {
      // Offline / out of range fallback: show static totals
      const staticInfo = fallbackRouteInfo(base);
      const totalDist = routeInfoNow?.totalDistKm ?? staticInfo.totalDistKm;
      const totalDur = routeInfoNow?.totalDurMin ?? staticInfo.totalDurMin;
      
      setNextStop(base[0]);
      setNextDistKm(0);
      setNextEtaMin(0);
      setDestDistKm(totalDist);
      setDestEtaMin(totalDur);
      
      onEtaUpdate?.({
        destEtaMin: totalDur,
        destDistKm: totalDist,
        totalDistKm: totalDist,
        totalDurMin: totalDur,
      });
      return;
    }

    const fallbackNextDist = +(hav(snappedLat, snappedLng, next.lat, next.lng) * 1.25).toFixed(2);
    const fallbackDestDist = +(hav(snappedLat, snappedLng, dest.lat, dest.lng) * 1.25).toFixed(2);
    const fallbackNextEta = fallbackEtaFromDistance(fallbackNextDist, speed, routeInfoNow?.totalDistKm, routeInfoNow?.totalDurMin);
    const fallbackDestEta = fallbackEtaFromDistance(fallbackDestDist, speed, routeInfoNow?.totalDistKm, routeInfoNow?.totalDurMin);
    setNextDistKm(fallbackNextDist);
    setNextEtaMin(fallbackNextEta);
    setDestDistKm(fallbackDestDist);
    setDestEtaMin(fallbackDestEta);
    onEtaUpdate?.({
      destEtaMin: fallbackDestEta,
      destDistKm: fallbackDestDist,
      totalDistKm: routeInfoNow?.totalDistKm ?? null,
      totalDurMin: routeInfoNow?.totalDurMin ?? null,
    });

    // Compute ETAs (lock to avoid concurrent fetches)
    if (!etaRef.current) {
      etaRef.current = true;
      Promise.all([
        computeEta(snappedLat, snappedLng, next.lat, next.lng, speed),           // to next stop
        computeEta(snappedLat, snappedLng, dest.lat, dest.lng, speed),           // to destination
        fetchRemainingToDestination(snappedLat, snappedLng, dest.lat, dest.lng), // road distance remaining
      ]).then(([toNext, toDest, remaining]) => {
        if (!isMounted.current) return;
        const newNextDist = toNext?.distKm ?? fallbackNextDist;
        const newNextEta = toNext ? Math.round(toNext.etaMin) : fallbackNextEta;
        const newDestEta = toDest ? Math.round(toDest.etaMin) : fallbackDestEta;
        const newDestDist = remaining?.distKm ?? toDest?.distKm ?? fallbackDestDist;
        setNextDistKm(newNextDist);
        setNextEtaMin(newNextEta);
        setDestEtaMin(newDestEta);
        setDestDistKm(newDestDist);
        // Notify parent so dashboard stats update
        if (onEtaUpdate) {
          onEtaUpdate({
            destEtaMin:   newDestEta,
            destDistKm:   newDestDist,
            totalDistKm:  routeInfoRef.current?.totalDistKm ?? null,
            totalDurMin:  routeInfoRef.current?.totalDurMin ?? null,
          });
        }
        etaRef.current = false;
      }).catch(() => { etaRef.current = false; });
    }
  }, [location, speed, fullRouteRoadPath]);

  /* ════ GPS trail ════ */
  useEffect(() => {
    if (!mapRef.current || positionHistory.length < 2) return;
    const coords = positionHistory.map(p => [p.lat, p.lng] as L.LatLngTuple);
    if (trailRef.current) { trailRef.current.setLatLngs(coords); }
    else { trailRef.current = L.polyline(coords, { color:"#F59E0B", weight:4, opacity:0.75, dashArray:"8,6", lineCap:"round" }).addTo(mapRef.current); }
  }, [positionHistory]);

  /* ════ RENDER ════ */
  return (
    <div style={{ position:"relative", width:"100%", height:"460px", zIndex: 1 }}>
      <div ref={containerRef} style={{ position:"absolute", inset:0 }} />

      {/* Loading */}
      {loadingRoute && (
        <div style={{ position:"absolute", top:14, left:"50%", transform:"translateX(-50%)", zIndex:3000, display:"flex", alignItems:"center", gap:8, background:"#22D3EE", color:"#fff", borderRadius:30, padding:"8px 16px", fontFamily:"Inter,system-ui,sans-serif", fontSize:12, fontWeight:700, whiteSpace:"nowrap", pointerEvents:"none", boxShadow:"0 4px 14px rgba(37,99,235,0.4)" }}>
          <div style={{ width:13, height:13, border:"2px solid rgba(255,255,255,0.35)", borderTopColor:"#fff", borderRadius:"50%", animation:"__dsp .7s linear infinite" }}/>
          Loading road route…
        </div>
      )}

      {/* ══ TOP-LEFT HUD: compact by default, expands on click ══ */}
      {!hideHud && (
      <button type="button" onClick={() => setStatsExpanded(v => !v)}
        style={{ position:"absolute", top:12, left:12, zIndex:1000, background:"rgba(255,255,255,0.98)", backdropFilter:"blur(12px)", borderRadius:18, padding:statsExpanded ? "12px 14px" : "10px 12px", boxShadow:"0 4px 20px rgba(0,0,0,0.14)", fontFamily:"Inter,system-ui,sans-serif", minWidth:statsExpanded ? 230 : 150, border:"1px solid rgba(226,232,240,0.9)", cursor:"pointer", textAlign:"left" }}>

        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:statsExpanded ? 10 : 0 }}>
          <div style={{ width:12, height:12, borderRadius:"50%", background:speedColor(speed), flexShrink:0, animation:speed>0?"pulse 1.5s infinite":"none" }}/>
          <div>
            <div style={{ fontSize:9, color:"#22D3EE", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>
              {statsExpanded ? "Live Speed" : "Remaining Time"}
            </div>
            <div style={{ fontSize:24, fontWeight:900, color:"#1E293B", lineHeight:1 }}>
              {statsExpanded ? (
                <>{speed.toFixed(0)}<span style={{ fontSize:13, fontWeight:500, color:"#64748B", marginLeft:3 }}>km/h</span></>
              ) : (
                <span style={{ color:"#22D3EE" }}>{destEtaMin != null ? formatEta(destEtaMin) : "—"}</span>
              )}
            </div>
          </div>
          <span style={{ marginLeft:"auto", fontSize:11, color:"#64748B", fontWeight:800 }}>{statsExpanded ? "−" : "+"}</span>
        </div>

        {statsExpanded && (
        <div style={{ borderTop:"1px solid #F1F5F9", paddingTop:9 }}>
          {/* Row 1: Total Time + Remaining time */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
            <div style={{ background:"#F8FAFC", borderRadius:10, padding:"7px 8px", textAlign:"center" }}>
              <div style={{ fontSize:9, color:"#94A3B8", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.04em" }}>Total Time</div>
              <div style={{ fontSize:16, fontWeight:900, color:"#1E293B", marginTop:1 }}>
                {routeInfo ? formatEta(routeInfo.totalDurMin) : "—"}
              </div>
              <div style={{ fontSize:9, color:"#94A3B8", fontWeight:600, marginTop:1 }}>full route</div>
            </div>
            <div style={{ background:"#EFF6FF", borderRadius:10, padding:"7px 8px", textAlign:"center" }}>
              <div style={{ fontSize:9, color:"#22D3EE", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.04em" }}>Remaining</div>
              <div style={{ fontSize:16, fontWeight:900, color:"#22D3EE", marginTop:1 }}>
                {destEtaMin != null ? formatEta(destEtaMin) : "—"}
              </div>
            </div>
          </div>

          {/* Row 2: Remaining distance + Total route distance */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:9, color:"#94A3B8", fontWeight:700, textTransform:"uppercase" }}>Remaining Dist</div>
              <div style={{ fontSize:15, fontWeight:900, color:"#1E293B" }}>
                {destDistKm != null ? formatDist(destDistKm) : (routeInfo ? formatDist(routeInfo.totalDistKm) : "—")}
              </div>
              <div style={{ fontSize:9, color:"#94A3B8", fontWeight:600 }}>road to dest</div>
            </div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:9, color:"#94A3B8", fontWeight:700, textTransform:"uppercase" }}>Total Dist</div>
              <div style={{ fontSize:15, fontWeight:900, color:"#475569" }}>
                {routeInfo ? formatDist(routeInfo.totalDistKm) : "—"}
              </div>
              <div style={{ fontSize:9, color:"#94A3B8", fontWeight:600 }}>full route</div>
            </div>
          </div>

          {/* ETA source label */}
          <div style={{ marginTop:7, textAlign:"center", fontSize:9, color:"#94A3B8", fontWeight:600, letterSpacing:"0.04em" }}>
            ⚡ road · signals · traffic · speed
          </div>
        </div>
        )}
      </button>
      )}
      {isDeviated && (
        <div style={{
          position: "absolute",
          top: statsExpanded ? 190 : 78,
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
          border: "1px solid rgba(255, 255, 255, 0.2)",
          transition: "top 0.2s ease"
        }}>
          <span style={{ fontSize: 13, animation: "pulse 1.5s infinite" }}>⚠️</span>
          <span>Deviated from Previous Route</span>
        </div>
      )}

      {/* ══ BOTTOM HUD: Next stop ══ */}
      {!hideHud && nextStop && location && (
        <button type="button" onClick={() => setStopExpanded(v => !v)}
          style={{ position:"absolute", bottom:12, left:12, right:12, zIndex:1000, background:"rgba(255,255,255,0.98)", backdropFilter:"blur(12px)", borderRadius:16, padding:stopExpanded ? "12px 16px" : "10px 12px", boxShadow:"0 4px 20px rgba(0,0,0,0.14)", fontFamily:"Inter,system-ui,sans-serif", display:"flex", alignItems:"center", gap:12, border:"1px solid rgba(226,232,240,0.9)", cursor:"pointer", textAlign:"left" }}>
          {/* Icon */}
          <div style={{ width:stopExpanded ? 44 : 34, height:stopExpanded ? 44 : 34, borderRadius:12, background:"linear-gradient(135deg,#22D3EE,#3B82F6)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, boxShadow:"0 2px 8px rgba(37,99,235,0.3)" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
          </div>

          {/* Info */}
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:10, color:"#94A3B8", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em" }}>Next Stop</div>
            <div style={{ fontSize:15, fontWeight:800, color:"#1E293B", marginTop:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {nextStop.name}
            </div>
            {stopExpanded && <div style={{ fontSize:11, color:"#64748B", marginTop:2, display:"flex", alignItems:"center", gap:6 }}>
              <span>{formatDist(nextDistKm)} by road</span>
              {speed > 3 && <span style={{ color:"#22D3EE", fontWeight:600 }}>· {speed.toFixed(0)} km/h</span>}
            </div>}
          </div>

          {/* ETA to next stop */}
          <div style={{ textAlign:"center", flexShrink:0, minWidth:stopExpanded ? 96 : 72 }}>
            <div style={{ fontSize:9, color:"#94A3B8", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em" }}>{stopExpanded ? "ETA" : "Tap"}</div>
            <div style={{ fontSize: stopExpanded && nextEtaMin != null && nextEtaMin >= 60 ? 18 : 22, fontWeight:900, color:"#22D3EE", lineHeight:1.1, marginTop:2 }}>
              {nextEtaMin != null ? formatEta(nextEtaMin) : (speed > 3 ? formatEta((nextDistKm/speed)*60*1.4) : "--")}
            </div>
            {stopExpanded && <div style={{ fontSize:9, color:"#64748B", marginTop:2, fontWeight:600 }}>road+traffic</div>}
          </div>
        </button>
      )}

      {/* Legend */}
      <div style={{ position:"absolute", top:12, right:12, zIndex:1000, background:"rgba(255,255,255,0.97)", backdropFilter:"blur(8px)", borderRadius:10, padding:"6px 10px", boxShadow:"0 2px 8px rgba(0,0,0,0.1)", fontFamily:"Inter,system-ui,sans-serif", fontSize:10, fontWeight:600, color:"#64748B", display:"flex", flexDirection:"column", gap:4 }}>
        <span style={{ display:"flex", alignItems:"center", gap:5 }}><span style={{ width:18, height:3, background:"#22D3EE", borderRadius:2, display:"inline-block" }}/>Route</span>
        <span style={{ display:"flex", alignItems:"center", gap:5 }}><span style={{ width:18, height:3, background:"#F59E0B", borderRadius:2, display:"inline-block" }}/>Trail</span>
        <span style={{ display:"flex", alignItems:"center", gap:5 }}><span style={{ width:8, height:8, borderRadius:"50%", background:"#22C55E", display:"inline-block" }}/>Moving</span>
      </div>

      <style>{`
        @keyframes __dpulse{0%{transform:scale(1);opacity:.75}50%{transform:scale(1.5);opacity:.1}100%{transform:scale(1);opacity:.75}}
        @keyframes __dsp{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.4)}}
      `}</style>
    </div>
  );
}








