import { NextRequest, NextResponse } from "next/server";
import { db, pool } from "@/db";
import { drivers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureWebAuthnTables, newChallenge, saveChallenge, getWebAuthnExpectedOriginAndRpId } from "../../_lib";

export async function POST(req: NextRequest) {
  try {
    await ensureWebAuthnTables();
    const { identifier } = await req.json();
    const value = String(identifier || "").trim();
    if (!value) return NextResponse.json({ error: "Enter Driver ID first" }, { status: 400 });

    const lookup = /^DRV\d+$/i.test(value)
      ? eq(drivers.driverId, value.toUpperCase())
      : eq(drivers.email, value);
    const [driver] = await db.select().from(drivers).where(lookup);
    if (!driver) return NextResponse.json({ error: "Driver not found" }, { status: 404 });

    const credentials = await pool.query(
      `SELECT credential_id FROM driver_webauthn_credentials WHERE driver_id=$1`,
      [driver.id],
    );
    if (credentials.rowCount === 0) {
      return NextResponse.json({ error: "Fingerprint is not enabled for this driver" }, { status: 404 });
    }

    const challenge = newChallenge();
    await saveChallenge(driver.id, challenge, "login");

    return NextResponse.json({
      driverId: driver.driverId,
      challenge,
      rpId: getWebAuthnExpectedOriginAndRpId(req).hostname,
      timeout: 60000,
      userVerification: "preferred",
      allowCredentials: credentials.rows.map(row => ({
        type: "public-key",
        id: row.credential_id,
      })),
    });
  } catch (error) {
    console.error("WebAuthn login options error:", error);
    return NextResponse.json({ error: "Failed to start fingerprint login" }, { status: 500 });
  }
}
