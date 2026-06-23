import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { signToken } from "@/utils/jwt";
import { db, pool } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_contact VARCHAR(20)`);
    const { name, email, password, role, phone, parentContact, village, boardingStop, assignedBusId, studentId } = await req.json();

    if (!name || !email || !password || !role) {
      return NextResponse.json({ error: "Name, email, password, and role are required" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters long" }, { status: 400 });
    }
    if (phone && !/^\d{10}$/.test(phone)) {
      return NextResponse.json({ error: "Mobile number must be exactly 10 digits" }, { status: 400 });
    }
    if (parentContact && !/^\d{10}$/.test(parentContact)) {
      return NextResponse.json({ error: "Parent contact number must be exactly 10 digits" }, { status: 400 });
    }
    if (role !== "student") {
      return NextResponse.json({ error: "Only students can self-register. Drivers are added by admin." }, { status: 400 });
    }

    const existing = await db.select().from(users).where(eq(users.email, email));
    if (existing.length > 0) {
      return NextResponse.json({ error: "Email already registered" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.insert(users).values({
      name,
      email,
      password: hashedPassword,
      role: "student",
      phone:        phone        || null,
      parentContact:parentContact|| null,
      village:      village      || null,
      boardingStop: boardingStop || null,
      assignedBusId:assignedBusId|| null,
      studentId:    studentId    || null,
    }).returning();

    const user = result[0];
    const token = signToken({ id: user.id, role: "student", email: user.email, name: user.name });
    const { password: _, ...safe } = user;

    return NextResponse.json({ token, user: { ...safe, role: "student" } });
  } catch (error: any) {
    console.error("Register error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
