import { Router } from "express";
import type { PoolClient } from "pg";
import { pool } from "../db.js";

// Temporary LOCAL-ONLY demo workflow. This is not user authentication.
// Real deployment must use verified sessions before enabling booking writes.
export const demoBookingsRouter = Router();
const DEMO_EMAIL = "alex.demo@example.com";
const LOOPBACK_ADDRESSES = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1"
]);

class BookingRuleError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

interface DemoStudent {
  id: string;
  role: string;
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

// Disabled unless deliberately enabled in backend/.env. Even then, only
// requests originating from this machine are accepted.
demoBookingsRouter.use((req, res, next) => {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_DEMO_BOOKING !== "true"
  ) {
    res.status(404).json({ error: "Demo booking endpoint disabled" });
    return;
  }

  if (!LOOPBACK_ADDRESSES.has(req.socket.remoteAddress ?? "")) {
    res.status(403).json({ error: "Demo bookings are local-only" });
    return;
  }

  next();
});

// Read the fictional student's upcoming appointments.
// This lets us confirm that a booking survives refreshing React.
demoBookingsRouter.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT b.id, b.slot_id, b.status, b.booked_at,
             s.starts_at, s.ends_at
      FROM bookings AS b
      JOIN appointment_slots AS s ON s.id = b.slot_id
      JOIN profiles AS p ON p.id = b.student_id
      WHERE p.email = $1
        AND b.status = 'booked'
        AND s.starts_at >= NOW()
      ORDER BY s.starts_at
      `,
      [DEMO_EMAIL]
    );

    res.json({ bookings: result.rows });
  } catch (error) {
    console.error("Unable to retrieve demo bookings:", error);
    res.status(500).json({ error: "Unable to retrieve bookings" });
  }
});

// Create a booking for ONLY the fixed, fictional demo student.
// The request supplies a slotId, never a student ID or a capacity count.
demoBookingsRouter.post("/", async (req, res) => {
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

    const studentResult = await client.query<DemoStudent>(
      "SELECT id, role FROM profiles WHERE lower(email) = lower($1)",
      [DEMO_EMAIL]
    );
    const student = studentResult.rows[0];

    if (!student || student.role !== "student") {
      throw new BookingRuleError(403, "Demo student is not configured");
    }

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
      INSERT INTO bookings (student_id, slot_id, week_start)
      VALUES ($1, $2, $3::date)
      RETURNING id, slot_id, status, booked_at
      `,
      [student.id, slot.id, slot.week_start]
    );

    await client.query(
      `
      INSERT INTO booking_events
        (booking_id, actor_id, event_type, event_data)
      VALUES
        ($1, $2, 'created', jsonb_build_object('slot_id', $3::text))
      `,
      [created.rows[0].id, student.id, slot.id]
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
