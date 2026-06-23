"use client";

/**
 * RouteBuilderMap — interactive route editor with road alternatives.
 *
 * Interactions:
 *  1. DRAG the route line → shows up to 3 road alternatives to choose from
 *  2. Click an alternative → route updates via that road
 *  3. DOUBLE-CLICK empty area → adds stop (snapped to road)
 *  4. DRAG stop markers → repositions stops
 *  5. Click stop popup → rename / remove
 *  6. "Add Stop" button → adds at map centre
 *  7. "Set Route" → saves, "Reset" → restores original
 */

import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface BuilderStop { name: string; lat: number; lng: number; }

interface Alternative {
  path:    L.LatLngTuple[];
  distKm:  number;
  durMin:  number;
  via:     BuilderStop;        // the snapped via-point
  insertAt:number;             // where to insert it
  label:   string;             // road name from OSRM
}

interface Props {
  initialStops: BuilderStop[];
  routeName?:   string;
  onSave:       (stops: BuilderStop[]) => void;
  onCancel?:    () => void;
  height?:      number;
}

/* ── OSRM: route through stops leg-by-leg in parallel, returns combined path ── */
async function fetchRoad(stops: BuilderStop[], alts = 0): Promise<{
  path: L.LatLngTuple[]; distKm: number; durMin: number;
}[]> {
  if (stops.length < 2) return [{
    path: stops.map(s => [s.lat, s.lng] as L.LatLngTuple), distKm: 0, durMin: 0,
  }];

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
      totalDuration += (hav(start.lat, start.lng, end.lat, end.lng) / 30) * 3600;
    }
  }

  return [{
    path: combinedPath,
    distKm: +(totalDistance / 1000).toFixed(2),
    durMin: Math.round(totalDuration / 60)
  }];
}

/* ── Snap to nearest road, return multiple candidates ── */
async function snapToRoadMultiple(lat: number, lng: number, count = 3): Promise<BuilderStop[]> {
  try {
    const r = await fetch(
      `https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}?number=${count}`,
      { signal: AbortSignal.timeout(6000) }
    );
    const d = await r.json();
    if (d.code === "Ok" && d.waypoints?.length) {
      return d.waypoints.map((wp: any) => ({
        lat:  wp.location[1],
        lng:  wp.location[0],
        name: wp.name || `Road`,
      }));
    }
  } catch { /**/ }
  return [{ lat, lng, name: "Road" }];
}

async function snapToRoad(lat: number, lng: number): Promise<BuilderStop> {
  const pts = await snapToRoadMultiple(lat, lng, 1);
  return pts[0] ?? { lat, lng, name: "New Stop" };
}

/* ── haversine km ── */
function hav(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, r = Math.PI / 180;
  const a = Math.sin((lat2-lat1)*r/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin((lng2-lng1)*r/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function bestInsertIdx(stops: BuilderStop[], wp: BuilderStop): number {
  if (stops.length <= 1) return stops.length;
  let bestIdx = 1, bestScore = Infinity;
  for (let i = 1; i < stops.length; i++) {
    const score = hav(stops[i-1].lat, stops[i-1].lng, wp.lat, wp.lng)
                + hav(wp.lat, wp.lng, stops[i].lat, stops[i].lng)
                - hav(stops[i-1].lat, stops[i-1].lng, stops[i].lat, stops[i].lng);
    if (score < bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

/* ── Stop pin icon ── */
function makeStopIcon(idx: number, total: number, name: string): L.DivIcon {
  const isFirst = idx === 0, isLast = idx === total - 1;
  const color   = isFirst ? "#16A34A" : isLast ? "#DC2626" : "#22D3EE";
  const label   = isFirst ? "A" : isLast ? "B" : String(idx + 1);
  const sz      = (isFirst || isLast) ? 34 : 26;
  const typeLabel = isFirst ? "START" : isLast ? "END" : `Stop ${idx + 1}`;
  const displayName = name ? name : typeLabel;
  return L.divIcon({
    html: `
      <div style="cursor:grab;position:relative;user-select:none">
        <div style="width:${sz}px;height:${sz}px;background:${color};border:3px solid white;border-radius:50%;
          box-shadow:0 2px 6px rgba(0,0,0,0.22);display:flex;align-items:center;justify-content:center;">
          <span style="font-size:${sz>28?13:10}px;font-weight:900;color:white;font-family:Inter,system-ui,sans-serif">${label}</span>
        </div>
        <div style="position:absolute;top:${sz+4}px;left:50%;transform:translateX(-50%);
          background:rgba(255,255,255,0.96);color:#475569;padding:2px 8px;border-radius:12px;border:1px solid rgba(37,99,235,0.08);
          font-size:10px;font-weight:700;white-space:nowrap;pointer-events:none;font-family:Inter,system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.25);">
          ${displayName}</div>
      </div>`,
    className: "", iconSize: [sz,sz], iconAnchor: [sz/2,sz/2],
  });
}

function makeGhostIcon(dragging: boolean): L.DivIcon {
  return L.divIcon({
    html: `<div style="width:22px;height:22px;background:${dragging?"#F59E0B":"#94A3B8"};border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:${dragging?"grabbing":"default"};"></div>`,
    className: "", iconSize: [22,22], iconAnchor: [11,11],
  });
}

/* ── Alternative path colors ── */
const ALT_COLORS = ["#22D3EE", "#F59E0B", "#10B981"];
const ALT_LABELS = ["Option A (Recommended)", "Option B", "Option C"];

function durLabel(min: number) {
  return min >= 60 ? `${Math.floor(min/60)}h ${min%60}m` : `${min} min`;
}

export default function RouteBuilderMap({
  initialStops, routeName = "Route", onSave, onCancel, height = 480,
}: Props) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const mapRef         = useRef<L.Map | null>(null);
  const routeLayerRef  = useRef<L.LayerGroup | null>(null);   // main route
  const altLayerRef    = useRef<L.LayerGroup | null>(null);   // alternatives overlay
  const markersRef     = useRef<L.Marker[]>([]);
  const ghostRef       = useRef<L.Marker | null>(null);
  const isMounted      = useRef(true);
  const isRedrawing    = useRef(false);
  const isDraggingRef  = useRef(false);

  // Jitter overlapping stops so they are easily identifiable and draggable
  const processedStops = React.useMemo(() => {
    const arr = JSON.parse(JSON.stringify(initialStops)) as BuilderStop[];
    const seen = new Set<string>();
    for (let i = 0; i < arr.length; i++) {
      let lat = arr[i].lat;
      let lng = arr[i].lng;
      let key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      let attempts = 0;
      while (seen.has(key) && attempts < 10) {
        lat += 0.0015 * (i + 1);
        lng += 0.0015 * (i + 1);
        key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
        attempts++;
      }
      arr[i].lat = lat;
      arr[i].lng = lng;
      seen.add(key);
    }
    return arr;
  }, [initialStops]);

  const stopsRef   = useRef<BuilderStop[]>(processedStops);
  const initialRef = useRef<BuilderStop[]>([...processedStops]);

  const [uiStops,       setUiStops]       = useState<BuilderStop[]>(processedStops);
  const [roadInfo,      setRoadInfo]       = useState<{ distKm: number; durMin: number } | null>(null);
  const [snapping,      setSnapping]       = useState(false);
  const [rebuilding,    setRebuilding]     = useState(false);
  const [hasChanges,    setHasChanges]     = useState(false);
  const [toast,         setToast]          = useState<{ msg: string; k: number } | null>(null);
  /* alternatives picker state */
  const [alternatives,  setAlternatives]   = useState<Alternative[]>([]);
  const [showAltPicker, setShowAltPicker]  = useState(false);

  function showToast(msg: string) {
    setToast({ msg, k: Date.now() });
    setTimeout(() => setToast(null), 3500);
  }
  function syncUI() { setUiStops([...stopsRef.current]); }

  /* ── Clear alternatives overlay ── */
  function clearAlternatives() {
    const lg = altLayerRef.current;
    if (lg) lg.clearLayers();
    setAlternatives([]);
    setShowAltPicker(false);
  }

  /* ── Draw alternatives on map (colored lines) ── */
  function drawAlternativesOnMap(alts: Alternative[]) {
    const map = mapRef.current;
    const lg  = altLayerRef.current;
    if (!map || !lg) return;
    lg.clearLayers();

    alts.forEach((alt, idx) => {
      const color = ALT_COLORS[idx] ?? "#94A3B8";
      const isMain = idx === 0;
      // Glow
      L.polyline(alt.path, { color, weight: 16, opacity: 0.12, lineCap:"round", lineJoin:"round", interactive:false }).addTo(lg);
      // White casing
      L.polyline(alt.path, { color:"#fff", weight: isMain?11:9, opacity:1, lineCap:"round", lineJoin:"round", interactive:false }).addTo(lg);
      // Main line — clickable to select this alternative
      const line = L.polyline(alt.path, {
        color, weight: isMain ? 7 : 5,
        opacity: isMain ? 1 : 0.75,
        lineCap:"round", lineJoin:"round",
        dashArray: idx === 0 ? undefined : "10, 5",
      }).addTo(lg);

      // Label badge on the line
      if (alt.path.length > 0) {
        const midIdx = Math.floor(alt.path.length / 2);
        const [midLat, midLng] = alt.path[midIdx] as [number, number];
        L.marker([midLat, midLng] as L.LatLngTuple, {
          icon: L.divIcon({
            html: `<div style="
              background:${color};color:white;
              padding:3px 10px;border-radius:20px;
              font-size:11px;font-weight:800;
              white-space:nowrap;
              font-family:Inter,system-ui,sans-serif;
              box-shadow:0 2px 8px rgba(0,0,0,0.2);
              border:2px solid white;
              cursor:pointer;
            ">${idx===0?"✓ ":""}${alt.distKm}km · ${durLabel(alt.durMin)}</div>`,
            className: "",
            iconSize: [120, 28],
            iconAnchor: [60, 14],
          }),
          interactive: true,
          zIndexOffset: 2000 + idx,
        }).addTo(lg).on("click", () => selectAlternative(alt));

        line.on("click", () => selectAlternative(alt));
      }
    });
  }

  /* ── User selects one alternative ── */
  async function selectAlternative(alt: Alternative) {
    clearAlternatives();
    const updated = [...stopsRef.current];
    updated.splice(alt.insertAt, 0, alt.via);
    stopsRef.current = updated;
    setHasChanges(true);
    syncUI();
    await redrawMap();
    showToast(`✅ Route updated via "${alt.via.name}" (${alt.distKm} km)`);
  }

  /* ══════════════════════════════
     CORE REDRAW
  ══════════════════════════════ */
  async function redrawMap() {
    const map = mapRef.current;
    const lg  = routeLayerRef.current;
    if (!map || !lg) return;
    if (isRedrawing.current) return;
    isRedrawing.current = true;
    setRebuilding(true);

    markersRef.current.forEach(m => { try { map.removeLayer(m); } catch { /**/ } });
    markersRef.current = [];
    lg.clearLayers();

    const stops = stopsRef.current;

    if (stops.length >= 2) {
      const bounds = L.latLngBounds(stops.map(s => [s.lat, s.lng] as L.LatLngTuple));
      map.fitBounds(bounds.pad(0.18), { animate:true, duration:0.4 });
    } else if (stops.length === 1) {
      map.setView([stops[0].lat, stops[0].lng], 15, { animate:true });
    }

    if (stops.length >= 2) {
      const results = await fetchRoad(stops, 0);
      if (!isMounted.current) { isRedrawing.current = false; setRebuilding(false); return; }
      const info = results[0];
      setRoadInfo({ distKm: info.distKm, durMin: info.durMin });

      L.polyline(info.path, { color:"#93C5FD", weight:18, opacity:0.15, lineCap:"round", lineJoin:"round", interactive:false }).addTo(lg);
      L.polyline(info.path, { color:"#FFFFFF", weight:8, opacity:0.72,    lineCap:"round", lineJoin:"round", interactive:false }).addTo(lg);

      const mainLine = L.polyline(info.path, {
        color:"#22D3EE", weight:7, opacity:1, lineCap:"round", lineJoin:"round",
      }).addTo(lg);

      /* ── Drag on route line → fetch alternatives ── */
      let dragGhost: L.Marker | null = null;
      let dragActive = false;

      mainLine.on("mousedown", (e: L.LeafletEvent) => {
        const me = e as L.LeafletMouseEvent;
        if (!mapRef.current) return;
        L.DomEvent.stopPropagation(me);
        dragActive = true;
        isDraggingRef.current = true;
        mapRef.current.dragging.disable();
        if (dragGhost) { try { mapRef.current.removeLayer(dragGhost); } catch { /**/ } }
        dragGhost = L.marker([me.latlng.lat, me.latlng.lng] as L.LatLngTuple, {
          icon: makeGhostIcon(true), interactive:false, zIndexOffset:9999,
        }).addTo(mapRef.current);
      });

      const el = containerRef.current;
      if (el) {
        // Remove old listeners first
        const oldMM = (el as any).__rbMM;
        const oldMU = (el as any).__rbMU;
        if (oldMM) el.removeEventListener("mousemove", oldMM);
        if (oldMU) el.removeEventListener("mouseup",   oldMU);

        const onMouseMove = (ev: MouseEvent) => {
          if (!dragActive || !mapRef.current) return;
          const rect  = el.getBoundingClientRect();
          const ll    = mapRef.current.containerPointToLatLng(L.point(ev.clientX-rect.left, ev.clientY-rect.top));
          if (dragGhost) dragGhost.setLatLng([ll.lat, ll.lng]);
        };

        const onMouseUp = async (ev: MouseEvent) => {
          if (!dragActive || !mapRef.current) return;
          dragActive = false;
          isDraggingRef.current = false;
          mapRef.current.dragging.enable();
          if (!dragGhost) return;

          const ll = dragGhost.getLatLng();
          try { mapRef.current?.removeLayer(dragGhost); } catch { /**/ }
          dragGhost = null;

          /* Fetch multiple nearby road candidates + route alternatives */
          setSnapping(true);
          showToast("🛣️ Finding road alternatives…");

          const candidates = await snapToRoadMultiple(ll.lat, ll.lng, 3);
          const uniqueCandidates = candidates.filter((c, i, arr) =>
            i === 0 || hav(c.lat, c.lng, arr[0].lat, arr[0].lng) > 0.05
          ).slice(0, 3);

          /* Build an alternative route for each candidate */
          const builtAlts: Alternative[] = [];
          for (const candidate of uniqueCandidates) {
            const insertAt = bestInsertIdx(stopsRef.current, candidate);
            const testStops = [...stopsRef.current];
            testStops.splice(insertAt, 0, candidate);
            const results = await fetchRoad(testStops, 0);
            if (results[0] && isMounted.current) {
              builtAlts.push({
                path:     results[0].path,
                distKm:   results[0].distKm,
                durMin:   results[0].durMin,
                via:      candidate,
                insertAt,
                label:    candidate.name,
              });
            }
          }

          setSnapping(false);

          if (builtAlts.length === 1) {
            /* Only one option — apply directly */
            await selectAlternative(builtAlts[0]);
          } else if (builtAlts.length > 1) {
            /* Multiple options — let user choose */
            setAlternatives(builtAlts);
            setShowAltPicker(true);
            drawAlternativesOnMap(builtAlts);
            showToast("🛣️ Pick a road option from the map or panel below");
          }
        };

        el.addEventListener("mousemove", onMouseMove);
        el.addEventListener("mouseup",   onMouseUp);
        (el as any).__rbMM = onMouseMove;
        (el as any).__rbMU = onMouseUp;
      }

      /* Touch drag */
      mainLine.on("touchstart", (e: L.LeafletEvent) => {
        if (!mapRef.current) return;
        L.DomEvent.stopPropagation(e);
        dragActive = true;
        isDraggingRef.current = true;
        const te = (e as any).originalEvent?.touches?.[0];
        if (!te) return;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const ll = mapRef.current.containerPointToLatLng(L.point(te.clientX-rect.left, te.clientY-rect.top));
        if (dragGhost) { try { mapRef.current.removeLayer(dragGhost); } catch { /**/ } }
        dragGhost = L.marker([ll.lat, ll.lng] as L.LatLngTuple, {
          icon: makeGhostIcon(true), interactive:false, zIndexOffset:9999,
        }).addTo(mapRef.current);
      });

      mainLine.on("touchmove", (e: L.LeafletEvent) => {
        if (!dragActive || !mapRef.current) return;
        if ((e as any).originalEvent) (e as any).originalEvent.preventDefault();
        const te = (e as any).originalEvent?.touches?.[0];
        if (!te) return;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const ll = mapRef.current.containerPointToLatLng(L.point(te.clientX-rect.left, te.clientY-rect.top));
        if (dragGhost) dragGhost.setLatLng([ll.lat, ll.lng]);
      });

      mainLine.on("touchend", async (e: L.LeafletEvent) => {
        if (!dragActive || !mapRef.current) return;
        dragActive = false;
        isDraggingRef.current = false;
        if (!dragGhost) return;
        const ll = dragGhost.getLatLng();
        try { mapRef.current?.removeLayer(dragGhost); } catch { /**/ }
        dragGhost = null;

        setSnapping(true);
        showToast("🛣️ Finding road alternatives…");
        const candidates = await snapToRoadMultiple(ll.lat, ll.lng, 3);
        const unique = candidates.filter((c,i,arr) => i===0 || hav(c.lat,c.lng,arr[0].lat,arr[0].lng)>0.05).slice(0,3);
        const builtAlts: Alternative[] = [];
        for (const candidate of unique) {
          const insertAt = bestInsertIdx(stopsRef.current, candidate);
          const testStops = [...stopsRef.current];
          testStops.splice(insertAt, 0, candidate);
          const results = await fetchRoad(testStops, 0);
          if (results[0] && isMounted.current) builtAlts.push({ path:results[0].path, distKm:results[0].distKm, durMin:results[0].durMin, via:candidate, insertAt, label:candidate.name });
        }
        setSnapping(false);
        if (builtAlts.length === 1) { await selectAlternative(builtAlts[0]); }
        else if (builtAlts.length > 1) { setAlternatives(builtAlts); setShowAltPicker(true); drawAlternativesOnMap(builtAlts); showToast("🛣️ Pick a road option"); }
      });

      /* Arrows */
      const step = Math.max(4, Math.floor(info.path.length / 8));
      for (let i = step; i < info.path.length-1; i += step) {
        const [la1,ln1] = info.path[i-1] as [number,number];
        const [la2,ln2] = info.path[i]   as [number,number];
        const ang = (Math.atan2(ln2-ln1, la2-la1)*180)/Math.PI;
        L.marker(info.path[i] as L.LatLngTuple, {
          icon: L.divIcon({
            html:`<svg width="14" height="14" viewBox="0 0 24 24" style="transform:rotate(${90-ang}deg);display:block;pointer-events:none" fill="none" stroke="#1D4ED8" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
            className:"", iconSize:[14,14], iconAnchor:[7,7],
          }),
          interactive:false, zIndexOffset:50,
        }).addTo(lg);
      }

      map.fitBounds(L.latLngBounds(info.path).pad(0.12), { animate:true, duration:0.5 });
    }

    /* Draggable stop markers */
    stops.forEach((stop, idx) => {
      const marker = L.marker([stop.lat, stop.lng] as L.LatLngTuple, {
        icon: makeStopIcon(idx, stops.length, stop.name),
        draggable: true, zIndexOffset: 1000+idx, autoPan: true,
      }).addTo(map!);

      marker.on("dblclick",  (e: L.LeafletEvent) => { L.DomEvent.stopPropagation(e); });
      marker.on("mousedown", (e: L.LeafletEvent) => { L.DomEvent.stopPropagation(e); });

      marker.bindPopup(`
        <div style="font-family:Inter,sans-serif;min-width:200px;padding:2px 0">
          <div style="font-weight:800;font-size:13px;color:#1E293B;margin-bottom:8px">
            ${idx===0?"🟢 Start":idx===stops.length-1?"🔴 End":`🔵 Stop ${idx+1}`}: ${stop.name || `Stop ${idx+1}`}
          </div>
          <label style="font-size:10px;color:#64748B;font-weight:600;display:block;margin-bottom:4px">STOP NAME</label>
          <input id="rb-name-${idx}" value="${(stop.name||"").replace(/"/g,"&quot;")}"
            style="width:100%;padding:6px 10px;border:1.5px solid #DBEAFE;border-radius:8px;font-size:12px;outline:none;box-sizing:border-box;margin-bottom:8px"
            placeholder="Stop name"/>
          <div style="display:flex;gap:6px">
            <button onclick="window.__rbSave(${idx})"
              style="flex:1;background:#22D3EE;color:white;border:none;border-radius:8px;padding:6px;font-size:12px;font-weight:700;cursor:pointer">✓ Save</button>
            <button onclick="window.__rbRemove(${idx})"
              style="background:#DC2626;color:white;border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer">✕ Delete Stop</button>
          </div>
          <p style="font-size:10px;color:#94A3B8;margin-top:6px;margin-bottom:0">Drag this pin to move the stop</p>
        </div>
      `);

      marker.on("dragend", async (e: any) => {
        clearAlternatives();
        const ll = e.target.getLatLng();
        setSnapping(true);
        showToast("📍 Snapping to road…");
        const snapped = await snapToRoad(ll.lat, ll.lng);
        setSnapping(false);
        stopsRef.current[idx] = { ...stopsRef.current[idx], lat:snapped.lat, lng:snapped.lng };
        setHasChanges(true); syncUI(); redrawMap();
        showToast(`✅ Stop ${idx+1} repositioned`);
      });

      markersRef.current.push(marker);
    });

    isRedrawing.current = false;
    setRebuilding(false);
  }

  /* ── Add stop at lat/lng ── */
  async function addStopAt(lat: number, lng: number) {
    const map = mapRef.current;
    if (!map || isDraggingRef.current) return;
    clearAlternatives();

    if (ghostRef.current) { try { map.removeLayer(ghostRef.current); } catch { /**/ } }
    ghostRef.current = L.marker([lat,lng] as L.LatLngTuple, {
      icon:makeGhostIcon(false), interactive:false, zIndexOffset:9999,
    }).addTo(map);

    setSnapping(true);
    showToast("📍 Snapping to road…");
    const snapped = await snapToRoad(lat, lng);
    if (ghostRef.current) { try { map.removeLayer(ghostRef.current); } catch { /**/ } ghostRef.current = null; }
    setSnapping(false);

    const insertAt = bestInsertIdx(stopsRef.current, snapped);
    const updated  = [...stopsRef.current];
    updated.splice(insertAt, 0, snapped);
    stopsRef.current = updated;
    setHasChanges(true); syncUI();
    await redrawMap();
    showToast(`✅ Added "${snapped.name}"`);
  }

  async function addStopAtCenter() {
    const map = mapRef.current;
    if (!map || snapping || rebuilding) return;
    const c = map.getCenter();
    await addStopAt(c.lat, c.lng);
  }

  /* ════ Init map ════ */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    isMounted.current = true;

    const initStops  = stopsRef.current;
    const initCenter: L.LatLngTuple = initStops.length > 0
      ? [initStops.reduce((s,p)=>s+p.lat,0)/initStops.length, initStops.reduce((s,p)=>s+p.lng,0)/initStops.length]
      : [17.045, 82.065];

    const map = L.map(containerRef.current, { center:initCenter, zoom:13, zoomControl:false, doubleClickZoom:false });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
    L.control.zoom({ position:"bottomright" }).addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    altLayerRef.current   = L.layerGroup().addTo(map);   // alternatives on top
    mapRef.current = map;

    map.on("dblclick", (e: L.LeafletMouseEvent) => {
      if (!isDraggingRef.current) addStopAt(e.latlng.lat, e.latlng.lng);
    });

    /* click on empty map → dismiss alternatives */
    map.on("click", () => { if (showAltPicker) clearAlternatives(); });

    let lastTime = 0, lastX = 0, lastY = 0;
    const el = containerRef.current;
    function onTouchEnd(e: TouchEvent) {
      if (isDraggingRef.current) return;
      const t = e.changedTouches[0];
      const now = Date.now();
      if (now-lastTime < 350 && Math.abs(t.clientX-lastX)<30 && Math.abs(t.clientY-lastY)<30) {
        e.preventDefault();
        map.setView(map.getCenter(), Math.min(map.getZoom()+1,17), { animate:true });
        const rect = el.getBoundingClientRect();
        const ll   = map.containerPointToLatLng(L.point(t.clientX-rect.left, t.clientY-rect.top));
        addStopAt(ll.lat, ll.lng);
        lastTime = 0;
      } else { lastTime=now; lastX=t.clientX; lastY=t.clientY; }
    }
    el.addEventListener("touchend", onTouchEnd, { passive:false });

    (window as any).__rbRemove = (idx: number) => {
      map.closePopup();
      if (stopsRef.current.length <= 2) { showToast("⚠️ Minimum 2 stops required"); return; }
      stopsRef.current = stopsRef.current.filter((_,i) => i !== idx);
      setHasChanges(true); syncUI(); clearAlternatives(); redrawMap();
      showToast("Stop removed");
    };
    (window as any).__rbSave = (idx: number) => {
      const input = document.getElementById(`rb-name-${idx}`) as HTMLInputElement;
      const name  = input?.value.trim() || `Stop ${idx+1}`;
      stopsRef.current[idx] = { ...stopsRef.current[idx], name };
      setHasChanges(true); syncUI(); map.closePopup();
      showToast(`✅ Renamed to "${name}"`); redrawMap();
    };

    redrawMap();

    return () => {
      isMounted.current = false;
      el.removeEventListener("touchend", onTouchEnd);
      const mm = (el as any).__rbMM, mu = (el as any).__rbMU;
      if (mm) el.removeEventListener("mousemove", mm);
      if (mu) el.removeEventListener("mouseup",   mu);
      delete (window as any).__rbRemove;
      delete (window as any).__rbSave;
      if (ghostRef.current) { try { map.removeLayer(ghostRef.current); } catch { /**/ } ghostRef.current = null; }
      map.remove(); mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleReset() {
    stopsRef.current = [...initialRef.current];
    setHasChanges(false); syncUI(); clearAlternatives(); redrawMap();
    showToast("Route reset to original");
  }
  function handleSave() {
    if (stopsRef.current.length < 2) { showToast("⚠️ At least 2 stops required"); return; }
    onSave([...stopsRef.current]);
    setHasChanges(false);
    showToast("✅ Route saved!");
  }

  /* ════ RENDER ════ */
  return (
    <div style={{ display:"flex", flexDirection:"column", fontFamily:"Inter,system-ui,sans-serif" }}>

      {/* Toolbar */}
      <div style={{ background:"linear-gradient(135deg,#1D4ED8,#22D3EE)", padding:"12px 16px", borderRadius:"16px 16px 0 0", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
        <div style={{ minWidth:0, flex:1 }}>
          <div style={{ color:"white", fontWeight:800, fontSize:15, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>🗺️ {routeName}</div>
          <div style={{ color:"#BFDBFE", fontSize:11, marginTop:2 }}>
            {uiStops.length} stop{uiStops.length!==1?"s":""} ·{" "}
            {roadInfo ? `${roadInfo.distKm} km · ${durLabel(roadInfo.durMin)}` : rebuilding?"calculating…":"—"}
            {hasChanges && <span style={{ color:"#FCD34D", marginLeft:6 }}>● Unsaved changes</span>}
          </div>
        </div>
        <div style={{ display:"flex", gap:8, flexShrink:0 }}>
          {onCancel && <button onClick={onCancel} style={{ background:"rgba(255,255,255,0.15)", color:"white", border:"none", borderRadius:10, padding:"7px 14px", fontSize:12, fontWeight:700, cursor:"pointer" }}>Cancel</button>}
          <button onClick={handleReset} disabled={!hasChanges} style={{ background:"rgba(255,255,255,0.15)", color:"white", border:"none", borderRadius:10, padding:"7px 14px", fontSize:12, fontWeight:700, cursor:hasChanges?"pointer":"default", opacity:hasChanges?1:0.35 }}>↺ Reset</button>
          <button onClick={handleSave} disabled={uiStops.length<2||rebuilding} style={{ background:uiStops.length>=2?"#22C55E":"#94A3B8", color:"white", border:"none", borderRadius:10, padding:"7px 20px", fontSize:13, fontWeight:800, cursor:uiStops.length>=2?"pointer":"default", boxShadow:uiStops.length>=2?"0 3px 12px rgba(34,197,94,0.45)":"none", transition:"all .2s ease" }}>
            {rebuilding?"⏳ Updating…":"✓ Set Route"}
          </button>
        </div>
      </div>

      {/* Stop breadcrumb */}
      <div style={{ background:"#F8FAFC", borderLeft:"1px solid #E2E8F0", borderRight:"1px solid #E2E8F0", padding:"8px 14px", display:"flex", gap:6, alignItems:"center", flexWrap:"nowrap", overflowX:"auto", minHeight:46 }}>
        {uiStops.length===0 ? (
          <span style={{ fontSize:12, color:"#94A3B8", fontWeight:600 }}>No stops — drag the route line or double-click empty area to add</span>
        ) : uiStops.map((s,i) => (
          <React.Fragment key={i}>
            <div style={{ display:"inline-flex", alignItems:"center", gap:6, background:"white", border:"1.5px solid #E2E8F0", borderRadius:20, padding:"4px 8px 4px 6px", fontSize:11, fontWeight:700, color:"#1E293B", whiteSpace:"nowrap" }}>
              <span style={{ width:17, height:17, borderRadius:"50%", flexShrink:0, background:i===0?"#16A34A":i===uiStops.length-1?"#DC2626":"#22D3EE", color:"white", display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900 }}>{i===0?"A":i===uiStops.length-1?"B":i+1}</span>
              <span 
                onClick={() => {
                  const m = markersRef.current[i];
                  if (m && mapRef.current) {
                    mapRef.current.setView(m.getLatLng(), 15, { animate: true });
                    m.openPopup();
                  }
                }}
                style={{ cursor: "pointer", transition: "color 0.15s ease" }}
                className="hover:text-blue-600"
              >
                {s.name||`Stop ${i+1}`}
              </span>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  if (stopsRef.current.length <= 2) { showToast("⚠️ Minimum 2 stops required"); return; }
                  stopsRef.current = stopsRef.current.filter((_, idx) => idx !== i);
                  setHasChanges(true); syncUI(); clearAlternatives(); redrawMap();
                  showToast("Stop removed");
                }}
                style={{
                  background: "none", border: "none", color: "#EF4444", fontSize: "12px", fontWeight: "900", 
                  cursor: "pointer", padding: "0 2px", display: "inline-flex", alignItems: "center", justifyContent: "center"
                }}
                title="Delete Stop"
              >
                ✕
              </button>
            </div>
            {i<uiStops.length-1&&<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="3" style={{ flexShrink:0 }}><polyline points="9 18 15 12 9 6"/></svg>}
          </React.Fragment>
        ))}
      </div>

      {/* ── Road Alternative Picker Panel ── */}
      {showAltPicker && alternatives.length > 0 && (
        <div style={{ background:"white", borderLeft:"1px solid #E2E8F0", borderRight:"1px solid #E2E8F0", borderBottom:"1px solid #E2E8F0", padding:"12px 16px" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:16 }}>🛣️</span>
              <div>
                <p style={{ fontWeight:800, fontSize:13, color:"#1E293B", margin:0 }}>Choose your road preference</p>
                <p style={{ fontSize:11, color:"#64748B", margin:0 }}>Multiple roads found — pick the one you want</p>
              </div>
            </div>
            <button onClick={clearAlternatives} style={{ background:"#F1F5F9", border:"none", borderRadius:8, padding:"5px 10px", fontSize:11, fontWeight:700, color:"#64748B", cursor:"pointer" }}>✕ Cancel</button>
          </div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            {alternatives.map((alt, idx) => (
              <button key={idx} onClick={() => selectAlternative(alt)} style={{
                flex:"1 1 160px",
                background: idx===0?"#EFF6FF":"#F8FAFC",
                border:`2px solid ${ALT_COLORS[idx]??="#94A3B8"}`,
                borderRadius:12, padding:"10px 14px",
                cursor:"pointer", textAlign:"left",
                transition:"all .15s ease",
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                  <span style={{ width:12, height:12, borderRadius:"50%", background:ALT_COLORS[idx]??="#94A3B8", display:"inline-block", flexShrink:0 }}/>
                  <span style={{ fontSize:11, fontWeight:800, color:ALT_COLORS[idx]??="#94A3B8" }}>
                    {idx===0?"✓ Recommended":`Option ${String.fromCharCode(65+idx)}`}
                  </span>
                </div>
                <div style={{ fontSize:14, fontWeight:800, color:"#1E293B", marginBottom:2 }}>
                  {alt.distKm} km · {durLabel(alt.durMin)}
                </div>
                <div style={{ fontSize:11, color:"#64748B", fontWeight:600 }}>
                  via {alt.via.name || "road"}
                </div>
              </button>
            ))}
          </div>
          <p style={{ fontSize:10, color:"#94A3B8", margin:"8px 0 0", textAlign:"center" }}>
            You can also click the colored lines directly on the map above
          </p>
        </div>
      )}

      {/* Map */}
      <div style={{ position:"relative", height, zIndex: 1 }}>
        <div ref={containerRef} style={{ position:"absolute", inset:0 }} />

        {/* Status overlay */}
        {(snapping||rebuilding) && (
          <div style={{ position:"absolute", top:12, left:"50%", transform:"translateX(-50%)", zIndex:3000, display:"flex", alignItems:"center", gap:8, background:snapping?"#7C3AED":"#22D3EE", color:"white", borderRadius:30, padding:"9px 18px", fontSize:12, fontWeight:700, whiteSpace:"nowrap", pointerEvents:"none", boxShadow:`0 4px 14px rgba(${snapping?"124,58,237":"37,99,235"},0.4)` }}>
            <div style={{ width:13, height:13, border:"2px solid rgba(255,255,255,0.35)", borderTopColor:"white", borderRadius:"50%", animation:"__rsp .7s linear infinite" }}/>
            {snapping?"Finding road alternatives…":"Updating road path…"}
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div key={toast.k} style={{ position:"absolute", bottom:92, left:"50%", transform:"translateX(-50%)", zIndex:3000, background:"rgba(30,41,59,0.92)", color:"white", borderRadius:30, padding:"9px 18px", fontSize:12, fontWeight:700, whiteSpace:"nowrap", animation:"__rfd .2s ease", pointerEvents:"none" }}>
            {toast.msg}
          </div>
        )}

        {/* Hint */}
        <div style={{ position:"absolute", top:12, right:12, zIndex:1000, background:"rgba(255,255,255,0.96)", backdropFilter:"blur(8px)", borderRadius:12, padding:"7px 12px", boxShadow:"0 2px 10px rgba(0,0,0,0.1)", fontSize:11, fontWeight:700, color:"#22D3EE", border:"1.5px solid #DBEAFE", pointerEvents:"none", display:"flex", flexDirection:"column", gap:4 }}>
          <span>🖱️ Drag blue line → road choices</span>
          <span>🖱️ Double-click → add stop</span>
          <span>🖱️ Drag pin → move stop</span>
        </div>

        {uiStops.length===0 && (
          <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none", zIndex:500 }}>
            <div style={{ background:"rgba(255,255,255,0.97)", borderRadius:20, padding:"24px 36px", textAlign:"center", boxShadow:"0 8px 32px rgba(0,0,0,0.12)" }}>
              <div style={{ fontSize:40, marginBottom:8 }}>📍</div>
              <p style={{ fontWeight:700, fontSize:14, color:"#1E293B", margin:"0 0 4px" }}>No stops yet</p>
              <p style={{ fontSize:12, color:"#94A3B8" }}>Double-click map or use "Add Stop" below</p>
            </div>
          </div>
        )}

        {/* Legend */}
        <div style={{ position:"absolute", bottom:88, right:12, zIndex:1000, background:"rgba(255,255,255,0.97)", backdropFilter:"blur(8px)", borderRadius:10, padding:"6px 10px", boxShadow:"0 2px 8px rgba(0,0,0,0.1)", fontSize:10, fontWeight:600, color:"#64748B", display:"flex", flexDirection:"column", gap:3 }}>
          {[["#16A34A","Start (A)"],["#DC2626","End (B)"],["#22D3EE","Drag to reshape"],["#F59E0B","Alt road B"],["#10B981","Alt road C"]].map(([c,l]) => (
            <span key={l} style={{ display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ width:10, height:10, borderRadius:"50%", background:c, display:"inline-block" }}/>{l}
            </span>
          ))}
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{ background:"white", borderLeft:"1px solid #E2E8F0", borderRight:"1px solid #E2E8F0", borderBottom:"1px solid #E2E8F0", borderRadius:"0 0 16px 16px", padding:"10px 14px", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <button onClick={addStopAtCenter} disabled={snapping||rebuilding} style={{ display:"flex", alignItems:"center", gap:8, background:"linear-gradient(135deg,#22D3EE,#3B82F6)", color:"white", border:"none", borderRadius:12, padding:"10px 18px", fontSize:13, fontWeight:700, cursor:(snapping||rebuilding)?"not-allowed":"pointer", boxShadow:"0 3px 10px rgba(37,99,235,0.3)", opacity:(snapping||rebuilding)?0.5:1, flexShrink:0 }}>
          <span style={{ fontSize:18, lineHeight:1 }}>➕</span>Add Stop at Map Centre
        </button>
        <div style={{ fontSize:11, color:"#94A3B8", fontWeight:600, flex:1, minWidth:100 }}>
          or drag the blue line to choose between parallel roads
        </div>
        <div style={{ background:"#F1F5F9", borderRadius:20, padding:"6px 14px", fontSize:12, fontWeight:700, color:"#475569", display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <span style={{ width:8, height:8, borderRadius:"50%", background:"#22D3EE", display:"inline-block" }}/>
          {uiStops.length} stops{roadInfo&&<span style={{ color:"#22D3EE", marginLeft:4 }}>· {roadInfo.distKm} km · {durLabel(roadInfo.durMin)}</span>}
        </div>
      </div>

      <style>{`
        @keyframes __rsp { to { transform: rotate(360deg); } }
        @keyframes __rfd { from { opacity:0; transform:translateX(-50%) translateY(6px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
      `}</style>
    </div>
  );
}








