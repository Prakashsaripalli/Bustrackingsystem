import { pool } from "@/db";
import crypto from "crypto";
import { NextRequest } from "next/server";

export function getWebAuthnExpectedOriginAndRpId(req: NextRequest) {
  const rawProto = req.headers.get("x-forwarded-proto") || "";
  const rawHost = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  
  const proto = rawProto.split(",")[0].trim() || (req.nextUrl.protocol.replace(":", ""));
  const host = rawHost.split(",")[0].trim() || req.nextUrl.host;
  
  const hostname = host.split(":")[0];
  const origin = `${proto}://${host}`;
  
  return { origin, hostname };
}


export function base64url(buffer: Buffer | ArrayBuffer | Uint8Array): string {
  const value = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function fromBase64url(value: string): Buffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

export function newChallenge(): string {
  return base64url(crypto.randomBytes(32));
}

let tablesReady = false;

export async function ensureWebAuthnTables() {
  if (tablesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id SERIAL PRIMARY KEY,
      driver_id INTEGER REFERENCES drivers(id),
      challenge TEXT NOT NULL,
      type VARCHAR(30) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS driver_webauthn_credentials (
      id SERIAL PRIMARY KEY,
      driver_id INTEGER REFERENCES drivers(id),
      credential_id TEXT UNIQUE NOT NULL,
      public_key TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  tablesReady = true;
}

export async function saveChallenge(driverId: number, challenge: string, type: "register" | "login") {
  await ensureWebAuthnTables();
  await pool.query(
    `INSERT INTO webauthn_challenges(driver_id, challenge, type, expires_at)
     VALUES($1, $2, $3, NOW() + INTERVAL '5 minutes')`,
    [driverId, challenge, type],
  );
}

export async function consumeChallenge(driverId: number, challenge: string, type: "register" | "login") {
  await ensureWebAuthnTables();
  const result = await pool.query(
    `DELETE FROM webauthn_challenges
     WHERE id = (
       SELECT id FROM webauthn_challenges
       WHERE driver_id=$1 AND challenge=$2 AND type=$3 AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1
     )
     RETURNING id`,
    [driverId, challenge, type],
  );
  return (result.rowCount ?? 0) > 0;
}

function readLength(data: Buffer, offset: number, additional: number): { length: number; offset: number } {
  if (additional < 24) return { length: additional, offset };
  if (additional === 24) return { length: data[offset], offset: offset + 1 };
  if (additional === 25) return { length: data.readUInt16BE(offset), offset: offset + 2 };
  if (additional === 26) return { length: data.readUInt32BE(offset), offset: offset + 4 };
  throw new Error("Unsupported CBOR length");
}

function parseCbor(data: Buffer, offset = 0): { value: any; offset: number } {
  const initial = data[offset++];
  const major = initial >> 5;
  const additional = initial & 31;
  const len = readLength(data, offset, additional);
  offset = len.offset;

  if (major === 0) return { value: len.length, offset };
  if (major === 1) return { value: -1 - len.length, offset };
  if (major === 2) return { value: data.subarray(offset, offset + len.length), offset: offset + len.length };
  if (major === 3) return { value: data.subarray(offset, offset + len.length).toString("utf8"), offset: offset + len.length };
  if (major === 4) {
    const arr = [];
    for (let index = 0; index < len.length; index++) {
      const item = parseCbor(data, offset);
      arr.push(item.value);
      offset = item.offset;
    }
    return { value: arr, offset };
  }
  if (major === 5) {
    const map: Record<string, any> = {};
    for (let index = 0; index < len.length; index++) {
      const key = parseCbor(data, offset);
      const val = parseCbor(data, key.offset);
      map[String(key.value)] = val.value;
      offset = val.offset;
    }
    return { value: map, offset };
  }
  if (major === 7) return { value: additional === 21 ? true : additional === 20 ? false : null, offset };
  throw new Error("Unsupported CBOR value");
}

export function validateClientData(clientData: any, expectedType: "webauthn.create" | "webauthn.get", expectedOrigin: string) {
  if (clientData.type !== expectedType) throw new Error("Invalid WebAuthn operation");
  if (clientData.origin !== expectedOrigin) throw new Error("Invalid WebAuthn origin");
}

export function validateAuthenticatorData(authData: Buffer, expectedRpId: string, requireUserVerification = false) {
  if (authData.length < 37) throw new Error("Invalid authenticator data");
  const expectedRpIdHash = crypto.createHash("sha256").update(expectedRpId).digest();
  const receivedRpIdHash = authData.subarray(0, 32);
  if (!crypto.timingSafeEqual(expectedRpIdHash, receivedRpIdHash)) {
    throw new Error("Invalid WebAuthn relying party");
  }
  const flags = authData[32];
  if ((flags & 0x01) !== 0x01) throw new Error("User presence was not verified");
  if (requireUserVerification && (flags & 0x04) !== 0x04) {
    throw new Error("Fingerprint/PIN verification is required");
  }
}

export function extractCredentialPublicKey(attestationObject: string): { credentialId: string; publicKey: string; authenticatorData: Buffer } {
  const decoded = parseCbor(fromBase64url(attestationObject)).value;
  const authData: Buffer = decoded.authData;
  if (!Buffer.isBuffer(authData)) throw new Error("Invalid authenticator data");

  let offset = 37;
  const flags = authData[32];
  const hasAttestedCredentialData = (flags & 0x40) === 0x40;
  if (!hasAttestedCredentialData) throw new Error("Missing credential data");

  offset += 16;
  const credentialIdLength = authData.readUInt16BE(offset);
  offset += 2;
  const credentialId = authData.subarray(offset, offset + credentialIdLength);
  offset += credentialIdLength;
  
  // Extract exactly the COSE public key bytes using the CBOR parser offset
  const parsedCose = parseCbor(authData, offset);
  const coseKeyLength = parsedCose.offset - offset;
  const publicKey = authData.subarray(offset, offset + coseKeyLength);

  return { credentialId: base64url(credentialId), publicKey: base64url(publicKey), authenticatorData: authData };
}

export function parseClientData(clientDataJSON: string) {
  return JSON.parse(fromBase64url(clientDataJSON).toString("utf8"));
}

function cosePublicKeyToKeyObject(publicKey: string): crypto.KeyObject {
  const cose = parseCbor(fromBase64url(publicKey)).value as Record<string, any>;
  const keyType = Number(cose["1"]);

  if (keyType === 2) {
    const curve = Number(cose["-1"]);
    if (curve !== 1) throw new Error("Unsupported fingerprint key curve");
    return crypto.createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: base64url(cose["-2"]),
        y: base64url(cose["-3"]),
      },
      format: "jwk",
    });
  }

  if (keyType === 3) {
    return crypto.createPublicKey({
      key: {
        kty: "RSA",
        n: base64url(cose["-1"]),
        e: base64url(cose["-2"]),
      },
      format: "jwk",
    });
  }

  throw new Error("Unsupported fingerprint credential type");
}

export function verifyAssertionSignature(params: {
  publicKey: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
  expectedRpId: string;
  requireUserVerification?: boolean;
}) {
  const authData = fromBase64url(params.authenticatorData);
  validateAuthenticatorData(authData, params.expectedRpId, params.requireUserVerification ?? false);
  const clientDataHash = crypto.createHash("sha256").update(fromBase64url(params.clientDataJSON)).digest();
  const signedData = Buffer.concat([authData, clientDataHash]);
  const key = cosePublicKeyToKeyObject(params.publicKey);
  const valid = crypto.verify("sha256", signedData, key, fromBase64url(params.signature));
  if (!valid) throw new Error("Fingerprint signature verification failed");
}
