// Sequential cancellation/reschedule and privacy tests with fictional accounts.
// Run only against local foodbank_dev or disposable CI database.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { hashPassword } from "../security/passwords.js";

const API = "http://localhost:3001";
const ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";

if (process.env.NODE_ENV === "production" ||
    !["127.0.0.1", "localhost"].includes(process.env.PGHOST ?? "") ||
    process.env.PGDATABASE !== "foodbank_dev") {
  throw new Error("Booking management tests are restricted to local foodbank_dev");
}

const uid = randomUUID().slice(0, 12);
const prefix = "management-" + uid;
const users = [
  { email: prefix + "-a@example.test", name: "ManagementA", id: "" },
  { email: prefix + "-b@example.test", name: "ManagementB", id: "" }
];
const password = "FictionalTestPassword_1234";
const staffPassword = process.env.DEMO_STAFF_PASSWORD;
assert.ok(staffPassword, "DEMO_STAFF_PASSWORD must be configured");

let termId: string | null = null;
const slotIds: string[] = [];

interface ApiResponse { status: number; data: any; cookie: string; }
async function request(
  method: "GET" | "POST", path: string, cookie = "", body?: unknown
): Promise<ApiResponse> {
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
    data: await response.json(),
    cookie: (response.headers.get("set-cookie") ?? "").split(";")[0]
  };
}
async function login(email: string, pass: string): Promise<string> {
  const response = await request("POST", "/api/auth/login", "", {
    email, password: pass
  });
  assert.equal(response.status, 200, "Cannot log in fictional test account");
  assert.ok(response.cookie.startsWith("foodbank_session="));
  return response.cookie;
}
async function availability(cookie: string, slotId: string) {
  const response = await request("GET", "/api/slots", cookie);
  assert.equal(response.status, 200);
  const slot = (response.data.slots as {
    id: string; remaining_capacity: number; booked_count: number;
  }[]).find(row => row.id === slotId);
  assert.ok(slot, "Expected fixture slot to be listed");
  // Public availability contains no student identity.
  assert.ok(!JSON.stringify(response.data).includes(users[0].email));
  assert.ok(!JSON.stringify(response.data).includes(users[1].email));
  return slot;
}

try {
  // Prepare completely fictional fixtures in a single database transaction.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const staff = await client.query<{ id: string }>(
      "SELECT id FROM profiles WHERE email = 'staff.demo@example.com'"
    );
    assert.ok(staff.rows[0], "Provision the fictional staff account first");

    const termResult = await client.query<{ id: string }>(
      `
      INSERT INTO terms
        (code, name, starts_on, ends_on, minimum_notice_days,
         maximum_notice_days, cancellation_cutoff_hours)
      VALUES ($1, 'Appointment Management Test',
        (NOW() AT TIME ZONE 'America/Vancouver')::date - 1,
        (NOW() AT TIME ZONE 'America/Vancouver')::date + 120,
        7, 60, 24)
      RETURNING id
      `,
      ["MGMT-" + uid]
    );
    termId = termResult.rows[0].id;
    const hash = await hashPassword(password);
    for (const user of users) {
      const p = await client.query<{ id: string }>(
        "INSERT INTO profiles (email, first_name, last_name, role) " +
        "VALUES ($1, $2, 'Fixture', 'student') RETURNING id",
        [user.email, user.name]
      );
      user.id = p.rows[0].id;
      await client.query(
        "INSERT INTO auth_credentials (profile_id, password_hash) VALUES ($1, $2)",
        [user.id, hash]
      );
      await client.query(
        "INSERT INTO enrollment_verifications " +
        "(student_id, term_id, status, verified_by, verified_at) " +
        "VALUES ($1, $2, 'verified', $3, NOW())",
        [user.id, termId, staff.rows[0].id]
      );
      await client.query(
        "INSERT INTO eligibility_surveys (student_id, term_id, responses) " +
        "VALUES ($1, $2, '{\"fictional\":true}'::jsonb)",
        [user.id, termId]
      );
    }

    for (const days of [14, 15, 16]) {
      const result = await client.query<{ id: string }>(
        `
        INSERT INTO appointment_slots (term_id, starts_at, ends_at, capacity)
        VALUES (
          $1,
          NOW() + $2::integer * INTERVAL '1 day',
          NOW() + $2::integer * INTERVAL '1 day' + INTERVAL '20 minutes',
          1
        )
        RETURNING id
        `,
        [termId, days]
      );
      slotIds.push(result.rows[0].id);
    }
    const near = await client.query<{ id: string }>(
      `
      INSERT INTO appointment_slots (term_id, starts_at, ends_at, capacity)
      VALUES ($1, NOW() + INTERVAL '12 hours',
                 NOW() + INTERVAL '12 hours 20 minutes', 1)
      RETURNING id
      `,
      [termId]
    );
    slotIds.push(near.rows[0].id);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const [aCookie, bCookie, staffCookie] = await Promise.all([
    login(users[0].email, password),
    login(users[1].email, password),
    login("staff.demo@example.com", staffPassword)
  ]);

  // Student A fills the one-place slot; B sees it as full without A's name.
  const initial = await request("POST", "/api/bookings", aCookie, { slotId: slotIds[0] });
  assert.equal(initial.status, 201, JSON.stringify(initial.data));
  const aBooking = initial.data.booking.id as string;
  assert.equal((await availability(bCookie, slotIds[0])).remaining_capacity, 0);
  assert.equal((await request("POST", "/api/bookings", bCookie, {
    slotId: slotIds[0]
  })).status, 409);

  // Staff see A's name; a second student cannot read A's private booking data.
  const staffBefore = await request(
    "GET", "/api/staff/bookings?search=" + prefix + "&status=booked", staffCookie
  );
  assert.equal(staffBefore.status, 200, JSON.stringify(staffBefore.data));
  assert.ok(staffBefore.data.bookings.some((b: any) =>
    b.student_id === users[0].id && b.email === users[0].email
  ));
  assert.equal(
    (await request("GET", "/api/staff/bookings", bCookie)).status, 403
  );
  assert.equal(
    (await request("POST", "/api/bookings/" + aBooking + "/cancel", bCookie)).status,
    404
  );
  assert.equal(
    (await request("POST", "/api/bookings/" + aBooking + "/cancel", staffCookie)).status,
    403
  );
  const bPrivate = await request("GET", "/api/bookings/history", bCookie);
  assert.equal(bPrivate.status, 200);
  assert.equal(bPrivate.data.bookings.length, 0);
  console.log("PASS: capacity shared, private student records, staff sees booking owners");

  // Cancel A: slot 1 becomes bookable for B, history is preserved.
  const cancelled = await request(
    "POST", "/api/bookings/" + aBooking + "/cancel", aCookie
  );
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.equal((await availability(bCookie, slotIds[0])).remaining_capacity, 1);
  assert.equal((await request(
    "POST", "/api/bookings/" + aBooking + "/cancel", aCookie
  )).status, 409);
  const bBooked = await request("POST", "/api/bookings", bCookie, { slotId: slotIds[0] });
  assert.equal(bBooked.status, 201, JSON.stringify(bBooked.data));
  const bBooking = bBooked.data.booking.id as string;
  console.log("PASS: cancellation frees capacity and records a terminal cancelled booking");

  // A reschedules from slot 2 to 3. B cannot take full slot 3.
  const bookedA2 = await request("POST", "/api/bookings", aCookie, { slotId: slotIds[1] });
  assert.equal(bookedA2.status, 201);
  const aSecond = bookedA2.data.booking.id as string;
  const moved = await request(
    "POST", "/api/bookings/" + aSecond + "/reschedule",
    aCookie, { slotId: slotIds[2] }
  );
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.equal((await availability(bCookie, slotIds[1])).remaining_capacity, 1);
  assert.equal((await availability(bCookie, slotIds[2])).remaining_capacity, 0);
  assert.equal((await request(
    "POST", "/api/bookings/" + bBooking + "/reschedule",
    bCookie, { slotId: slotIds[2] }
  )).status, 409);

  const movedB = await request(
    "POST", "/api/bookings/" + bBooking + "/reschedule",
    bCookie, { slotId: slotIds[1] }
  );
  assert.equal(movedB.status, 200, JSON.stringify(movedB.data));
  assert.equal((await availability(aCookie, slotIds[0])).remaining_capacity, 1);
  assert.equal((await availability(aCookie, slotIds[1])).remaining_capacity, 0);

  const aHistory = await request("GET", "/api/bookings/history", aCookie);
  assert.equal(aHistory.status, 200);
  assert.ok(aHistory.data.bookings.some((b: any) => b.id === aBooking && b.status === "cancelled"));
  const eventsA = await request("GET", "/api/bookings/events", aCookie);
  assert.equal(eventsA.status, 200);
  assert.ok(eventsA.data.events.some((e: any) => e.event_type === "cancelled"));
  assert.ok(eventsA.data.events.some((e: any) => e.event_type === "rescheduled"));
  const eventsB = await request("GET", "/api/bookings/events", bCookie);
  assert.equal(eventsB.status, 200);
  assert.ok(eventsB.data.events.every((e: any) => e.booking_id !== aBooking));
  console.log("PASS: atomic rescheduling and private in-app activity history");

  // The source appointment's 24-hour cutoff is enforced even if target is open.
  const nearBooking = await pool.query<{ id: string }>(
    `
    INSERT INTO bookings (student_id, slot_id, week_start)
    SELECT $1, s.id,
      date_trunc('week', s.starts_at AT TIME ZONE 'America/Vancouver')::date
    FROM appointment_slots AS s WHERE s.id = $2
    RETURNING id
    `,
    [users[0].id, slotIds[3]]
  );
  const nearId = nearBooking.rows[0].id;
  assert.equal((await request(
    "POST", "/api/bookings/" + nearId + "/cancel", aCookie
  )).status, 422);
  assert.equal((await request(
    "POST", "/api/bookings/" + nearId + "/reschedule",
    aCookie, { slotId: slotIds[0] }
  )).status, 422);
  console.log("PASS: 24-hour cutoff enforced for cancellation and rescheduling");

  const staffAfter = await request(
    "GET", "/api/staff/bookings?search=" + prefix + "&status=booked", staffCookie
  );
  assert.equal(staffAfter.status, 200);
  assert.ok(staffAfter.data.bookings.some((b: any) =>
    b.student_id === users[1].id && b.slot_id === slotIds[1]
  ));
  const staffAll = await request(
    "GET", "/api/staff/bookings?search=" + prefix + "&status=all", staffCookie
  );
  assert.equal(staffAll.status, 200);
  assert.ok(staffAll.data.bookings.some((b: any) => b.id === aBooking && b.status === "cancelled"));
  console.log("PASS: staff roster updates and retains cancelled history");
  console.log("Booking management workflow tests passed.");
} finally {
  const ids = users.map(user => user.id).filter(Boolean);
  if (ids.length > 0 || termId) {
    const cleanup = await pool.connect();
    try {
      await cleanup.query("BEGIN");
      if (ids.length) {
        await cleanup.query(
          "DELETE FROM booking_events WHERE booking_id IN " +
          "(SELECT id FROM bookings WHERE student_id = ANY($1::uuid[]))",
          [ids]
        );
        await cleanup.query("DELETE FROM bookings WHERE student_id = ANY($1::uuid[])", [ids]);
        await cleanup.query("DELETE FROM auth_sessions WHERE profile_id = ANY($1::uuid[])", [ids]);
        await cleanup.query("DELETE FROM auth_credentials WHERE profile_id = ANY($1::uuid[])", [ids]);
        await cleanup.query("DELETE FROM enrollment_verifications WHERE student_id = ANY($1::uuid[])", [ids]);
        await cleanup.query("DELETE FROM eligibility_surveys WHERE student_id = ANY($1::uuid[])", [ids]);
      }
      if (termId) {
        await cleanup.query("DELETE FROM appointment_slots WHERE term_id = $1", [termId]);
        await cleanup.query("DELETE FROM terms WHERE id = $1", [termId]);
      }
      if (ids.length) {
        await cleanup.query("DELETE FROM profiles WHERE id = ANY($1::uuid[])", [ids]);
      }
      await cleanup.query("COMMIT");
      console.log("Cleaned up booking management test-only records");
    } catch (error) {
      await cleanup.query("ROLLBACK");
      console.error("Test fixture cleanup failed:", error);
    } finally {
      cleanup.release();
    }
  }
  await pool.end();
}
