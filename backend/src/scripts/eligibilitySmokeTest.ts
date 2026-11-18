// End-to-end fictional enrollment and survey workflow.
// Run with npm run test:eligibility while the backend is running.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";

const BASE = "http://localhost:3001";
const ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";

async function request(
  method: "GET" | "POST" | "PUT",
  path: string,
  cookie?: string,
  payload?: unknown
): Promise<{ status: number; body: any; cookie?: string }> {
  const headers: Record<string, string> = { Origin: ORIGIN };
  if (payload !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const result = await fetch(BASE + path, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  return {
    status: result.status,
    body: await result.json(),
    cookie: (result.headers.get("set-cookie") || "").split(";")[0]
  };
}

const unique = randomUUID();
const email = "eligibility-" + unique + "@example.test";
const password = "TestOnly_Eligibility_1234_" + unique;
const staffPassword = process.env.DEMO_STAFF_PASSWORD;
assert.ok(staffPassword, "Set DEMO_STAFF_PASSWORD before running the test");

try {
  const anonymous = await request("GET", "/api/eligibility/terms");
  assert.equal(anonymous.status, 401);

  const registration = await request("POST", "/api/auth/register", undefined, {
    email, firstName: "Eligibility", lastName: "Tester", password
  });
  assert.equal(registration.status, 201, JSON.stringify(registration.body));

  const studentLogin = await request("POST", "/api/auth/login", undefined, { email, password });
  assert.equal(studentLogin.status, 200);
  const studentCookie = studentLogin.cookie as string;
  assert.ok(studentCookie.startsWith("foodbank_session="));

  const staffLogin = await request("POST", "/api/auth/login", undefined, {
    email: "staff.demo@example.com", password: staffPassword
  });
  assert.equal(staffLogin.status, 200);
  const staffCookie = staffLogin.cookie as string;

  const termsResponse = await request("GET", "/api/eligibility/terms", studentCookie);
  assert.equal(termsResponse.status, 200);
  const terms = termsResponse.body.terms as {
    id: string; code: string; enrollment_status: string;
    survey_submitted_at: string | null;
  }[];
  const demoTerm = terms.find(term => term.code === "DEMO");
  assert.ok(demoTerm, "Demo term missing; apply migration and seed");
  assert.equal(demoTerm.enrollment_status, "pending");
  assert.equal(demoTerm.survey_submitted_at, null);
  const termId = demoTerm.id;

  const studentIdResult = await pool.query<{ id: string }>(
    "SELECT id FROM profiles WHERE email = $1", [email]
  );
  const studentId = studentIdResult.rows[0].id;

  const forbiddenStaffAction = await request(
    "PUT", "/api/staff/enrollments/" + studentId + "/" + termId,
    studentCookie, { status: "verified" }
  );
  assert.equal(forbiddenStaffAction.status, 403);
  const forbiddenStudentSurvey = await request(
    "POST", "/api/eligibility/surveys/" + termId,
    staffCookie, { confirmAccurate: true, understandVerification: true }
  );
  assert.equal(forbiddenStudentSurvey.status, 403);
  console.log("PASS: student/staff endpoint role restrictions");

  const slots = await request("GET", "/api/slots", studentCookie);
  assert.equal(slots.status, 200);
  const demoSlot = (slots.body.slots as { id: string; term_id: string; starts_at: string }[])
    .find(slot => slot.term_id === termId);
  assert.ok(demoSlot, "Demo slot missing or now in past");
  const beforeApproval = await request("POST", "/api/bookings", studentCookie, {
    slotId: demoSlot.id
  });
  assert.equal(beforeApproval.status, 403);

  const invalidSurvey = await request(
    "POST", "/api/eligibility/surveys/" + termId,
    studentCookie, { confirmAccurate: true, understandVerification: false }
  );
  assert.equal(invalidSurvey.status, 400);

  const rejected = await request(
    "PUT", "/api/staff/enrollments/" + studentId + "/" + termId,
    staffCookie, { status: "rejected" }
  );
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  const approved = await request(
    "PUT", "/api/staff/enrollments/" + studentId + "/" + termId,
    staffCookie, { status: "verified" }
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const repeated = await request(
    "PUT", "/api/staff/enrollments/" + studentId + "/" + termId,
    staffCookie, { status: "verified" }
  );
  assert.equal(repeated.status, 409);

  const staffList = await request(
    "GET", "/api/staff/enrollments?termId=" + termId, staffCookie
  );
  assert.equal(staffList.status, 200);
  assert.ok((staffList.body.students as { id: string; enrollment_status: string }[])
    .some(item => item.id === studentId && item.enrollment_status === "verified"));
  const stillBlocked = await request("POST", "/api/bookings", studentCookie, {
    slotId: demoSlot.id
  });
  assert.equal(stillBlocked.status, 403);
  console.log("PASS: staff verification alone is not enough to book");

  const submitted = await request(
    "POST", "/api/eligibility/surveys/" + termId,
    studentCookie, { confirmAccurate: true, understandVerification: true }
  );
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  const duplicateSurvey = await request(
    "POST", "/api/eligibility/surveys/" + termId,
    studentCookie, { confirmAccurate: true, understandVerification: true }
  );
  assert.equal(duplicateSurvey.status, 409);

  const nowEligible = await request("GET", "/api/eligibility/terms", studentCookie);
  assert.equal(nowEligible.status, 200);
  const record = (nowEligible.body.terms as {
    id: string; enrollment_status: string; survey_submitted_at: string | null
  }[]).find(item => item.id === termId);
  assert.equal(record?.enrollment_status, "verified");
  assert.ok(record.survey_submitted_at);

  const booked = await request("POST", "/api/bookings", studentCookie, {
    slotId: demoSlot.id
  });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));

  const duplicateBooking = await request("POST", "/api/bookings", studentCookie, {
    slotId: demoSlot.id
  });
  assert.equal(duplicateBooking.status, 409);
  console.log("PASS: both approvals allow exactly one reservation per week");

  const history = await pool.query<{ total: number }>(
    "SELECT count(*)::integer AS total FROM enrollment_verification_events " +
    "WHERE student_id = $1 AND term_id = $2",
    [studentId, termId]
  );
  assert.equal(history.rows[0].total, 2);

  const audit = await pool.query<{ total: number }>(
    "SELECT count(*)::integer AS total FROM audit_logs " +
    "WHERE target_id = $1 AND action = 'enrollment_status_changed'",
    [studentId]
  );
  assert.equal(audit.rows[0].total, 2);
  console.log("PASS: both staff decisions preserved in audit and event history");

  // Explicit policy: losing verification blocks NEW bookings, but does
  // not retroactively cancel an appointment already confirmed.
  const second = await pool.query<{id:string}>(
    `INSERT INTO appointment_slots(term_id, starts_at, ends_at, capacity)
     VALUES ($1,
       ((CURRENT_DATE + 25) + TIME '16:00') AT TIME ZONE 'America/Vancouver',
       ((CURRENT_DATE + 25) + TIME '16:20') AT TIME ZONE 'America/Vancouver', 1)
     RETURNING id`,
    [termId]
  );
  try {
    const withdrawn = await request(
      "PUT", "/api/staff/enrollments/" + studentId + "/" + termId,
      staffCookie, { status:"rejected" }
    );
    assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
    const existing = await request("GET", "/api/bookings", studentCookie);
    assert.equal(existing.status, 200);
    assert.ok(existing.body.bookings.some((b:any) =>
      b.id === booked.body.booking.id && b.status === "booked"
    ), "A confirmed reservation must survive withdrawal of enrollment approval");

    const newBooking = await request("POST", "/api/bookings", studentCookie,
      { slotId:second.rows[0].id });
    assert.equal(newBooking.status, 403, JSON.stringify(newBooking.body));
    const existingAgain = await request("GET", "/api/bookings", studentCookie);
    assert.ok(existingAgain.body.bookings.some((b:any) =>
      b.id === booked.body.booking.id && b.status === "booked"
    ));
    console.log("PASS: withdrawing verification preserves existing appointment, forbids new booking");
  } finally {
    await pool.query("DELETE FROM appointment_slots WHERE id=$1",
      [second.rows[0].id]);
  }
  console.log("Eligibility integration tests passed.");
} finally {
  await pool.end();
}
