const BASE_URL = "http://localhost:3000";

async function runTest() {
  console.log("🧪 Starting Alerts and Notifications Flow Verification...\n");

  try {
    // 1. Log in as Driver
    console.log("🔑 Logging in as Driver (Ramesh)...");
    const driverLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "ramesh@bustrack.com",
        password: "driver123",
        role: "driver"
      })
    });
    if (!driverLoginRes.ok) throw new Error(`Driver login failed: ${driverLoginRes.status}`);
    const driverData = await driverLoginRes.json();
    const driverToken = driverData.token;
    console.log("✅ Driver logged in successfully.");

    // 2. Log in as Admin
    console.log("🔑 Logging in as Admin...");
    const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@bustrack.com",
        password: "admin123",
        role: "admin"
      })
    });
    if (!adminLoginRes.ok) throw new Error(`Admin login failed: ${adminLoginRes.status}`);
    const adminData = await adminLoginRes.json();
    const adminToken = adminData.token;
    console.log("✅ Admin logged in successfully.");

    // 3. Log in as Student
    console.log("🔑 Logging in as Student (student1)...");
    const studentLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "student1@college.com",
        password: "student123",
        role: "student"
      })
    });
    if (!studentLoginRes.ok) throw new Error(`Student login failed: ${studentLoginRes.status}`);
    const studentData = await studentLoginRes.json();
    const studentToken = studentData.token;
    console.log("✅ Student logged in successfully.\n");

    // 4. Post an Emergency Alert as Driver
    console.log("🚨 Posting Emergency Alert as Driver for BUS101...");
    const postAlertRes = await fetch(`${BASE_URL}/api/alerts`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${driverToken}`
      },
      body: JSON.stringify({
        busId: "BUS101",
        category: "breakdown",
        reason: "Engine failure near main gate",
        lat: 17.015,
        lng: 82.025
      })
    });
    if (!postAlertRes.ok) throw new Error(`Posting alert failed: ${postAlertRes.status}`);
    const alertResData = await postAlertRes.json();
    const alertId = alertResData.alert.id;
    console.log(`✅ Alert posted successfully! Alert ID: ${alertId}`);
    console.log(`   Title: ${alertResData.alert.title}`);
    console.log(`   Message: ${alertResData.alert.message}\n`);

    // 5. Get Alerts as Student and verify deduplication
    console.log("📋 Fetching Alerts as Student...");
    const studentAlertsRes = await fetch(`${BASE_URL}/api/alerts`, {
      headers: { "Authorization": `Bearer ${studentToken}` }
    });
    if (!studentAlertsRes.ok) throw new Error(`Student alerts fetch failed: ${studentAlertsRes.status}`);
    const studentAlerts = await studentAlertsRes.json();
    console.log(`✅ Student received ${studentAlerts.length} alert(s).`);
    const myAlert = studentAlerts.find((a: any) => a.id === alertId || a.message.includes("Engine failure"));
    if (myAlert) {
      console.log(`   Found matching alert: ID=${myAlert.id}, resolvedAt=${myAlert.resolvedAt}`);
    } else {
      console.log("❌ Could not find matching alert for the student!");
    }

    // Verify there are no duplicate alerts (matching title and message)
    const duplicates = studentAlerts.filter((a: any) => a.title === alertResData.alert.title && a.message === alertResData.alert.message);
    console.log(`   Duplicates count: ${duplicates.length} (should be 1)`);
    if (duplicates.length > 1) {
      console.log("❌ Deduplication check failed! Found multiple copies.");
    } else {
      console.log("✅ Deduplication check passed.");
    }
    console.log("");

    // 6. Get Alerts as Admin
    console.log("📋 Fetching Alerts as Admin...");
    const adminAlertsRes = await fetch(`${BASE_URL}/api/alerts`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    if (!adminAlertsRes.ok) throw new Error(`Admin alerts fetch failed: ${adminAlertsRes.status}`);
    const adminAlerts = await adminAlertsRes.json();
    console.log(`✅ Admin received ${adminAlerts.length} alert(s).\n`);

    // 7. Resolve the Alert as Admin
    console.log(`🔧 Resolving Alert ID ${alertId} as Admin...`);
    const resolveAlertRes = await fetch(`${BASE_URL}/api/alerts`, {
      method: "PATCH",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        id: alertId,
        resolved: true
      })
    });
    if (!resolveAlertRes.ok) throw new Error(`Resolving alert failed: ${resolveAlertRes.status}`);
    const resolveData = await resolveAlertRes.json();
    console.log(`✅ Alert resolved successfully in DB. resolvedAt: ${resolveData.resolvedAt}\n`);

    // 8. Fetch Alerts as Student again to confirm resolved status (turned green / resolvedAt is populated)
    console.log("📋 Fetching Alerts as Student again to confirm resolution status...");
    const updatedStudentAlertsRes = await fetch(`${BASE_URL}/api/alerts`, {
      headers: { "Authorization": `Bearer ${studentToken}` }
    });
    if (!updatedStudentAlertsRes.ok) throw new Error(`Updated student alerts fetch failed: ${updatedStudentAlertsRes.status}`);
    const updatedStudentAlerts = await updatedStudentAlertsRes.json();
    const updatedMyAlert = updatedStudentAlerts.find((a: any) => a.message.includes("Engine failure"));
    if (updatedMyAlert && updatedMyAlert.resolvedAt) {
      console.log(`✅ Success! Student's alert is marked resolved. resolvedAt: ${updatedMyAlert.resolvedAt}`);
    } else {
      console.log("❌ Student's alert does not reflect resolved status!");
    }

  } catch (error: any) {
    console.error("❌ Test encountered an error:", error.message);
  }
}

runTest();

export {};
