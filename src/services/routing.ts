/**
 * Road-following route geometry using OSRM public demo server.
 * No API key required. Returns decoded [lat, lng][] array.
 */
export async function getRoadRoute(
  stops: { lat: number; lng: number }[]
): Promise<[number, number][]> {
  if (stops.length < 2) return stops.map(s => [s.lat, s.lng]);

  // OSRM expects lng,lat order
  const coords = stops.map(s => `${s.lng},${s.lat}`).join(";");
  const url =
    `https://router.project-osrm.org/route/v1/driving/${coords}` +
    `?overview=full&geometries=geojson&steps=true`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error("OSRM error");
    const data = await res.json();
    const coords2d: [number, number][] =
      data.routes[0].geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]);
    return coords2d;
  } catch {
    // Fallback: straight lines between stops
    return stops.map(s => [s.lat, s.lng]);
  }
}

/**
 * Get step-by-step maneuvers from OSRM for turn-by-turn navigation.
 */
export interface NavStep {
  instruction: string;
  distance: number;   // metres
  duration: number;   // seconds
  maneuver: string;   // "turn-right" | "turn-left" | "straight" | "arrive" | etc.
  name: string;       // road name
}

export async function getNavSteps(
  stops: { lat: number; lng: number; name: string }[]
): Promise<NavStep[]> {
  if (stops.length < 2) return [];

  const coords = stops.map(s => `${s.lng},${s.lat}`).join(";");
  const url =
    `https://router.project-osrm.org/route/v1/driving/${coords}` +
    `?overview=false&steps=true&annotations=false`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error("OSRM error");
    const data = await res.json();

    const steps: NavStep[] = [];
    for (const leg of data.routes[0].legs) {
      for (const step of leg.steps) {
        const manType = step.maneuver?.type ?? "straight";
        const manMod  = step.maneuver?.modifier ?? "";
        let instruction = buildInstruction(manType, manMod, step.name);
        steps.push({
          instruction,
          distance: step.distance,
          duration: step.duration,
          maneuver: `${manType}-${manMod}`.replace(/-$/, ""),
          name: step.name ?? "",
        });
      }
    }
    return steps;
  } catch {
    // Fallback — just list stop-to-stop legs
    return stops.slice(0, -1).map((s, i) => ({
      instruction: `Head towards ${stops[i + 1].name}`,
      distance: 0,
      duration: 0,
      maneuver: "straight",
      name: "",
    }));
  }
}

function buildInstruction(type: string, modifier: string, road: string): string {
  const r = road ? ` onto ${road}` : "";
  switch (type) {
    case "depart":     return `Start${r}`;
    case "arrive":     return "You have arrived at your destination";
    case "turn":
      if (modifier.includes("left"))  return `Turn left${r}`;
      if (modifier.includes("right")) return `Turn right${r}`;
      return `Continue${r}`;
    case "continue":   return `Continue straight${r}`;
    case "merge":      return `Merge${r}`;
    case "roundabout": return `Enter roundabout${r}`;
    case "exit roundabout": return `Exit roundabout${r}`;
    case "fork":
      if (modifier.includes("left"))  return `Keep left${r}`;
      if (modifier.includes("right")) return `Keep right${r}`;
      return `Keep straight${r}`;
    default:           return `Continue${r}`;
  }
}

/** Haversine distance km */
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*toR)*Math.cos(lat2*toR)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export function formatDist(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

export function formatDuration(secs: number): string {
  const m = Math.round(secs / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m/60)}h ${m%60}m`;
}
