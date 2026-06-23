import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { signToken } from "@/utils/jwt";
import { db, pool } from "@/db";
import { users, drivers, admins } from "@/db/schema";
import { eq, or } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_contact VARCHAR(20)`);
    const { email, driverId, password, role } = await req.json();

    if (!password || !role) {
      return NextResponse.json({ error: "Password and role are required" }, { status: 400 });
    }
    if (!email && !driverId) {
      return NextResponse.json({ error: "Email or Driver ID is required" }, { status: 400 });
    }

    let user: any = null;

    if (role === "student") {
      if (!email) return NextResponse.json({ error: "Email required for students" }, { status: 400 });
      const result = await db.select().from(users).where(eq(users.email, email));
      user = result[0];
    } else if (role === "driver") {
      // Driver can login with email OR driverId
      if (driverId) {
        const result = await db.select().from(drivers).where(eq(drivers.driverId, driverId));
        user = result[0];
      } else if (email) {
        const result = await db.select().from(drivers).where(eq(drivers.email, email));
        user = result[0];
      }
    } else if (role === "admin") {
      if (!email) return NextResponse.json({ error: "Email required for admin" }, { status: 400 });
      const result = await db.select().from(admins).where(eq(admins.email, email));
      user = result[0];
    } else {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    if (!user) {
      return NextResponse.json({ error: "User not found. Check your credentials." }, { status: 404 });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const token = signToken({ id: user.id, role, email: user.email, name: user.name });
    const { password: _, ...userWithoutPassword } = user;

    return NextResponse.json({ token, user: { ...userWithoutPassword, role } });
  } catch (error: any) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
