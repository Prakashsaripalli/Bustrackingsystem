import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { trips, busLocations } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const busId = searchParams.get("busId");
    if (!busId) {
      return NextResponse.json({ error: "busId required" }, { status: 400 });
    }

    // Get last completed trip of this bus
    const lastTrip = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.busId, busId), eq(trips.status, "completed")))
      .orderBy(desc(trips.endTime))
      .limit(1);

    let path: any[] = [];
    if (lastTrip.length > 0) {
      // Get bus locations for this completed trip
      path = await db
        .select({
          lat: busLocations.lat,
          lng: busLocations.lng,
        })
        .from(busLocations)
        .where(eq(busLocations.tripId, lastTrip[0].id))
        .orderBy(busLocations.timestamp);
    }

    if (path.length >= 2) {
      return NextResponse.json({ path });
    }

    return NextResponse.json({ path: [] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
