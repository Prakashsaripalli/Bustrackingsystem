import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function main() {
  const { db } = await import("./src/db");
  const { buses, routes, trips } = await import("./src/db/schema");

  const { busLocations } = await import("./src/db/schema");

  const allBuses = await db.select().from(buses);
  console.log("=== BUSES ===");
  console.log(allBuses);

  const allRoutes = await db.select().from(routes);
  console.log("=== ROUTES ===");
  console.log(JSON.stringify(allRoutes, null, 2));

  const allTrips = await db.select().from(trips);
  console.log("=== TRIPS ===");
  console.log(allTrips.slice(-5));

  const { admins, drivers, users } = await import("./src/db/schema");

  const allAdmins = await db.select().from(admins);
  console.log("=== ADMINS ===");
  console.log(allAdmins);

  const allDrivers = await db.select().from(drivers);
  console.log("=== DRIVERS ===");
  console.log(allDrivers);

  const allStudents = await db.select().from(users);
  console.log("=== STUDENTS ===");
  console.log(allStudents);
}

main().catch(err => console.error(err));
