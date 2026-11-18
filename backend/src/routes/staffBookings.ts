import express from "express";
import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { requireUser, requireRole, currentAccount } from "../security/sessions.js";
import { parseRosterQuery, buildPageInfo } from "../utils/rosterPagination.js";

export const staffBookingsRouter = express.Router();
staffBookingsRouter.use(requireUser, requireRole("staff"));

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

staffBookingsRouter.get("/", async (req, res) => {
  const pagination = parseRosterQuery(req.query);
  const termId = req.query.termId ?? "";
  const status = req.query.status ?? "booked";

  if (!pagination || typeof termId !== "string" ||
      (termId !== "" && !uuidPattern.test(termId)) ||
      (typeof status !== "string" || ![
        "booked", "needs_review", "completed", "no_show", "cancelled", "all"
      ].includes(status))) {
    res.status(400).json({
      error: "Invalid booking filters; use termId, status, search, limit and offset"
    });
    return;
  }

  try {
    // Student identities are returned only through the staff-authorized route.
    // The default shows all UPCOMING booked appointments, across all students.
    const filters = [
      "FROM bookings AS b",
      "JOIN profiles AS p ON p.id = b.student_id",
      "JOIN appointment_slots AS s ON s.id = b.slot_id",
      "JOIN terms AS t ON t.id = s.term_id",
      "LEFT JOIN dependent_requests AS d ON d.id = b.pickup_dependent_id",
      "LEFT JOIN pickup_contacts AS c ON c.id = b.pickup_contact_id",
      "WHERE p.role = 'student'",
      "AND ($1::uuid IS NULL OR t.id = $1::uuid)",
      "AND (",
      "  $2::text = '' OR",
      "  strpos(lower(p.email), lower($2)) > 0 OR",
      "  strpos(lower(concat_ws(' ', p.first_name, p.last_name)), lower($2)) > 0",
      ")",
      "AND (",
      "  ($3::text = 'booked' AND b.status = 'booked' AND s.starts_at >= NOW())",
      "  OR ($3::text = 'needs_review' AND b.status = 'booked' AND s.ends_at <= NOW())",
      "  OR ($3::text IN ('completed','no_show','cancelled') AND b.status = $3::text)",
      "  OR $3::text = 'all'",
      ")"
    ].join("\n");

    const values = [termId || null, pagination.search, status];
    const [countResult, bookingsResult] = await Promise.all([
      pool.query<{ total: number }>(
        "SELECT count(*)::integer AS total " + filters, values
      ),
      pool.query(
        [
          "SELECT b.id, b.student_id, b.slot_id, b.status, b.week_start, b.booked_at,",
          "b.cancelled_at, s.starts_at, s.ends_at, b.pickup_kind,",
          "COALESCE(d.full_name,c.full_name) AS pickup_name,",
          "COALESCE(d.status,c.status) AS pickup_status,",
          "c.consent_given_at AS pickup_consent_at,",
          "p.email, p.first_name, p.last_name, t.code AS term_code, t.name AS term_name",
          filters,
          "ORDER BY",
          " CASE WHEN $3::text = 'booked' THEN s.starts_at END ASC,",
          " CASE WHEN $3::text = 'needs_review' THEN s.ends_at END DESC,",
          " CASE WHEN $3::text IN ('completed','no_show','cancelled','all')",
          "   THEN s.starts_at END DESC,",
          " b.id",
          "LIMIT $4 OFFSET $5"
        ].join("\n"),
        [...values, pagination.limit, pagination.offset]
      )
    ]);

    res.set("Cache-Control", "no-store");
    res.json({
      bookings: bookingsResult.rows,
      pagination: buildPageInfo(
        pagination, countResult.rows[0].total, bookingsResult.rows.length
      )
    });
  } catch (error) {
    console.error("Unable to load staff bookings:", error);
    res.status(500).json({ error: "Unable to retrieve staff appointments" });
  }
});


// Staff-only outcome recording. The existing unique weekly booking index
// continues to include completed and missed bookings. The transaction
// serializes behind the slot row, like staff closure and student changes.
staffBookingsRouter.post("/:bookingId/outcome", async (req, res) => {
  const id = req.params.bookingId;
  const outcome: unknown = req.body?.outcome;
  if (typeof id !== "string" || !uuidPattern.test(id) ||
      (outcome !== "completed" && outcome !== "no_show")) {
    res.status(400).json({
      error: "Valid booking ID and outcome (completed or no_show) required"
    });
    return;
  }

  const actorId = currentAccount(req).id;
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // Choose lock order using an initial read, then recheck the row
    // while it is locked. In particular, a reschedule can change slot_id.
    const original = await client.query<{ slot_id: string }>(
      "SELECT slot_id FROM bookings WHERE id=$1", [id]
    );
    if (!original.rows[0]) {
      res.status(404).json({ error: "Booking not found" });
      await client.query("ROLLBACK");
      return;
    }

    await client.query(
      "SELECT id FROM appointment_slots WHERE id=$1 FOR UPDATE",
      [original.rows[0].slot_id]
    );

    const record = await client.query<{
      slot_id: string; status: string; ends_at: Date;
    }>(
      `SELECT b.slot_id, b.status, s.ends_at
       FROM bookings AS b
       JOIN appointment_slots AS s ON s.id=b.slot_id
       WHERE b.id=$1 FOR UPDATE OF b`,
      [id]
    );
    const booking = record.rows[0];
    if (!booking) {
      res.status(404).json({ error: "Booking not found" });
      await client.query("ROLLBACK");
      return;
    }
    if (booking.slot_id !== original.rows[0].slot_id ||
        booking.status !== "booked") {
      res.status(409).json({
        error: "Only an unchanged active booking can be marked; refresh and try again"
      });
      await client.query("ROLLBACK");
      return;
    }
    if (booking.ends_at.getTime() > Date.now()) {
      res.status(422).json({
        error: "Wait until the scheduled appointment has ended before recording its outcome"
      });
      await client.query("ROLLBACK");
      return;
    }

    const updated = await client.query<{ id: string; status: string }>(
      "UPDATE bookings SET status=$1 WHERE id=$2 AND status='booked' " +
      "RETURNING id,status",
      [outcome, id]
    );
    if (updated.rows.length !== 1) {
      throw new Error("Booking outcome changed during transaction");
    }

    // Write staff audit and private booking-event history atomically.
    // Deliberately exclude names and contact details from JSON logs.
    await client.query(
      `INSERT INTO booking_events (booking_id,actor_id,event_type,event_data)
       VALUES ($1,$2,$3,
         jsonb_build_object('recorded_by','staff','slot_id',$4::text))`,
      [id, actorId, outcome, booking.slot_id]
    );
    await client.query(
      `INSERT INTO audit_logs
        (actor_id,action,target_type,target_id,details)
       VALUES ($1,'booking_outcome_recorded','booking',$2,
         jsonb_build_object('outcome',$3::text))`,
      [actorId, id, outcome]
    );

    await client.query("COMMIT");
    res.json({
      booking: { id: updated.rows[0].id, status: updated.rows[0].status },
      message: outcome === "completed"
        ? "Appointment marked completed"
        : "Appointment marked no-show"
    });
  } catch (error) {
    if (client) {
      try { await client.query("ROLLBACK"); }
      catch (rollbackError) {
        console.error("Staff outcome rollback failed:", rollbackError);
      }
    }
    console.error("Staff appointment outcome failed:", error);
    res.status(500).json({ error: "Unable to record appointment outcome" });
  } finally {
    client?.release();
  }
});
