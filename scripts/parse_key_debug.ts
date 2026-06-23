import crypto from "crypto";

const keyBuf = Buffer.concat([
  Buffer.from([0xa5, 0x01, 0x01, 0x01, 0x01, 0xb0]),
  Buffer.from('1f06092a864886f70d01004100300d06092a864886f70d01010105000382010f003082010a0282010100', 'hex')
]);

// Let's also test if we can extract the DER RSA key starting from the SEQUENCE tag 0x30
// In our buffer, 0x30 is at offset 19 (which is where 30 0d 06 09 ... begins)
const rsaDer = keyBuf.subarray(19);

try {
  console.log("Attempting to parse full keyBuf as SPKI DER...");
  const k = crypto.createPublicKey({
    key: keyBuf,
    format: "der",
    type: "spki",
  });
  console.log("Success! Full keyBuf parsed as SPKI DER.");
} catch (e: any) {
  console.log("Failed to parse full keyBuf as SPKI DER:", e.message);
}

try {
  console.log("Attempting to parse rsaDer (offset 19) as SPKI DER...");
  const k = crypto.createPublicKey({
    key: rsaDer,
    format: "der",
    type: "spki",
  });
  console.log("Success! rsaDer parsed as SPKI DER.");
} catch (e: any) {
  console.log("Failed to parse rsaDer as SPKI DER:", e.message);
}
