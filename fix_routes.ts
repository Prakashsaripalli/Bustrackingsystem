import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

interface Stop { name: string; lat: number; lng: number; }

async function calcRouteDistanceDuration(stops: Stop[]) {
  if (stops.length < 2) return { distance: 0, duration: 0 };
  try {
    const cs  = stops.map(s => `${s.lng},${s.lat}`).join(";");
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${cs}?overview=false`,
      { signal: AbortSignal.timeout(10000) }
    );
    const d = await res.json();
    if (d.code === "Ok") {
      return {
        distance: +(d.routes[0].distance / 1000).toFixed(1),
        duration: Math.round(d.routes[0].duration / 60),
      };
    }
  } catch (err) {
    console.error("OSRM call failed:", err);
  }
  return { distance: null, duration: null };
}

async function main() {
  const { db } = await import("./src/db");
  const { routes } = await import("./src/db/schema");
  const { eq } = await import("drizzle-orm");

  console.log("Starting route corrections...");

  // 1. Update Route 5 (Jaggampeta-College) distance/duration
  const route5 = await db.select().from(routes).where(eq(routes.id, 5));
  if (route5.length > 0) {
    const coords: Stop[] = typeof route5[0].stopCoordinates === "string" 
      ? JSON.parse(route5[0].stopCoordinates) 
      : (route5[0].stopCoordinates as Stop[]);
    
    const osrm = await calcRouteDistanceDuration(coords);
    console.log(`Route 5 OSRM result: Distance = ${osrm.distance} km, Duration = ${osrm.duration} min`);
    
    await db.update(routes).set({
      distance: osrm.distance,
      estimatedDuration: osrm.duration
    }).where(eq(routes.id, 5));
    console.log("Updated Route 5 successfully.");
  }

  // 2. Update Route 6 (Rajamundry - College) stop coordinates + distance/duration
  const route6 = await db.select().from(routes).where(eq(routes.id, 6));
  if (route6.length > 0) {
    const accurateCoords: Stop[] = [
      { name: "Rajamundry", lat: 17.0005, lng: 81.8016 },
      { name: "Divancheruvu", lat: 17.0435, lng: 81.8596 },
      { name: "Rajanagaram", lat: 17.0792, lng: 81.8988 },
      { name: "Ramaswamipeta", lat: 17.0765, lng: 81.9965 },
      { name: "Aditya Engineering College", lat: 17.090298, lng: 82.068772 }
    ];

    const osrm = await calcRouteDistanceDuration(accurateCoords);
    console.log(`Route 6 OSRM result: Distance = ${osrm.distance} km, Duration = ${osrm.duration} min`);

    await db.update(routes).set({
      stopCoordinates: accurateCoords,
      distance: osrm.distance,
      estimatedDuration: osrm.duration
    }).where(eq(routes.id, 6));
    console.log("Updated Route 6 successfully.");
  }

  // Verify updated routes
  const updatedRoutes = await db.select().from(routes);
  console.log("=== UPDATED ROUTES ===");
  console.log(JSON.stringify(updatedRoutes, null, 2));
}

main().catch(err => console.error(err));
