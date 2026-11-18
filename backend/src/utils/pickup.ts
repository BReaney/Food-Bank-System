import type { PoolClient } from "pg";

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PickupKind = "self" | "dependent" | "third_party";
export interface PickupChoice {
  kind: PickupKind;
  id: string | null;
}
export interface PickupColumns {
  pickup_kind: PickupKind;
  pickup_dependent_id: string | null;
  pickup_contact_id: string | null;
}

export class PickupRuleError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Only IDs are trusted from client input. Student ownership/approval are
 * checked against PostgreSQL using the authenticated session student ID.
 */
export function parsePickupChoice(body: any): PickupChoice {
  const kind = body?.pickupKind ?? "self";
  const id = body?.pickupId ?? null;
  if (kind === "self" && (id === null || id === "")) {
    return { kind, id: null };
  }
  if ((kind === "dependent" || kind === "third_party") &&
      typeof id === "string" && UUID_PATTERN.test(id)) {
    return { kind, id };
  }
  throw new PickupRuleError(400, "Choose yourself or a confirmed dependent/pickup contact");
}

export async function verifyPickupChoice(
  client: PoolClient, studentId: string, choice: PickupChoice
): Promise<PickupColumns> {
  if (choice.kind === "self") {
    return { pickup_kind: "self", pickup_dependent_id: null, pickup_contact_id: null };
  }

  const isDependent = choice.kind === "dependent";
  const table = isDependent ? "dependent_requests" : "pickup_contacts";
  const extra = isDependent ? "" : " AND consent_given_at IS NOT NULL";

  // The table name and extra clause are chosen only from code constants.
  // FOR SHARE prevents revocation/editing while the booking is committed.
  const record = await client.query(
    "SELECT id FROM " + table +
    " WHERE id = $1 AND student_id = $2" +
    " AND status = 'confirmed' AND removed_at IS NULL" + extra +
    " FOR SHARE",
    [choice.id, studentId]
  );
  if (!record.rows[0]) {
    throw new PickupRuleError(
      403, "The selected person is not an active, staff-confirmed record belonging to you"
    );
  }
  return {
    pickup_kind: choice.kind,
    pickup_dependent_id: isDependent ? choice.id : null,
    pickup_contact_id: isDependent ? null : choice.id
  };
}

/**
 * Editing or removing a student-owned pickup record can indirectly change
 * every booking currently assigned to that person. Apply the EXACT same
 * term-specific cutoff as cancelling, rescheduling, and directly changing
 * a booking's pickup person. The caller has already locked this person's
 * record FOR UPDATE, which also blocks simultaneous new pickup selections.
 *
 * Only assigned, still-booked appointments are relevant. The student may
 * still edit unused contact records and remove unused confirmed dependents.
 * Staff safety revocations deliberately do NOT use this restriction.
 */
export async function assertStudentPickupRecordEditable(
  client: PoolClient,
  studentId: string,
  kind: "dependent" | "third_party",
  recordId: string
): Promise<void> {
  const column = kind === "dependent" ? "pickup_dependent_id" : "pickup_contact_id";
  const result = await client.query(
    `SELECT b.id FROM bookings AS b
      JOIN appointment_slots AS s ON s.id = b.slot_id
      JOIN terms AS t ON t.id = s.term_id
      WHERE b.student_id = $1
        AND b.` + column + ` = $2
        AND b.status = 'booked'
        AND s.starts_at <= clock_timestamp()
           + t.cancellation_cutoff_hours * INTERVAL '1 hour'
      ORDER BY b.id
      LIMIT 1
      FOR UPDATE OF b`,
    [studentId, recordId]
  );
  if (result.rows.length) {
    throw new PickupRuleError(
      422,
      "This person is assigned to an appointment inside its cancellation " +
        "cutoff. Student-initiated changes are closed; contact staff for assistance."
    );
  }
}

/**
 * When approval or consent is withdrawn, invalidate assignments on future
 * or in-progress appointments atomically. Keep the booking but restore
 * pickup to the student; record
 * a private in-app event so the student can see the change.
 *
 * Call with the dependent/contact row already locked FOR UPDATE, inside
 * the same transaction that changes approval or removes the record.
 */
export async function clearFuturePickupAssignments(
  client: PoolClient,
  kind: "dependent" | "third_party",
  recordId: string,
  actorId: string,
  reason: string
): Promise<number> {
  const column = kind === "dependent" ? "pickup_dependent_id" : "pickup_contact_id";
  const result = await client.query<{ id: string }>(
    "UPDATE bookings AS b " +
    "SET pickup_kind = 'self', pickup_dependent_id = NULL, pickup_contact_id = NULL " +
    "FROM appointment_slots AS s " +
    "WHERE b.slot_id = s.id AND b.status = 'booked' " +
    "AND s.ends_at > clock_timestamp() AND b." + column + " = $1 " +
    "RETURNING b.id",
    [recordId]
  );

  for (const booking of result.rows) {
    await client.query(
      `INSERT INTO booking_events
        (booking_id, actor_id, event_type, event_data)
       VALUES ($1, $2, 'pickup_updated',
         jsonb_build_object('pickup_kind','self','reason',$3::text))`,
      [booking.id, actorId, reason]
    );
  }
  return result.rows.length;
}

export function validDisplayName(value: unknown): value is string {
  return typeof value === "string" &&
    value.trim().length >= 2 && value.trim().length <= 100 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}
