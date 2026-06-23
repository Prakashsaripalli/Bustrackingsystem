import dotenv from "dotenv";
import bcrypt from "bcryptjs";

async function seed() {
  dotenv.config({ path: ".env.local" });
  const { db } = await import("../src/db");
  const { buses, routes, drivers, admins, users } = await import("../src/db/schema");

  console.log("🌱 Seeding database...");

  // ─── Admin ───
  const adminPassword = await bcrypt.hash("admin123", 10);
  await db.insert(admins).values({
    name: "Admin",
    email: "admin@bustrack.com",
    password: adminPassword,
    role: "admin",
  }).onConflictDoNothing();

  // ─── Drivers ───
  const driverPassword = await bcrypt.hash("driver123", 10);
  await db.insert(drivers).values([
    { driverId: "DRV001", name: "Ramesh Kumar", email: "ramesh@bustrack.com", password: driverPassword, phone: "9876543210", licenseNo: "AP123456", assignedBusId: "BUS101", preferredRouteId: 1, isActive: true },
    { driverId: "DRV002", name: "Suresh Reddy", email: "suresh@bustrack.com", password: driverPassword, phone: "9876543211", licenseNo: "AP123457", assignedBusId: "BUS102", preferredRouteId: 2, isActive: true },
    { driverId: "DRV003", name: "Venkatesh Rao", email: "venkatesh@bustrack.com", password: driverPassword, phone: "9876543212", licenseNo: "AP123458", assignedBusId: "BUS103", preferredRouteId: 3, isActive: true },
  ]).onConflictDoNothing();

  // ─── Routes ───
  await db.insert(routes).values([
    {
      routeName: "Jaggampeta-Surrampalem",
      stops: ["Jaggampeta", "Nagaram", "Surrampalem"],
      stopCoordinates: [
        { name: "Jaggampeta", lat: 17.015, lng: 82.025 },
        { name: "Nagaram", lat: 17.045, lng: 82.065 },
        { name: "Surrampalem", lat: 17.075, lng: 82.095 },
      ],
      distance: 12.5,
      estimatedDuration: 25,
      isActive: true,
      isReversible: true,
      morningCutoff: "12:01",
    },
    {
      routeName: "Kakinada-Rajahmundry",
      stops: ["Kakinada", "Samarlakota", "Peddapuram", "Rajahmundry"],
      stopCoordinates: [
        { name: "Kakinada", lat: 16.943, lng: 82.240 },
        { name: "Samarlakota", lat: 17.050, lng: 82.170 },
        { name: "Peddapuram", lat: 17.077, lng: 82.138 },
        { name: "Rajahmundry", lat: 17.000, lng: 81.780 },
      ],
      distance: 45.0,
      estimatedDuration: 60,
      isActive: true,
      isReversible: true,
      morningCutoff: "12:01",
    },
    {
      routeName: "Amalapuram-Razole",
      stops: ["Amalapuram", "Mummidivaram", "Razole"],
      stopCoordinates: [
        { name: "Amalapuram", lat: 16.578, lng: 82.006 },
        { name: "Mummidivaram", lat: 16.620, lng: 81.950 },
        { name: "Razole", lat: 16.660, lng: 81.890 },
      ],
      distance: 18.0,
      estimatedDuration: 30,
      isActive: true,
      isReversible: true,
      morningCutoff: "12:01",
    },
  ]).onConflictDoNothing();

  // ─── Buses ───
  await db.insert(buses).values([
    { busId: "BUS101", busNumber: "AP05-1234", plateNumber: "AP05-1234", capacity: 60, routeId: 1, status: "inactive", isActive: true },
    { busId: "BUS102", busNumber: "AP05-5678", plateNumber: "AP05-5678", capacity: 50, routeId: 2, status: "inactive", isActive: true },
    { busId: "BUS103", busNumber: "AP05-9012", plateNumber: "AP05-9012", capacity: 55, routeId: 3, status: "inactive", isActive: true },
  ]).onConflictDoNothing();

  // ─── Students (users) ───
  const studentPassword = await bcrypt.hash("student123", 10);
  await db.insert(users).values([
    { name: "Student One", email: "student1@college.com", password: studentPassword, role: "student", phone: "9988776655", village: "Nagaram", assignedBusId: "BUS101", boardingStop: "Nagaram", studentId: "STU001" },
    { name: "Student Two", email: "student2@college.com", password: studentPassword, role: "student", phone: "9988776656", village: "Surrampalem", assignedBusId: "BUS101", boardingStop: "Surrampalem", studentId: "STU002" },
  ]).onConflictDoNothing();

  console.log("✅ Database seeded successfully!");
  console.log("\n📋 Test Accounts:");
  console.log("   Admin:   admin@bustrack.com / admin123");
  console.log("   Driver:  ramesh@bustrack.com / driver123");
  console.log("   Student: student1@college.com / student123");
}

seed()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .then(() => process.exit(0));
