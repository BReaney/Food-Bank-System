// Run only with the local prototype backend and fictional database.
// This suite deliberately uses sequential requests; concurrent booking stress
// tests remain deferred.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";

const BASE = "http://localhost:3001";
const ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
const STAFF_PASSWORD = process.env.DEMO_STAFF_PASSWORD;
if (!STAFF_PASSWORD ||
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1"].includes(process.env.PGHOST ?? "") ||
    process.env.PGDATABASE !== "foodbank_dev") {
  throw new Error("Requires local foodbank_dev and DEMO_STAFF_PASSWORD");
}
const suffix = randomUUID().slice(0, 12);
const aEmail = "household-a-" + suffix + "@example.test";
const bEmail = "household-b-" + suffix + "@example.test";
const password = "FictionalHouseholdTest_1234";
const studentIds: string[] = [];
const dependentIds: string[] = [];
let contactId = "";
let termId = "";

async function request(method: string, path: string, cookie = "", body?: unknown) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    status: response.status,
    body: await response.json() as any,
    cookie: (response.headers.get("set-cookie") || "").split(";")[0]
  };
}
async function register(email: string, firstName: string): Promise<string> {
  const result = await request("POST", "/api/auth/register", "", {
    email, password, firstName, lastName: "Fixture"
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const row = await pool.query<{ id: string }>(
    "SELECT id FROM profiles WHERE email=$1", [email]
  );
  const id = row.rows[0].id;
  studentIds.push(id);
  return id;
}
async function login(email: string, pass: string): Promise<string> {
  const result = await request("POST", "/api/auth/login", "", {
    email, password: pass
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(result.cookie.startsWith("foodbank_session="));
  return result.cookie;
}
async function staffChange(type: "dependents" | "contacts", id: string,
                           cookie: string, status: string) {
  return request("PUT", "/api/staff/household/" + type + "/" + id + "/status",
    cookie, { status });
}

try {
  const aId = await register(aEmail, "HouseholdA");
  await register(bEmail, "HouseholdB");
  const [a, b, staff] = await Promise.all([
    login(aEmail, password), login(bEmail, password),
    login("staff.demo@example.com", STAFF_PASSWORD)
  ]);

  assert.equal((await request("GET", "/api/household/contacts")).status, 401);
  assert.equal((await request("GET", "/api/staff/household/contacts", a)).status, 403);
  assert.equal((await request("GET", "/api/household/dependents", staff)).status, 403);
  assert.equal((await request("POST", "/api/household/dependents", a,
    { fullName: "", relationship: "child" })).status, 400);

  const requested = await request("POST", "/api/household/dependents", a, {
    fullName: "Fictional Dependent", relationship: "child"
  });
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  const dependentId = requested.body.dependent.id as string;
  dependentIds.push(dependentId);
  assert.equal(requested.body.dependent.status, "pending");
  assert.equal((await request("GET", "/api/household/dependents", b))
    .body.dependents.length, 0);
  assert.equal((await request("DELETE",
    "/api/household/dependents/" + dependentId, a)).status, 409);
  assert.equal((await request("DELETE",
    "/api/household/dependents/" + dependentId, b)).status, 404);
  const staffList = await request(
    "GET", "/api/staff/household/dependents?search=" + aEmail, staff
  );
  assert.ok(staffList.body.records.some((r: any) => r.id === dependentId));
  assert.equal((await staffChange("dependents", dependentId, a, "confirmed")).status, 403);
  assert.equal((await staffChange("dependents", dependentId, staff, "confirmed")).status, 200);
  assert.equal((await staffChange("dependents", dependentId, staff, "confirmed")).status, 409);

  const second = await request("POST", "/api/household/dependents", a, {
    fullName: "Fictional Denied", relationship: "other"
  });
  assert.equal(second.status, 201);
  const deniedId = second.body.dependent.id as string;
  dependentIds.push(deniedId);
  assert.equal((await staffChange("dependents", deniedId, staff, "denied")).status, 200);
  assert.equal((await request("DELETE",
    "/api/household/dependents/" + deniedId, a)).status, 409);
  console.log("PASS: dependent requests, staff decisions, student removal rule and isolation");

  const disclosure = await request("GET", "/api/household/consent", a);
  assert.equal(disclosure.status, 200);
  assert.ok(disclosure.body.text.includes("authorize"));
  assert.equal((await request("POST", "/api/household/contacts", a, {
    fullName: "Fictional Pickup", contactMethod: "phone",
    contactValue: "250-555-0100"
  })).status, 400);
  assert.equal((await request("POST", "/api/household/contacts", a, {
    fullName: "Fictional Pickup", contactMethod: "phone",
    contactValue: "bad", consentAccepted: true
  })).status, 400);
  const created = await request("POST", "/api/household/contacts", a, {
    fullName: "Fictional Pickup", contactMethod: "phone",
    contactValue: "250-555-0100", consentAccepted: true
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  contactId = created.body.contact.id;
  assert.equal(created.body.contact.status, "pending");
  assert.equal((await request("GET", "/api/household/contacts", b)).body.contacts.length, 0);
  assert.equal((await request("PUT", "/api/household/contacts/" + contactId, b, {
    fullName: "Not owner", contactMethod: "phone",
    contactValue: "250-555-0123", consentAccepted: true
  })).status, 404);
  const consentList = await request(
    "GET", "/api/staff/household/contacts?search=" + aEmail, staff
  );
  const consentRow = consentList.body.records.find((x: any) => x.id === contactId);
  assert.ok(consentRow);
  assert.equal(consentRow.consent_text, disclosure.body.text);
  assert.ok(consentRow.consent_given_at);
  assert.equal((await staffChange("contacts", contactId, staff, "confirmed")).status, 200);
  console.log("PASS: explicit consent recorded; only owner and staff can read contact");

  // Unique future term and private booked slot; existing demo appointments unaffected.
  const term = await pool.query<{ id: string }>(
    "INSERT INTO terms " +
    "(code,name,starts_on,ends_on,minimum_notice_days,maximum_notice_days) " +
    "VALUES ($1,'Household fixture',(NOW() AT TIME ZONE 'America/Vancouver')::date-1," +
    "(NOW() AT TIME ZONE 'America/Vancouver')::date+90,7,60) RETURNING id",
    ["PICKUP-" + suffix]
  );
  termId = term.rows[0].id;
  const staffProfile = await pool.query<{ id: string }>(
    "SELECT id FROM profiles WHERE email='staff.demo@example.com'"
  );
  for (const studentId of studentIds) {
    await pool.query(
      "INSERT INTO enrollment_verifications " +
      "(student_id,term_id,status,verified_by,verified_at) " +
      "VALUES ($1,$2,'verified',$3,NOW())",
      [studentId,termId,staffProfile.rows[0].id]
    );
    await pool.query(
      "INSERT INTO eligibility_surveys (student_id,term_id,responses) " +
      "VALUES ($1,$2,$3::jsonb)",
      [studentId,termId,JSON.stringify({ fictional: true })]
    );
  }
  const slot = await pool.query<{ id: string }>(
    "INSERT INTO appointment_slots (term_id, starts_at, ends_at, capacity) " +
    "VALUES ($1,NOW()+INTERVAL '15 days',NOW()+INTERVAL '15 days 20 minutes',2) " +
    "RETURNING id", [termId]
  );
  const slotId = slot.rows[0].id;

  const badOwner = await request("POST", "/api/bookings", b, {
    slotId, pickupKind: "third_party", pickupId: contactId
  });
  assert.equal(badOwner.status, 403, JSON.stringify(badOwner.body));
  assert.equal((await request("POST", "/api/bookings", a, {
    slotId, pickupKind: "dependent", pickupId: deniedId
  })).status, 403);

  const booking = await request("POST", "/api/bookings", a, {
    slotId, pickupKind: "third_party", pickupId: contactId
  });
  assert.equal(booking.status, 201, JSON.stringify(booking.body));
  const bookingId = booking.body.booking.id as string;
  assert.equal((await request("GET", "/api/bookings", a))
    .body.bookings[0].pickup_name, "Fictional Pickup");
  const otherStudent = await request("GET", "/api/bookings", b);
  assert.equal(otherStudent.status, 200);
  assert.ok(!JSON.stringify(otherStudent.body).includes("Fictional Pickup"));
  const staffBookings = await request("GET",
    "/api/staff/bookings?search=" + aEmail, staff);
  assert.ok(staffBookings.body.bookings.some((x: any) =>
    x.id === bookingId && x.pickup_name === "Fictional Pickup"));
  assert.equal((await request("PATCH",
    "/api/bookings/" + bookingId + "/pickup", b,
    { pickupKind: "self" })).status, 404);
  console.log("PASS: booking pickup selection requires ownership and confirmation");

  // Contact changes require fresh consent and invalidate future designations.
  assert.equal((await request("PUT", "/api/household/contacts/" + contactId, a, {
    fullName: "Fictional Updated", contactMethod: "email",
    contactValue: "updated@example.test"
  })).status, 400);
  const edited = await request("PUT", "/api/household/contacts/" + contactId, a, {
    fullName: "Fictional Updated", contactMethod: "email",
    contactValue: "updated@example.test", consentAccepted: true
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.contact.status, "pending");
  assert.equal(edited.body.affectedBookings, 1);
  assert.equal((await request("GET", "/api/bookings", a))
    .body.bookings[0].pickup_kind, "self");

  assert.equal((await staffChange("contacts", contactId, staff, "confirmed")).status, 200);
  const assigned = await request("PATCH", "/api/bookings/" + bookingId + "/pickup",
    a, { pickupKind: "third_party", pickupId: contactId });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  const rejected = await staffChange("contacts", contactId, staff, "denied");
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.affectedBookings, 1);
  assert.equal((await request("GET", "/api/bookings", a))
    .body.bookings[0].pickup_kind, "self");
  assert.equal((await request("PATCH", "/api/bookings/" + bookingId + "/pickup",
    a, { pickupKind: "third_party", pickupId: contactId })).status, 403);

  const attachDependent = await request("PATCH",
    "/api/bookings/" + bookingId + "/pickup", a,
    { pickupKind: "dependent", pickupId: dependentId });
  assert.equal(attachDependent.status, 200, JSON.stringify(attachDependent.body));
  const removedDependent = await request("DELETE",
    "/api/household/dependents/" + dependentId, a);
  assert.equal(removedDependent.status, 200);
  assert.equal(removedDependent.body.affectedBookings, 1);
  assert.equal((await request("GET", "/api/bookings", a))
    .body.bookings[0].pickup_kind, "self");
  const events = await request("GET", "/api/bookings/events", a);
  assert.ok(events.body.events.some((x: any) => x.event_type === "pickup_updated"));
  assert.equal((await request("DELETE",
    "/api/household/contacts/" + contactId, a)).status, 200);
  assert.equal((await request("GET", "/api/household/contacts", a))
    .body.contacts.length, 0);

  const audit = await pool.query<{ total: number }>(
    "SELECT count(*)::integer AS total FROM audit_logs " +
    "WHERE target_id = ANY($1::uuid[]) AND action='household_status_changed'",
    [[...dependentIds, contactId]]
  );
  assert.ok(audit.rows[0].total >= 4);
  console.log("PASS: contact edits, denial and dependent removal invalidate pickup and audit decisions");
  console.log("Household and third-party pickup integration tests passed");
} finally {
  // Cleanup scope is exclusively test-created identities and term.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (studentIds.length) {
      await client.query(
        "DELETE FROM booking_events WHERE booking_id IN " +
        "(SELECT id FROM bookings WHERE student_id=ANY($1::uuid[]))",
        [studentIds]
      );
      await client.query(
        "DELETE FROM bookings WHERE student_id=ANY($1::uuid[])", [studentIds]
      );
      await client.query(
        "DELETE FROM household_events WHERE student_id=ANY($1::uuid[])", [studentIds]
      );
      await client.query(
        "DELETE FROM audit_logs WHERE target_id=ANY($1::uuid[]) " +
        "AND action='household_status_changed'",
        [[...dependentIds, ...(contactId ? [contactId] : [])]]
      );
      await client.query(
        "DELETE FROM pickup_contacts WHERE student_id=ANY($1::uuid[])", [studentIds]
      );
      await client.query(
        "DELETE FROM dependent_requests WHERE student_id=ANY($1::uuid[])", [studentIds]
      );
      await client.query(
        "DELETE FROM enrollment_verifications WHERE student_id=ANY($1::uuid[])", [studentIds]
      );
      await client.query(
        "DELETE FROM eligibility_surveys WHERE student_id=ANY($1::uuid[])", [studentIds]
      );
      await client.query(
        "DELETE FROM auth_sessions WHERE profile_id=ANY($1::uuid[])", [studentIds]
      );
      await client.query(
        "DELETE FROM auth_credentials WHERE profile_id=ANY($1::uuid[])", [studentIds]
      );
    }
    if (termId) {
      await client.query("DELETE FROM appointment_slots WHERE term_id=$1", [termId]);
      await client.query("DELETE FROM terms WHERE id=$1", [termId]);
    }
    if (studentIds.length) {
      await client.query(
        "DELETE FROM profiles WHERE id=ANY($1::uuid[])", [studentIds]
      );
    }
    await client.query("COMMIT");
    console.log("Cleaned up household fictional test fixtures");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Household test fixture cleanup failed:", error);
  } finally {
    client.release();
    await pool.end();
  }
}
