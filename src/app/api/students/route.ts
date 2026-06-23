import { NextRequest, NextResponse } from "next/server";
import { db, pool } from "@/db";
import { users, drivers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyToken } from "@/utils/jwt";
import bcrypt from "bcryptjs";

function getToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

function requireAdmin(req: NextRequest) {
  const payload = verifyToken(getToken(req));
  return payload?.role === "admin" ? payload : null;
}

function safeStudent(student: typeof users.$inferSelect) {
  const { password, ...safe } = student;
  return safe;
}

let usersColumnsReady = false;

async function ensureUsersColumns() {
  if (usersColumnsReady) return;
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_contact VARCHAR(20)`);
  usersColumnsReady = true;
}

export async function GET(req: NextRequest) {
  try {
    await ensureUsersColumns();
    const token = getToken(req);
    const payload = verifyToken(token);
    if (!payload) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (payload.role === "admin") {
      const rows = await db.select().from(users).orderBy(users.name);
      return NextResponse.json(rows.map(safeStudent));
    } else if (payload.role === "driver") {
      const driverResult = await db.select({ assignedBusId: drivers.assignedBusId }).from(drivers).where(eq(drivers.id, payload.id));
      if (driverResult.length === 0) return NextResponse.json({ error: "Driver not found" }, { status: 404 });
      const busId = driverResult[0].assignedBusId;
      if (!busId) {
        return NextResponse.json([]);
      }
      const rows = await db.select().from(users).where(eq(users.assignedBusId, busId)).orderBy(users.name);
      return NextResponse.json(rows.map(safeStudent));
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load students" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureUsersColumns();
    if (!requireAdmin(req)) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    const body = await req.json();
    const { name, email, password, phone, parentContact, village, boardingStop, assignedBusId, studentId } = body;

    if (!name || !email || !password) {
      return NextResponse.json({ error: "Name, email, and password are required" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters long" }, { status: 400 });
    }
    if (phone && !/^\d{10}$/.test(String(phone).trim())) {
      return NextResponse.json({ error: "Mobile number must be exactly 10 digits" }, { status: 400 });
    }
    if (parentContact && !/^\d{10}$/.test(String(parentContact).trim())) {
      return NextResponse.json({ error: "Parent contact number must be exactly 10 digits" }, { status: 400 });
    }

    const existing = await db.select().from(users).where(eq(users.email, email));
    if (existing.length > 0) {
      return NextResponse.json({ error: "Email already registered" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [inserted] = await db.insert(users).values({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: hashedPassword,
      role: "student",
      phone: phone ? String(phone).trim() : null,
      parentContact: parentContact ? String(parentContact).trim() : null,
      village: village ? String(village).trim() : null,
      boardingStop: boardingStop ? String(boardingStop).trim() : null,
      assignedBusId: assignedBusId ? String(assignedBusId).trim().toUpperCase() : null,
      studentId: studentId ? String(studentId).trim() : null,
    }).returning();

    return NextResponse.json(safeStudent(inserted), { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to create student" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureUsersColumns();
    if (!requireAdmin(req)) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    const body = await req.json();
    const id = Number(body.id);
    if (!id) return NextResponse.json({ error: "Student id required" }, { status: 400 });

    if (body.password !== undefined && body.password !== "" && body.password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters long" }, { status: 400 });
    }
    if (body.phone && !/^\d{10}$/.test(String(body.phone).trim())) {
      return NextResponse.json({ error: "Mobile number must be exactly 10 digits" }, { status: 400 });
    }
    if (body.parentContact && !/^\d{10}$/.test(String(body.parentContact).trim())) {
      return NextResponse.json({ error: "Parent contact number must be exactly 10 digits" }, { status: 400 });
    }

    const updates: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = String(body.name).trim();
    if (body.phone !== undefined) updates.phone = body.phone ? String(body.phone).trim() : null;
    if (body.parentContact !== undefined) updates.parentContact = body.parentContact ? String(body.parentContact).trim() : null;
    if (body.village !== undefined) updates.village = body.village ? String(body.village).trim() : null;
    if (body.assignedBusId !== undefined) updates.assignedBusId = body.assignedBusId ? String(body.assignedBusId).trim().toUpperCase() : null;
    if (body.boardingStop !== undefined) updates.boardingStop = body.boardingStop ? String(body.boardingStop).trim() : null;
    if (body.studentId !== undefined) updates.studentId = body.studentId ? String(body.studentId).trim() : null;
    if (body.password !== undefined && body.password !== "") {
      updates.password = await bcrypt.hash(body.password, 10);
    }

    const [updated] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
    if (!updated) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    return NextResponse.json(safeStudent(updated));
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update student" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureUsersColumns();
    if (!requireAdmin(req)) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!id) return NextResponse.json({ error: "Student id required" }, { status: 400 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        DO $$
        BEGIN
          IF to_regclass('public.notifications') IS NOT NULL THEN
            DELETE FROM notifications WHERE user_id = ${id};
          END IF;
        END $$;
      `);
      await client.query(`DELETE FROM users WHERE id = $1`, [id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to delete student" }, { status: 500 });
  }
}
