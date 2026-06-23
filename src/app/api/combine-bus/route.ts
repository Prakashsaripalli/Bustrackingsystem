import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { buses, drivers, notifications, users } from "@/db/schema";
import { verifyToken } from "@/utils/jwt";

let notificationsTableReady = false;

async function ensureNotificationsTable() {
  if (notificationsTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      driver_id INTEGER REFERENCES drivers(id),
      bus_id VARCHAR(50),
      type VARCHAR(100) NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  notificationsTableReady = true;
}

function getToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

function toAlert(row: typeof notifications.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    driverId: row.driverId,
    busId: row.busId,
    type: row.type,
    title: row.title,
    message: row.message,
    isRead: row.isRead,
    createdAt: row.createdAt,
  };
}

export async function POST(req: NextRequest) {
  try {
    await ensureNotificationsTable();
    const payload = verifyToken(getToken(req));
    if (!payload || payload.role !== "driver") {
      return NextResponse.json({ error: "Driver access required" }, { status: 403 });
    }

    const body = await req.json();
    const primaryBusId = String(body.primaryBusId || "").trim().toUpperCase();
    const targetBusId = String(body.targetBusId || "").trim().toUpperCase();
    const reason = String(body.reason || "").trim();

    if (!primaryBusId || !targetBusId) {
      return NextResponse.json({ error: "Both bus numbers are required" }, { status: 400 });
    }
    if (primaryBusId === targetBusId) {
      return NextResponse.json({ error: "Enter a different bus number to combine" }, { status: 400 });
    }

    const [targetBus] = await db
      .select({ busId: buses.busId })
      .from(buses)
      .where(eq(buses.busId, targetBusId));
    if (!targetBus) {
      return NextResponse.json({ error: `Bus ${targetBusId} not found` }, { status: 404 });
    }

    const [driver] = await db
      .select({ name: drivers.name, driverId: drivers.driverId })
      .from(drivers)
      .where(eq(drivers.id, payload.id));

    const assignedStudents = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.assignedBusId, targetBusId));

    const reasonText = reason ? ` Reason: ${reason}` : "";
    const title = `🔁 ${targetBusId} combined with ${primaryBusId}`;
    const message = `${targetBusId} passengers should track ${primaryBusId} now. Driver ${driver?.name || payload.name || ""} (${driver?.driverId || "Driver"}) has combined these buses.${reasonText}`;

    const values: (typeof notifications.$inferInsert)[] = [
      {
        driverId: payload.id,
        busId: targetBusId,
        type: "bus_combined",
        title,
        message,
      },
      ...assignedStudents.map(student => ({
        userId: student.id,
        driverId: payload.id,
        busId: targetBusId,
        type: "bus_combined",
        title,
        message,
      })),
    ];

    const inserted = await db.insert(notifications).values(values).returning();
    const adminAlert = inserted.find(alert => alert.userId === null) ?? inserted[0];

    return NextResponse.json({
      alert: toAlert(adminAlert),
      primaryBusId,
      targetBusId,
      reason,
      studentCount: assignedStudents.length,
    });
  } catch (error) {
    console.error("Combine bus error:", error);
    return NextResponse.json({ error: "Failed to combine buses" }, { status: 500 });
  }
}
