const BASE_URL = "http://localhost:3000";

async function runTest() {
  console.log("🧪 Starting Complaints & Tickets Flow Verification...\n");

  try {
    // 1. Log in as Student
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
    console.log("✅ Student logged in successfully.");

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
    console.log("✅ Admin logged in successfully.\n");

    // 3. Submit a Complaint as Student
    console.log("✍️ Submitting a Complaint as Student...");
    const submitRes = await fetch(`${BASE_URL}/api/complaints`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${studentToken}`
      },
      body: JSON.stringify({
        reason: "Delayed Departure",
        description: "Bus BUS101 departed 15 minutes late from Nagaram stop this morning."
      })
    });
    if (!submitRes.ok) throw new Error(`Submitting complaint failed: ${submitRes.status}`);
    const submittedComplaint = await submitRes.json();
    const complaintId = submittedComplaint.id;
    console.log(`✅ Complaint submitted successfully! ID: ${complaintId}`);
    console.log(`   Reason: ${submittedComplaint.reason}`);
    console.log(`   Description: ${submittedComplaint.description}\n`);

    // 4. Get complaints as Student
    console.log("📋 Fetching Complaints as Student...");
    const getStudentComplaintsRes = await fetch(`${BASE_URL}/api/complaints`, {
      headers: { "Authorization": `Bearer ${studentToken}` }
    });
    if (!getStudentComplaintsRes.ok) throw new Error(`Student complaints fetch failed: ${getStudentComplaintsRes.status}`);
    const studentComplaints = await getStudentComplaintsRes.json();
    console.log(`✅ Student received ${studentComplaints.length} complaint(s).`);
    const myComplaint = studentComplaints.find((c: any) => c.id === complaintId);
    if (myComplaint) {
      console.log(`   Found matching ticket: ID=${myComplaint.id}, status=${myComplaint.status}`);
    } else {
      console.log("❌ Could not find matching ticket for the student!");
    }
    console.log("");

    // 5. Get complaints as Admin
    console.log("📋 Fetching Complaints as Admin...");
    const getAdminComplaintsRes = await fetch(`${BASE_URL}/api/complaints`, {
      headers: { "Authorization": `Bearer ${adminToken}` }
    });
    if (!getAdminComplaintsRes.ok) throw new Error(`Admin complaints fetch failed: ${getAdminComplaintsRes.status}`);
    const adminComplaints = await getAdminComplaintsRes.json();
    console.log(`✅ Admin received ${adminComplaints.length} complaint(s) in total.`);
    const myAdminComplaint = adminComplaints.find((c: any) => c.id === complaintId);
    if (myAdminComplaint) {
      console.log(`   Found student's ticket in Admin list:`);
      console.log(`     Student Name: ${myAdminComplaint.studentName}`);
      console.log(`     Student Email: ${myAdminComplaint.studentEmail}`);
      console.log(`     Student Roll No: ${myAdminComplaint.studentRollNumber}`);
    } else {
      console.log("❌ Admin list is missing the student's ticket!");
    }
    console.log("");

    // 6. Resolve complaint as Admin
    console.log(`🔧 Resolving Complaint ID ${complaintId} as Admin...`);
    const resolveRes = await fetch(`${BASE_URL}/api/complaints`, {
      method: "PATCH",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        id: complaintId,
        adminExplanation: "Checked logs. Driver held bus for a connecting train passenger. We have instructed him to prioritize departure schedule.",
        status: "resolved"
      })
    });
    if (!resolveRes.ok) throw new Error(`Resolving complaint failed: ${resolveRes.status}`);
    const resolvedComplaint = await resolveRes.json();
    console.log(`✅ Complaint resolved successfully! Status: ${resolvedComplaint.status}`);
    console.log(`   Explanation: ${resolvedComplaint.adminExplanation}\n`);

    // 7. Verify resolved complaint as Student
    console.log("📋 Re-fetching Complaints as Student...");
    const getStudentComplaintsRes2 = await fetch(`${BASE_URL}/api/complaints`, {
      headers: { "Authorization": `Bearer ${studentToken}` }
    });
    const studentComplaints2 = await getStudentComplaintsRes2.json();
    const myComplaint2 = studentComplaints2.find((c: any) => c.id === complaintId);
    if (myComplaint2 && myComplaint2.status === "resolved") {
      console.log(`✅ Success! Student's ticket reflects resolved state.`);
      console.log(`   Admin Explanation: ${myComplaint2.adminExplanation}`);
    } else {
      console.log("❌ Student's ticket does not reflect resolved state!");
    }

  } catch (error: any) {
    console.error("❌ Test encountered an error:", error.message);
  }
}

runTest();

export {};
