import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { complaints, users, admins } from "@/db/schema";
import { verifyToken } from "@/utils/jwt";

let complaintsTableReady = false;

async function ensureComplaintsTable() {
  if (complaintsTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaints (
      id SERIAL PRIMARY KEY,
      student_id INTEGER REFERENCES users(id) NOT NULL,
      reason VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      status VARCHAR(50) DEFAULT 'pending' NOT NULL,
      admin_explanation TEXT,
      resolved_by INTEGER REFERENCES admins(id),
      resolved_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  complaintsTableReady = true;
}

function getToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

export async function GET(req: NextRequest) {
  try {
    await ensureComplaintsTable();
    const payload = verifyToken(getToken(req));
    if (!payload) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (payload.role === "admin") {
      // Admins get all complaints, with student details
      const rows = await db
        .select({
          id: complaints.id,
          studentId: complaints.studentId,
          reason: complaints.reason,
          description: complaints.description,
          status: complaints.status,
          adminExplanation: complaints.adminExplanation,
          resolvedAt: complaints.resolvedAt,
          createdAt: complaints.createdAt,
          studentName: users.name,
          studentEmail: users.email,
          studentRollNumber: users.studentId,
        })
        .from(complaints)
        .leftJoin(users, eq(complaints.studentId, users.id))
        .orderBy(desc(complaints.createdAt));
      return NextResponse.json(rows);
    } else if (payload.role === "student") {
      // Students only get their own complaints
      const rows = await db
        .select({
          id: complaints.id,
          studentId: complaints.studentId,
          reason: complaints.reason,
          description: complaints.description,
          status: complaints.status,
          adminExplanation: complaints.adminExplanation,
          resolvedAt: complaints.resolvedAt,
          createdAt: complaints.createdAt,
        })
        .from(complaints)
        .where(eq(complaints.studentId, payload.id))
        .orderBy(desc(complaints.createdAt));
      return NextResponse.json(rows);
    } else {
      return NextResponse.json({ error: "Forbidden role" }, { status: 403 });
    }
  } catch (error) {
    console.error("Complaints GET error:", error);
    return NextResponse.json({ error: "Failed to load complaints" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureComplaintsTable();
    const payload = verifyToken(getToken(req));
    if (!payload || payload.role !== "student") {
      return NextResponse.json({ error: "Student access required" }, { status: 403 });
    }

    const { reason, description } = await req.json();
    if (!reason || !description) {
      return NextResponse.json({ error: "Reason and description are required" }, { status: 400 });
    }

    const [inserted] = await db
      .insert(complaints)
      .values({
        studentId: payload.id,
        reason: String(reason).trim(),
        description: String(description).trim(),
        status: "pending",
      })
      .returning();

    return NextResponse.json(inserted);
  } catch (error) {
    console.error("Complaints POST error:", error);
    return NextResponse.json({ error: "Failed to submit complaint" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureComplaintsTable();
    const payload = verifyToken(getToken(req));
    if (!payload || payload.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id, adminExplanation, status } = await req.json();
    if (!id) {
      return NextResponse.json({ error: "Complaint ID is required" }, { status: 400 });
    }

    const [updated] = await db
      .update(complaints)
      .set({
        status: status || "resolved",
        adminExplanation: adminExplanation ? String(adminExplanation).trim() : null,
        resolvedBy: payload.id,
        resolvedAt: new Date(),
      })
      .where(eq(complaints.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Complaint not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Complaints PATCH error:", error);
    return NextResponse.json({ error: "Failed to resolve complaint" }, { status: 500 });
  }
}
