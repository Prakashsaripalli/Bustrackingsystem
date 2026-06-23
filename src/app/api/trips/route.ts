import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { trips, drivers, routes } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const busId    = searchParams.get("busId");
    const status   = searchParams.get("status");
    const search   = searchParams.get("search");

    // Join with drivers and routes for richer data
    const result = await db
      .select({
        id:         trips.id,
        busId:      trips.busId,
        driverId:   trips.driverId,
        routeId:    trips.routeId,
        status:     trips.status,
        startTime:  trips.startTime,
        endTime:    trips.endTime,
        createdAt:  trips.createdAt,
        emergencyAlert: trips.emergencyAlert,
        driverName:   drivers.name,
        driverUid:    drivers.driverId,
        driverPhone:  drivers.phone,
        routeName:    routes.routeName,
        routeStops:   routes.stops,
      })
      .from(trips)
      .leftJoin(drivers, eq(trips.driverId, drivers.id))
      .leftJoin(routes,  eq(trips.routeId,  routes.id))
      .orderBy(desc(trips.createdAt));

    let filtered = result;

    if (busId)  filtered = filtered.filter(t => t.busId === busId);
    if (status) filtered = filtered.filter(t => t.status === status);
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(t =>
        t.busId?.toLowerCase().includes(q) ||
        t.driverName?.toLowerCase().includes(q) ||
        t.driverUid?.toLowerCase().includes(q) ||
        t.driverPhone?.toLowerCase().includes(q) ||
        t.routeName?.toLowerCase().includes(q) ||
        t.status?.toLowerCase().includes(q) ||
        t.routeStops?.some(s => s.toLowerCase().includes(q))
      );
    }

    return NextResponse.json(filtered);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();

    // Check if bus is active
    const { buses } = await import("@/db/schema");
    const bus = await db.select().from(buses).where(eq(buses.busId, data.busId));
    if (bus.length > 0 && !bus[0].isActive) {
      return NextResponse.json({ error: `Bus ${data.busId} is deactivated. Please activate it first.` }, { status: 403 });
    }

    const actualStartTime = new Date();
    const result = await db.insert(trips).values({
      ...data,
      startTime: data.status === "active" ? actualStartTime : undefined,
    }).returning();
    return NextResponse.json(result[0], { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, ...updateData } = await req.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const updates: any = { ...updateData };
    const actualTime = new Date();
    if (updateData.status === "completed") updates.endTime = actualTime;
    if (updateData.status === "paused")    updates.pausedAt = actualTime;

    const result = await db.update(trips).set(updates).where(eq(trips.id, id)).returning();
    return NextResponse.json(result[0]);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const numericId = parseInt(id);
    const { busLocations } = await import("@/db/schema");
    await db.transaction(async (tx) => {
      await tx.delete(busLocations).where(eq(busLocations.tripId, numericId));
      await tx.delete(trips).where(eq(trips.id, numericId));
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
