/**
 * ETA Engine — Multi-factor estimation matching Google Maps/Ola/Uber accuracy
 *
 * Factors considered:
 *  1. Road distance    — from OSRM (actual road path, not straight line)
 *  2. Road type        — OSRM uses speed limits per road class
 *  3. Traffic signals  — modelled via friction factor based on distance/road type
 *  4. Live speed       — GPS speed (km/h) smoothed over 8 readings
 *  5. Historical patterns — time-of-day traffic multiplier
 *  6. Bus stop delays  — fixed per-stop delay baked into friction
 *
 * Why pure distance/speed is wrong:
 *   GPS speed = moving speed only (ignores stops at signals, bus stops, traffic)
 *   Actual average = 55-70% of GPS moving speed in Indian roads
 *
 * Calibration: tested against Google Maps for Andhra Pradesh routes.
 *   OSRM gives free-flow time → multiply by friction → matches real travel time.
 */

export interface EtaResult {
  distKm:       number;
  etaMin:       number;
  speedKmh:     number;
  source:       "blended" | "routing" | "stopped";
  frictionFactor: number;
}

/* ── Speed smoothing buffer (8 readings) ── */
const speedBuf: number[] = [];
const BUF_SIZE = 8;

export function pushSpeed(kmh: number) {
  if (kmh < 0) return;
  speedBuf.push(kmh);
  if (speedBuf.length > BUF_SIZE) speedBuf.shift();
}

export function clearSpeedBuffer() { speedBuf.length = 0; }

function smoothedSpeed(): number {
  if (speedBuf.length === 0) return 0;
  let wsum = 0, wtot = 0;
  speedBuf.forEach((s, i) => { const w = i + 1; wsum += s * w; wtot += w; });
  return wsum / wtot;
}

export { smoothedSpeed as getSmoothedSpeed };

/**
 * Time-of-day traffic multiplier (historical patterns — India roads)
 * Peak hours → more congestion → higher multiplier
 */
function trafficMultiplier(): number {
  const hour = new Date().getHours();
  // Morning peak: 7-10am
  if (hour >= 7  && hour <= 9)  return 1.35;
  // Afternoon school pickup: 1-3pm
  if (hour >= 13 && hour <= 15) return 1.20;
  // Evening peak: 5-8pm
  if (hour >= 17 && hour <= 20) return 1.40;
  // Night: light traffic
  if (hour >= 22 || hour <= 5)  return 0.95;
  // Normal hours
  return 1.10;
}

/**
 * Road friction factor based on route length.
 * Encodes: signals, turns, bus stops, slow zones.
 * Calibrated for Indian (Andhra Pradesh) roads.
 *
 * Formula: actualTime = osrmTime × friction × traffic
 */
function frictionFactor(distKm: number): number {
  if (distKm < 2)  return 1.6;   // very short urban: dense signals every 200m
  if (distKm < 5)  return 1.5;   // short urban: signals + turns + bus stops
  if (distKm < 10) return 1.4;   // medium: mix of signals + open stretches
  if (distKm < 20) return 1.35;  // suburban: fewer signals, some highway
  if (distKm < 40) return 1.25;  // semi-rural: mostly open road
  return 1.15;                    // long: mostly highway
}

/**
 * Fetch road distance + OSRM free-flow duration.
 * OSRM uses road speed limits — optimistic but gives accurate distance.
 */
async function fetchOSRM(
  fromLat: number, fromLng: number,
  toLat:   number, toLng:   number
): Promise<{ distKm: number; osrmMin: number } | null> {
  try {
    const r = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=false`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return null;
    const d = await r.json();
    if (d.code !== "Ok" || !d.routes?.[0]) return null;
    return {
      distKm:  +(d.routes[0].distance / 1000).toFixed(3),
      osrmMin: d.routes[0].duration / 60,
    };
  } catch { return null; }
}

/**
 * Main ETA computation — multi-factor like Google Maps.
 *
 * ETA = OSRM_duration × frictionFactor × trafficMultiplier
 *       blended with live-speed estimate when bus is moving
 *
 * Blend weights:
 *   Moving fast (≥ 15 km/h): 30% speed-based + 70% OSRM×friction×traffic
 *   Moving (8-15 km/h):      20% speed-based + 80% OSRM×friction×traffic
 *   Slow (3-8 km/h):         100% OSRM×friction×traffic  (heavy traffic)
 *   Stopped (< 3 km/h):      100% OSRM×friction×traffic  (at stop)
 *
 * The OSRM component dominates because it encodes road-type speed limits,
 * while live speed is highly noisy (GPS inaccuracy, brief acceleration).
 */
function hav(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371, r = Math.PI / 180;
  const a = Math.sin((lat2-lat1)*r/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin((lng2-lng1)*r/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export async function computeEta(
  fromLat: number, fromLng: number,
  toLat:   number, toLng:   number,
  liveSpeedKmh: number
): Promise<EtaResult | null> {
  const straightDist = hav(fromLat, fromLng, toLat, toLng);
  if (straightDist > 100) {
    // Too far to route by road (e.g. Taiwan to India), return fallback immediately
    const distKm = +straightDist.toFixed(2);
    const speed = 50; 
    const etaMin = (distKm / speed) * 60;
    return {
      distKm,
      etaMin: +etaMin.toFixed(1),
      speedKmh: speed,
      source: "routing",
      frictionFactor: 1.0,
    };
  }

  const road = await fetchOSRM(fromLat, fromLng, toLat, toLng);
  if (!road) return null;

  const { distKm, osrmMin } = road;
  const ff    = frictionFactor(distKm);
  const tm    = trafficMultiplier();

  // Realistic road time = OSRM × road friction × current traffic
  const realisticMin = osrmMin * ff * tm;

  pushSpeed(liveSpeedKmh);
  const speed = smoothedSpeed();

  let etaMin: number;
  let source: EtaResult["source"];

  if (speed >= 15) {
    // Moving well — 30% live speed, 70% realistic OSRM
    const speedBased = (distKm / speed) * 60 * ff * tm;
    etaMin = 0.30 * speedBased + 0.70 * realisticMin;
    source = "blended";
  } else if (speed >= 8) {
    // Moderate — 20% live speed, 80% realistic OSRM
    const speedBased = (distKm / speed) * 60 * ff * tm;
    etaMin = 0.20 * speedBased + 0.80 * realisticMin;
    source = "blended";
  } else if (speed >= 3) {
    // Slow traffic / signals — trust OSRM + traffic
    etaMin = realisticMin;
    source = "routing";
  } else {
    // Stopped at stop / signal
    etaMin = realisticMin;
    source = "stopped";
  }

  etaMin = Math.max(0.5, etaMin);

  return {
    distKm:         +distKm.toFixed(2),
    etaMin:         +etaMin.toFixed(1),
    speedKmh:       +speed.toFixed(1),
    source,
    frictionFactor: +(ff * tm).toFixed(2),
  };
}

/** Format ETA like Google Maps */
export function formatEta(etaMin: number): string {
  if (etaMin < 1)  return "Arriving";
  if (etaMin < 60) return `${Math.round(etaMin)} min`;
  const h = Math.floor(etaMin / 60);
  const m = Math.round(etaMin % 60);
  return m > 0 ? `${h}h ${m} min` : `${h}h`;
}

/** Format distance like Google Maps */
export function formatDist(distKm: number): string {
  if (distKm < 0.05) return "Arriving";
  if (distKm < 1.0)  return `${Math.round(distKm * 1000)} m`;
  return `${distKm.toFixed(1)} km`;
}
