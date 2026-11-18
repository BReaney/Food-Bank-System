import express from "express";
import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { currentAccount, requireRole, requireUser } from "../security/sessions.js";
import { buildPageInfo, parseRosterQuery } from "../utils/rosterPagination.js";

// Read-only staff view: existing tables are the source of truth.
// Viewing/searching student records is audited; no contact details or
// search phrases are written to audit JSON.
export const staffRecordsRouter = express.Router();
staffRecordsRouter.use(requireUser, requireRole("staff"));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rollback(client: PoolClient): Promise<void> {
  try { await client.query("ROLLBACK"); }
  catch (error) { console.error("Staff records rollback failed:", error); }
}

// Dedicated search API, rather than combining private data in the browser.
// Literal, case-insensitive matching; bounded results and stable pagination.
staffRecordsRouter.get("/", async (req, res) => {
  const page = parseRosterQuery(req.query);
  if (!page) {
    res.status(400).json({ error: "Use limit 1-100, offset 0-1000000, and search up to 100 characters" });
    return;
  }
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const filter = [
      "FROM profiles AS p WHERE p.role = 'student'",
      "AND ($1::text = ''",
      " OR strpos(lower(p.email), lower($1)) > 0",
      " OR strpos(lower(concat_ws(' ', p.first_name, p.last_name)), lower($1)) > 0)"
    ].join("\n");
    const count = await client.query<{ total: number }>(
      "SELECT count(*)::integer AS total " + filter, [page.search]
    );
    const students = await client.query(
      [
        "SELECT p.id, p.email, p.first_name, p.last_name",
        filter,
        "ORDER BY lower(p.last_name), lower(p.first_name), lower(p.email), p.id",
        "LIMIT $2 OFFSET $3"
      ].join("\n"),
      [page.search, page.limit, page.offset]
    );
    await client.query(
      "INSERT INTO audit_logs (actor_id, action, target_type, details) " +
      "VALUES ($1, 'staff_records_searched', 'student_directory', " +
      "jsonb_build_object('filtered', $2::boolean, 'resultCount', $3::integer))",
      [currentAccount(req).id, page.search.length > 0, count.rows[0].total]
    );
    await client.query("COMMIT");
    res.json({
      students: students.rows,
      pagination: buildPageInfo(page, count.rows[0].total, students.rows.length)
    });
  } catch (error) {
    if (client) await rollback(client);
    console.error("Staff records search failed:", error);
    res.status(500).json({ error: "Unable to search student records" });
  } finally {
    client?.release();
  }
});

// Single student record. Appointments are paginated so a many-term student
// history remains readable without silently dropping older bookings.
staffRecordsRouter.get("/:studentId", async (req, res) => {
  const studentId = req.params.studentId;
  const page = parseRosterQuery(req.query);
  if (typeof studentId !== "string" || !UUID.test(studentId)) {
    res.status(400).json({ error: "A valid student ID is required" });
    return;
  }
  if (!page || page.search !== "") {
    res.status(400).json({ error: "Use limit 1-100 and offset 0-1000000 for appointment history" });
    return;
  }

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const profileResult = await client.query(
      "SELECT id, first_name, last_name, email, created_at " +
      "FROM profiles WHERE id = $1 AND role = 'student'",
      [studentId]
    );
    const student = profileResult.rows[0];
    if (!student) {
      await rollback(client);
      res.status(404).json({ error: "Student record not found" });
      return;
    }

    // All terms show independent enrollment and survey status. An absent
    // verification row is distinguished from an explicit pending decision.
    const terms = await client.query(
      [
        "SELECT t.id, t.code, t.name, t.starts_on, t.ends_on,",
        "v.status AS enrollment_status, v.verified_at,",
        "s.submitted_at AS survey_submitted_at",
        "FROM terms AS t",
        "LEFT JOIN enrollment_verifications AS v",
        "  ON v.term_id = t.id AND v.student_id = $1",
        "LEFT JOIN eligibility_surveys AS s",
        "  ON s.term_id = t.id AND s.student_id = $1",
        "ORDER BY t.starts_on DESC, t.id"
      ].join("\n"), [studentId]
    );
    const enrollmentEvents = await client.query(
      [
        "SELECT id, term_id, previous_status, new_status, occurred_at",
        "FROM enrollment_verification_events",
        "WHERE student_id = $1",
        "ORDER BY occurred_at DESC, id DESC"
      ].join("\n"), [studentId]
    );

    const bookingCount = await client.query<{ total: number }>(
      "SELECT count(*)::integer AS total FROM bookings WHERE student_id = $1",
      [studentId]
    );
    const bookings = await client.query(
      [
        "SELECT b.id, b.status, b.week_start, b.booked_at, b.cancelled_at,",
        "s.starts_at, s.ends_at, t.id AS term_id,",
        "t.code AS term_code, t.name AS term_name,",
        "b.pickup_kind,",
        "COALESCE(d.full_name, c.full_name) AS pickup_name",
        "FROM bookings AS b",
        "JOIN appointment_slots AS s ON s.id = b.slot_id",
        "JOIN terms AS t ON t.id = s.term_id",
        "LEFT JOIN dependent_requests AS d ON d.id = b.pickup_dependent_id",
        "LEFT JOIN pickup_contacts AS c ON c.id = b.pickup_contact_id",
        "WHERE b.student_id = $1",
        "ORDER BY s.starts_at DESC, b.booked_at DESC, b.id DESC",
        "LIMIT $2 OFFSET $3"
      ].join("\n"), [studentId, page.limit, page.offset]
    );
    const bookingIds = bookings.rows.map((row: { id: string }) => row.id);
    const bookingEvents = await client.query(
      [
        "SELECT booking_id, id, event_type, occurred_at",
        "FROM booking_events",
        "WHERE booking_id = ANY($1::uuid[])",
        "ORDER BY occurred_at ASC, id ASC"
      ].join("\n"), [bookingIds]
    );

    // Only active registered contacts are shown. Removed records are not
    // reinstated; appointment status/history remains intact.
    const dependents = await client.query(
      [
        "SELECT id, full_name, relationship, status,",
        "created_at, reviewed_at",
        "FROM dependent_requests",
        "WHERE student_id = $1 AND removed_at IS NULL",
        "ORDER BY created_at DESC, id DESC"
      ].join("\n"), [studentId]
    );
    const contacts = await client.query(
      [
        "SELECT id, full_name, contact_method, contact_value,",
        "status, consent_given_at, created_at, reviewed_at",
        "FROM pickup_contacts",
        "WHERE student_id = $1 AND removed_at IS NULL",
        "ORDER BY created_at DESC, id DESC"
      ].join("\n"), [studentId]
    );

    // A successful record read must have an audit entry. Never log actual
    // survey responses, names, emails, phone numbers, or consent text.
    await client.query(
      "INSERT INTO audit_logs (actor_id, action, target_type, target_id, details) " +
      "VALUES ($1, 'staff_student_record_viewed', 'student', $2, " +
      "jsonb_build_object('appointmentOffset', $3::integer))",
      [currentAccount(req).id, studentId, page.offset]
    );
    await client.query("COMMIT");

    const eventsByBooking = new Map<string, unknown[]>();
    for (const event of bookingEvents.rows) {
      const list = eventsByBooking.get(event.booking_id) ?? [];
      list.push({
        id: event.id,
        event_type: event.event_type,
        occurred_at: event.occurred_at
      });
      eventsByBooking.set(event.booking_id, list);
    }
    res.json({
      student,
      terms: terms.rows,
      enrollmentEvents: enrollmentEvents.rows,
      appointments: bookings.rows.map((row: { id: string }) => ({
        ...row,
        events: eventsByBooking.get(row.id) ?? []
      })),
      appointmentsPagination: buildPageInfo(
        page, bookingCount.rows[0].total, bookings.rows.length
      ),
      dependents: dependents.rows,
      contacts: contacts.rows
    });
  } catch (error) {
    if (client) await rollback(client);
    console.error("Staff student record failed:", error);
    res.status(500).json({ error: "Unable to retrieve student record" });
  } finally {
    client?.release();
  }
});
