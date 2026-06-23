import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import bcrypt from "bcryptjs";

async function main() {
  const { db } = await import("../src/db");
  const { drivers } = await import("../src/db/schema");
  const allDrivers = await db.select().from(drivers);
  console.log("Found drivers:", allDrivers.length);
  for (const d of allDrivers) {
    const isDriver123 = await bcrypt.compare("driver123", d.password);
    console.log(`Driver ID: ${d.driverId}, Email: ${d.email}, Name: ${d.name}`);
    console.log(`  Password hash: ${d.password}`);
    console.log(`  Is 'driver123' correct? ${isDriver123}`);
  }
}

main().catch(console.error);
