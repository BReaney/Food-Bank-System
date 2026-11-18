// Sequential staff outcome integration checks using fictional records only.
// Run against the local development DB or CI's disposable foodbank_dev.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";

const API = "http://localhost:3001";
const ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
const STAFF_PASSWORD = process.env.DEMO_STAFF_PASSWORD;
if (process.env.NODE_ENV === "production" ||
    !["127.0.0.1", "localhost"].includes(process.env.PGHOST ?? "") ||
    process.env.PGDATABASE !== "foodbank_dev" || !STAFF_PASSWORD) {
  throw new Error("Staff outcome tests require local foodbank_dev and demo staff");
}
const suffix = randomUUID().slice(0, 10);
const firstEmail = "outcome-a-" + suffix + "@example.test";
const secondEmail = "outcome-b-" + suffix + "@example.test";
const password = "FictionalOutcomeTest_1234";
const termCode = "OUTCOME-" + suffix.toUpperCase();

interface ResponseData {
  status: number;
  body: any;
  cookie: string;
}
async function request(
  method: string, path: string, cookie = "", body?: unknown
): Promise<ResponseData> {
  const response = await fetch(API + path, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    status: response.status,
    body: await response.json(),
    cookie: (response.headers.get("set-cookie") ?? "").split(";")[0]
  };
}
function equalStatus(result: ResponseData, expected: number): void {
  assert.equal(result.status, expected, JSON.stringify(result.body));
}
async function register(email: string, firstName: string) {
  equalStatus(await request("POST", "/api/auth/register", "", {
    email, firstName, lastName: "Fixture", password
  }), 201);
}
async function login(email: string, pass: string): Promise<string> {
  const result = await request("POST", "/api/auth/login", "", {
    email, password: pass
  });
  equalStatus(result, 200);
  assert.ok(result.cookie.startsWith("foodbank_session="));
  return result.cookie;
}
function listPath(status: string, email: string): string {
  return "/api/staff/bookings?status=" + status +
    "&search=" + encodeURIComponent(email) + "&limit=25&offset=0";
}

let ids: string[] = [];
let bookingIds: string[] = [];
let termId: string | null = null;
try {
  await register(firstEmail, "OutcomeA");
  await register(secondEmail, "OutcomeB");

  const users = await pool.query<{ id: string; email: string }>(
    "SELECT id,email FROM profiles WHERE email = ANY($1::text[])",
    [[firstEmail, secondEmail]]
  );
  ids = users.rows.map(row => row.id);
  const firstId = users.rows.find(row => row.email === firstEmail)?.id;
  assert.ok(firstId, "Fictional student was not provisioned");
  const [studentA, studentB, staff] = await Promise.all([
    login(firstEmail, password),
    login(secondEmail, password),
    login("staff.demo@example.com", STAFF_PASSWORD)
  ]);
  const t = await pool.query<{ id: string }>(
    `INSERT INTO terms (code,name,starts_on,ends_on)
     VALUES ($1,'Fictional Outcomes',
             (NOW() AT TIME ZONE 'America/Vancouver')::date-60,
             (NOW() AT TIME ZONE 'America/Vancouver')::date+90)
     RETURNING id`,
    [termCode]
  );
  termId = t.rows[0].id;

  // Past slots are inserted directly because the real calendar API
  // correctly refuses to schedule appointments in the past.
  const slots = await pool.query<{ id: string; days: number }>(
    `INSERT INTO appointment_slots (term_id, starts_at, ends_at, capacity)
     SELECT $1, NOW()+days*INTERVAL '1 day',
       NOW()+days*INTERVAL '1 day'+INTERVAL '20 minutes', 1
     FROM unnest(ARRAY[-24,-10,14,-38]::integer[]) AS days
     RETURNING id, EXTRACT(day FROM NOW()-starts_at)::integer AS days`,
    [termId]
  );
  assert.equal(slots.rows.length, 4);
  // Match each slot deterministically by its chronological start time.
  const ordered = await pool.query<{ id: string }>(
    "SELECT id FROM appointment_slots WHERE term_id=$1 ORDER BY starts_at ASC",
    [termId]
  );
  const [cancelledSlot, noShowSlot, completedSlot, futureSlot] =
    ordered.rows.map(row => row.id);

  // Chronological order: -38, -24, -10, +14. Distinct weeks.
  const inserts = await pool.query<{ id: string; slot_id: string }>(
    `INSERT INTO bookings (student_id,slot_id,week_start,status,cancelled_at)
     SELECT $1,s.id,
       date_trunc('week',s.starts_at AT TIME ZONE 'America/Vancouver')::date,
       CASE WHEN s.id=$2 THEN 'cancelled' ELSE 'booked' END,
       CASE WHEN s.id=$2 THEN NOW() ELSE NULL END
     FROM appointment_slots AS s
     WHERE s.id=ANY($3::uuid[])
     RETURNING id,slot_id`,
    [firstId,cancelledSlot,[cancelledSlot,noShowSlot,completedSlot,futureSlot]]
  );
  bookingIds = inserts.rows.map(row => row.id);
  const findBooking = (slotId: string) =>
    inserts.rows.find(row => row.slot_id === slotId)?.id ?? "";
  const cancelled = findBooking(cancelledSlot);
  const missed = findBooking(noShowSlot);
  const completed = findBooking(completedSlot);
  const upcoming = findBooking(futureSlot);
  assert.ok(cancelled && missed && completed && upcoming);

  equalStatus(await request("POST",
    "/api/staff/bookings/" + completed + "/outcome", "", { outcome: "completed" }), 401);
  equalStatus(await request("POST",
    "/api/staff/bookings/" + completed + "/outcome", studentA,
    { outcome: "completed" }), 403);
  equalStatus(await request("POST",
    "/api/staff/bookings/" + completed + "/outcome", studentB,
    { outcome: "no_show" }), 403);
  equalStatus(await request("POST",
    "/api/staff/bookings/not-an-id/outcome", staff, { outcome: "completed" }), 400);
  equalStatus(await request("POST",
    "/api/staff/bookings/" + completed + "/outcome", staff, { outcome: "unknown" }), 400);
  equalStatus(await request("POST",
    "/api/staff/bookings/" + randomUUID() + "/outcome", staff,
    { outcome: "completed" }), 404);
  equalStatus(await request("POST",
    "/api/staff/bookings/" + upcoming + "/outcome", staff,
    { outcome: "completed" }), 422);
  equalStatus(await request("POST",
    "/api/staff/bookings/" + cancelled + "/outcome", staff,
    { outcome: "no_show" }), 409);
  equalStatus(await request("GET", listPath("not_a_status", firstEmail), staff), 400);

  const review = await request("GET", listPath("needs_review", firstEmail), staff);
  equalStatus(review, 200);
  assert.deepEqual(
    new Set(review.body.bookings.map((r: any) => r.id)),
    new Set([completed, missed])
  );
  const upcomingList = await request("GET", listPath("booked", firstEmail), staff);
  equalStatus(upcomingList, 200);
  assert.ok(upcomingList.body.bookings.some((r: any) => r.id === upcoming));
  assert.ok(!upcomingList.body.bookings.some((r: any) => r.id === missed));
  console.log("PASS: role checks, invalid inputs, overdue roster and future-slot protection");

  const markedCompleted = await request("POST",
    "/api/staff/bookings/" + completed + "/outcome", staff,
    { outcome: "completed" });
  equalStatus(markedCompleted, 200);
  assert.equal(markedCompleted.body.booking.status, "completed");
  const markedMissed = await request("POST",
    "/api/staff/bookings/" + missed + "/outcome", staff,
    { outcome: "no_show" });
  equalStatus(markedMissed, 200);
  assert.equal(markedMissed.body.booking.status, "no_show");
  equalStatus(await request("POST",
    "/api/staff/bookings/" + completed + "/outcome", staff,
    { outcome: "no_show" }), 409);
  equalStatus(await request("POST",
    "/api/staff/bookings/" + missed + "/outcome", staff,
    { outcome: "no_show" }), 409);

  const afterReview = await request("GET", listPath("needs_review", firstEmail), staff);
  equalStatus(afterReview, 200);
  assert.equal(afterReview.body.pagination.total, 0);
  const done = await request("GET", listPath("completed", firstEmail), staff);
  equalStatus(done, 200);
  assert.ok(done.body.bookings.some((r: any) => r.id === completed));
  const missedList = await request("GET", listPath("no_show", firstEmail), staff);
  equalStatus(missedList, 200);
  assert.ok(missedList.body.bookings.some((r: any) => r.id === missed));
  const cancelledList = await request("GET", listPath("cancelled", firstEmail), staff);
  equalStatus(cancelledList, 200);
  assert.ok(cancelledList.body.bookings.some((r: any) => r.id === cancelled));

  const studentHistory = await request("GET", "/api/bookings/history", studentA);
  equalStatus(studentHistory, 200);
  assert.ok(studentHistory.body.bookings.some((r: any) =>
    r.id === completed && r.status === "completed"));
  assert.ok(studentHistory.body.bookings.some((r: any) =>
    r.id === missed && r.status === "no_show"));
  const studentEvents = await request("GET", "/api/bookings/events", studentA);
  equalStatus(studentEvents, 200);
  assert.ok(studentEvents.body.events.some((r: any) =>
    r.booking_id === completed && r.event_type === "completed"));
  assert.ok(studentEvents.body.events.some((r: any) =>
    r.booking_id === missed && r.event_type === "no_show"));
  const otherStudentHistory = await request("GET", "/api/bookings/history", studentB);
  equalStatus(otherStudentHistory, 200);
  assert.deepEqual(otherStudentHistory.body.bookings, []);
  const otherStudentEvents = await request("GET", "/api/bookings/events", studentB);
  equalStatus(otherStudentEvents, 200);
  assert.deepEqual(otherStudentEvents.body.events, []);

  const events = await pool.query<{ total: number }>(
    `SELECT count(*)::integer AS total
     FROM booking_events
     WHERE booking_id=ANY($1::uuid[])
       AND event_type IN ('completed','no_show')`,
    [[completed,missed]]
  );
  assert.equal(events.rows[0].total, 2);
  const audits = await pool.query<{ total: number }>(
    `SELECT count(*)::integer AS total
     FROM audit_logs
     WHERE target_id=ANY($1::uuid[]) AND action='booking_outcome_recorded'`,
    [[completed,missed]]
  );
  assert.equal(audits.rows[0].total, 2);
  console.log("PASS: one-time outcomes, filtered roster, student-owned history and audit");

  // Ensure completion did not remove the student-week constraint.
  // PostgreSQL must still reject any second non-cancelled booking that week.
  const secondSlot = await pool.query<{ id: string }>(
    `INSERT INTO appointment_slots (term_id, starts_at, ends_at, capacity)
     SELECT term_id, starts_at+INTERVAL '1 hour',
       ends_at+INTERVAL '1 hour',1
     FROM appointment_slots WHERE id=$1 RETURNING id`,
    [completedSlot]
  );
  await assert.rejects(async () => {
    await pool.query(
      `INSERT INTO bookings(student_id,slot_id,week_start)
       SELECT $1,s.id,date_trunc(
         'week',s.starts_at AT TIME ZONE 'America/Vancouver')::date
       FROM appointment_slots s WHERE s.id=$2`,
      [firstId,secondSlot.rows[0].id]
    );
  }, (err: unknown) =>
    Boolean(err && typeof err === "object" && "code" in err && err.code === "23505")
  );
  console.log("PASS: completed bookings still count toward one booking per week");
  console.log("Staff appointment outcomes integration tests passed.");
} finally {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const users = await client.query<{ id: string }>(
      "SELECT id FROM profiles WHERE email=ANY($1::text[])",
      [[firstEmail, secondEmail]]
    );
    ids = users.rows.map(row => row.id);
    const term = await client.query<{ id: string }>(
      "SELECT id FROM terms WHERE code=$1", [termCode]
    );
    if (ids.length) {
      await client.query(
        `DELETE FROM booking_events WHERE booking_id IN
          (SELECT id FROM bookings WHERE student_id=ANY($1::uuid[]))`,
        [ids]
      );
      await client.query(
        "DELETE FROM audit_logs WHERE action='booking_outcome_recorded' " +
        "AND target_id=ANY($1::uuid[])",
        [bookingIds]
      );
      await client.query(
        "DELETE FROM bookings WHERE student_id=ANY($1::uuid[])", [ids]
      );
    }
    if (term.rows[0]) {
      await client.query(
        "DELETE FROM appointment_slots WHERE term_id=$1",
        [term.rows[0].id]
      );
      await client.query("DELETE FROM terms WHERE id=$1", [term.rows[0].id]);
    }
    if (ids.length) {
      await client.query(
        "DELETE FROM auth_sessions WHERE profile_id=ANY($1::uuid[])", [ids]
      );
      await client.query(
        "DELETE FROM auth_credentials WHERE profile_id=ANY($1::uuid[])", [ids]
      );
      await client.query("DELETE FROM profiles WHERE id=ANY($1::uuid[])", [ids]
      );
    }
    await client.query("COMMIT");
    console.log("Cleaned up outcome-test fictional records");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Outcome test fixture cleanup failed:", error);
  } finally {
    client.release();
    await pool.end();
  }
}
