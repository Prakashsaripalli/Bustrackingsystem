import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db, pool } from "@/db";
import { drivers, notifications, trips, users } from "@/db/schema";
import { verifyToken } from "@/utils/jwt";

const EMERGENCY_LABELS: Record<string, string> = {
  breakdown: "Breakdown",
  tyre_puncture: "Tyre Puncture",
  accident: "Accident",
  traffic: "More Traffic",
  medical: "Medical Help",
  other: "Other",
};

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
      resolved_at TIMESTAMP,
      resolved_by INTEGER,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP`);
  await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS resolved_by INTEGER`);
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
    resolvedAt: row.resolvedAt,
    resolvedBy: row.resolvedBy,
    createdAt: row.createdAt,
  };
}

export async function GET(req: NextRequest) {
  try {
    await ensureNotificationsTable();
    const payload = verifyToken(getToken(req));
    if (!payload) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const baseWhere = or(eq(notifications.type, "emergency"), eq(notifications.type, "bus_combined"));
    let rows: (typeof notifications.$inferSelect)[] = [];

    if (payload.role === "admin") {
      rows = await db
        .select()
        .from(notifications)
        .where(and(baseWhere, isNull(notifications.userId)))
        .orderBy(desc(notifications.createdAt))
        .limit(50);
    } else if (payload.role === "student") {
      const [student] = await db
        .select({ assignedBusId: users.assignedBusId })
        .from(users)
        .where(eq(users.id, payload.id));

      const rawRows = await db
        .select()
        .from(notifications)
        .where(and(
          baseWhere,
          or(
            eq(notifications.userId, payload.id),
            student?.assignedBusId
              ? and(isNull(notifications.userId), eq(notifications.busId, student.assignedBusId))
              : undefined,
          ),
        ))
        .orderBy(desc(notifications.createdAt))
        .limit(50);

      const seen = new Set<string>();
      rows = [];
      for (const row of rawRows) {
        const key = `${row.title}|${row.message}`;
        if (!seen.has(key)) {
          seen.add(key);
          rows.push(row);
        }
      }
    } else if (payload.role === "driver") {
      rows = await db
        .select()
        .from(notifications)
        .where(and(baseWhere, isNull(notifications.userId), eq(notifications.driverId, payload.id)))
        .orderBy(desc(notifications.createdAt))
        .limit(50);
    } else {
      return NextResponse.json({ error: "Invalid role" }, { status: 403 });
    }

    return NextResponse.json(rows.map(toAlert));
  } catch (error) {
    console.error("Alerts GET error:", error);
    return NextResponse.json({ error: "Failed to load alerts" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureNotificationsTable();
    const payload = verifyToken(getToken(req));
    if (!payload || payload.role !== "driver") {
      return NextResponse.json({ error: "Driver access required" }, { status: 403 });
    }

    const body = await req.json();
    const busId = String(body.busId || "").trim().toUpperCase();
    const category = String(body.category || "other").trim();
    const label = EMERGENCY_LABELS[category] ?? EMERGENCY_LABELS.other;
    const reason = String(body.reason || "").trim();
    const lat = typeof body.lat === "number" ? body.lat : null;
    const lng = typeof body.lng === "number" ? body.lng : null;

    if (!busId) return NextResponse.json({ error: "Bus ID is required" }, { status: 400 });

    const [driver] = await db
      .select({ name: drivers.name, driverId: drivers.driverId })
      .from(drivers)
      .where(eq(drivers.id, payload.id));

    const assignedStudents = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.assignedBusId, busId));

    const locationText = lat !== null && lng !== null ? ` Location: ${lat.toFixed(5)}, ${lng.toFixed(5)}.` : "";
    const reasonText = reason ? ` Reason: ${reason}` : "";
    const title = `🚨 ${label} - ${busId}`;
    const message = `Emergency alert from ${driver?.name || payload.name || "driver"} (${driver?.driverId || "Driver"}) for bus ${busId}.${reasonText}${locationText}`;

    const values: (typeof notifications.$inferInsert)[] = [
      {
        driverId: payload.id,
        busId,
        type: "emergency",
        title,
        message,
      },
      ...assignedStudents.map(student => ({
        userId: student.id,
        driverId: payload.id,
        busId,
        type: "emergency",
        title,
        message,
      })),
    ];

    const inserted = await db.insert(notifications).values(values).returning();
    await db
      .update(trips)
      .set({ emergencyAlert: true })
      .where(and(eq(trips.busId, busId), eq(trips.status, "active")))
      .catch(() => {});

    const adminAlert = inserted.find(alert => alert.userId === null) ?? inserted[0];

    return NextResponse.json({
      alert: toAlert(adminAlert),
      busId,
      category,
      label,
      reason,
      lat,
      lng,
      studentCount: assignedStudents.length,
    });
  } catch (error) {
    console.error("Alerts POST error:", error);
    return NextResponse.json({ error: "Failed to send emergency alert" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureNotificationsTable();
    const payload = verifyToken(getToken(req));
    if (!payload || payload.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = await req.json();
    const id = Number(body.id);
    if (!id) return NextResponse.json({ error: "Alert id is required" }, { status: 400 });

    const [alertToResolve] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, id));

    if (!alertToResolve) return NextResponse.json({ error: "Alert not found" }, { status: 404 });

    const resolvedAtVal = body.resolved === false ? null : new Date();
    const resolvedByVal = body.resolved === false ? null : payload.id;

    const updatedRows = await db
      .update(notifications)
      .set({
        isRead: true,
        resolvedAt: resolvedAtVal,
        resolvedBy: resolvedByVal,
      })
      .where(or(
        eq(notifications.id, id),
        and(
          eq(notifications.busId, alertToResolve.busId || ""),
          eq(notifications.title, alertToResolve.title),
          eq(notifications.message, alertToResolve.message)
        )
      ))
      .returning();

    const updated = updatedRows.find(row => row.id === id) || updatedRows[0];
    return NextResponse.json(toAlert(updated));
  } catch (error) {
    console.error("Alerts PATCH error:", error);
    return NextResponse.json({ error: "Failed to update alert" }, { status: 500 });
  }
}
