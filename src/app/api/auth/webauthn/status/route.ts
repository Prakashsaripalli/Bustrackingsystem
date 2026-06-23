import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/db";
import { verifyToken } from "@/utils/jwt";
import { ensureWebAuthnTables } from "../_lib";

function tokenFrom(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

export async function GET(req: NextRequest) {
  try {
    await ensureWebAuthnTables();
    const payload = verifyToken(tokenFrom(req));
    if (!payload || payload.role !== "driver") {
      return NextResponse.json({ error: "Driver access required" }, { status: 403 });
    }
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM driver_webauthn_credentials WHERE driver_id=$1`,
      [payload.id],
    );
    return NextResponse.json({ enabled: Number(result.rows[0]?.count || 0) > 0 });
  } catch (error) {
    console.error("WebAuthn status error:", error);
    return NextResponse.json({ error: "Failed to load fingerprint status" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureWebAuthnTables();
    const payload = verifyToken(tokenFrom(req));
    if (!payload || payload.role !== "driver") {
      return NextResponse.json({ error: "Driver access required" }, { status: 403 });
    }
    await pool.query(`DELETE FROM driver_webauthn_credentials WHERE driver_id=$1`, [payload.id]);
    return NextResponse.json({ enabled: false });
  } catch (error) {
    console.error("WebAuthn disable error:", error);
    return NextResponse.json({ error: "Failed to disable fingerprint" }, { status: 500 });
  }
}
