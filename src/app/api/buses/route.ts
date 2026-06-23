import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { buses, routes, drivers } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const busId = searchParams.get("busId");
    const routeId = searchParams.get("routeId");
    const all = searchParams.get("all"); // include inactive

    let result;
    if (busId) {
      result = await db.select().from(buses)
        .leftJoin(routes, eq(buses.routeId, routes.id))
        .leftJoin(drivers, eq(buses.driverId, drivers.id))
        .where(eq(buses.busId, busId));
    } else if (routeId) {
      result = await db.select().from(buses)
        .leftJoin(routes, eq(buses.routeId, routes.id))
        .leftJoin(drivers, eq(buses.driverId, drivers.id))
        .where(eq(buses.routeId, parseInt(routeId)));
    } else if (all === "true") {
      result = await db.select().from(buses)
        .leftJoin(routes, eq(buses.routeId, routes.id))
        .leftJoin(drivers, eq(buses.driverId, drivers.id));
    } else {
      result = await db.select().from(buses)
        .leftJoin(routes, eq(buses.routeId, routes.id))
        .leftJoin(drivers, eq(buses.driverId, drivers.id))
        .where(eq(buses.isActive, true));
    }

    const flatResult = result.map((r: any) => ({
      ...r.buses,
      route: r.routes ? {
        ...r.routes,
        stopCoordinates: typeof r.routes.stopCoordinates === "string"
          ? JSON.parse(r.routes.stopCoordinates) : r.routes.stopCoordinates,
      } : null,
      driver: r.drivers ? { id: r.drivers.id, name: r.drivers.name, driverId: r.drivers.driver_id, phone: r.drivers.phone } : null,
    }));

    return NextResponse.json(flatResult);
  } catch (error: any) {
    console.error("Buses API error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();

    // Validate required fields
    if (!data.busId || !data.busNumber) {
      return NextResponse.json({ error: "busId and busNumber are required" }, { status: 400 });
    }

    // Check for duplicate busId
    const existingById = await db.select().from(buses).where(eq(buses.busId, data.busId));
    if (existingById.length > 0) {
      return NextResponse.json({ error: `Bus ID "${data.busId}" already exists` }, { status: 400 });
    }

    // Check for duplicate busNumber
    const existingByNum = await db.select().from(buses).where(eq(buses.busNumber, data.busNumber));
    if (existingByNum.length > 0) {
      return NextResponse.json({ error: `Bus Number "${data.busNumber}" already exists` }, { status: 400 });
    }

    const insertData: any = {
      busId: data.busId,
      busNumber: data.busNumber,
      plateNumber: data.plateNumber || null,
      capacity: parseInt(data.capacity) || 60,
      isActive: true,
      status: "inactive",
    };
    if (data.routeId) insertData.routeId = parseInt(data.routeId);
    if (data.driverId) insertData.driverId = parseInt(data.driverId);

    const result = await db.insert(buses).values(insertData).returning();
    return NextResponse.json(result[0], { status: 201 });
  } catch (error: any) {
    console.error("Add bus error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { busId, ...updateData } = await req.json();
    if (!busId) return NextResponse.json({ error: "busId required" }, { status: 400 });

    const cleanUpdate: any = {};
    if (updateData.isActive !== undefined) cleanUpdate.isActive = updateData.isActive;
    if (updateData.status !== undefined) cleanUpdate.status = updateData.status;
    if (updateData.busNumber !== undefined) cleanUpdate.busNumber = updateData.busNumber;
    if (updateData.plateNumber !== undefined) cleanUpdate.plateNumber = updateData.plateNumber || null;
    if (updateData.routeId !== undefined) cleanUpdate.routeId = updateData.routeId ? parseInt(updateData.routeId) : null;
    if (updateData.driverId !== undefined) cleanUpdate.driverId = updateData.driverId ? parseInt(updateData.driverId) : null;
    if (updateData.lastLat !== undefined) cleanUpdate.lastLat = updateData.lastLat;
    if (updateData.lastLng !== undefined) cleanUpdate.lastLng = updateData.lastLng;
    if (updateData.lastSpeed !== undefined) cleanUpdate.lastSpeed = updateData.lastSpeed;
    if (updateData.capacity !== undefined) cleanUpdate.capacity = parseInt(updateData.capacity);

    const result = await db.update(buses).set(cleanUpdate).where(eq(buses.busId, busId)).returning();
    if (result.length === 0) return NextResponse.json({ error: "Bus not found" }, { status: 404 });
    return NextResponse.json(result[0]);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const busId = searchParams.get("busId");
    if (!busId) return NextResponse.json({ error: "busId required" }, { status: 400 });
    await db.delete(buses).where(eq(buses.busId, busId));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
