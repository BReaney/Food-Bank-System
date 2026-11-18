import express from "express";
import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { currentAccount, requireRole, requireUser } from "../security/sessions.js";
import { parsePickupChoice, verifyPickupChoice, PickupRuleError } from "../utils/pickup.js";

export const bookingManagementRouter = express.Router();
bookingManagementRouter.use(requireUser, requireRole("student"));

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class RuleError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

interface BookedAppointment {
  id: string;
  student_id: string;
  slot_id: string;
  status: string;
  starts_at: Date;
  ends_at: Date;
  cancellation_cutoff_hours: number;
}
interface TargetSlot {
  id: string;
  term_id: string;
  capacity: number;
  is_open: boolean;
  starts_at: Date;
  ends_at: Date;
  week_start: string;
  within_term: boolean;
  within_booking_window: boolean;
}
interface Eligibility {
  enrollment_verified: boolean;
  survey_submitted: boolean;
}

async function lockSlots(client: PoolClient, slotIds: string[]): Promise<void> {
  // Canonical order avoids opposite-direction reschedules deadlocking.
  const ordered = [...new Set(slotIds)].sort();
  for (const id of ordered) {
    await client.query("SELECT id FROM appointment_slots WHERE id = $1 FOR UPDATE", [id]);
  }
}

async function loadOwnedBooking(
  client: PoolClient, bookingId: string, studentId: string
): Promise<BookedAppointment> {
  const result = await client.query<BookedAppointment>(
    `
    SELECT b.id, b.student_id, b.slot_id, b.status,
           s.starts_at, s.ends_at, t.cancellation_cutoff_hours
    FROM bookings AS b
    JOIN appointment_slots AS s ON s.id = b.slot_id
    JOIN terms AS t ON t.id = s.term_id
    WHERE b.id = $1 AND b.student_id = $2
    FOR UPDATE OF b
    `,
    [bookingId, studentId]
  );
  if (!result.rows[0]) throw new RuleError(404, "Appointment not found");
  return result.rows[0];
}

function ensureCanChange(booking: BookedAppointment): void {
  if (booking.status !== "booked") {
    throw new RuleError(409, "Only active bookings may be changed");
  }
  if (
    booking.starts_at.getTime() - Date.now() <=
    booking.cancellation_cutoff_hours * 60 * 60 * 1000
  ) {
    throw new RuleError(
      422, "The change cutoff for this appointment has passed (cancellation, rescheduling and pickup changes)"
    );
  }
}

async function checkEligibility(
  client: PoolClient, studentId: string, termId: string
): Promise<void> {
  const result = await client.query<Eligibility>(
    `
    SELECT
      EXISTS (SELECT 1 FROM enrollment_verifications
              WHERE student_id = $1 AND term_id = $2 AND status = 'verified')
        AS enrollment_verified,
      EXISTS (SELECT 1 FROM eligibility_surveys
              WHERE student_id = $1 AND term_id = $2)
        AS survey_submitted
    `,
    [studentId, termId]
  );
  if (!result.rows[0].enrollment_verified || !result.rows[0].survey_submitted) {
    throw new RuleError(403, "Current-term enrollment verification and survey are required");
  }
}

async function loadTarget(client: PoolClient, id: string): Promise<TargetSlot> {
  const result = await client.query<TargetSlot>(
    `
    SELECT s.id, s.term_id, s.capacity, s.is_open,
           s.starts_at, s.ends_at,
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
    `,
    [id]
  );
  if (!result.rows[0]) throw new RuleError(404, "Target slot not found");
  return result.rows[0];
}

function handleError(res: express.Response, error: unknown): void {
  if (error instanceof PickupRuleError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof RuleError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (
    error && typeof error === "object" &&
    "code" in error && error.code === "23505"
  ) {
    res.status(409).json({ error: "You already have a booking for that week" });
    return;
  }
  console.error("Booking management error:", error);
  res.status(500).json({ error: "Unable to update appointment" });
}

// Only the signed-in student sees their booking history; no arbitrary student IDs.
bookingManagementRouter.get("/history", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT b.id, b.slot_id, b.week_start, b.status, b.booked_at, b.cancelled_at,
             b.pickup_kind, b.pickup_dependent_id, b.pickup_contact_id,
             COALESCE(d.full_name,c.full_name) AS pickup_name,
             s.starts_at, s.ends_at
      FROM bookings AS b
      JOIN appointment_slots AS s ON s.id = b.slot_id
      LEFT JOIN dependent_requests AS d ON d.id = b.pickup_dependent_id
      LEFT JOIN pickup_contacts AS c ON c.id = b.pickup_contact_id
      WHERE b.student_id = $1
      ORDER BY b.booked_at DESC, b.id DESC
      LIMIT 30
      `,
      [currentAccount(req).id]
    );
    res.set("Cache-Control", "no-store");
    res.json({ bookings: result.rows });
  } catch (error) {
    console.error("Unable to retrieve booking history:", error);
    res.status(500).json({ error: "Unable to retrieve booking history" });
  }
});

// A private in-app activity log. Does NOT email the user or disclose other students.
bookingManagementRouter.get("/events", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT e.id, e.booking_id, e.event_type, e.event_data, e.occurred_at
      FROM booking_events AS e
      JOIN bookings AS b ON b.id = e.booking_id
      WHERE b.student_id = $1
      ORDER BY e.occurred_at DESC, e.id DESC
      LIMIT 30
      `,
      [currentAccount(req).id]
    );
    res.set("Cache-Control", "no-store");
    res.json({ events: result.rows });
  } catch (error) {
    console.error("Unable to retrieve appointment activity:", error);
    res.status(500).json({ error: "Unable to retrieve appointment activity" });
  }
});

// Cancellation releases capacity and the weekly booking restriction in one commit.
bookingManagementRouter.post("/:bookingId/cancel", async (req, res) => {
  const bookingId = req.params.bookingId;
  if (!uuidPattern.test(bookingId ?? "")) {
    res.status(400).json({ error: "Invalid appointment identifier" });
    return;
  }
  const studentId = currentAccount(req).id;
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // Read an untrusted slot ID only to choose the lock. Recheck under lock.
    const initial = await client.query<{ slot_id: string }>(
      "SELECT slot_id FROM bookings WHERE id = $1 AND student_id = $2",
      [bookingId, studentId]
    );
    if (!initial.rows[0]) throw new RuleError(404, "Appointment not found");
    await lockSlots(client, [initial.rows[0].slot_id]);

    const booking = await loadOwnedBooking(client, bookingId, studentId);
    if (booking.slot_id !== initial.rows[0].slot_id) {
      throw new RuleError(409, "Appointment changed; refresh and try again");
    }
    ensureCanChange(booking);

    await client.query(
      `
      UPDATE bookings
      SET status = 'cancelled', cancelled_at = NOW()
      WHERE id = $1 AND student_id = $2
      `,
      [bookingId, studentId]
    );
    await client.query(
      `
      INSERT INTO booking_events (booking_id, actor_id, event_type, event_data)
      VALUES ($1, $2, 'cancelled',
        jsonb_build_object('slot_id', $3::text, 'starts_at', $4::text))
      `,
      [bookingId, studentId, booking.slot_id, booking.starts_at.toISOString()]
    );

    await client.query("COMMIT");
    res.json({ message: "Appointment cancelled. Its capacity is now available." });
  } catch (error) {
    if (client) {
      try { await client.query("ROLLBACK"); }
      catch (rollbackError) { console.error("Cancellation rollback failed:", rollbackError); }
    }
    handleError(res, error);
  } finally {
    client?.release();
  }
});

// Rescheduling keeps the original booking ID and preserves its event history.
// Both source and target slot rows are locked in sorted order before changes.
bookingManagementRouter.post("/:bookingId/reschedule", async (req, res) => {
  const bookingId = req.params.bookingId;
  const newSlotId: unknown = req.body?.slotId;
  if (!uuidPattern.test(bookingId ?? "") ||
      typeof newSlotId !== "string" || !uuidPattern.test(newSlotId)) {
    res.status(400).json({ error: "Valid appointment and target slot IDs are required" });
    return;
  }

  const studentId = currentAccount(req).id;
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const initial = await client.query<{ slot_id: string }>(
      "SELECT slot_id FROM bookings WHERE id = $1 AND student_id = $2",
      [bookingId, studentId]
    );
    if (!initial.rows[0]) throw new RuleError(404, "Appointment not found");
    if (initial.rows[0].slot_id === newSlotId) {
      throw new RuleError(409, "Choose a different appointment slot");
    }
    await lockSlots(client, [initial.rows[0].slot_id, newSlotId]);

    const booking = await loadOwnedBooking(client, bookingId, studentId);
    if (booking.slot_id !== initial.rows[0].slot_id) {
      throw new RuleError(409, "Appointment changed; refresh and try again");
    }
    ensureCanChange(booking);

    const target = await loadTarget(client, newSlotId);
    if (!target.is_open) throw new RuleError(409, "Target slot is closed");
    if (!target.within_term) throw new RuleError(422, "Target slot is outside its term");
    if (!target.within_booking_window) {
      throw new RuleError(422, "Target slot is outside the advance booking window");
    }
    await checkEligibility(client, studentId, target.term_id);

    const alreadyBooked = await client.query(
      `
      SELECT 1 FROM bookings
      WHERE student_id = $1 AND week_start = $2::date AND id <> $3
        AND status IN ('booked', 'completed', 'no_show')
      LIMIT 1
      `,
      [studentId, target.week_start, bookingId]
    );
    if (alreadyBooked.rowCount && alreadyBooked.rowCount > 0) {
      throw new RuleError(409, "You already have an appointment for that week");
    }

    const occupancy = await client.query<{ booked_count: number }>(
      `
      SELECT count(*)::integer AS booked_count FROM bookings
      WHERE slot_id = $1 AND status = 'booked'
      `,
      [newSlotId]
    );
    if (occupancy.rows[0].booked_count >= target.capacity) {
      throw new RuleError(409, "Target slot is full");
    }

    const updated = await client.query(
      `
      UPDATE bookings
      SET slot_id = $1, week_start = $2::date
      WHERE id = $3 AND student_id = $4
      RETURNING id, slot_id, status, week_start
      `,
      [newSlotId, target.week_start, bookingId, studentId]
    );
    await client.query(
      `
      INSERT INTO booking_events (booking_id, actor_id, event_type, event_data)
      VALUES ($1, $2, 'rescheduled',
        jsonb_build_object(
          'from_slot_id', $3::text, 'to_slot_id', $4::text,
          'from_starts_at', $5::text, 'to_starts_at', $6::text
        ))
      `,
      [
        bookingId, studentId, booking.slot_id, newSlotId,
        booking.starts_at.toISOString(), target.starts_at.toISOString()
      ]
    );
    await client.query("COMMIT");
    res.json({ message: "Appointment rescheduled.", booking: updated.rows[0] });
  } catch (error) {
    if (client) {
      try { await client.query("ROLLBACK"); }
      catch (rollbackError) { console.error("Reschedule rollback failed:", rollbackError); }
    }
    handleError(res, error);
  } finally {
    client?.release();
  }
});


// Student may change the person collecting the hamper up to the same cutoff.
// Status/ownership are rechecked under a booking row lock. A confirmed
// contact/dependent row is held FOR SHARE for the entire update.
bookingManagementRouter.patch("/:bookingId/pickup", async (req, res) => {
  const bookingId = req.params.bookingId;
  if (typeof bookingId !== "string" || !uuidPattern.test(bookingId)) {
    res.status(400).json({ error: "Invalid booking identifier" });
    return;
  }
  let choice;
  try {
    choice = parsePickupChoice(req.body);
  } catch (error) {
    handleError(res, error);
    return;
  }
  const studentId = currentAccount(req).id;
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // Acquire the target person's share lock before the booking row lock,
    // consistent with consent withdrawal's contact -> booking ordering.
    const pickup = await verifyPickupChoice(client, studentId, choice);
    const booking = await loadOwnedBooking(client, bookingId, studentId);
    ensureCanChange(booking);

    const old = await client.query<{
      pickup_kind: string;
      pickup_dependent_id: string | null;
      pickup_contact_id: string | null;
    }>(
      "SELECT pickup_kind, pickup_dependent_id, pickup_contact_id " +
      "FROM bookings WHERE id=$1",
      [bookingId]
    );
    if (old.rows[0]?.pickup_kind === pickup.pickup_kind &&
        old.rows[0]?.pickup_dependent_id === pickup.pickup_dependent_id &&
        old.rows[0]?.pickup_contact_id === pickup.pickup_contact_id) {
      throw new RuleError(409, "This booking already has that pickup person");
    }

    await client.query(
      `UPDATE bookings SET pickup_kind=$1, pickup_dependent_id=$2,
                          pickup_contact_id=$3 WHERE id=$4`,
      [
        pickup.pickup_kind, pickup.pickup_dependent_id,
        pickup.pickup_contact_id, bookingId
      ]
    );
    await client.query(
      `INSERT INTO booking_events (booking_id, actor_id, event_type, event_data)
       VALUES ($1,$2,'pickup_updated',
         jsonb_build_object('pickup_kind',$3::text,'reason','student_selected'))`,
      [bookingId, studentId, pickup.pickup_kind]
    );
    await client.query("COMMIT");
    res.json({ message: "Booking pickup person updated" });
  } catch (error) {
    if (client) {
      try { await client.query("ROLLBACK"); }
      catch (rollbackError) { console.error("Pickup update rollback failed:", rollbackError); }
    }
    handleError(res, error);
  } finally {
    client?.release();
  }
});
