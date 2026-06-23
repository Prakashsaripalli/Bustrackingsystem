import { NextRequest, NextResponse } from "next/server";
import { db, pool } from "@/db";
import { routes } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/* ── Geocode via Nominatim ── */
async function geocode(name: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name + ", Andhra Pradesh, India")}&format=json&limit=1`;
    const res = await fetch(url, { headers: { "User-Agent": "BusTrackLive/1.0" }, signal: AbortSignal.timeout(6000) });
    const d   = await res.json();
    if (d.length > 0) return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) };
  } catch { /**/ }
  return null;
}

/* ── OSRM: auto-calculate distance + duration leg-by-leg in parallel ── */
async function calcRouteDistanceDuration(stops: { lat: number; lng: number }[]) {
  if (stops.length < 2) return { distance: 0, duration: 0 };
  
  const legPromises = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const start = stops[i];
    const end = stops[i + 1];
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=false`;
    
    legPromises.push(
      fetch(url, { signal: AbortSignal.timeout(10000) })
        .then(async (r) => {
          if (!r.ok) return null;
          const d = await r.json();
          if (d.code !== "Ok" || !d.routes?.[0]) return null;
          return {
            distance: d.routes[0].distance, // meters
            duration: d.routes[0].duration // seconds
          };
        })
        .catch(() => null)
    );
  }

  const legs = await Promise.all(legPromises);

  let totalDistance = 0;
  let totalDuration = 0;

  for (let i = 0; i < stops.length - 1; i++) {
    const leg = legs[i];
    if (leg) {
      totalDistance += leg.distance;
      totalDuration += leg.duration;
    } else {
      const start = stops[i];
      const end = stops[i + 1];
      const d = haversineDistance(start.lat, start.lng, end.lat, end.lng) * 1000;
      totalDistance += d;
      totalDuration += (d / 30) * 3600; // 30 km/h fallback
    }
  }

  return {
    distance: +(totalDistance / 1000).toFixed(1),
    duration: Math.round(totalDuration / 60),
  };
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, r = Math.PI / 180;
  const a = Math.sin((lat2-lat1)*r/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin((lng2-lng1)*r/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const stop = searchParams.get("stop");
    const id   = searchParams.get("id");

    let result;
    if (stop) {
      result = await db.select().from(routes).where(sql`${stop} = ANY(${routes.stops})`);
    } else if (id) {
      result = await db.select().from(routes).where(eq(routes.id, parseInt(id)));
    } else {
      result = await db.select().from(routes);
    }

    const parsed = result.map((r: any) => ({
      ...r,
      stopCoordinates: typeof r.stopCoordinates === "string" ? JSON.parse(r.stopCoordinates) : r.stopCoordinates,
      // Include direction fields with defaults
      isReversible:  r.isReversible  ?? true,
      morningStart:  r.morningStart  ?? "06:00",
      eveningStart:  r.eveningStart  ?? "16:00",
      morningCutoff: r.morningCutoff ?? "12:01",
    }));
    return NextResponse.json(parsed);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    if (!data.routeName || !data.stops || data.stops.length < 1) {
      return NextResponse.json({ error: "routeName and at least 1 stop required" }, { status: 400 });
    }

    const stops: string[] = data.stops.map((s: string) => s.trim()).filter(Boolean);

    // Automatically check and append Aditya Engineering College destination if not present
    const lastStop = stops[stops.length - 1]?.toLowerCase();
    const hasCollegeDest = lastStop && (
      lastStop.includes("aditya") ||
      lastStop.includes("college") ||
      lastStop.includes("aec") ||
      lastStop.includes("university") ||
      lastStop.includes("campus")
    );
    if (!hasCollegeDest) {
      stops.push("Aditya Engineering College");
    }

    if (stops.length < 2) {
      return NextResponse.json({ error: "Route must have at least 2 stops" }, { status: 400 });
    }

    /* Step 1: Geocode each stop */
    const stopCoords = await Promise.all(stops.map(async (stop) => {
      const isCollege = stop.toLowerCase().includes("aditya") || 
                        stop.toLowerCase().includes("college") || 
                        stop.toLowerCase().includes("aec") || 
                        stop.toLowerCase().includes("university") || 
                        stop.toLowerCase().includes("campus");
      if (isCollege) {
        return { name: stop, lat: 17.045, lng: 82.065 };
      }
      const coords = await geocode(stop);
      return { name: stop, lat: coords?.lat ?? 17.0, lng: coords?.lng ?? 82.0 };
    }));

    /* Step 2: Auto-calculate distance + duration via OSRM */
    let { distance, duration } = await calcRouteDistanceDuration(stopCoords);

    // Override with manual values if provided
    if (data.distance) distance = parseFloat(data.distance);
    if (data.estimatedDuration) duration = parseInt(data.estimatedDuration);

    const result = await db.insert(routes).values({
      routeName: data.routeName,
      stops,
      stopCoordinates: stopCoords,
      distance: distance || null,
      estimatedDuration: duration || null,
      isActive: true,
      isReversible: true,
      morningCutoff: data.morningCutoff || "12:01",
    }).returning();

    return NextResponse.json({
      ...result[0],
      stopCoordinates: stopCoords,
      _autoCalc: { distance, duration },
    }, { status: 201 });
  } catch (e: any) {
    console.error("Add route error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, ...updateData } = await req.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    // Sanitize allowed fields
    const allowed: Record<string, any> = {};
    if (updateData.routeName       !== undefined) allowed.routeName       = updateData.routeName;
    if (updateData.distance        !== undefined) allowed.distance        = updateData.distance;
    if (updateData.estimatedDuration !== undefined) allowed.estimatedDuration = updateData.estimatedDuration;
    if (updateData.isActive        !== undefined) allowed.isActive        = updateData.isActive;
    if (updateData.isReversible    !== undefined) allowed.isReversible    = updateData.isReversible;
    if (updateData.morningStart    !== undefined) allowed.morningStart    = updateData.morningStart;
    if (updateData.eveningStart    !== undefined) allowed.eveningStart    = updateData.eveningStart;
    if (updateData.morningCutoff   !== undefined) allowed.morningCutoff   = updateData.morningCutoff;

    if (updateData.stops !== undefined) {
      const stops: string[] = updateData.stops.map((s: string) => s.trim()).filter(Boolean);
      
      // Auto-append college if not present
      const lastStop = stops[stops.length - 1]?.toLowerCase();
      const hasCollegeDest = lastStop && (
        lastStop.includes("aditya") ||
        lastStop.includes("college") ||
        lastStop.includes("aec") ||
        lastStop.includes("university") ||
        lastStop.includes("campus")
      );
      if (!hasCollegeDest && stops.length > 0) {
        stops.push("Aditya Engineering College");
      }
      allowed.stops = stops;

      // If stops are updated but stopCoordinates are NOT sent, generate them
      if (updateData.stopCoordinates === undefined) {
        const stopCoords = await Promise.all(stops.map(async (stop) => {
          const isCollege = stop.toLowerCase().includes("aditya") || 
                            stop.toLowerCase().includes("college") || 
                            stop.toLowerCase().includes("aec") || 
                            stop.toLowerCase().includes("university") || 
                            stop.toLowerCase().includes("campus");
          if (isCollege) {
            return { name: stop, lat: 17.045, lng: 82.065 };
          }
          const coords = await geocode(stop);
          return { name: stop, lat: coords?.lat ?? 17.0, lng: coords?.lng ?? 82.0 };
        }));
        allowed.stopCoordinates = stopCoords;
      }
    }

    if (updateData.stopCoordinates !== undefined) {
      const stopCoords = [...updateData.stopCoordinates];
      // Auto-append college if not present
      const lastCoord = stopCoords[stopCoords.length - 1];
      const lastCoordName = lastCoord?.name?.toLowerCase() || "";
      const hasCollegeDest = lastCoordName && (
        lastCoordName.includes("aditya") ||
        lastCoordName.includes("college") ||
        lastCoordName.includes("aec") ||
        lastCoordName.includes("university") ||
        lastCoordName.includes("campus")
      );
      if (!hasCollegeDest && stopCoords.length > 0) {
        stopCoords.push({ name: "Aditya Engineering College", lat: 17.045, lng: 82.065 });
      }
      allowed.stopCoordinates = stopCoords;
      
      // Keep stops aligned with stopCoordinates names
      allowed.stops = stopCoords.map(sc => sc.name);
    }

    const result = await db.update(routes).set(allowed).where(eq(routes.id, id)).returning();
    return NextResponse.json({
      ...result[0],
      stopCoordinates: typeof result[0].stopCoordinates === "string"
        ? JSON.parse(result[0].stopCoordinates) : result[0].stopCoordinates,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const routeId = parseInt(id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE buses SET route_id = NULL WHERE route_id = $1`, [routeId]);
      await client.query(`UPDATE trips SET route_id = NULL WHERE route_id = $1`, [routeId]);
      await client.query(`UPDATE drivers SET preferred_route_id = NULL WHERE preferred_route_id = $1`, [routeId]);
      await client.query(`DELETE FROM routes WHERE id = $1`, [routeId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
