import dotenv from "dotenv";
import crypto from "crypto";
dotenv.config({ path: ".env.local" });

// Helper to encode CBOR values manually for our mock test
function encodeCborMap(map: Record<number | string, any>): Buffer {
  const buffers: Buffer[] = [];
  const keys = Object.keys(map);
  
  buffers.push(Buffer.from([0xa0 + keys.length]));
  
  for (const k of keys) {
    const keyNum = Number(k);
    if (keyNum >= 0) {
      if (keyNum < 24) {
        buffers.push(Buffer.from([keyNum]));
      } else {
        throw new Error("Unsupported key value > 23");
      }
    } else {
      const val = -1 - keyNum;
      if (val < 24) {
        buffers.push(Buffer.from([0x20 + val]));
      } else {
        throw new Error("Unsupported negative key value");
      }
    }
    
    const v = map[k];
    if (typeof v === "number") {
      if (v >= 0) {
        if (v < 24) {
          buffers.push(Buffer.from([v]));
        } else {
          if (v < 256) {
            buffers.push(Buffer.from([0x18, v]));
          } else {
            const buf = Buffer.alloc(3);
            buf[0] = 0x19;
            buf.writeUInt16BE(v, 1);
            buffers.push(buf);
          }
        }
      } else {
        const val = -1 - v;
        if (val < 24) {
          buffers.push(Buffer.from([0x20 + val]));
        } else {
          // Negative value
          if (val < 256) {
            buffers.push(Buffer.from([0x38, val]));
          } else {
            const buf = Buffer.alloc(3);
            buf[0] = 0x39;
            buf.writeUInt16BE(val, 1);
            buffers.push(buf);
          }
        }
      }
    } else if (Buffer.isBuffer(v)) {
      if (v.length < 24) {
        buffers.push(Buffer.from([0x40 + v.length]));
      } else if (v.length < 256) {
        buffers.push(Buffer.from([0x58, v.length]));
      } else {
        const buf = Buffer.alloc(3);
        buf[0] = 0x59;
        buf.writeUInt16BE(v.length, 1);
        buffers.push(buf);
      }
      buffers.push(v);
    } else if (typeof v === "string") {
      const utf8 = Buffer.from(v, "utf8");
      if (utf8.length < 24) {
        buffers.push(Buffer.from([0x60 + utf8.length]));
      } else {
        buffers.push(Buffer.from([0x78, utf8.length]));
      }
      buffers.push(utf8);
    } else {
      throw new Error("Unsupported value type: " + typeof v);
    }
  }
  
  return Buffer.concat(buffers);
}

async function runTest() {
  const { 
    base64url, 
    extractCredentialPublicKey, 
    verifyAssertionSignature 
  } = await import("../src/app/api/auth/webauthn/_lib");

  console.log("🧪 Starting WebAuthn Cryptographic Flow Test with RSA...");

  // 1. Generate RSA key pair for test (2048-bit)
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  // Extract public key coordinates to construct COSE Key
  const jwk = publicKey.export({ format: "jwk" });
  const n = Buffer.from(jwk.n!, "base64");
  const e = Buffer.from(jwk.e!, "base64");

  console.log("Generated test JWK coordinates:");
  console.log("N length:", n.length);
  console.log("E length:", e.length);

  // COSE RSA Key Map parameters:
  // 1 -> kty: 3 (RSA)
  // 3 -> alg: -257 (RS256)
  // -1 -> n (modulus, Buffer)
  // -2 -> e (exponent, Buffer)
  const coseKeyMap = {
    1: 3,
    3: -257,
    "-1": n,
    "-2": e,
  };

  const coseKeyBytes = encodeCborMap(coseKeyMap);
  console.log("Constructed COSE Key Bytes length:", coseKeyBytes.length);

  // 2. Construct authData buffer
  const rpId = "localhost";
  const rpIdHash = crypto.createHash("sha256").update(rpId).digest();
  const flags = Buffer.from([0x41]); // User Present (0x01) and Has Attested Credential Data (0x40)
  const signCount = Buffer.alloc(4); // 0
  const aaguid = Buffer.alloc(16); // zeroed
  const credId = Buffer.from("test-credential-id-rsa-12345");
  const credIdLen = Buffer.alloc(2);
  credIdLen.writeUInt16BE(credId.length, 0);

  const authData = Buffer.concat([
    rpIdHash,
    flags,
    signCount,
    aaguid,
    credIdLen,
    credId,
    coseKeyBytes,
  ]);

  // Construct CBOR attestation object
  const attestationObjectMap: Record<string, any> = {
    fmt: "none",
    attStmt: encodeCborMap({}),
    authData: authData,
  };
  
  const attestationObjectCbor = Buffer.concat([
    Buffer.from([0xa3]), // map of 3 items
    Buffer.from([0x63]), Buffer.from("fmt", "utf8"), Buffer.from([0x64]), Buffer.from("none", "utf8"),
    Buffer.from([0x67]), Buffer.from("attStmt", "utf8"), Buffer.from([0xa0]), // empty map
    Buffer.from([0x68]), Buffer.from("authData", "utf8"), 
    Buffer.from([0x59, (authData.length >> 8) & 0xff, authData.length & 0xff]), // 2-byte byte-string length
    authData
  ]);

  const attestationObjectBase64 = base64url(attestationObjectCbor);

  // 3. Test extraction
  console.log("Testing extractCredentialPublicKey...");
  const extracted = extractCredentialPublicKey(attestationObjectBase64);
  console.log("Extracted credential ID:", extracted.credentialId);
  console.log("Extracted public key length:", extracted.publicKey.length);

  // 4. Verify assertion signature (simulate login)
  const clientDataJSON = JSON.stringify({
    type: "webauthn.get",
    challenge: "some-random-challenge-base64url",
    origin: "http://localhost:3000",
  });
  const clientDataJSONBase64 = base64url(Buffer.from(clientDataJSON, "utf8"));
  const clientDataHash = crypto.createHash("sha256").update(Buffer.from(clientDataJSON, "utf8")).digest();

  // Create assertion authenticator data
  const assertAuthData = Buffer.concat([
    rpIdHash,
    Buffer.from([0x01]), // User present
    Buffer.from([0, 0, 0, 1]), // Sign count = 1
  ]);

  const signedData = Buffer.concat([assertAuthData, clientDataHash]);
  
  // Sign the data with our private key
  const signature = crypto.sign("sha256", signedData, privateKey);

  console.log("Testing verifyAssertionSignature...");
  try {
    verifyAssertionSignature({
      publicKey: extracted.publicKey,
      authenticatorData: base64url(assertAuthData),
      clientDataJSON: clientDataJSONBase64,
      signature: base64url(signature),
      expectedRpId: rpId,
    });
    console.log("✅ WebAuthn Cryptographic verification with RSA succeeded!");
  } catch (err) {
    console.error("❌ Cryptographic verification with RSA failed:", err);
  }
}

runTest()
  .catch(console.error)
  .then(() => process.exit(0));
