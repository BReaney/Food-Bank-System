// Unified staff records integration test: fictional fixtures only.
// Run with the local backend active and provisioned demo staff/student accounts.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";

const API = "http://localhost:3001";
const ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
const staffPassword = process.env.DEMO_STAFF_PASSWORD;
const studentPassword = process.env.DEMO_STUDENT_PASSWORD;
assert.ok(staffPassword && studentPassword, "Configure DEMO_STAFF_PASSWORD and DEMO_STUDENT_PASSWORD");

type ResponseData = { status: number; data: any };

async function get(path: string, cookie?: string): Promise<ResponseData> {
  const response = await fetch(API + path, {
    headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) }
  });
  return { status: response.status, data: await response.json() };
}
async function login(email: string, password: string): Promise<string> {
  const response = await fetch(API + "/api/auth/login", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert.equal(response.status, 200, "Demo account login");
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  assert.ok(cookie.startsWith("foodbank_session="));
  return cookie;
}

const key = randomUUID();
const studentEmail = "records-" + key + "@example.test";
const termOne = "REC-" + key.slice(0, 8);
const termTwo = "REC-" + key.slice(9, 17);
let studentId = "";
let termIds: string[] = [];
let slotIds: string[] = [];
let bookingIds: string[] = [];
let dependentId = "";
let contactId = "";

try {
  const staff = await pool.query<{ id: string }>(
    "SELECT id FROM profiles WHERE email = 'staff.demo@example.com' AND role = 'staff'"
  );
  const staffId = staff.rows[0]?.id;
  assert.ok(staffId, "Provisioned demo staff is required");

  const created = await pool.query<{ id: string }>(
    "INSERT INTO profiles (email,first_name,last_name,role,student_designation,dietary_restrictions) " +
    "VALUES ($1,'Records','Fixture','student','international',ARRAY['vegan','gluten-free']::text[]) " +
    "RETURNING id", [studentEmail]
  );
  studentId = created.rows[0].id;
  const createdTerms = await pool.query<{ id: string }>(
    "INSERT INTO terms (code,name,starts_on,ends_on) VALUES " +
    "($1,'Fixture Winter','2024-01-01','2024-04-30')," +
    "($2,'Fixture Summer','2024-05-01','2024-08-31') RETURNING id",
    [termOne, termTwo]
  );
  termIds = createdTerms.rows.map(row => row.id);
  assert.equal(termIds.length, 2);
  const termsByCode = await pool.query<{ id: string; code: string }>(
    "SELECT id, code FROM terms WHERE code = ANY($1::text[])", [[termOne, termTwo]]
  );
  const winterId = termsByCode.rows.find(row => row.code === termOne)!.id;
  const summerId = termsByCode.rows.find(row => row.code === termTwo)!.id;

  await pool.query(
    "INSERT INTO enrollment_verifications " +
    "(student_id,term_id,status,verified_by,verified_at) VALUES " +
    "($1,$2,'verified',$4,NOW()),($1,$3,'rejected',NULL,NULL)",
    [studentId, winterId, summerId, staffId]
  );
  await pool.query(
    "INSERT INTO enrollment_verification_events " +
    "(student_id,term_id,actor_id,previous_status,new_status) VALUES " +
    "($1,$2,$4,NULL,'pending'),($1,$2,$4,'pending','verified')," +
    "($1,$3,$4,NULL,'rejected')",
    [studentId, winterId, summerId, staffId]
  );
  await pool.query(
    "INSERT INTO eligibility_surveys (student_id,term_id,responses) " +
    "VALUES ($1,$2,$3::jsonb)",
    [studentId, winterId, JSON.stringify({
      confirmAccurate: true, understandVerification: true
    })]
  );
  const d = await pool.query<{ id: string }>(
    "INSERT INTO dependent_requests " +
    "(student_id,full_name,relationship,status,reviewed_by,reviewed_at) " +
    "VALUES ($1,'Fictional Dependent','child','confirmed',$2,NOW()) RETURNING id",
    [studentId, staffId]
  );
  dependentId = d.rows[0].id;
  const c = await pool.query<{ id: string }>(
    "INSERT INTO pickup_contacts " +
    "(student_id,full_name,contact_method,contact_value,status," +
    "consent_version,consent_text,reviewed_by,reviewed_at) " +
    "VALUES ($1,'Fictional Pickup','email','pickup@example.test','confirmed'," +
    "'demo-v1','Fictional consent for testing',$2,NOW()) RETURNING id",
    [studentId, staffId]
  );
  contactId = c.rows[0].id;
  const slots = await pool.query<{ id: string }>(
    "INSERT INTO appointment_slots " +
    "(term_id,starts_at,ends_at,capacity) VALUES " +
    "($1,'2024-02-05T17:00:00Z','2024-02-05T17:15:00Z',5)," +
    "($1,'2024-02-12T17:00:00Z','2024-02-12T17:15:00Z',5) RETURNING id",
    [winterId]
  );
  slotIds = slots.rows.map(row => row.id);
  const bookings = await pool.query<{ id: string }>(
    "INSERT INTO bookings " +
    "(student_id,slot_id,week_start,status,booked_at,cancelled_at," +
    "pickup_kind,pickup_dependent_id,pickup_contact_id) VALUES " +
    "($1,$2,'2024-02-05','completed','2024-01-20T20:00:00Z',NULL,'dependent',$4,NULL)," +
    "($1,$3,'2024-02-12','cancelled','2024-01-25T20:00:00Z',NOW(),'third_party',NULL,$5) " +
    "RETURNING id",
    [studentId, slotIds[0], slotIds[1], dependentId, contactId]
  );
  bookingIds = bookings.rows.map(row => row.id);
  await pool.query(
    "INSERT INTO booking_events (booking_id,actor_id,event_type,occurred_at) VALUES " +
    "($1,$3,'created','2024-01-20T20:00:00Z')," +
    "($1,$3,'completed','2024-02-05T19:00:00Z')," +
    "($2,$3,'created','2024-01-25T20:00:00Z')," +
    "($2,$3,'cancelled','2024-02-01T20:00:00Z')",
    [bookingIds[0], bookingIds[1], studentId]
  );

  const staffCookie = await login("staff.demo@example.com", staffPassword);
  const studentCookie = await login("alex.demo@example.com", studentPassword);
  const path = "/api/staff/records";
  assert.equal((await get(path)).status, 401);
  assert.equal((await get(path, studentCookie)).status, 403);
  assert.equal((await get(path + "/" + studentId)).status, 401);
  assert.equal((await get(path + "/" + studentId, studentCookie)).status, 403);
  console.log("PASS: search and full details are inaccessible to students and guests");

  const search = await get(path + "?search=" + encodeURIComponent(studentEmail), staffCookie);
  assert.equal(search.status, 200);
  assert.equal(search.data.pagination.total, 1);
  assert.equal(search.data.students[0].id, studentId);
  assert.equal(search.data.students[0].student_designation, "international");
  assert.deepEqual(search.data.students[0].dietary_restrictions, ["vegan", "gluten-free"]);
  const caseInsensitive = await get(
    path + "?search=" + encodeURIComponent("RECORDS FIXTURE"), staffCookie
  );
  assert.equal(caseInsensitive.data.pagination.total, 1);
  const missing = await get(
    path + "?search=" + encodeURIComponent("missing-" + key), staffCookie
  );
  assert.equal(missing.status, 200);
  assert.deepEqual(missing.data.students, []);
  assert.equal(missing.data.pagination.total, 0);
  for (const suffix of ["?limit=101", "?offset=-1", "?search=" + "x".repeat(101),
                        "?search=a&search=b"]) {
    assert.equal((await get(path + suffix, staffCookie)).status, 400);
  }
  console.log("PASS: exact and missing-record searches, validation and pagination");

  assert.equal((await get(path + "/not-a-uuid", staffCookie)).status, 400);
  assert.equal((await get(path + "/" + randomUUID(), staffCookie)).status, 404);
  assert.equal((await get(path + "/" + studentId + "?limit=0", staffCookie)).status, 400);

  const first = await get(path + "/" + studentId + "?limit=1&offset=0", staffCookie);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.student.email, studentEmail);
  assert.equal(first.data.student.student_designation, "international");
  assert.deepEqual(first.data.student.dietary_restrictions, ["vegan", "gluten-free"]);
  assert.equal(first.data.terms.length >= 2, true);
  assert.equal(first.data.terms.find((t: any) => t.id === winterId).enrollment_status, "verified");
  assert.ok(first.data.terms.find((t: any) => t.id === winterId).survey_submitted_at);
  assert.equal(first.data.terms.find((t: any) => t.id === summerId).enrollment_status, "rejected");
  assert.equal(first.data.terms.find((t: any) => t.id === summerId).survey_submitted_at, null);
  assert.equal(first.data.enrollmentEvents.filter((e: any) => e.term_id === winterId).length, 2);
  assert.equal(first.data.appointments.length, 1);
  assert.equal(first.data.appointmentsPagination.total, 2);
  assert.equal(first.data.appointmentsPagination.hasNext, true);
  assert.equal(first.data.appointments[0].status, "cancelled");
  assert.deepEqual(first.data.appointments[0].events.map((e: any) => e.event_type),
                   ["created", "cancelled"]);
  assert.equal(first.data.dependents.length, 1);
  assert.equal(first.data.dependents[0].status, "confirmed");
  assert.equal(first.data.contacts.length, 1);
  assert.equal(first.data.contacts[0].contact_value, "pickup@example.test");

  const second = await get(path + "/" + studentId + "?limit=1&offset=1", staffCookie);
  assert.equal(second.status, 200);
  assert.equal(second.data.appointments[0].status, "completed");
  assert.equal(second.data.appointmentsPagination.hasNext, false);
  assert.equal(second.data.appointments[0].pickup_kind, "dependent");
  assert.ok(!JSON.stringify(first.data).includes("confirmAccurate"));
  assert.ok(!JSON.stringify(first.data).includes("Fictional consent for testing"));
  assert.ok(!JSON.stringify(first.data).includes("password_hash"));
  console.log("PASS: independent enrollment/survey history, booking events, and household contacts");

  const views = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM audit_logs " +
    "WHERE action='staff_student_record_viewed' AND actor_id=$1 AND target_id=$2",
    [staffId, studentId]
  );
  assert.equal(Number(views.rows[0].count), 2);
  const searches = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM audit_logs " +
    "WHERE action='staff_records_searched' AND actor_id=$1",
    [staffId]
  );
  assert.ok(Number(searches.rows[0].count) >= 3);
  // Legacy accounts have unspecified fields. An explicit choice of "none"
  // must remain distinguishable from an unanswered dietary question.
  await pool.query(
    "UPDATE profiles SET student_designation = NULL, dietary_restrictions = ARRAY[]::text[] " +
    "WHERE id = $1", [studentId]
  );
  const legacySearch = await get(path + "?search=" + encodeURIComponent(studentEmail), staffCookie);
  assert.equal(legacySearch.status, 200);
  assert.equal(legacySearch.data.students[0].student_designation, null);
  assert.deepEqual(legacySearch.data.students[0].dietary_restrictions, []);
  const legacyDetail = await get(path + "/" + studentId, staffCookie);
  assert.equal(legacyDetail.status, 200);
  assert.equal(legacyDetail.data.student.student_designation, null);
  assert.deepEqual(legacyDetail.data.student.dietary_restrictions, []);

  await pool.query(
    "UPDATE profiles SET student_designation = 'domestic', " +
    "dietary_restrictions = ARRAY['none']::text[] WHERE id = $1", [studentId]
  );
  const noneSearch = await get(path + "?search=" + encodeURIComponent(studentEmail), staffCookie);
  assert.equal(noneSearch.status, 200);
  assert.equal(noneSearch.data.students[0].student_designation, "domestic");
  assert.deepEqual(noneSearch.data.students[0].dietary_restrictions, ["none"]);
  const noneDetail = await get(path + "/" + studentId, staffCookie);
  assert.equal(noneDetail.status, 200);
  assert.equal(noneDetail.data.student.student_designation, "domestic");
  assert.deepEqual(noneDetail.data.student.dietary_restrictions, ["none"]);
  const audits = await pool.query<{ details: unknown }>(
    "SELECT details FROM audit_logs WHERE actor_id = $1 AND target_id = $2 " +
    "AND action = 'staff_student_record_viewed'", [staffId, studentId]
  );
  assert.ok(audits.rows.every(row => !JSON.stringify(row.details).includes("gluten-free")));
  assert.ok(audits.rows.every(row => !JSON.stringify(row.details).includes("vegan")));
  console.log("PASS: staff-only search/details show multiple preferences, legacy unspecified values and explicit None");
  console.log("PASS: staff record inspection and search are audited without recording dietary values");
  console.log("Unified staff records integration tests passed.");
} finally {
  // Delete only fixtures created by this test; leave other student data alone.
  if (studentId) {
    await pool.query("DELETE FROM audit_logs WHERE target_type='student' AND target_id=$1", [studentId]);
    if (bookingIds.length) {
      await pool.query("DELETE FROM booking_events WHERE booking_id = ANY($1::uuid[])", [bookingIds]);
      await pool.query("DELETE FROM bookings WHERE id = ANY($1::uuid[])", [bookingIds]);
    }
    if (slotIds.length) {
      await pool.query("DELETE FROM appointment_slots WHERE id = ANY($1::uuid[])", [slotIds]);
    }
    await pool.query("DELETE FROM dependent_requests WHERE student_id=$1", [studentId]);
    await pool.query("DELETE FROM pickup_contacts WHERE student_id=$1", [studentId]);
    await pool.query("DELETE FROM enrollment_verification_events WHERE student_id=$1", [studentId]);
    await pool.query("DELETE FROM enrollment_verifications WHERE student_id=$1", [studentId]);
    await pool.query("DELETE FROM eligibility_surveys WHERE student_id=$1", [studentId]);
    await pool.query("DELETE FROM profiles WHERE id=$1", [studentId]);
  }
  if (termIds.length) {
    await pool.query("DELETE FROM terms WHERE id = ANY($1::uuid[])", [termIds]);
  }
  await pool.end();
}
