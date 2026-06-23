import { NextRequest, NextResponse } from "next/server";
import { db, pool } from "@/db";
import { drivers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyToken } from "@/utils/jwt";
import {
  consumeChallenge,
  ensureWebAuthnTables,
  extractCredentialPublicKey,
  parseClientData,
  validateAuthenticatorData,
  validateClientData,
  getWebAuthnExpectedOriginAndRpId,
} from "../../_lib";

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

    const body = await req.json();
    const clientData = parseClientData(body.response?.clientDataJSON || "");
    const challengeOk = await consumeChallenge(payload.id, clientData.challenge, "register");
    if (!challengeOk) {
      return NextResponse.json({ error: "Fingerprint setup expired. Try again." }, { status: 400 });
    }

    const credential = extractCredentialPublicKey(body.response?.attestationObject || "");
    const { origin, hostname } = getWebAuthnExpectedOriginAndRpId(req);
    validateClientData(clientData, "webauthn.create", origin);
    validateAuthenticatorData(credential.authenticatorData, hostname);
    if (credential.credentialId !== body.id) {
      return NextResponse.json({ error: "Credential mismatch" }, { status: 400 });
    }

    await pool.query(
      `INSERT INTO driver_webauthn_credentials(driver_id, credential_id, public_key)
       VALUES($1, $2, $3)
       ON CONFLICT (credential_id) DO UPDATE SET public_key=EXCLUDED.public_key`,
      [payload.id, credential.credentialId, credential.publicKey],
    );

    const [driver] = await db.select().from(drivers).where(eq(drivers.id, payload.id));
    return NextResponse.json({
      ok: true,
      driverId: driver?.driverId,
      email: driver?.email,
      credentialId: credential.credentialId,
    });
  } catch (error) {
    console.error("WebAuthn register verify error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to enable fingerprint" }, { status: 400 });
  }
}
