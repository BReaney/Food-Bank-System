import express from "express";
import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { currentAccount, requireRole, requireUser } from "../security/sessions.js";

export const staffRouter = express.Router();
staffRouter.use(requireUser, requireRole("staff"));

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// Existing basic staff-only directory (no sensitive survey answers).
staffRouter.get("/profiles", async (_req, res) => {
  const result = await pool.query(
    "SELECT id, email, first_name, last_name, role " +
    "FROM profiles WHERE role = 'student' " +
    "ORDER BY last_name, first_name LIMIT 100"
  );
  res.json({ students: result.rows });
});

// Show student enrollment and survey completion for exactly one selected term.
// The staff roster is paginated and supports a bounded name/email search.
staffRouter.get("/enrollment", async (req, res) => {
  const termId = req.query.termId;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const offsetRaw = req.query.offset;
  const offset = offsetRaw === undefined ? 0 : Number(offsetRaw);
  if (!isUuid(termId) || search.length > 100 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    res.status(400).json({ error: "Valid termId, search and offset are required" });
    return;
  }

  try {
    const term = await pool.query<{ id: string }>(
      "SELECT id FROM terms WHERE id = $1", [termId]
    );
    if (!term.rows[0]) {
      res.status(404).json({ error: "Term not found" });
      return;
    }

    const sql = [
      "SELECT p.id, p.email, p.first_name, p.last_name,",
      "COALESCE(ev.status, 'pending') AS enrollment_status,",
      "ev.verified_at, (es.student_id IS NOT NULL) AS survey_submitted,",
      "es.submitted_at AS survey_submitted_at",
      "FROM profiles AS p",
      "LEFT JOIN enrollment_verifications AS ev",
      "ON ev.student_id = p.id AND ev.term_id = $1",
      "LEFT JOIN eligibility_surveys AS es",
      "ON es.student_id = p.id AND es.term_id = $1",
      "WHERE p.role = 'student'",
      "AND (p.email ILIKE $2 OR p.first_name ILIKE $2 OR p.last_name ILIKE $2)",
      "ORDER BY p.last_name, p.first_name, p.id",
      "LIMIT 51 OFFSET $3"
    ].join(" ");
    const students = await pool.query(sql, [termId, "%" + search + "%", offset]);
    const hasMore = students.rows.length > 50;
    res.json({
      students: students.rows.slice(0, 50),
      nextOffset: hasMore ? offset + 50 : null
    });
  } catch (error) {
    console.error("Unable to retrieve enrollment roster:", error);
    res.status(500).json({ error: "Unable to retrieve enrollment roster" });
  }
});

// Independently verify or reject enrollment. No email or student-supplied
// field can grant this permission; only the staff session can call this.
// Staff actions and the previous/new status are recorded in audit_logs.
staffRouter.patch("/enrollment/:studentId", async (req, res) => {
  const studentId = req.params.studentId;
  const termId: unknown = req.body?.termId;
  const status: unknown = req.body?.status;

  if (!isUuid(studentId) || !isUuid(termId) ||
      !["pending", "verified", "rejected"].includes(String(status))) {
    res.status(400).json({ error: "Valid student, term and enrollment status required" });
    return;
  }

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // Serialize changes for this student, even when no term record exists.
    const student = await client.query<{ id: string }>(
      "SELECT id FROM profiles WHERE id = $1 AND role = 'student' FOR UPDATE",
      [studentId]
    );
    if (!student.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Student not found" });
      return;
    }
    const term = await client.query<{ id: string }>(
      "SELECT id FROM terms WHERE id = $1", [termId]
    );
    if (!term.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Term not found" });
      return;
    }

    const previous = await client.query<{ status: string }>(
      "SELECT status FROM enrollment_verifications " +
      "WHERE student_id = $1 AND term_id = $2",
      [studentId, termId]
    );
    const oldStatus = previous.rows[0]?.status ?? "pending";
    const staffId = currentAccount(req).id;
    const reviewed = status !== "pending";

    const saved = await client.query(
      "INSERT INTO enrollment_verifications " +
      "(student_id, term_id, status, verified_by, verified_at) " +
      "VALUES ($1, $2, $3, $4, $5) " +
      "ON CONFLICT (student_id, term_id) DO UPDATE SET " +
      "status = EXCLUDED.status, verified_by = EXCLUDED.verified_by, " +
      "verified_at = EXCLUDED.verified_at " +
      "RETURNING student_id, term_id, status, verified_at",
      [studentId, termId, status, reviewed ? staffId : null,
        status === "verified" ? new Date() : null]
    );

    await client.query(
      "INSERT INTO audit_logs " +
      "(actor_id, action, target_type, target_id, details) " +
      "VALUES ($1, 'enrollment_status_changed', 'enrollment_verifications', $2, " +
      "jsonb_build_object('term_id', $3::text, 'previous_status', $4::text, 'new_status', $5::text))",
      [staffId, studentId, termId, oldStatus, status]
    );

    await client.query("COMMIT");
    res.json({ verification: saved.rows[0] });
  } catch (error) {
    if (client) {
      try { await client.query("ROLLBACK"); }
      catch (rollbackError) { console.error("Rollback failed:", rollbackError); }
    }
    console.error("Failed to update enrollment:", error);
    res.status(500).json({ error: "Unable to update enrollment" });
  } finally {
    client?.release();
  }
});
