import dotenv from "dotenv";
import { eq } from "drizzle-orm";

async function repairDemoData() {
  dotenv.config({ path: ".env.local" });
  const { db } = await import("../src/db");
  const { drivers, routes, users } = await import("../src/db/schema");

  console.log("🔧 Repairing demo data...");

  await db.update(routes).set({
    isReversible: true,
    morningCutoff: "12:01",
  });

  await db.update(drivers).set({
    driverId: "DRV001",
    assignedBusId: "BUS101",
    preferredRouteId: 1,
    isActive: true,
    updatedAt: new Date(),
  }).where(eq(drivers.email, "ramesh@bustrack.com"));

  await db.update(drivers).set({
    driverId: "DRV002",
    assignedBusId: "BUS102",
    preferredRouteId: 2,
    isActive: true,
    updatedAt: new Date(),
  }).where(eq(drivers.email, "suresh@bustrack.com"));

  await db.update(drivers).set({
    driverId: "DRV003",
    assignedBusId: "BUS103",
    preferredRouteId: 3,
    isActive: true,
    updatedAt: new Date(),
  }).where(eq(drivers.email, "venkatesh@bustrack.com"));

  await db.update(users).set({
    assignedBusId: "BUS101",
    boardingStop: "Nagaram",
    studentId: "STU001",
    updatedAt: new Date(),
  }).where(eq(users.email, "student1@college.com"));

  await db.update(users).set({
    assignedBusId: "BUS101",
    boardingStop: "Surrampalem",
    studentId: "STU002",
    updatedAt: new Date(),
  }).where(eq(users.email, "student2@college.com"));

  console.log("✅ Demo data repaired.");
}

repairDemoData()
  .catch((error) => {
    console.error("❌ Repair failed:", error);
    process.exit(1);
  })
  .then(() => process.exit(0));
