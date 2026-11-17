import express from "express";
import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { currentAccount, requireRole, requireUser } from "../security/sessions.js";
import { buildPageInfo, parseRosterQuery } from "../utils/rosterPagination.js";

export const enrollmentStaffRouter = express.Router();
enrollmentStaffRouter.use(requireUser, requireRole("staff"));

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Status = "pending" | "verified" | "rejected";

interface EnrollmentRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  enrollment_status: Status;
  survey_submitted_at: string | null;
  verified_at: string | null;
}

// Staff view is restricted to a chosen term and shows survey and
// independent enrollment-verification status side by side.
enrollmentStaffRouter.get("/", async (req, res) => {
  const termId = req.query.termId;
  const page = parseRosterQuery(req.query);
  if (typeof termId !== "string" || !uuidPattern.test(termId)) {
    res.status(400).json({ error: "A valid termId query parameter is required" });
    return;
  }
  if (!page) {
    res.status(400).json({
      error: "Use limit 1-100, offset 0-1000000, and search up to 100 characters"
    });
    return;
  }

  try {
    const termResult = await pool.query(
      "SELECT id, code, name, starts_on, ends_on FROM terms WHERE id = $1",
      [termId]
    );
    if (termResult.rowCount === 0) {
      res.status(404).json({ error: "Term not found" });
      return;
    }

    // The search is literal, case-insensitive substring matching.
    // strpos avoids treating % and _ as SQL wildcard characters.
    const [countResult, rosterResult] = await Promise.all([
      pool.query<{ total: number }>(
        `
        SELECT count(*)::integer AS total
        FROM profiles AS p
        WHERE p.role = 'student'
          AND (
            $1::text = ''
            OR strpos(lower(p.email), lower($1)) > 0
            OR strpos(lower(concat_ws(' ', p.first_name, p.last_name)), lower($1)) > 0
          )
        `,
        [page.search]
      ),
      pool.query<EnrollmentRow>(
        `
        SELECT p.id, p.email, p.first_name, p.last_name,
               COALESCE(v.status, 'pending') AS enrollment_status,
               v.verified_at, s.submitted_at AS survey_submitted_at
        FROM profiles AS p
        LEFT JOIN enrollment_verifications AS v
          ON v.student_id = p.id AND v.term_id = $1
        LEFT JOIN eligibility_surveys AS s
          ON s.student_id = p.id AND s.term_id = $1
        WHERE p.role = 'student'
          AND (
            $2::text = ''
            OR strpos(lower(p.email), lower($2)) > 0
            OR strpos(lower(concat_ws(' ', p.first_name, p.last_name)), lower($2)) > 0
          )
        ORDER BY lower(p.last_name), lower(p.first_name), lower(p.email), p.id
        LIMIT $3 OFFSET $4
        `,
        [termId, page.search, page.limit, page.offset]
      )
    ]);

    res.json({
      term: termResult.rows[0],
      students: rosterResult.rows,
      pagination: buildPageInfo(page, countResult.rows[0].total, rosterResult.rows.length)
    });
  } catch (error) {
    console.error("Failed to retrieve enrollment list:", error);
    res.status(500).json({ error: "Unable to load enrollment records" });
  }
});

// Staff decisions are transactional and create an immutable decision
// history event PLUS an audit log entry.
enrollmentStaffRouter.put("/:studentId/:termId", async (req, res) => {
  const { studentId, termId } = req.params;
  const status: unknown = req.body?.status;
  if (!uuidPattern.test(studentId ?? "") || !uuidPattern.test(termId ?? "") ||
      (typeof status !== "string" || !["pending", "verified", "rejected"].includes(status))) {
    res.status(400).json({ error: "Valid studentId, termId and status are required" });
    return;
  }

  const newStatus = status as Status;
  let client: PoolClient | undefined;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // Lock profile to serialize decisions by competing staff members
    // even if no enrollment record exists yet.
    const student = await client.query<{ id: string }>(
      "SELECT id FROM profiles WHERE id = $1 AND role = 'student' FOR UPDATE",
      [studentId]
    );
    if (student.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Student not found" });
      return;
    }

    const term = await client.query(
      "SELECT id FROM terms WHERE id = $1",
      [termId]
    );
    if (term.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Term not found" });
      return;
    }

    const before = await client.query<{ status: Status }>(
      "SELECT status FROM enrollment_verifications WHERE student_id = $1 AND term_id = $2",
      [studentId, termId]
    );
    const previousStatus = before.rows[0]?.status ?? null;
    if (previousStatus === newStatus) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Enrollment already has that status" });
      return;
    }

    await client.query(
      `
      INSERT INTO enrollment_verifications
        (student_id, term_id, status, verified_by, verified_at)
      VALUES ($1, $2, $3, $4, CASE WHEN $3 = 'verified' THEN NOW() ELSE NULL END)
      ON CONFLICT (student_id, term_id) DO UPDATE SET
        status = EXCLUDED.status,
        verified_by = EXCLUDED.verified_by,
        verified_at = EXCLUDED.verified_at
      `,
      [studentId, termId, newStatus, newStatus === "verified" ? currentAccount(req).id : null]
    );

    await client.query(
      `
      INSERT INTO enrollment_verification_events
        (student_id, term_id, actor_id, previous_status, new_status)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [studentId, termId, currentAccount(req).id, previousStatus, newStatus]
    );

    await client.query(
      `
      INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
      VALUES (
        $1, 'enrollment_status_changed', 'student', $2,
        jsonb_build_object(
          'termId', $3::text,
          'from', $4::text,
          'to', $5::text
        )
      )
      `,
      [currentAccount(req).id, studentId, termId, previousStatus, newStatus]
    );

    await client.query("COMMIT");
    res.json({ studentId, termId, status: newStatus });
  } catch (error) {
    if (client) {
      try { await client.query("ROLLBACK"); }
      catch (rollbackError) { console.error("Enrollment rollback failed:", rollbackError); }
    }
    console.error("Enrollment verification failed:", error);
    res.status(500).json({ error: "Unable to update enrollment status" });
  } finally {
    client?.release();
  }
});
