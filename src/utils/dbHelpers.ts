import { db } from "@/db";
import { buses, routes, drivers, trips, busLocations, users, admins, notifications } from "@/db/schema";
import { eq, and, like, desc, sql } from "drizzle-orm";

// ─── Buses ───
export async function getAllBuses() {
  return await db.select().from(buses).where(eq(buses.isActive, true));
}

export async function getBusById(busId: string) {
  const result = await db.select().from(buses).where(eq(buses.busId, busId));
  return result[0];
}

export async function getBusWithRoute(busId: string) {
  const result = await db
    .select()
    .from(buses)
    .leftJoin(routes, eq(buses.routeId, routes.id))
    .where(eq(buses.busId, busId));
  return result[0];
}

// ─── Routes ───
export async function getAllRoutes() {
  return await db.select().from(routes).where(eq(routes.isActive, true));
}

export async function getRoutesByStop(stopName: string) {
  return await db
    .select()
    .from(routes)
    .where(
      and(
        eq(routes.isActive, true),
        sql`${stopName} = ANY(${routes.stops})`
      )
    );
}

export async function getRouteById(routeId: number) {
  const result = await db.select().from(routes).where(eq(routes.id, routeId));
  return result[0];
}

// ─── Drivers ───
export async function getDriverById(driverId: number) {
  const result = await db.select().from(drivers).where(eq(drivers.id, driverId));
  return result[0];
}

export async function getDriverByEmail(email: string) {
  const result = await db.select().from(drivers).where(eq(drivers.email, email));
  return result[0];
}

// ─── Trips ───
export async function getActiveTripByBus(busId: string) {
  const result = await db
    .select()
    .from(trips)
    .where(
      and(eq(trips.busId, busId), eq(trips.status, "active"))
    );
  return result[0];
}

export async function createTrip(data: typeof trips.$inferInsert) {
  const result = await db.insert(trips).values(data).returning();
  return result[0];
}

export async function updateTripStatus(tripId: number, status: string) {
  const result = await db
    .update(trips)
    .set({ status, endTime: status === "completed" ? new Date() : undefined })
    .where(eq(trips.id, tripId))
    .returning();
  return result[0];
}

// ─── Users ───
export async function getUserByEmail(email: string) {
  const result = await db.select().from(users).where(eq(users.email, email));
  return result[0];
}

export async function createUser(data: typeof users.$inferInsert) {
  const result = await db.insert(users).values(data).returning();
  return result[0];
}

// ─── Admins ───
export async function getAdminByEmail(email: string) {
  const result = await db.select().from(admins).where(eq(admins.email, email));
  return result[0];
}
