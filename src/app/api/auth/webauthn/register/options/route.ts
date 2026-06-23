import { NextRequest, NextResponse } from "next/server";
import { db, pool } from "@/db";
import { drivers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyToken } from "@/utils/jwt";
import { base64url, ensureWebAuthnTables, newChallenge, saveChallenge, getWebAuthnExpectedOriginAndRpId } from "../../_lib";

function tokenFrom(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

export async function POST(req: NextRequest) {
  try {
    await ensureWebAuthnTables();
    const payload = verifyToken(tokenFrom(req));
    if (!payload || payload.role !== "driver") {
      return NextResponse.json({ error: "Driver access required" }, { status: 403 });
    }

    const [driver] = await db.select().from(drivers).where(eq(drivers.id, payload.id));
    if (!driver) return NextResponse.json({ error: "Driver not found" }, { status: 404 });

    const existing = await pool.query(
      `SELECT credential_id FROM driver_webauthn_credentials WHERE driver_id=$1`,
      [driver.id],
    );
    const challenge = newChallenge();
    await saveChallenge(driver.id, challenge, "register");
    const { hostname: rpId } = getWebAuthnExpectedOriginAndRpId(req);

    return NextResponse.json({
      challenge,
      rp: { name: "BusTrackLive", id: rpId },
      user: {
        id: base64url(Buffer.from(String(driver.id))),
        name: driver.driverId || driver.email,
        displayName: driver.name,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      timeout: 60000,
      attestation: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "preferred",
        residentKey: "preferred",
      },
      excludeCredentials: existing.rows.map(row => ({
        type: "public-key",
        id: row.credential_id,
      })),
    });
  } catch (error) {
    console.error("WebAuthn register options error:", error);
    return NextResponse.json({ error: "Failed to start fingerprint setup" }, { status: 500 });
  }
}
