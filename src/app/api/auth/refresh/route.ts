import { NextRequest, NextResponse } from "next/server";
import { db, pool } from "@/db";
import { admins, drivers, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { signToken, verifyToken } from "@/utils/jwt";

export async function POST(req: NextRequest) {
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_contact VARCHAR(20)`);
    const auth = req.headers.get("authorization") || "";
    const payload = verifyToken(auth.startsWith("Bearer ") ? auth.slice(7) : "");
    if (!payload) return NextResponse.json({ error: "Session expired" }, { status: 401 });

    let account: any;
    if (payload.role === "driver") {
      [account] = await db.select().from(drivers).where(eq(drivers.id, payload.id));
    } else if (payload.role === "student") {
      [account] = await db.select().from(users).where(eq(users.id, payload.id));
    } else if (payload.role === "admin") {
      [account] = await db.select().from(admins).where(eq(admins.id, payload.id));
    }
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    const token = signToken({
      id: account.id,
      role: payload.role,
      email: account.email,
      name: account.name,
    });
    const { password: _, ...safeAccount } = account;
    return NextResponse.json({ token, user: { ...safeAccount, role: payload.role } });
  } catch (error) {
    console.error("Session refresh error:", error);
    return NextResponse.json({ error: "Failed to refresh session" }, { status: 500 });
  }
}
