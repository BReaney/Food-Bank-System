// Smoke tests for enrollment verification, survey and booking authorizations.
// GitHub Actions uses a disposable PostgreSQL database with fictional accounts.
// Local use requires the prototype API, a future demo slot and two free spaces.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";

const BASE = "http://localhost:3001";
const ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";

async function call(
  path: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  body?: unknown,
  cookie?: string
): Promise<{ status: number; data: any; cookie: string }> {
  const headers: Record<string, string> = { Origin: ORIGIN };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: (response.headers.get("set-cookie") ?? "").split(";")[0]
  };
}

async function makeStudent(label: string): Promise<{ id: string; cookie: string }> {
  const email = label + "-" + randomUUID() + "@example.test";
  const password = "LocalSmoke_" + randomUUID();
  const signup = await call("/api/auth/register", "POST", {
    email, firstName: label, lastName: "Example", password
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.data));
  const login = await call("/api/auth/login", "POST", { email, password });
  assert.equal(login.status, 200);
  assert.ok(login.cookie.startsWith("foodbank_session="));
  const me = await call("/api/auth/me", "GET", undefined, login.cookie);
  assert.equal(me.status, 200);
  return { id: me.data.profile.id, cookie: login.cookie };
}

try {
  const slots = await call("/api/slots");
  assert.equal(slots.status, 401, "Anonymous users should not see appointment slots");

  const staffPassword = process.env.DEMO_STAFF_PASSWORD;
  assert.ok(staffPassword, "Set demo staff password");
  const staffLogin = await call("/api/auth/login", "POST", {
    email: "staff.demo@example.com", password: staffPassword
  });
  assert.equal(staffLogin.status, 200);
  const staffCookie = staffLogin.cookie;

  const first = await makeStudent("First");
  const second = await makeStudent("Second");
  const listedSlots = await call("/api/slots", "GET", undefined, first.cookie);
  assert.equal(listedSlots.status, 200);
  const slot = listedSlots.data.slots.find((s: any) => s.is_open && s.remaining_capacity >= 2);
  assert.ok(slot, "Expected a test slot with at least two available places");

  const termId = slot.term_id as string;
  const terms = await call("/api/terms", "GET", undefined, first.cookie);
  assert.equal(terms.status, 200);
  const term = terms.data.terms.find((t: any) => t.id === termId);
  assert.ok(term, "Selected slot's term must be available");
  assert.equal(term.survey_submitted, false);
  assert.equal(term.enrollment_status, "pending");
  console.log("PASS: per-term student status starts incomplete");

  const invalid = await call("/api/terms/" + termId + "/survey", "POST", {
    enrollmentAttestation: true,
    householdType: "",
    fictionalDataConfirmation: true
  }, first.cookie);
  assert.equal(invalid.status, 400, "Missing required survey answer must be rejected");

  const survey = {
    enrollmentAttestation: true,
    householdType: "individual",
    fictionalDataConfirmation: true
  };
  assert.equal(
    (await call("/api/terms/" + termId + "/survey", "POST", survey, first.cookie)).status, 201
  );
  assert.equal(
    (await call("/api/terms/" + termId + "/survey", "POST", survey, first.cookie)).status, 409
  );
  console.log("PASS: required survey fields enforced, one submission per student/term");

  assert.equal(
    (await call("/api/bookings", "POST", { slotId: slot.id }, first.cookie)).status, 403
  );
  assert.equal(
    (await call("/api/staff/enrollment?termId=" + termId, "GET", undefined, first.cookie)).status, 403
  );
  assert.equal(
    (await call("/api/staff/enrollment/" + first.id, "PATCH", {
      termId, status: "verified"
    }, first.cookie)).status, 403
  );
  console.log("PASS: survey alone does not grant booking; student cannot access staff routes");

  const staffRoster = await call(
    "/api/staff/enrollment?termId=" + termId, "GET", undefined, staffCookie
  );
  assert.equal(staffRoster.status, 200);
  const firstRecord = staffRoster.data.students.find((s: any) => s.id === first.id);
  assert.ok(firstRecord);
  assert.equal(firstRecord.enrollment_status, "pending");
  assert.equal(firstRecord.survey_submitted, true);

  const firstApprove = await call(
    "/api/staff/enrollment/" + first.id, "PATCH",
    { termId, status: "verified" }, staffCookie
  );
  assert.equal(firstApprove.status, 200);
  assert.equal(firstApprove.data.verification.status, "verified");

  const approvedTerm = await call("/api/terms", "GET", undefined, first.cookie);
  const myTerm = approvedTerm.data.terms.find((t: any) => t.id === termId);
  assert.equal(myTerm.survey_submitted, true);
  assert.equal(myTerm.enrollment_status, "verified");
  console.log("PASS: staff approval and survey status are independent but both visible to owner");

  // Separate student is approved by staff first; survey is still mandatory.
  assert.equal(
    (await call("/api/staff/enrollment/" + second.id, "PATCH",
      { termId, status: "verified" }, staffCookie)).status, 200
  );
  assert.equal(
    (await call("/api/bookings", "POST", { slotId: slot.id }, second.cookie)).status, 403
  );
  assert.equal(
    (await call("/api/terms/" + termId + "/survey", "POST", survey, second.cookie)).status, 201
  );

  const booked1 = await call("/api/bookings", "POST", { slotId: slot.id }, first.cookie);
  const booked2 = await call("/api/bookings", "POST", { slotId: slot.id }, second.cookie);
  assert.equal(booked1.status, 201, JSON.stringify(booked1.data));
  assert.equal(booked2.status, 201, JSON.stringify(booked2.data));
  assert.equal(
    (await call("/api/bookings", "POST", { slotId: slot.id }, first.cookie)).status, 409
  );
  console.log("PASS: bookings require both checks and still enforce weekly uniqueness");

  // Check that the staff decision is independently recorded in audit_logs.
  const audit = await pool.query<{ count: number }>(
    "SELECT COUNT(*)::integer AS count FROM audit_logs " +
    "WHERE actor_id = (SELECT id FROM profiles WHERE email = $1) " +
    "AND action = 'enrollment_status_changed' " +
    "AND target_id = ANY($2::uuid[])",
    ["staff.demo@example.com", [first.id, second.id]]
  );
  assert.ok(audit.rows[0].count >= 2);
  console.log("PASS: enrollment decisions are audited");

  const rejected = await call("/api/staff/enrollment/" + second.id, "PATCH",
    { termId, status: "rejected" }, staffCookie);
  assert.equal(rejected.status, 200);
  assert.equal(rejected.data.verification.status, "rejected");
  const studentTerms = await call("/api/terms", "GET", undefined, second.cookie);
  assert.equal(
    studentTerms.data.terms.find((t: any) => t.id === termId).enrollment_status, "rejected"
  );
  console.log("PASS: student sees staff rejection for the relevant term");
  console.log("Eligibility and enrollment smoke tests passed");
} finally {
  await pool.end();
}
