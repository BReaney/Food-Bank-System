import express from "express";
import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { currentAccount, requireRole, requireUser } from "../security/sessions.js";
import { parsePickupChoice, verifyPickupChoice, PickupRuleError } from "../utils/pickup.js";

// Each booking is owned by the authenticated student session.
export const bookingsRouter = express.Router();
bookingsRouter.use(requireUser, requireRole("student"));

class BookingRuleError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

interface LockedSlot {
  id: string;
  term_id: string;
  capacity: number;
  is_open: boolean;
  week_start: string;
  within_term: boolean;
  within_booking_window: boolean;
}

interface EligibilityCheck {
  enrollment_verified: boolean;
  survey_submitted: boolean;
}

// Retrieve only the current student's upcoming appointments.
bookingsRouter.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT b.id, b.slot_id, b.status, b.booked_at,
             b.pickup_kind, b.pickup_dependent_id, b.pickup_contact_id,
             COALESCE(d.full_name, c.full_name) AS pickup_name,
             s.starts_at, s.ends_at, s.term_id,
             t.cancellation_cutoff_hours,
             (s.starts_at >= NOW() + t.cancellation_cutoff_hours * INTERVAL '1 hour') AS can_modify
      FROM bookings AS b
      JOIN appointment_slots AS s ON s.id = b.slot_id
      JOIN terms AS t ON t.id = s.term_id
      LEFT JOIN dependent_requests AS d ON d.id = b.pickup_dependent_id
      LEFT JOIN pickup_contacts AS c ON c.id = b.pickup_contact_id
      WHERE b.student_id = $1
        AND b.status = 'booked'
        AND s.starts_at >= NOW()
      ORDER BY s.starts_at
      `,
      [currentAccount(req).id]
    );

    res.json({ bookings: result.rows });
  } catch (error) {
    console.error("Unable to retrieve bookings:", error);
    res.status(500).json({ error: "Unable to retrieve bookings" });
  }
});

// Create a booking using the student ID derived from the server-side session.
// The browser supplies only a slotId.
bookingsRouter.post("/", async (req, res) => {
  const slotId: unknown = req.body?.slotId;
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (typeof slotId !== "string" || !uuidPattern.test(slotId)) {
    res.status(400).json({ error: "A valid slotId is required" });
    return;
  }

  let client: PoolClient | undefined;

  try {
    client = await pool.connect();

    // All following queries use the SAME connection until COMMIT/ROLLBACK.
    await client.query("BEGIN");

    const student = currentAccount(req);

    // Serialize competing bookings for the same slot. The calendar week
    // is calculated from the slot's Vancouver-local start time, not the UI.
    const slotResult = await client.query<LockedSlot>(
      `
      SELECT s.id, s.term_id, s.capacity, s.is_open,
             to_char(
               date_trunc('week', s.starts_at AT TIME ZONE 'America/Vancouver'),
               'YYYY-MM-DD'
             ) AS week_start,
             (
               (s.starts_at AT TIME ZONE 'America/Vancouver')::date >= t.starts_on
               AND (s.ends_at AT TIME ZONE 'America/Vancouver')::date <= t.ends_on
             ) AS within_term,
             (
               s.starts_at >= NOW() + t.minimum_notice_days * INTERVAL '1 day'
               AND s.starts_at <= NOW() + t.maximum_notice_days * INTERVAL '1 day'
             ) AS within_booking_window
      FROM appointment_slots AS s
      JOIN terms AS t ON t.id = s.term_id
      WHERE s.id = $1
      FOR UPDATE OF s
      `,
      [slotId]
    );
    const slot = slotResult.rows[0];

    if (!slot) {
      throw new BookingRuleError(404, "Appointment slot not found");
    }
    if (!slot.is_open) {
      throw new BookingRuleError(409, "This appointment slot is closed");
    }
    if (!slot.within_term) {
      throw new BookingRuleError(422, "Appointment is outside its term dates");
    }
    if (!slot.within_booking_window) {
      throw new BookingRuleError(
        422,
        "Appointment is outside the allowed advance booking window"
      );
    }

    // Survey completion does not replace independent staff verification.
    const checkResult = await client.query<EligibilityCheck>(
      `
      SELECT
        EXISTS (
          SELECT 1 FROM enrollment_verifications
          WHERE student_id = $1 AND term_id = $2 AND status = 'verified'
        ) AS enrollment_verified,
        EXISTS (
          SELECT 1 FROM eligibility_surveys
          WHERE student_id = $1 AND term_id = $2
        ) AS survey_submitted
      `,
      [student.id, slot.term_id]
    );
    const checks = checkResult.rows[0];

    if (!checks.enrollment_verified || !checks.survey_submitted) {
      throw new BookingRuleError(
        403,
        "Current-term enrollment verification and survey are required"
      );
    }

    // Friendly error for an existing reservation. The database's unique
    // partial index is still essential for simultaneous requests.
    const existingResult = await client.query(
      `
      SELECT 1 FROM bookings
      WHERE student_id = $1 AND week_start = $2
        AND status IN ('booked', 'completed', 'no_show')
      LIMIT 1
      `,
      [student.id, slot.week_start]
    );

    if (existingResult.rowCount !== null && existingResult.rowCount > 0) {
      throw new BookingRuleError(
        409,
        "You already have a booking for this calendar week"
      );
    }

    // The requested picker must belong to this student and have staff approval.
    // Defaults to self for clients that do not yet send a picker choice.
    const choice = parsePickupChoice(req.body);
    const pickup = await verifyPickupChoice(client, student.id, choice);

    // Count AFTER locking the slot, so another request to this API cannot
    // insert into the same slot between our check and insertion.
    const countResult = await client.query<{ booked_count: number }>(
      `
      SELECT count(*)::integer AS booked_count
      FROM bookings
      WHERE slot_id = $1 AND status = 'booked'
      `,
      [slot.id]
    );

    if (countResult.rows[0].booked_count >= slot.capacity) {
      throw new BookingRuleError(409, "This appointment slot is full");
    }

    const created = await client.query<{
      id: string;
      slot_id: string;
      status: string;
      booked_at: Date;
    }>(
      `
      INSERT INTO bookings
        (student_id, slot_id, week_start,
         pickup_kind, pickup_dependent_id, pickup_contact_id)
      VALUES ($1, $2, $3::date, $4, $5, $6)
      RETURNING id, slot_id, status, booked_at,
                pickup_kind, pickup_dependent_id, pickup_contact_id
      `,
      [
        student.id, slot.id, slot.week_start,
        pickup.pickup_kind, pickup.pickup_dependent_id, pickup.pickup_contact_id
      ]
    );

    await client.query(
      `
      INSERT INTO booking_events
        (booking_id, actor_id, event_type, event_data)
      VALUES
        ($1, $2, 'created',
          jsonb_build_object('slot_id', $3::text,
                             'pickup_kind', $4::text))
      `,
      [created.rows[0].id, student.id, slot.id, pickup.pickup_kind]
    );

    await client.query("COMMIT");
    res.status(201).json({ booking: created.rows[0] });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Booking rollback failed:", rollbackError);
      }
    }

    if (error instanceof PickupRuleError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof BookingRuleError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    // PostgreSQL SQLSTATE 23505 is a unique-constraint violation.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      res.status(409).json({
        error: "You already have a booking for this calendar week"
      });
      return;
    }

    console.error("Booking transaction failed:", error);
    res.status(500).json({ error: "Unable to create booking" });
  } finally {
    client?.release();
  }
});
