import { NextRequest, NextResponse } from "next/server";
import { db, pool } from "@/db";
import { drivers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { signToken } from "@/utils/jwt";
import {
  consumeChallenge,
  ensureWebAuthnTables,
  parseClientData,
  validateClientData,
  verifyAssertionSignature,
  getWebAuthnExpectedOriginAndRpId,
} from "../../_lib";

export async function POST(req: NextRequest) {
  try {
    await ensureWebAuthnTables();
    const body = await req.json();
    const driverId = String(body.driverId || "").trim().toUpperCase();
    const credentialId = String(body.id || "").trim();

    if (!driverId || !credentialId) {
      return NextResponse.json({ error: "Fingerprint response missing" }, { status: 400 });
    }

    const [driver] = await db.select().from(drivers).where(eq(drivers.driverId, driverId));
    if (!driver) return NextResponse.json({ error: "Driver not found" }, { status: 404 });

    const credential = await pool.query(
      `SELECT id, public_key FROM driver_webauthn_credentials WHERE driver_id=$1 AND credential_id=$2`,
      [driver.id, credentialId],
    );
    if (credential.rowCount === 0) {
      return NextResponse.json({ error: "Fingerprint not registered for this driver" }, { status: 403 });
    }

    const clientData = parseClientData(body.response?.clientDataJSON || "");
    const challengeOk = await consumeChallenge(driver.id, clientData.challenge, "login");
    if (!challengeOk) {
      return NextResponse.json({ error: "Fingerprint login expired. Try again." }, { status: 400 });
    }
    const { origin, hostname } = getWebAuthnExpectedOriginAndRpId(req);
    validateClientData(clientData, "webauthn.get", origin);
    verifyAssertionSignature({
      publicKey: credential.rows[0].public_key,
      authenticatorData: body.response?.authenticatorData || "",
      clientDataJSON: body.response?.clientDataJSON || "",
      signature: body.response?.signature || "",
      expectedRpId: hostname,
    });

    const token = signToken({ id: driver.id, role: "driver", email: driver.email, name: driver.name });
    const { password: _, ...driverWithoutPassword } = driver;

    return NextResponse.json({ token, user: { ...driverWithoutPassword, role: "driver" } });
  } catch (error) {
    console.error("WebAuthn login verify error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Fingerprint login failed" }, { status: 400 });
  }
}
