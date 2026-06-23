import { NextRequest, NextResponse } from "next/server";
import { db, pool } from "@/db";
import { drivers, buses } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import bcrypt from "bcryptjs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const email = searchParams.get("email");
    const driverId = searchParams.get("driverId");

    let result;
    if (id) {
      result = await db.select().from(drivers).where(eq(drivers.id, parseInt(id)));
    } else if (email) {
      result = await db.select().from(drivers).where(eq(drivers.email, email));
    } else if (driverId) {
      result = await db.select().from(drivers).where(eq(drivers.driverId, driverId));
    } else {
      result = await db.select().from(drivers);
    }

    // Remove password from response
    const safe = result.map(({ password, ...d }) => d);
    return NextResponse.json(safe);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, email, password, phone, licenseNo, assignedBusId } = await req.json();
    if (!name || !email || !password) {
      return NextResponse.json({ error: "Name, email, password required" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters long" }, { status: 400 });
    }
    if (phone && !/^\d{10}$/.test(phone)) {
      return NextResponse.json({ error: "Mobile number must be exactly 10 digits" }, { status: 400 });
    }

    // Check email unique
    const existing = await db.select().from(drivers).where(eq(drivers.email, email));
    if (existing.length > 0) {
      return NextResponse.json({ error: "Email already registered" }, { status: 400 });
    }

    const hashed = await bcrypt.hash(password, 10);

    // Auto-generate driverId
    const allDrivers = await db.select({ id: drivers.id }).from(drivers);
    const nextNum = (allDrivers.length + 1).toString().padStart(3, "0");
    const driverId = `DRV${nextNum}`;

    const result = await db.insert(drivers).values({
      driverId,
      name,
      email,
      password: hashed,
      phone: phone || null,
      licenseNo: licenseNo || null,
      assignedBusId: assignedBusId || null,
      isActive: true,
    }).returning();

    const { password: _, ...safe } = result[0];
    return NextResponse.json(safe, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, password, ...updateData } = await req.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    if (password && password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters long" }, { status: 400 });
    }
    if (updateData.phone && !/^\d{10}$/.test(updateData.phone)) {
      return NextResponse.json({ error: "Mobile number must be exactly 10 digits" }, { status: 400 });
    }

    const updates: any = { ...updateData, updatedAt: new Date() };
    if (password) updates.password = await bcrypt.hash(password, 10);

    const result = await db.update(drivers).set(updates).where(eq(drivers.id, id)).returning();
    const { password: _, ...safe } = result[0];
    return NextResponse.json(safe);
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
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE buses SET driver_id = NULL WHERE driver_id = $1`, [numericId]);
      await client.query(`UPDATE trips SET driver_id = NULL WHERE driver_id = $1`, [numericId]);
      await client.query(`
        DO $$
        BEGIN
          IF to_regclass('public.notifications') IS NOT NULL THEN
            UPDATE notifications SET driver_id = NULL WHERE driver_id = ${numericId};
          END IF;
          IF to_regclass('public.driver_webauthn_credentials') IS NOT NULL THEN
            DELETE FROM driver_webauthn_credentials WHERE driver_id = ${numericId};
          END IF;
          IF to_regclass('public.webauthn_challenges') IS NOT NULL THEN
            DELETE FROM webauthn_challenges WHERE driver_id = ${numericId};
          END IF;
        END $$;
      `);
      await client.query(`DELETE FROM drivers WHERE id = $1`, [numericId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
