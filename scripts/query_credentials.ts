import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { pool } = await import("../src/db");
  const { ensureWebAuthnTables } = await import("../src/app/api/auth/webauthn/_lib");
  
  await ensureWebAuthnTables();
  
  const driversRes = await pool.query("SELECT * FROM drivers");
  console.log(`Found ${driversRes.rowCount} driver(s):`);
  for (const d of driversRes.rows) {
    console.log(`- ID: ${d.id}, driverId: ${d.driver_id}, name: ${d.name}, email: ${d.email}`);
  }

  const credentialsRes = await pool.query("SELECT * FROM driver_webauthn_credentials");
  console.log(`Found ${credentialsRes.rowCount} credential(s):`);
  for (const row of credentialsRes.rows) {
    console.log("-----------------------------------------");
    console.log("ID:", row.id);
    console.log("Driver ID:", row.driver_id);
    console.log("Credential ID:", row.credential_id);
    console.log("Public Key (length):", row.public_key ? row.public_key.length : "null");
    console.log("Public Key starts with:", row.public_key ? row.public_key.substring(0, 80) : "null");
  }
}

main()
  .catch(console.error)
  .then(() => process.exit(0));
