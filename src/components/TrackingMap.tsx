"use client";

/**
 * TrackingMap — Student & Admin view
 * Real bus image marker that rotates with heading and smoothly moves with GPS updates
 */

import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface Stop      { name: string; lat: number; lng: number; }
interface BusLoc    { lat: number; lng: number; speed: number; heading: number; busId: string; }
interface RouteInfo { id: number; routeName: string; stops: Stop[]; }

interface Props {
  busLocations:    Map<string, BusLoc>;
  selectedBusId:   string | null;
  routeStops?:     Stop[];
  allRoutes?:      any[];
  onBusClick?:     (busId: string) => void;
  onRouteChange?:  (routeId: number) => void;
  autoFlyToStart?: boolean;
}

/* ── OSRM road path computed leg-by-leg in parallel ── */
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

/* ── Bus SVG icon (top-view bus facing up, rotated by heading) ── */
function makeBusMarkerIcon(heading: number, selected: boolean, busId: string): L.DivIcon {
  const sz = selected ? 52 : 44;
  const glow = selected
    ? "0 0 0 5px rgba(37,99,235,0.25), 0 6px 24px rgba(37,99,235,0.55)"
    : "0 4px 16px rgba(37,99,235,0.45)";
  const pulse = selected
    ? `<div style="position:absolute;inset:-8px;border-radius:50%;border:3px solid rgba(37,99,235,0.35);animation:__bpulse 1.5s ease-in-out infinite;"></div>` : "";

  return L.divIcon({
    html: `
      <div style="position:relative;display:flex;align-items:center;justify-content:center;">
        ${pulse}
        <div style="
          width:${sz}px;height:${sz}px;
          background:linear-gradient(145deg,#1D4ED8,#3B82F6);
          border-radius:50%;
          border:3px solid white;
          box-shadow:${glow};
          display:flex;align-items:center;justify-content:center;
          transform:rotate(${heading}deg);
          transition:transform 0.4s ease;
          position:relative;
        ">
          <!-- Top-view bus SVG -->
          <svg width="${sz*0.62}" height="${sz*0.62}" viewBox="0 0 64 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <!-- Bus body -->
            <rect x="8" y="8" width="48" height="64" rx="10" fill="white" opacity="0.95"/>
            <!-- Front windscreen -->
            <rect x="14" y="12" width="36" height="16" rx="4" fill="#BFDBFE" opacity="0.9"/>
            <!-- Rear windscreen -->
            <rect x="14" y="52" width="36" height="14" rx="4" fill="#BFDBFE" opacity="0.7"/>
            <!-- Left windows row -->
            <rect x="10" y="32" width="10" height="12" rx="2" fill="#DBEAFE" opacity="0.8"/>
            <!-- Right windows row -->
            <rect x="44" y="32" width="10" height="12" rx="2" fill="#DBEAFE" opacity="0.8"/>
            <!-- Centre stripe -->
            <rect x="8" y="30" width="48" height="20" rx="0" fill="rgba(37,99,235,0.15)"/>
            <!-- Front bumper (direction indicator) -->
            <rect x="16" y="5" width="32" height="6" rx="3" fill="#93C5FD"/>
            <!-- Rear bumper -->
            <rect x="16" y="69" width="32" height="5" rx="3" fill="#BFDBFE"/>
            <!-- Left wheel arch -->
            <ellipse cx="14" cy="22" rx="5" ry="6" fill="#1E293B" opacity="0.7"/>
            <ellipse cx="14" cy="58" rx="5" ry="6" fill="#1E293B" opacity="0.7"/>
            <!-- Right wheel arch -->
            <ellipse cx="50" cy="22" rx="5" ry="6" fill="#1E293B" opacity="0.7"/>
            <ellipse cx="50" cy="58" rx="5" ry="6" fill="#1E293B" opacity="0.7"/>
          </svg>
          <!-- Direction arrow tip at front -->
          <div style="
            position:absolute;top:-7px;left:50%;
            transform:translateX(-50%);
            width:0;height:0;
            border-left:7px solid transparent;
            border-right:7px solid transparent;
            border-bottom:10px solid white;
          "></div>
        </div>
        <!-- Bus ID label -->
        <div style="
          position:absolute;bottom:-22px;left:50%;transform:translateX(-50%);
          background:#1D4ED8;color:white;
          padding:2px 8px;border-radius:20px;
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

function makePin(type: "start"|"end", label: string): L.DivIcon {
  const color  = type === "start" ? "#16A34A" : "#DC2626";
  const letter = type === "start" ? "A" : "B";
  return L.divIcon({
    html: `
      <div style="position:relative;width:38px">
        <svg width="38" height="52" viewBox="0 0 38 52" style="display:block;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.25))">
          <path d="M19 1C9.33 1 1.5 8.83 1.5 18.5C1.5 32.5 19 51 19 51S36.5 32.5 36.5 18.5C36.5 8.83 28.67 1 19 1Z" fill="${color}" stroke="white" stroke-width="2"/>
          <circle cx="19" cy="18" r="9" fill="white"/>
        </svg>
        <span style="position:absolute;top:5px;left:50%;transform:translateX(-50%);font-size:14px;font-weight:900;color:${color};font-family:Inter,system-ui,sans-serif;line-height:1">${letter}</span>
        <div style="position:absolute;top:56px;left:50%;transform:translateX(-50%);background:${color};color:#fff;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,0.2);font-family:Inter,system-ui,sans-serif;max-width:160px;overflow:hidden;text-overflow:ellipsis;pointer-events:none">${label}</div>
      </div>`,
    className: "", iconSize: [38,52], iconAnchor: [19,52], popupAnchor: [0,-56],
  });
}

function makeBusPopup(bus: BusLoc): string {
  return `
    <div style="font-family:Inter,system-ui,sans-serif;min-width:190px;padding:4px 0">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="width:40px;height:40px;background:linear-gradient(135deg,#1D4ED8,#3B82F6);border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
          <svg width="22" height="28" viewBox="0 0 64 80" fill="none">
            <rect x="8" y="8" width="48" height="64" rx="10" fill="white" opacity="0.95"/>
            <rect x="14" y="12" width="36" height="16" rx="4" fill="#BFDBFE"/>
            <rect x="16" y="5" width="32" height="6" rx="3" fill="#93C5FD"/>
            <ellipse cx="14" cy="22" rx="5" ry="6" fill="#1E293B" opacity="0.7"/>
            <ellipse cx="50" cy="22" rx="5" ry="6" fill="#1E293B" opacity="0.7"/>
          </svg>
        </div>
        <div>
          <div style="font-weight:800;font-size:16px;color:#1E293B">${bus.busId}</div>
          <span style="background:#16A34A;color:white;padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:0.05em">● LIVE</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div style="background:#EFF6FF;border-radius:10px;padding:8px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#2563EB;line-height:1">${bus.speed.toFixed(0)}</div>
          <div style="font-size:10px;color:#64748B;font-weight:600;text-transform:uppercase;margin-top:2px">km/h</div>
        </div>
        <div style="background:#F8FAFC;border-radius:10px;padding:8px;text-align:center">
          <div style="font-size:10px;font-weight:700;color:#1E293B;line-height:1.5">${bus.lat.toFixed(5)}<br>${bus.lng.toFixed(5)}</div>
          <div style="font-size:10px;color:#94A3B8;font-weight:600;text-transform:uppercase;margin-top:2px">GPS</div>
        </div>
      </div>
    </div>`;
}

/* ── Smooth interpolation for bus movement ── */
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

export default function TrackingMap({
  busLocations, selectedBusId, routeStops,
  onBusClick, autoFlyToStart,
}: Props) {
  const divRef        = useRef<HTMLDivElement>(null);
  const mapRef        = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const busMarkersRef = useRef<Map<string, {
    marker: L.Marker;
    prevLat: number; prevLng: number;
    targetLat: number; targetLng: number;
    heading: number; rafId: number | null;
  }>>(new Map());
  const prevStopKey   = useRef("");
  const isMounted     = useRef(true);
  const onBusClickRef = useRef(onBusClick);
  onBusClickRef.current = onBusClick;

  /* ════ 1. Init map ════ */
  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    isMounted.current = true;

    /* Inject bus animation CSS into <head> once so Leaflet divIcon HTML can use it */
    const STYLE_ID = "__bustrack_anim";
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        @keyframes __bpulse {
          0%   { transform: scale(1); opacity: 0.75; }
          50%  { transform: scale(1.45); opacity: 0.15; }
          100% { transform: scale(1); opacity: 0.75; }
        }
        @keyframes __sp {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }

    const map = L.map(divRef.current, {
      center: [17.045, 82.065], zoom: 12,
      zoomControl: false,
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      isMounted.current = false;
      // Cancel all animation frames
      busMarkersRef.current.forEach(d => { if (d.rafId) cancelAnimationFrame(d.rafId); });
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /* ════ 2. Draw route ════ */
  useEffect(() => {
    const map = mapRef.current;
    const lg  = routeLayerRef.current;
    if (!map || !lg) return;

    if (!routeStops || routeStops.length < 2) {
      lg.clearLayers();
      prevStopKey.current = "";
      return;
    }
    const key = routeStops.map(s => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join("|");
    if (key === prevStopKey.current) return;
    prevStopKey.current = key;
    lg.clearLayers();

    /* Spinner */
    const mid = routeStops[Math.floor(routeStops.length / 2)];
    L.marker([mid.lat, mid.lng] as L.LatLngTuple, {
      icon: L.divIcon({
        html: `<div style="width:36px;height:36px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(0,0,0,0.18)"><div style="width:20px;height:20px;border:3px solid #2563EB;border-top-color:transparent;border-radius:50%;animation:__sp .7s linear infinite"></div></div><style>@keyframes __sp{to{transform:rotate(360deg)}}</style>`,
        className:"", iconSize:[36,36], iconAnchor:[18,18],
      }),
      interactive: false,
    }).addTo(lg);

    if (autoFlyToStart) {
      map.flyTo([routeStops[0].lat, routeStops[0].lng], 14, { duration: 1.2 });
    }

    (async () => {
      const path = await fetchRoadPath(routeStops);
      if (!isMounted.current || !routeLayerRef.current) return;
      const lg2 = routeLayerRef.current;
      lg2.clearLayers();

      L.polyline(path, { color:"#93C5FD", weight:18, opacity:0.14, lineCap:"round", lineJoin:"round", interactive:false }).addTo(lg2);
      L.polyline(path, { color:"#fff",    weight:11, opacity:1,    lineCap:"round", lineJoin:"round", interactive:false }).addTo(lg2);
      L.polyline(path, { color:"#2563EB", weight:6,  opacity:1,    lineCap:"round", lineJoin:"round" }).addTo(lg2)
        .bindPopup(`<div style="font-family:Inter,sans-serif;text-align:center;padding:2px"><b>${routeStops[0].name} → ${routeStops[routeStops.length-1].name}</b></div>`);

      /* Arrows */
      const step = Math.max(4, Math.floor(path.length / 10));
      for (let i = step; i < path.length-1; i += step) {
        const [la1,ln1] = path[i-1] as [number,number];
        const [la2,ln2] = path[i]   as [number,number];
        const ang = (Math.atan2(ln2-ln1, la2-la1)*180)/Math.PI;
        L.marker(path[i] as L.LatLngTuple, {
          icon: L.divIcon({
            html:`<svg width="16" height="16" viewBox="0 0 24 24" style="transform:rotate(${90-ang}deg);display:block" fill="none" stroke="#1D4ED8" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
            className:"", iconSize:[16,16], iconAnchor:[8,8],
          }),
          interactive:false, zIndexOffset:50,
        }).addTo(lg2);
      }

      /* Intermediate stop dots */
      routeStops.slice(1,-1).forEach(s => {
        L.marker([s.lat,s.lng] as L.LatLngTuple, {
          icon: L.divIcon({
            html:`<div style="position:relative"><div style="width:14px;height:14px;background:#fff;border:3px solid #2563EB;border-radius:50%;box-shadow:0 2px 8px rgba(37,99,235,0.4)"></div><div style="position:absolute;top:18px;left:50%;transform:translateX(-50%);background:#1E293B;color:#fff;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.2);font-family:Inter,sans-serif">${s.name}</div></div>`,
            className:"", iconSize:[14,14], iconAnchor:[7,7],
          }),
          zIndexOffset:200,
        }).addTo(lg2).bindPopup(`<div style="font-family:Inter,sans-serif"><b>${s.name}</b><br><span style="color:#64748B;font-size:11px">Bus Stop</span></div>`);
      });

      /* Start A + End B pins */
      L.marker([routeStops[0].lat,routeStops[0].lng] as L.LatLngTuple, { icon:makePin("start",routeStops[0].name), zIndexOffset:1000 }).addTo(lg2)
        .bindPopup(`<div style="font-family:Inter,sans-serif"><b>${routeStops[0].name}</b><br><span style="color:#16A34A;font-size:11px;font-weight:600">📍 Starting Point</span></div>`);

      const en = routeStops[routeStops.length-1];
      L.marker([en.lat,en.lng] as L.LatLngTuple, { icon:makePin("end",en.name), zIndexOffset:1000 }).addTo(lg2)
        .bindPopup(`<div style="font-family:Inter,sans-serif"><b>${en.name}</b><br><span style="color:#DC2626;font-size:11px;font-weight:600">🏁 Destination</span></div>`);

      mapRef.current?.fitBounds(L.latLngBounds(path).pad(0.12), { animate:true, duration:0.8 });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeStops, autoFlyToStart]);

  /* ════ 3. Animated bus markers ════ */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    busLocations.forEach((bus, busId) => {
      // Skip invalid GPS coords (0,0 = off Africa coast — GPS not ready yet)
      if (bus.lat === 0 && bus.lng === 0) return;

      const sel = busId === selectedBusId;

      if (busMarkersRef.current.has(busId)) {
        /* ── Update existing marker with smooth animation ── */
        const data = busMarkersRef.current.get(busId)!;

        // Compute heading from movement direction if not provided
        const computedHeading = bus.heading !== 0 ? bus.heading
          : Math.atan2(bus.lng - data.prevLng, bus.lat - data.prevLat) * 180 / Math.PI;

        data.targetLat = bus.lat;
        data.targetLng = bus.lng;
        data.heading   = computedHeading;

        // Cancel previous animation
        if (data.rafId) cancelAnimationFrame(data.rafId);

        // Smooth interpolation over ~600ms (20 frames at 60fps)
        const startLat = data.prevLat;
        const startLng = data.prevLng;
        const startTime = performance.now();
        const duration  = 800;

        function animateStep(now: number) {
          if (!isMounted.current) return;
          const t = Math.min((now - startTime) / duration, 1);
          const eased = t < 0.5 ? 2*t*t : -1+(4-2*t)*t; // ease-in-out quad
          const lat = lerp(startLat, data.targetLat, eased);
          const lng = lerp(startLng, data.targetLng, eased);
          data.marker.setLatLng([lat, lng]);
          data.marker.setIcon(makeBusMarkerIcon(data.heading, sel, busId));
          data.marker.setZIndexOffset(sel ? 2000 : 500);
          if (t < 1) {
            data.rafId = requestAnimationFrame(animateStep);
          } else {
            data.prevLat = data.targetLat;
            data.prevLng = data.targetLng;
            data.rafId = null;
          }
        }
        data.rafId = requestAnimationFrame(animateStep);
        data.marker.setPopupContent(makeBusPopup(bus));

      } else {
        /* ── Create new marker ── */
        const heading = bus.heading || 0;
        const marker  = L.marker([bus.lat, bus.lng], {
          icon:          makeBusMarkerIcon(heading, sel, busId),
          zIndexOffset:  sel ? 2000 : 500,
        }).addTo(map).bindPopup(makeBusPopup(bus));

        marker.on("click", () => onBusClickRef.current?.(busId));

        busMarkersRef.current.set(busId, {
          marker,
          prevLat: bus.lat, prevLng: bus.lng,
          targetLat: bus.lat, targetLng: bus.lng,
          heading, rafId: null,
        });
      }
    });

    /* Remove stale markers */
    busMarkersRef.current.forEach((data, id) => {
      if (!busLocations.has(id)) {
        if (data.rafId) cancelAnimationFrame(data.rafId);
        map.removeLayer(data.marker);
        busMarkersRef.current.delete(id);
      }
    });

    /* Pan to selected bus */
    if (selectedBusId && busLocations.has(selectedBusId)) {
      const b = busLocations.get(selectedBusId)!;
      map.panTo([b.lat, b.lng], { animate:true, duration:0.5 });
    }
  }, [busLocations, selectedBusId]);

  return (
    <div style={{ position:"relative", width:"100%", height:"520px" }}>
      <div ref={divRef} style={{ position:"absolute", inset:0, borderRadius:"16px" }} />

      {/* Legend */}
      <div style={{
        position:"absolute", bottom:12, left:12, zIndex:1000,
        background:"rgba(255,255,255,0.97)", backdropFilter:"blur(8px)",
        borderRadius:12, padding:"7px 12px",
        boxShadow:"0 2px 12px rgba(0,0,0,0.1)",
        display:"flex", gap:12, alignItems:"center",
        fontSize:11, fontFamily:"Inter,system-ui,sans-serif", color:"#475569", fontWeight:600,
      }}>
        <span style={{ display:"flex", alignItems:"center", gap:5 }}>
          <span style={{ width:10, height:10, borderRadius:"50%", background:"#16A34A", display:"inline-block" }}/>Start
        </span>
        <span style={{ display:"flex", alignItems:"center", gap:5 }}>
          <span style={{ width:10, height:10, borderRadius:"50%", background:"#DC2626", display:"inline-block" }}/>End
        </span>
        <span style={{ display:"flex", alignItems:"center", gap:4 }}>
          <svg width="16" height="16" viewBox="0 0 64 80" fill="none" style={{ display:"inline-block" }}>
            <rect x="8" y="8" width="48" height="64" rx="10" fill="#2563EB"/>
            <rect x="14" y="12" width="36" height="16" rx="4" fill="#BFDBFE"/>
          </svg>
          Live Bus
        </span>
        <span style={{ display:"flex", alignItems:"center", gap:4 }}>
          <span style={{ width:16, height:3, borderRadius:2, background:"#2563EB", display:"inline-block" }}/>Road
        </span>
      </div>

      {/* No data */}
      {busLocations.size === 0 && (!routeStops || routeStops.length === 0) && (
        <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none", zIndex:500 }}>
          <div style={{ background:"rgba(255,255,255,0.97)", borderRadius:20, padding:"28px 36px", textAlign:"center", boxShadow:"0 8px 32px rgba(0,0,0,0.12)" }}>
            <div style={{ width:56, height:56, borderRadius:"50%", background:"#DBEAFE", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px" }}>
              <svg width="26" height="26" fill="none" viewBox="0 0 24 24" stroke="#2563EB" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
            </div>
            <p style={{ fontWeight:700, fontSize:15, color:"#1E293B", fontFamily:"Inter,system-ui,sans-serif", margin:"0 0 6px" }}>Select a route</p>
            <p style={{ fontSize:12, color:"#94A3B8", fontFamily:"Inter,system-ui,sans-serif" }}>Pick from the list to view live navigation</p>
          </div>
        </div>
      )}

    </div>
  );
}
