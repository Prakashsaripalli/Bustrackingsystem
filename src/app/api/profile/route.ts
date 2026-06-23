import { NextRequest, NextResponse } from "next/server";
import { db, pool } from "@/db";
import { users, drivers, admins } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { verifyToken } from "@/utils/jwt";

function getTokenFromRequest(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

export async function GET(req: NextRequest) {
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_contact VARCHAR(20)`);
    const token = getTokenFromRequest(req);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const payload = verifyToken(token);
    if (!payload) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    let profile: any;
    if (payload.role === "student") {
      const r = await db.select().from(users).where(eq(users.id, payload.id));
      if (r.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
      const { password, ...safe } = r[0];
      profile = { ...safe, role: "student" };
    } else if (payload.role === "driver") {
      const r = await db.select().from(drivers).where(eq(drivers.id, payload.id));
      if (r.length === 0) return NextResponse.json({ error: "Driver not found" }, { status: 404 });
      const { password, ...safe } = r[0];
      const adminList = await db.select({ name: admins.name, email: admins.email }).from(admins);
      profile = { ...safe, role: "driver", admins: adminList };
    } else {
      return NextResponse.json({ error: "Not supported for this role" }, { status: 400 });
    }

    return NextResponse.json(profile);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_contact VARCHAR(20)`);
    const token = getTokenFromRequest(req);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const payload = verifyToken(token);
    if (!payload) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const body = await req.json();
    const { password, newPassword, ...updateFields } = body;

    if (newPassword && newPassword.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters long" }, { status: 400 });
    }
    if (updateFields.phone && !/^\d{10}$/.test(updateFields.phone)) {
      return NextResponse.json({ error: "Mobile number must be exactly 10 digits" }, { status: 400 });
    }
    if (updateFields.parentContact && !/^\d{10}$/.test(updateFields.parentContact)) {
      return NextResponse.json({ error: "Parent contact number must be exactly 10 digits" }, { status: 400 });
    }

    // Verify old password if changing password
    if (newPassword) {
      if (!password) return NextResponse.json({ error: "Current password required to set new password" }, { status: 400 });
      let currentHash = "";
      if (payload.role === "student") {
        const r = await db.select({ password: users.password }).from(users).where(eq(users.id, payload.id));
        currentHash = r[0]?.password ?? "";
      } else {
        const r = await db.select({ password: drivers.password }).from(drivers).where(eq(drivers.id, payload.id));
        currentHash = r[0]?.password ?? "";
      }
      const valid = await bcrypt.compare(password, currentHash);
      if (!valid) return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
      updateFields.password = await bcrypt.hash(newPassword, 10);
    }

    // Remove fields not in schema
    delete updateFields.id;
    delete updateFields.role;
    delete updateFields.createdAt;

    let result: any;
    if (payload.role === "student") {
      const allowed: any = {};
      if (updateFields.name         !== undefined) allowed.name         = updateFields.name;
      if (updateFields.phone        !== undefined) allowed.phone        = updateFields.phone;
      if (updateFields.parentContact!== undefined) allowed.parentContact= updateFields.parentContact;
      if (updateFields.village      !== undefined) allowed.village      = updateFields.village;
      if (updateFields.boardingStop !== undefined) allowed.boardingStop = updateFields.boardingStop;
      if (updateFields.assignedBusId!== undefined) allowed.assignedBusId= updateFields.assignedBusId || null;
      if (updateFields.studentId    !== undefined) allowed.studentId    = updateFields.studentId;
      if (updateFields.password) allowed.password = updateFields.password;
      allowed.updatedAt = new Date();
      const r = await db.update(users).set(allowed).where(eq(users.id, payload.id)).returning();
      const { password: _, ...safe } = r[0];
      result = { ...safe, role: "student" };
    } else if (payload.role === "driver") {
      const allowed: any = {};
      if (updateFields.name) allowed.name = updateFields.name;
      if (updateFields.phone) allowed.phone = updateFields.phone;
      if (updateFields.licenseNo) allowed.licenseNo = updateFields.licenseNo;
      if (updateFields.assignedBusId !== undefined) allowed.assignedBusId = updateFields.assignedBusId || null;
      if (updateFields.preferredRouteId !== undefined) allowed.preferredRouteId = updateFields.preferredRouteId ? parseInt(updateFields.preferredRouteId) : null;
      if (updateFields.password) allowed.password = updateFields.password;
      allowed.updatedAt = new Date();
      const r = await db.update(drivers).set(allowed).where(eq(drivers.id, payload.id)).returning();
      const { password: _, ...safe } = r[0];
      result = { ...safe, role: "driver" };
    }

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
