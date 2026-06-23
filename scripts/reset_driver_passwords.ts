import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import bcrypt from "bcryptjs";

async function main() {
  const { db } = await import("../src/db");
  const { drivers } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const hashedPassword = await bcrypt.hash("driver123", 10);

  console.log("Updating DRV001 password...");
  await db.update(drivers)
    .set({ password: hashedPassword, updatedAt: new Date() })
    .where(eq(drivers.driverId, "DRV001"));

  console.log("Updating DRV005 password...");
  await db.update(drivers)
    .set({ password: hashedPassword, updatedAt: new Date() })
    .where(eq(drivers.driverId, "DRV005"));

  console.log("✅ Driver passwords reset to 'driver123' successfully!");
}

main().catch(console.error);
